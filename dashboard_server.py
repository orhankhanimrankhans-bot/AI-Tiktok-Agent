"""
AI TikTok Agent Dashboard Server
Provides WebSocket API for real-time pipeline tracking and REST API for controls
"""

import json
import asyncio
import logging
import sqlite3
import os
import secrets
import hashlib
import urllib.parse
import urllib.request
import urllib.error
import re
import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Optional, Set

try:
    from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect, HTTPException
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse, RedirectResponse
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn
except ImportError:
    print("ERROR: FastAPI not installed. Install with: pip install fastapi uvicorn websockets")
    exit(1)

from app.memory import DATABASE, get_all_videos, initialize_database, save_video
from app.core.jarvis_core import JarvisCore
from app.core.command_router import CommandRouter
from app.config import GEMINI_API_KEY, OPENAI_API_KEY
from app.kids_story import generate_kids_story
from app.kids_video import create_kids_video
from app.video_studio import (
    create_creatomate_job, create_veo_job, creatomate_available, list_jobs as list_studio_jobs,
    refresh_creatomate_job, refresh_veo_job, veo_available,
)
from jarvis.main import Jarvis as DesktopJarvis
from observability import create_request_id, get_logger, log_event, request_context


logger = get_logger("web")

# ============================================================
# CONFIGURATION
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parent
DASHBOARD_DIR = PROJECT_ROOT / "dashboard"
DASHBOARD_DIR.mkdir(exist_ok=True)

# TikTok OAuth Configuration
TOKEN_FILE = PROJECT_ROOT / "data" / "tiktok_tokens.json"
TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
SCHEDULE_FILE = PROJECT_ROOT / "data" / "daily_schedule.json"
FINAL_VIDEO_DIR = PROJECT_ROOT / "output" / "final"

TIKTOK_CLIENT_KEY = os.getenv("TIKTOK_CLIENT_KEY", "").strip()
TIKTOK_CLIENT_SECRET = os.getenv("TIKTOK_CLIENT_SECRET", "").strip()
TIKTOK_REDIRECT_URI = "http://127.0.0.1:8000/api/tiktok/callback"
TIKTOK_SCOPES = "user.info.basic,video.upload,video.publish"
DASHBOARD_AI_PROVIDER = os.getenv(
    "DASHBOARD_AI_PROVIDER",
    "openai",
).strip().lower()
DASHBOARD_OPENAI_MODEL = os.getenv("DASHBOARD_OPENAI_MODEL", "gpt-4.1-mini").strip()
DASHBOARD_GEMINI_MODEL = os.getenv("DASHBOARD_GEMINI_MODEL", "gemini-3.5-flash").strip()

TIKTOK_AUTH_URL = "https://www.tiktok.com/v2/auth/authorize/"
TIKTOK_TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/"

# OAuth sessions storage (in-memory for demo)
oauth_sessions = {}

app = FastAPI(title="AI TikTok Agent Dashboard")
jarvis = JarvisCore(
    DATABASE,
    max_concurrent_agents=int(os.getenv("JARVIS_MAX_CONCURRENT_AGENTS", "3")),
    safe_mode=os.getenv("JARVIS_SAFE_MODE", "0").strip() == "1",
)
command_router = CommandRouter(jarvis)
dashboard_conversation = DesktopJarvis()

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", "").strip() or create_request_id()
    with request_context(request_id):
        log_event(logger, logging.INFO, "request.received", "HTTP request received", method=request.method, path=request.url.path, interface="web")
        try:
            response = await call_next(request)
        except Exception:
            logger.exception("HTTP request failed", extra={"event": "request.failed", "method": request.method, "path": request.url.path})
            raise
        response.headers["X-Request-ID"] = request_id
        log_event(logger, logging.INFO, "request.completed", "HTTP request completed", method=request.method, path=request.url.path, status_code=response.status_code, success=response.status_code < 500)
        return response


@app.on_event("startup")
async def start_services():
    try:
        initialize_database()
        jarvis.initialize()
        asyncio.create_task(daily_scheduler())
        log_event(logger, logging.INFO, "dashboard.started", "FastAPI dashboard services started", success=True)
    except Exception:
        logger.exception("FastAPI dashboard startup failed", extra={"event": "dashboard.startup_failed"})
        raise


def serialize_task(task):
    return task.to_dict()


