"""Optional Veo job client plus the local Jarvis video-production entry point."""

from __future__ import annotations

import json
import logging
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4
from observability import get_logger


logger = get_logger("video_studio")

from app.config import GEMINI_API_KEY


PROJECT_ROOT = Path(__file__).resolve().parent.parent
STUDIO_DIR = PROJECT_ROOT / "output" / "video_studio"
JOB_FILE = STUDIO_DIR / "jobs.json"
VEO_MODEL = os.getenv("VEO_MODEL", "veo-3.1-fast-generate-preview").strip()
CREATOMATE_API_URL = "https://api.creatomate.com/v2/renders"
CREATOMATE_TEMPLATE_ID = os.getenv("CREATOMATE_TEMPLATE_ID", "d95aee92-e353-435b-a6b8-bb85c91d529f").strip()
CREATOMATE_DEFAULT_SOURCE = os.getenv(
    "CREATOMATE_DEFAULT_VIDEO_SOURCE",
    "https://creatomate.com/files/assets/7347c3b7-e1a8-4439-96f1-f3dfc95c3d28",
).strip()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_jobs() -> list[dict[str, Any]]:
    if not JOB_FILE.exists():
        return []
    try:
        return json.loads(JOB_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []


def _save_jobs(jobs: list[dict[str, Any]]) -> None:
    STUDIO_DIR.mkdir(parents=True, exist_ok=True)
    JOB_FILE.write_text(json.dumps(jobs, indent=2), encoding="utf-8")


def list_jobs() -> list[dict[str, Any]]:
    return sorted(_load_jobs(), key=lambda item: item["created_at"], reverse=True)[:30]


def _update_job(job_id: str, **updates: Any) -> dict[str, Any]:
    jobs = _load_jobs()
    for job in jobs:
        if job["id"] == job_id:
            job.update(updates)
            _save_jobs(jobs)
            return job
    raise KeyError("Video Studio job was not found.")


def veo_available() -> bool:
    return bool(GEMINI_API_KEY and os.getenv("VEO_ENABLED", "0").strip() == "1")


def creatomate_available() -> bool:
    return bool(os.getenv("CREATOMATE_API_KEY", "").strip() and CREATOMATE_TEMPLATE_ID)


def _creatomate_request(url: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    api_key = os.getenv("CREATOMATE_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("Creatomate is not configured. Add CREATOMATE_API_KEY to .env and restart the dashboard.")
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "User-Agent": "AI-TikTok-Agent/1.0",
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(detail).get("message", detail)
        except json.JSONDecodeError:
            logger.debug("Creatomate returned a non-JSON error body", extra={"event": "creatomate.non_json_error"})
        raise RuntimeError(f"Creatomate request failed ({error.code}): {detail}") from error


def create_creatomate_job(headline: str, supporting_text: str = "", video_source: str = "") -> dict[str, Any]:
    """Render the user's Creatomate template with safe text/source modifications."""
    headline = headline.strip()
    if not headline:
        raise ValueError("A headline is required for the Creatomate template.")
    source = (video_source or CREATOMATE_DEFAULT_SOURCE).strip()
    if not source.startswith(("https://", "http://")):
        raise ValueError("Creatomate video source must be an http or https URL.")
    modifications = {
        "Video.source": source,
        "Text-1.text": headline,
        "Text-2.text": supporting_text.strip() or headline,
    }
    result = _creatomate_request(
        CREATOMATE_API_URL,
        method="POST",
        body={"template_id": CREATOMATE_TEMPLATE_ID, "modifications": modifications},
    )
    render = result[0] if isinstance(result, list) and result else result
    if not isinstance(render, dict) or not render.get("id"):
        raise RuntimeError("Creatomate did not return a render ID.")
    status = str(render.get("status", "planned")).upper()
    job = {
        "id": str(uuid4()), "provider": "creatomate", "render_id": render["id"],
        "template_id": CREATOMATE_TEMPLATE_ID, "prompt": headline,
        "supporting_text": supporting_text.strip(), "source": source,
        "status": "COMPLETED" if status == "SUCCEEDED" else "FAILED" if status == "FAILED" else "GENERATING",
        "created_at": _now(), "updated_at": _now(),
    }
    if render.get("url"):
        job["video_url"] = render["url"]
    if render.get("snapshot_url"):
        job["snapshot_url"] = render["snapshot_url"]
    jobs = _load_jobs()
    jobs.append(job)
    _save_jobs(jobs)
    return job


def create_veo_job(prompt: str, duration: int = 8, resolution: str = "720p") -> dict[str, Any]:
    """Start a paid Veo operation. The caller must opt in via VEO_ENABLED=1."""
    if not veo_available():
        raise RuntimeError("Veo is not enabled. Set VEO_ENABLED=1 only after enabling Gemini API billing and Veo access.")
    prompt = prompt.strip()
    if not prompt:
        raise ValueError("A video prompt is required.")
    if duration not in {4, 6, 8}:
        raise ValueError("Veo duration must be 4, 6, or 8 seconds.")
    if resolution not in {"720p", "1080p"}:
        raise ValueError("Resolution must be 720p or 1080p.")
    if resolution == "1080p" and duration != 8:
        raise ValueError("Veo supports 1080p only for 8-second clips.")
    body = {
        "instances": [{"prompt": prompt}],
        "parameters": {"aspectRatio": "9:16", "durationSeconds": duration, "resolution": resolution},
    }
    url = "https://generativelanguage.googleapis.com/v1beta/models/" + urllib.parse.quote(VEO_MODEL, safe="-._") + ":predictLongRunning"
    request = urllib.request.Request(url, data=json.dumps(body).encode("utf-8"), headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_API_KEY})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            operation = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        try:
            detail = json.loads(detail).get("error", {}).get("message", detail)
        except json.JSONDecodeError:
            logger.debug("Veo returned a non-JSON error body", extra={"event": "veo.non_json_error"})
        raise RuntimeError(f"Veo request failed ({error.code}): {detail}") from error
    job = {
        "id": str(uuid4()), "provider": "veo", "model": VEO_MODEL, "prompt": prompt,
        "duration": duration, "resolution": resolution, "status": "QUEUED",
        "operation": operation.get("name"), "created_at": _now(), "updated_at": _now(),
    }
    if not job["operation"]:
        raise RuntimeError("Veo did not return an operation identifier.")
    jobs = _load_jobs()
    jobs.append(job)
    _save_jobs(jobs)
    return job


def refresh_veo_job(job_id: str) -> dict[str, Any]:
    job = next((item for item in _load_jobs() if item["id"] == job_id), None)
    if not job:
        raise KeyError("Video Studio job was not found.")
    if job["provider"] != "veo" or job["status"] in {"COMPLETED", "FAILED"}:
        return job
    url = "https://generativelanguage.googleapis.com/v1beta/" + job["operation"]
    request = urllib.request.Request(url, headers={"x-goog-api-key": GEMINI_API_KEY})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            operation = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        return _update_job(job_id, status="FAILED", error=f"Veo status failed ({error.code})", updated_at=_now())
    if not operation.get("done"):
        return _update_job(job_id, status="GENERATING", updated_at=_now())
    if operation.get("error"):
        return _update_job(job_id, status="FAILED", error=str(operation["error"]), updated_at=_now())
    videos = operation.get("response", {}).get("generatedVideos") or operation.get("response", {}).get("generateVideoResponse", {}).get("generatedSamples", [])
    video = videos[0] if videos else {}
    resource = video.get("video", video)
    uri = resource.get("uri") if isinstance(resource, dict) else None
    if not uri:
        return _update_job(job_id, status="FAILED", error="Veo completed without a downloadable video URI.", updated_at=_now())
    return _update_job(job_id, status="COMPLETED", video_uri=uri, updated_at=_now())


def refresh_creatomate_job(job_id: str) -> dict[str, Any]:
    job = next((item for item in _load_jobs() if item["id"] == job_id), None)
    if not job:
        raise KeyError("Video Studio job was not found.")
    if job["provider"] != "creatomate" or job["status"] in {"COMPLETED", "FAILED"}:
        return job
    render = _creatomate_request(f"{CREATOMATE_API_URL}/{urllib.parse.quote(job['render_id'], safe='-')}")
    status = str(render.get("status", "planned")).upper()
    updates: dict[str, Any] = {"updated_at": _now()}
    if status == "SUCCEEDED":
        updates.update({"status": "COMPLETED", "video_url": render.get("url"), "snapshot_url": render.get("snapshot_url")})
    elif status == "FAILED":
        updates.update({"status": "FAILED", "error": render.get("error_message", "Creatomate render failed.")})
    else:
        updates["status"] = "GENERATING"
    return _update_job(job_id, **updates)
