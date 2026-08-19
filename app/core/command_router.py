"""Strictly allowlisted text/voice command router for Jarvis."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.core.jarvis_core import JarvisCore
from app.core.models import Approval, ToolCall, ToolResult
from app.language.urdu import UrduCommandNormalizer


@dataclass(slots=True)
class CommandResult:
    action: str
    message: str
    data: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return {"action": self.action, "message": self.message, "data": self.data}


class CommandRouter:
    """Maps selected command phrases to safe Jarvis APIs; no shell execution exists here."""

    def __init__(self, core: JarvisCore) -> None:
        self.core = core
        self.language = UrduCommandNormalizer()

    def route(self, command: str) -> CommandResult:
        language_result = self.language.normalize(command)
        text = language_result.normalized
        lowered = text.lower()
        if not text:
            return CommandResult("help", "Say a Jarvis command or enter a topic.", {})
        if lowered in {"jarvis emergency stop", "jarvis emergency stop.", "/jarvis stop", "emergency stop"}:
            self.core.emergency_stop()
            return CommandResult("emergency_stop", "Emergency stop is active. New actions are blocked.", {})
        if lowered in {"/jarvis reactivate", "jarvis reactivate"}:
            self.core.reactivate()
            return CommandResult("reactivate", "Jarvis action execution is active again.", {})
        whatsapp_command = bool(re.search(
            r"\bwhatsapp\b|^(?:hello\s+jarvis[,. ]*|jarvis[,. ]*)?(?:message|tell|send)\b",
            text, re.I,
        ))
        if whatsapp_command:
            outcome = self.core.whatsapp.execute(text)
            return CommandResult("whatsapp", outcome.message, outcome.to_dict())
        app_match = re.match(
            r"^(?:hello\s+jarvis[,. ]*|jarvis[,. ]*)?(?:please\s+)?open\s+(?:my\s+)?(.+?)[.!]?$",
            text, re.I,
        )
        if app_match:
            application = app_match.group(1).strip()
            try:
                outcome = self.core.tools.request(ToolCall("open_application", {"application": application}))
            except ValueError as error:
                return CommandResult("open_application", str(error), {"success": False})
            if isinstance(outcome, Approval):
                return CommandResult("approval_required", outcome.summary, {"approval": outcome.to_dict()})
            message = outcome.data.get("message", outcome.message) if isinstance(outcome, ToolResult) else "Application request processed."
            return CommandResult("open_application", message, outcome.to_dict())
        topic_match = re.match(r"(?:jarvis[, ]+)?(?:create|make)(?:\s+(?:a|today's))?\s+(?:tiktok\s+)?video(?:\s+about)?\s+(.+)", text, re.I)
        if topic_match:
            topic = topic_match.group(1).strip(" .")
            objective = self.core.create_video_objective(topic, approval_required=True)
            return CommandResult("create_video", "Jarvis created a production objective.", {"objective_id": objective.id, "topic": topic})
        if lowered in {"/pipeline pause", "pause pipeline", "jarvis pause", "pause"}:
            self.core.pause()
            return CommandResult("pause", "Jarvis paused new task execution.", {})
        if lowered in {"/pipeline resume", "resume pipeline", "jarvis resume", "resume"}:
            self.core.resume()
            return CommandResult("resume", "Jarvis resumed task execution.", {})
        if lowered in {"/task list", "show pending tasks", "show me the current task", "current task"}:
            tasks = [task.to_dict() for task in self.core.tasks.list_tasks() if task.status.value not in {"COMPLETED", "CANCELLED"}]
            return CommandResult("task_list", f"Jarvis has {len(tasks)} unfinished task(s).", {"tasks": tasks})
        if lowered in {"/agent list", "/agent status", "agent status"}:
            agents = self.core.registry.profiles()
            return CommandResult("agent_status", "Jarvis agent status is ready.", {"agents": agents})
        if lowered in {"/system status", "system status", "jarvis status"}:
            return CommandResult("system_status", "Jarvis Core is online.", {
                "paused": self.core.paused, "emergency_stopped": self.core.permissions.emergency_stopped,
                "agents": self.core.registry.profiles(),
            })
        if lowered in {"/tools list", "tools list"}:
            return CommandResult("tool_list", "Registered Jarvis tools.", {"tools": self.core.tools.list()})
        return CommandResult("help", "Supported: open an allowlisted application, create a video about [topic], pause, resume, task list, agent status, or system status.", {})
