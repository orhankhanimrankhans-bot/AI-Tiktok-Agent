"""Agents that wrap existing, tested pipeline modules instead of duplicating them."""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from app.agents.base_agent import BaseAgent
from app.core.models import Task


PROJECT_ROOT = Path(__file__).resolve().parents[2]
PIPELINE_DIR = PROJECT_ROOT / "output" / "pipeline"
FINAL_DIR = PROJECT_ROOT / "output" / "final"


def safe_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "_", value).strip("_") or "tiktok_video"


class TopicAgent(BaseAgent):
    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        topic = str(task.input_data.get("topic") or "").strip()
        if not topic:
            from app.topic_manager import choose_new_topic
            topic = str(choose_new_topic()).strip()
        if not topic:
            raise RuntimeError("Topic manager returned an empty topic.")
        return {"topic": topic}


class ScriptAgent(BaseAgent):
    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        from app.orchestrator import clean_script, generate_script, validate_script
        topic = str(context.get("topic") or task.input_data.get("topic") or "").strip()
        if not topic:
            raise RuntimeError("A topic is required before script generation.")
        script = clean_script(generate_script(topic))
        validate_script(script)
        return {"topic": topic, "script": script, "word_count": len(script.split())}


class ScriptQualityAgent(BaseAgent):
    """Local, deterministic quality gate; never invents facts or pass scores."""

    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        script = str(context.get("script") or "").strip()
        words = script.split()
        score = 0
        reasons: list[str] = []
        if 40 <= len(words) <= 90:
            score += 30
        else:
            reasons.append("Narration must be between 40 and 90 words.")
        if script and script.rstrip().endswith((".", "!", "?")):
            score += 10
        else:
            reasons.append("Narration should finish as a complete sentence.")
        if len(words) >= 5 and any(mark in script[:120] for mark in ("?", "!")):
            score += 20
        else:
            reasons.append("Opening needs a stronger curiosity hook.")
        if len(set(word.lower().strip(".,!?'") for word in words)) >= max(12, len(words) // 2):
            score += 20
        else:
            reasons.append("Narration is overly repetitive.")
        forbidden = ("your task", "instructions", "constraints", "as an ai")
        if not any(item in script.lower() for item in forbidden):
            score += 20
        else:
            reasons.append("Narration contains instruction leakage.")
        return {"script_score": score, "qc_result": "PASS" if score >= 85 else "FAIL", "qc_reasons": reasons}


class VisualAgent(BaseAgent):
    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        from app.visual_planner import create_visual_plan
        topic, script = str(context.get("topic") or ""), str(context.get("script") or "")
        plan = create_visual_plan(script=script, topic=topic)
        if not plan:
            raise RuntimeError("Visual planner returned no scenes.")
        return {"visual_plan": plan}


class VoiceAgent(BaseAgent):
    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        from app.voice.script_voice_pipeline import script_to_voice
        script = str(context.get("script") or "")
        result = script_to_voice(script=script, video_id=f"jarvis_{task.objective_id[:8]}", minimum_accuracy=80.0)
        if not result or not result.get("approved"):
            raise RuntimeError("Voice generation or validation did not pass.")
        return {"voice": result}


class PipelineStateAgent(BaseAgent):
    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        from app.orchestrator import save_pipeline_data
        pipeline_file = save_pipeline_data(
            topic=str(context["topic"]), script=str(context["script"]),
            visual_plan=context["visual_plan"], voice_result=context["voice"],
        )
        return {"pipeline_file": str(pipeline_file)}


class ModuleAgent(BaseAgent):
    """Runs only an explicitly registered local module, never arbitrary commands."""

    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        modules = {
            "render_video": "app.video.renderer",
            "burn_captions": "app.video.caption_renderer",
            "build_package": "app.publishing.publisher",
        }
        module = modules.get(task.action)
        if not module:
            raise RuntimeError(f"Unapproved module action: {task.action}")
        result = subprocess.run([sys.executable, "-m", module], cwd=PROJECT_ROOT, text=True, capture_output=True)
        if result.returncode:
            raise RuntimeError((result.stderr or result.stdout)[-1500:])
        return {"module": module, "log_tail": result.stdout[-1200:]}


class FinalQualityAgent(BaseAgent):
    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        from app.video.quality_check import check_video
        files = sorted(FINAL_DIR.glob("*.mp4"), key=lambda path: path.stat().st_mtime)
        if not files:
            raise RuntimeError("No final MP4 exists for quality control.")
        video = files[-1]
        if not check_video(video):
            raise RuntimeError("Final MP4 did not pass technical quality control.")
        return {"video_path": str(video), "video_qc": "PASS"}


class PublisherAgent(ModuleAgent):
    """Uses the existing publisher only after Jarvis Core releases approval."""

    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        if task.action != "publish":
            raise RuntimeError("Publisher received an unsupported action.")
        result = subprocess.run(
            [sys.executable, "-m", "app.publishing.tiktok_publisher"],
            cwd=PROJECT_ROOT, text=True, capture_output=True,
        )
        if result.returncode:
            raise RuntimeError((result.stderr or result.stdout)[-1500:])
        # The publisher's own status monitor is authoritative. Preserve its log for review.
        return {"publish_attempted": True, "publisher_log_tail": result.stdout[-1600:]}