async def run_jarvis_objective(objective_id: str):
    """Run the local, non-publishing agent graph off the FastAPI event loop."""
    await asyncio.to_thread(jarvis.run_ready_tasks, objective_id)


@app.get("/api/jarvis/status")
async def jarvis_status():
    tasks = jarvis.tasks.list_tasks()
    return {
        "paused": jarvis.paused,
        "emergency_stopped": jarvis.permissions.emergency_stopped,
        "safe_mode": jarvis.permissions.safe_mode,
        "agents": jarvis.registry.profiles(),
        "tools": jarvis.tools.list(),
        "tasks": [serialize_task(task) for task in tasks[-80:]],
        "events": jarvis.tasks.recent_events(80),
    }


@app.post("/api/jarvis/objectives")
async def create_jarvis_objective(payload: dict):
    topic = str(payload.get("topic", "")).strip()
    if len(topic) > 220:
        raise HTTPException(status_code=400, detail="Topic must be 220 characters or fewer.")
    objective = jarvis.create_video_objective(topic, approval_required=True)
    if payload.get("run", True):
        asyncio.create_task(run_jarvis_objective(objective.id))
    return {"objective": objective.to_dict(), "message": "Jarvis created an approval-protected production plan."}


@app.post("/api/jarvis/pause")
async def pause_jarvis():
    jarvis.pause()
    return {"paused": True}


@app.post("/api/jarvis/resume")
async def resume_jarvis():
    if jarvis.permissions.emergency_stopped:
        raise HTTPException(status_code=409, detail="Emergency stop is active; use explicit reactivation.")
    jarvis.resume()
    return {"paused": False}


@app.post("/api/jarvis/emergency-stop")
async def emergency_stop_jarvis():
    jarvis.emergency_stop()
    return {"paused": True, "emergency_stopped": True}


@app.post("/api/jarvis/reactivate")
async def reactivate_jarvis():
    jarvis.reactivate()
    return {"paused": False, "emergency_stopped": False}


@app.post("/api/jarvis/tasks/{task_id}/approve")
async def approve_jarvis_task(task_id: str):
    try:
        task = jarvis.approve_publish(task_id)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    asyncio.create_task(run_jarvis_objective(task.objective_id))
    return {"task": serialize_task(task), "message": "Publishing approval released."}


@app.get("/api/jarvis/soul")
async def jarvis_soul():
    return jarvis.settings.soul()


@app.put("/api/jarvis/soul")
async def update_jarvis_soul(payload: dict):
    return jarvis.settings.update_soul(payload)


@app.post("/api/jarvis/command")
async def jarvis_command(payload: dict):
    command = str(payload.get("command", ""))
    log_event(logger, logging.INFO, "intent.selected", "Jarvis web command selected", user_input=command, intent="command", module_selection="app.core.command_router")
    result = command_router.route(command)
    if result.action == "create_video":
        asyncio.create_task(run_jarvis_objective(result.data["objective_id"]))
    return result.to_dict()


@app.get("/api/video-studio/status")
async def video_studio_status():
    return {"veo_available": veo_available(), "creatomate_available": creatomate_available(), "jobs": list_studio_jobs()}


