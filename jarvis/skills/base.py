"""Common contract shared by every orchestrated Jarvis skill."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any


@dataclass(frozen=True)
class SkillContext:
    user_input: str
    intent: str = "conversation"
    arguments: dict[str, Any] = field(default_factory=dict)
    conversation: Any = None


@dataclass(frozen=True)
class SkillResult:
    success: bool
    response: str = ""
    payload: Any = None


class BaseSkill(ABC):
    """Skills are isolated executors; only the orchestrator may invoke them."""

    name = "base"
    description = "Base skill"
    intents: tuple[str, ...] = ()
    priority = 100

    def can_handle(self, context: SkillContext) -> bool:
        return context.intent in self.intents

    @abstractmethod
    def execute(self, context: SkillContext) -> SkillResult:
        raise NotImplementedError
