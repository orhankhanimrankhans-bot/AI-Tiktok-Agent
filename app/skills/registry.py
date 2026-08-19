"""Skill metadata keeps agent tool access explicit and auditable."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable


@dataclass(frozen=True, slots=True)
class Skill:
    name: str
    description: str
    allowed_agents: tuple[str, ...]
    handler: Callable | None = None
    timeout_seconds: int = 180


class SkillRegistry:
    def __init__(self) -> None:
        self._skills: dict[str, Skill] = {}

    def register(self, skill: Skill) -> None:
        self._skills[skill.name] = skill

    def get(self, name: str) -> Skill:
        return self._skills[name]

    def list(self) -> list[dict]:
        return [
            {"name": skill.name, "description": skill.description,
             "allowed_agents": list(skill.allowed_agents), "timeout_seconds": skill.timeout_seconds}
            for skill in self._skills.values()
        ]