@app.post("/api/video-studio/generate")
async def video_studio_generate(payload: dict):
    prompt = str(payload.get("prompt", "")).strip()
    provider = str(payload.get("provider", "local")).strip().lower()
    if not prompt or len(prompt) > 1200:
        raise HTTPException(status_code=400, detail="Enter a video prompt between 1 and 1200 characters.")
    if provider == "local":
        objective = jarvis.create_video_objective(prompt, approval_required=True)
        asyncio.create_task(run_jarvis_objective(objective.id))
        return {"provider": "local", "objective_id": objective.id, "status": "QUEUED"}
    if provider == "veo":
        try:
            job = await asyncio.to_thread(
                create_veo_job, prompt, int(payload.get("duration", 8)), str(payload.get("resolution", "720p"))
            )
        except (ValueError, RuntimeError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return job
    if provider == "creatomate":
        try:
            job = await asyncio.to_thread(
                create_creatomate_job,
                prompt,
                str(payload.get("supporting_text", "")),
                str(payload.get("video_source", "")),
            )
        except (ValueError, RuntimeError) as error:
            raise HTTPException(status_code=400, detail=str(error)) from error
        return job
    raise HTTPException(status_code=400, detail="Unsupported video provider.")


@app.post("/api/video-studio/jobs/{job_id}/refresh")
async def refresh_video_studio_job(job_id: str):
    try:
        jobs = {job["id"]: job for job in list_studio_jobs()}
        job = jobs.get(job_id)
        if not job:
            raise KeyError("Video Studio job was not found.")
        refresh = refresh_creatomate_job if job.get("provider") == "creatomate" else refresh_veo_job
        return await asyncio.to_thread(refresh, job_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error

# ============================================================
# TIKTOK OAUTH HELPERS
# ============================================================

def create_code_verifier():
    """Create a PKCE code verifier."""
    return secrets.token_urlsafe(64)[:128]

def create_code_challenge(code_verifier):
    """Create TikTok PKCE S256 code challenge (SHA-256 hex)."""
    return hashlib.sha256(code_verifier.encode("ascii")).hexdigest()

def check_tiktok_connected():
    """Check if TikTok token exists."""
    return TOKEN_FILE.exists()

def load_tiktok_token():
    """Load TikTok access token from file."""
    if not TOKEN_FILE.exists():
        return None
    try:
        data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
        return data.get("access_token")
    except Exception:
        logger.exception("TikTok token could not be loaded", extra={"event": "tiktok.token_load_failed"})
        return None

def delete_tiktok_token():
    """Delete TikTok token file."""
    if TOKEN_FILE.exists():
        TOKEN_FILE.unlink()

def exchange_tiktok_code(authorization_code, code_verifier):
    """Exchange TikTok authorization code for access token."""
    if not TIKTOK_CLIENT_KEY:
        raise RuntimeError("TIKTOK_CLIENT_KEY is not configured")
    
    data = urllib.parse.urlencode({
        "client_key": TIKTOK_CLIENT_KEY,
        "client_secret": TIKTOK_CLIENT_SECRET,
        "code": authorization_code,
        "grant_type": "authorization_code",
        "redirect_uri": TIKTOK_REDIRECT_URI,
        "code_verifier": code_verifier,
    }).encode("utf-8")
    
    request = urllib.request.Request(
        TIKTOK_TOKEN_URL,
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read().decode("utf-8")
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"TikTok token error HTTP {error.code}: {body}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"Could not connect to TikTok: {error}") from error
    
    result = json.loads(body)
    
    if "error" in result:
        raise RuntimeError(json.dumps(result, indent=2))
    
    return result

def save_tiktok_token(token_data):
    """Save TikTok token to file."""
    TOKEN_FILE.write_text(
        json.dumps(token_data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

# ============================================================
# WEBSOCKET MANAGER (REAL-TIME UPDATES)
# ============================================================

class ConnectionManager:
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()
        self.current_pipeline_status = {
            "running": False,
            "current_stage": None,
            "progress": 0,
            "topic": None,
            "timestamp": None,
            "error": None,
            "completed_stages": [],
        }

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)
        # Send current status to new client
        await websocket.send_json({
            "type": "status",
            "data": self.current_pipeline_status
        })

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast(self, message: dict):
        """Broadcast message to all connected clients"""
        disconnected = set()
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                logger.debug("WebSocket broadcast failed; removing connection", exc_info=True, extra={"event": "websocket.broadcast_failed"})
                disconnected.add(connection)
        
        # Clean up disconnected clients
        for conn in disconnected:
            self.disconnect(conn)

    async def update_stage(self, stage: str, progress: int, topic: str = None):
        """Update pipeline stage and broadcast to clients"""
        completed = list(self.current_pipeline_status.get("completed_stages", []))
        previous_stage = self.current_pipeline_status.get("current_stage")
        if previous_stage and previous_stage not in ("Initializing", "Failed") and previous_stage not in completed:
            completed.append(previous_stage)
        self.current_pipeline_status = {
            "running": True,
            "current_stage": stage,
            "progress": progress,
            "topic": topic,
            "timestamp": datetime.now().isoformat(),
            "error": None,
            "completed_stages": completed,
        }
        
        await self.broadcast({
            "type": "stage_update",
            "data": self.current_pipeline_status
        })

    async def complete_pipeline(self, video_data: dict):
        """Mark pipeline as complete and broadcast"""
        self.current_pipeline_status["running"] = False
        current_stage = self.current_pipeline_status.get("current_stage")
        completed = self.current_pipeline_status.setdefault("completed_stages", [])
        if current_stage and current_stage not in completed:
            completed.append(current_stage)
        
        await self.broadcast({
            "type": "pipeline_complete",
            "data": {
                "status": self.current_pipeline_status,
                "video": video_data
            }
        })

    async def fail_pipeline(self, error: str):
        self.current_pipeline_status.update({
            "running": False,
            "current_stage": "Failed",
            "error": error,
            "timestamp": datetime.now().isoformat(),
        })
        await self.broadcast({
            "type": "pipeline_failed",
            "data": self.current_pipeline_status,
        })

manager = ConnectionManager()
pipeline_task: Optional[asyncio.Task] = None
pipeline_logs: list[str] = []

STAGE_PROGRESS = {
    "[1/9]": ("Topic Selection", 11),
    "[2-4/9]": ("Source Planning", 44),
    "[2/9]": ("Script Generation", 22),
    "[3/9]": ("Visual Planning", 33),
    "[4/9]": ("Voice Generation", 44),
    "[5/9]": ("Saving Pipeline", 56),
    "[6/9]": ("Video Rendering", 67),
    "[7/9]": ("Caption Burning", 78),
    "[8/9]": ("Creating Publishing Package", 89),
    "[9/9]": ("TikTok Upload", 95),
}


def load_schedule() -> dict:
    default = {"enabled": False, "time": "09:00"}
    if not SCHEDULE_FILE.exists():
        return default
    try:
        data = json.loads(SCHEDULE_FILE.read_text(encoding="utf-8"))
        time_value = str(data.get("time", default["time"]))
        if not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time_value):
            time_value = default["time"]
        return {"enabled": bool(data.get("enabled", False)), "time": time_value}
    except (OSError, json.JSONDecodeError):
        return default


def save_schedule(schedule: dict) -> None:
    SCHEDULE_FILE.write_text(json.dumps(schedule, indent=2), encoding="utf-8")


def next_run_at(schedule: dict) -> Optional[str]:
    if not schedule["enabled"]:
        return None
    hour, minute = (int(value) for value in schedule["time"].split(":"))
    now = datetime.now()
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return target.isoformat()


def newest_final_video(started_at: datetime) -> Optional[Path]:
    if not FINAL_VIDEO_DIR.exists():
        return None
    candidates = [path for path in FINAL_VIDEO_DIR.glob("*.mp4") if path.stat().st_mtime >= started_at.timestamp()]
    return max(candidates, key=lambda path: path.stat().st_mtime) if candidates else None


async def run_pipeline_process(source: str) -> None:
    global pipeline_task, pipeline_logs
    started_at = datetime.now()
    pipeline_logs = [f"[{started_at:%Y-%m-%d %H:%M:%S}] Pipeline started ({source})."]
    log_event(logger, logging.INFO, "execution.started", "TikTok pipeline subprocess starting", module_selection="app.orchestrator", source=source)
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-u",
        "-m",
        "app.orchestrator",
        cwd=str(PROJECT_ROOT),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )
    topic = None
    try:
        assert process.stdout is not None
        async for raw_line in process.stdout:
            line = raw_line.decode("utf-8", errors="replace").rstrip()
            if not line:
                continue
            pipeline_logs.append(line)
            del pipeline_logs[:-300]
            topic_match = re.match(r"Topic:\s*(.+)", line)
            if topic_match:
                topic = topic_match.group(1).strip()
            for marker, (stage, progress) in STAGE_PROGRESS.items():
                if marker in line:
                    await manager.update_stage(stage, progress, topic)
                    break
        return_code = await process.wait()
        if return_code != 0:
            error = next((line for line in reversed(pipeline_logs) if "Error:" in line), f"Pipeline exited with code {return_code}.")
            if any("unaudited_client_can_only_post_to_private_accounts" in line for line in pipeline_logs):
                error = (
                    "TikTok blocked direct publishing: this unaudited app can only "
                    "post SELF_ONLY content while the creator account is private. "
                    "Make the TikTok account private, then run again."
                )
            await manager.fail_pipeline(error)
            log_event(logger, logging.ERROR, "execution.failed", "TikTok pipeline subprocess failed", module_selection="app.orchestrator", return_code=return_code, error=error)
            if topic:
                save_video(topic, "", 0, status="failed")
            return
        final_video = newest_final_video(started_at)
        video_path = str(final_video) if final_video else None
        if topic:
            save_video(topic, "", 0, status="completed", video_path=video_path)
        await manager.complete_pipeline({
            "topic": topic,
            "status": "completed",
            "file_path": video_path,
        })
        log_event(logger, logging.INFO, "execution.completed", "TikTok pipeline subprocess completed", module_selection="app.orchestrator", success=True, topic=topic, video_path=video_path)
    except Exception as error:
        pipeline_logs.append(f"Dashboard runner error: {error}")
        logger.exception("TikTok pipeline runner recovered from failure", extra={"event": "execution.failed", "module_selection": "app.orchestrator"})
        await manager.fail_pipeline(str(error))
    finally:
        pipeline_task = None


async def daily_scheduler() -> None:
    last_run_date: Optional[str] = None
    while True:
        schedule = load_schedule()
        now = datetime.now()
        if (
            schedule["enabled"]
            and now.strftime("%H:%M") == schedule["time"]
            and last_run_date != now.date().isoformat()
            and not manager.current_pipeline_status["running"]
        ):
            last_run_date = now.date().isoformat()
            await launch_pipeline("daily schedule")
        await asyncio.sleep(20)


async def launch_pipeline(source: str) -> None:
    global pipeline_task
    if manager.current_pipeline_status["running"] or (pipeline_task and not pipeline_task.done()):
        raise HTTPException(status_code=409, detail="Pipeline already running")
    manager.current_pipeline_status = {
        "running": True,
        "current_stage": "Initializing",
        "progress": 0,
        "topic": None,
        "timestamp": datetime.now().isoformat(),
        "error": None,
        "completed_stages": [],
    }
    await manager.broadcast({"type": "pipeline_started", "data": manager.current_pipeline_status})
    pipeline_task = asyncio.create_task(run_pipeline_process(source))

# ============================================================
# REST API ENDPOINTS
# ============================================================

@app.get("/api/config")
async def get_config():
    """Expose non-secret dashboard assistant configuration."""
    return {
        "llm_provider": DASHBOARD_AI_PROVIDER,
        "model": DASHBOARD_GEMINI_MODEL if DASHBOARD_AI_PROVIDER == "gemini" else DASHBOARD_OPENAI_MODEL if DASHBOARD_AI_PROVIDER == "openai" else None,
        "api_key_set": bool(GEMINI_API_KEY) if DASHBOARD_AI_PROVIDER == "gemini" else bool(OPENAI_API_KEY) if DASHBOARD_AI_PROVIDER == "openai" else True,
    }

@app.post("/api/config/llm-provider")
async def set_llm_provider(provider: str):
    """Switch LLM provider (ollama or openai)"""
    if provider not in ["ollama", "openai"]:
        raise HTTPException(status_code=400, detail="Invalid provider")
    
    os.environ["LLM_PROVIDER"] = provider
    
    await manager.broadcast({
        "type": "config_update",
        "data": {"llm_provider": provider}
    })
    
    return {"status": "success", "provider": provider}

@app.get("/api/videos")
async def get_videos():
    """Get all generated videos"""
    try:
        videos = get_all_videos()
        return {
            "status": "success",
            "videos": [
                {
                    "id": v[0],
                    "topic": v[1],
                    "status": v[4],
                    "path": v[5],
                    "created_at": v[6],
                    "script": v[2][:100] + "..." if len(v[2]) > 100 else v[2],
                } for v in videos
            ],
            "total": len(videos)
        }
    except Exception as error:
        logger.exception(
            "Video listing failed gracefully",
            extra={"event": "videos.list_failed", "module_selection": "memory"},
        )
        raise HTTPException(status_code=500, detail=str(error)) from error

@app.get("/api/videos/stats")
async def get_stats():
    """Get pipeline statistics"""
    try:
        videos = get_all_videos()
        total = len(videos)
        completed = sum(1 for v in videos if v[4] == "completed")
        failed = sum(1 for v in videos if v[4] == "failed")
        
        return {
            "total_videos": total,
            "completed": completed,
            "failed": failed,
            "success_rate": (completed / total * 100) if total > 0 else 0,
            "pipeline_status": manager.current_pipeline_status
        }
    except Exception as error:
        logger.exception(
            "Dashboard statistics failed gracefully",
            extra={"event": "dashboard.stats_failed", "module_selection": "memory"},
        )
        raise HTTPException(status_code=500, detail=str(error)) from error

@app.post("/api/pipeline/start")
async def start_pipeline():
    """Trigger new pipeline execution"""
    await launch_pipeline("dashboard")
    return {"status": "pipeline_started"}


@app.get("/api/pipeline/status")
async def get_pipeline_status():
    return manager.current_pipeline_status


@app.get("/api/pipeline/logs")
async def get_pipeline_logs():
    return {"logs": pipeline_logs}


@app.get("/api/videos/{video_id}/file")
async def stream_video(video_id: int):
    for video in get_all_videos():
        if video[0] != video_id:
            continue
        path = Path(video[5]).resolve() if video[5] else None
        if path and path.is_file() and FINAL_VIDEO_DIR.resolve() in path.parents:
            return FileResponse(path, media_type="video/mp4", filename=path.name)
        raise HTTPException(status_code=404, detail="The generated video file is unavailable.")
    raise HTTPException(status_code=404, detail="Video record not found.")


@app.get("/api/output-videos")
async def list_output_videos():
    """List final MP4s created by both narrated and raw-process pipelines."""
    if not FINAL_VIDEO_DIR.exists():
        return {"videos": []}

    videos = sorted(
        FINAL_VIDEO_DIR.glob("*.mp4"),
        key=lambda file: file.stat().st_mtime,
        reverse=True,
    )
    return {
        "videos": [
            {
                "name": file.name,
                "size": file.stat().st_size,
                "created_at": datetime.fromtimestamp(file.stat().st_mtime).isoformat(),
                "url": f"/api/output-videos/{urllib.parse.quote(file.name)}",
            }
            for file in videos
        ]
    }


@app.post("/api/agent/respond")
async def agent_respond(payload: dict):
    """Answer a short dashboard request through the shared ChatGPT brain."""
    message = str(payload.get("message", "")).strip()
    if not message:
        raise HTTPException(status_code=400, detail="A question is required.")
    if len(message) > 800:
        raise HTTPException(status_code=400, detail="Keep the question under 800 characters.")

    log_event(logger, logging.INFO, "intent.selected", "Dashboard conversation selected", user_input=message, intent="conversation", module_selection=DASHBOARD_AI_PROVIDER)

    try:
        response = await asyncio.to_thread(dashboard_conversation.process, message)
    except Exception as error:
        logger.exception("Dashboard ChatGPT conversation failed gracefully", extra={"event": "execution.failed", "module_selection": "openai"})
        raise HTTPException(status_code=503, detail=str(error)) from error

    log_event(logger, logging.INFO, "execution.completed", "Dashboard conversation completed", module_selection="openai", success=True, response_length=len(response.strip()))
    return {"answer": response.strip()}


@app.post("/api/kids-story")
async def create_kids_story(payload: dict):
    """Generate an original, age-appropriate one-minute story with Gemini."""
    theme = str(payload.get("theme", "")).strip()
    try:
        story = await asyncio.to_thread(generate_kids_story, theme)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    words = len(story.split())
    return {
        "story": story,
        "word_count": words,
        "estimated_duration_seconds": round(words / 2.25),
    }


@app.post("/api/kids-video")
async def create_kids_story_video(payload: dict):
    """Render a reviewable storybook MP4; TikTok publishing is separate."""
    story = str(payload.get("story", "")).strip()
    try:
        final_path = await asyncio.to_thread(create_kids_video, story)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except RuntimeError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    return {
        "filename": final_path.name,
        "url": f"/api/output-videos/{urllib.parse.quote(final_path.name)}",
    }


@app.get("/api/output-videos/{filename}")
async def open_output_video(filename: str):
    """Serve a final MP4 by basename only; path traversal is not allowed."""
    safe_name = Path(filename).name
    if safe_name != filename or not safe_name.lower().endswith(".mp4"):
        raise HTTPException(status_code=400, detail="Invalid video filename.")

    video_path = (FINAL_VIDEO_DIR / safe_name).resolve()
    if FINAL_VIDEO_DIR.resolve() not in video_path.parents or not video_path.is_file():
        raise HTTPException(status_code=404, detail="Final video not found.")

    return FileResponse(video_path, media_type="video/mp4", filename=safe_name)


@app.get("/api/schedule")
async def get_schedule():
    schedule = load_schedule()
    return {**schedule, "next_run": next_run_at(schedule)}


@app.put("/api/schedule")
async def update_schedule(schedule: dict):
    enabled = schedule.get("enabled")
    time_value = schedule.get("time")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=400, detail="enabled must be true or false")
    if not isinstance(time_value, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", time_value):
        raise HTTPException(status_code=400, detail="time must use 24-hour HH:MM format")
    saved = {"enabled": enabled, "time": time_value}
    save_schedule(saved)
    return {**saved, "next_run": next_run_at(saved)}

# ============================================================
# TIKTOK API ENDPOINTS
# ============================================================

@app.get("/api/tiktok/status")
async def get_tiktok_status():
    """Get TikTok connection status"""
    connected = check_tiktok_connected()
    return {
        "connected": connected,
        "token_exists": connected,
    }

@app.get("/api/tiktok/login")
async def tiktok_login():
    """Initiate TikTok OAuth login flow"""
    if not TIKTOK_CLIENT_KEY:
        raise HTTPException(
            status_code=500,
            detail="TikTok Client Key not configured. Set TIKTOK_CLIENT_KEY environment variable."
        )
    
    state = secrets.token_urlsafe(32)
    code_verifier = create_code_verifier()
    code_challenge = create_code_challenge(code_verifier)
    
    oauth_sessions[state] = {"code_verifier": code_verifier}
    
    params = {
        "client_key": TIKTOK_CLIENT_KEY,
        "response_type": "code",
        "scope": TIKTOK_SCOPES,
        "redirect_uri": TIKTOK_REDIRECT_URI,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    
    authorization_url = TIKTOK_AUTH_URL + "?" + urllib.parse.urlencode(params)
    
    return RedirectResponse(authorization_url, status_code=302)

@app.get("/api/tiktok/callback")
async def tiktok_callback(code: str = None, state: str = None, error: str = None, error_description: str = None):
    """Handle TikTok OAuth callback"""
    if error:
        return RedirectResponse(f"/?error=TikTok+{error}+{error_description or ''}", status_code=302)
    
    if not code or not state:
        return RedirectResponse("/?error=Missing+authorization+code", status_code=302)
    
    session = oauth_sessions.pop(state, None)
    
    if not session:
        return RedirectResponse("/?error=Invalid+or+expired+OAuth+session", status_code=302)
    
    try:
        token_data = exchange_tiktok_code(code, session["code_verifier"])
        save_tiktok_token(token_data)
        return RedirectResponse("/?tiktok_connected=true", status_code=303)
    except Exception as error:
        logger.exception(
            "TikTok OAuth token exchange failed",
            extra={"event": "tiktok.oauth_exchange_failed", "module_selection": "tiktok_oauth"},
        )
        return RedirectResponse(f"/?error=Token+exchange+failed+{str(error)}", status_code=302)

@app.post("/api/tiktok/logout")
async def tiktok_logout():
    """Disconnect TikTok account"""
    delete_tiktok_token()
    return {"status": "success", "message": "TikTok account disconnected"}

# ============================================================
# WEBSOCKET ENDPOINT (REAL-TIME UPDATES)
# ============================================================

@app.websocket("/ws/pipeline")
async def websocket_pipeline(websocket: WebSocket):
    """WebSocket endpoint for real-time pipeline updates"""
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive, server broadcasts to this client
            await asyncio.sleep(1)
    except WebSocketDisconnect:
        manager.disconnect(websocket)

# ============================================================
# SERVE DASHBOARD FRONTEND
# ============================================================

@app.get("/")
async def root():
    """Serve dashboard HTML"""
    dashboard_file = PROJECT_ROOT / "dashboard.html"
    if dashboard_file.exists():
        return FileResponse(str(dashboard_file))
    return {"error": "Dashboard file not found"}

# ============================================================
# HELPER FUNCTION FOR ORCHESTRATOR
# ============================================================

async def notify_stage_update(stage: str, progress: int, topic: str = None):
    """Call this from orchestrator.py to update dashboard"""
    await manager.update_stage(stage, progress, topic)

async def notify_pipeline_complete(video_data: dict):
    """Call this from orchestrator.py when pipeline completes"""
    await manager.complete_pipeline(video_data)

# ============================================================
# MAIN
# ============================================================

if __name__ == "__main__":
    print("Starting AI TikTok Agent Dashboard...")
    print("Dashboard: http://localhost:8000")
    print("WebSocket: ws://localhost:8000/ws/pipeline")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=int(os.getenv("DASHBOARD_PORT", "8000")),
        log_level="info"
    )
