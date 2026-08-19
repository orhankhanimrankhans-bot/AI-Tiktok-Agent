"""Persistent operational settings for the local Jarvis supervisor."""

from __future__ import annotations

import json
from typing import Any

from app.core.task_manager import TaskManager


DEFAULT_SOUL = {
    "name": "Jarvis",
    "communication_style": "concise",
    "risk_tolerance": "conservative",
    "creativity": 0.75,
    "autonomy_level": "ASSISTED",
    "quality_threshold": 85,
    "publishing_requires_approval": True,
}


class SettingsStore:
    """Small settings facade over the task manager's existing SQLite database."""

    def __init__(self, tasks: TaskManager) -> None:
        self.tasks = tasks

    def get(self, key: str, default: Any = None) -> Any:
        with self.tasks._connect() as connection:
            row = connection.execute("SELECT value FROM system_settings WHERE key = ?", (key,)).fetchone()
        return json.loads(row["value"]) if row else default

    def set(self, key: str, value: Any) -> Any:
        with self.tasks._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO system_settings VALUES (?, ?, datetime('now'))",
                (key, json.dumps(value)),
            )
        return value

    def soul(self) -> dict[str, Any]:
        return {**DEFAULT_SOUL, **(self.get("jarvis_soul", {}) or {})}

    def update_soul(self, values: dict[str, Any]) -> dict[str, Any]:
        allowed = set(DEFAULT_SOUL)
        update = {key: value for key, value in values.items() if key in allowed}
        return self.set("jarvis_soul", {**self.soul(), **update})
