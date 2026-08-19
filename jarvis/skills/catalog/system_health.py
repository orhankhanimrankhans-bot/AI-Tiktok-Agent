"""Small read-only skill proving package-based skill discovery."""

from __future__ import annotations

from ..base import BaseSkill, SkillContext, SkillResult


class SystemHealthSkill(BaseSkill):
    name = "system_health"
    description = "Report core Jarvis service availability"
    intents = ("system_health",)

    def execute(self, context: SkillContext) -> SkillResult:
        del context
        return SkillResult(True, "Jarvis core services are available.")
