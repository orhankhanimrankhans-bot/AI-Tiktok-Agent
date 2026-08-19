"""Config-aware skill discovery, lifecycle, and failure isolation."""

from __future__ import annotations

import importlib
import inspect
import logging
import pkgutil
from dataclasses import asdict, dataclass
from threading import RLock
from typing import Iterable

from observability import get_logger, log_event
from .base import BaseSkill, SkillContext, SkillResult


logger = get_logger("skills")


@dataclass
class SkillState:
    name: str
    enabled: bool = True
    status: str = "loaded"
    error: str = ""


class SkillRegistry:
    def __init__(self, *, enabled: Iterable[str] | None = None, disabled: Iterable[str] = ()) -> None:
        self.enabled = {name.strip().casefold() for name in enabled or () if name.strip()}
        self.disabled = {name.strip().casefold() for name in disabled if name.strip()}
        self._skills: dict[str, BaseSkill] = {}
        self._states: dict[str, SkillState] = {}
        self.active_skill: str | None = None
        self.failed_skill: str | None = None
        self._lock = RLock()
        self._active_counts: dict[str, int] = {}

    def register(self, skill: BaseSkill) -> bool:
        name = skill.name.strip().casefold()
        allowed = not self.enabled or name in self.enabled
        if name in self.disabled or not allowed:
            self._states[name] = SkillState(name, enabled=False, status="disabled")
            log_event(logger, logging.INFO, "skill.disabled", "Skill disabled by configuration", skill=name)
            return False
        with self._lock:
            self._skills[name] = skill
            self._states[name] = SkillState(name)
        log_event(logger, logging.INFO, "skill.loaded", "Skill loaded", skill=name)
        return True

    def discover(self, package_name: str) -> list[type[BaseSkill]]:
        package = importlib.import_module(package_name)
        classes: list[type[BaseSkill]] = []
        for module_info in pkgutil.iter_modules(package.__path__, package.__name__ + "."):
            module = importlib.import_module(module_info.name)
            classes.extend(
                cls for _, cls in inspect.getmembers(module, inspect.isclass)
                if issubclass(cls, BaseSkill) and cls is not BaseSkill and cls.__module__ == module.__name__
            )
        return classes

    def select(self, context: SkillContext) -> BaseSkill | None:
        with self._lock:
            candidates = [skill for skill in self._skills.values() if skill.can_handle(context)]
        return min(candidates, key=lambda skill: skill.priority, default=None)

    def execute(self, context: SkillContext) -> SkillResult:
        skill = self.select(context)
        if skill is None:
            log_event(logger, logging.WARNING, "skill.unavailable", "No enabled skill can handle request", intent=context.intent, success=False)
            return SkillResult(False, f"The {context.intent} skill is unavailable or disabled.")
        with self._lock:
            self.active_skill = skill.name
            self._active_counts[skill.name] = self._active_counts.get(skill.name, 0) + 1
            self.failed_skill = None
            self._states[skill.name].status = "active"
        log_event(logger, logging.INFO, "skill.started", "Skill execution started", skill=skill.name, intent=context.intent)
        try:
            result = skill.execute(context)
            with self._lock:
                self._states[skill.name].status = "ready" if result.success else "failed"
                if not result.success:
                    self.failed_skill = skill.name
            return result
        except Exception as error:
            with self._lock:
                self.failed_skill = skill.name
                state = self._states[skill.name]
                state.status = "failed"
                state.error = type(error).__name__
            logger.exception("Skill failed gracefully", extra={"event": "skill.failed", "skill": skill.name})
            return SkillResult(False, f"The {skill.name} skill could not complete this request. Please try again.")
        finally:
            with self._lock:
                remaining = self._active_counts.get(skill.name, 1) - 1
                if remaining > 0:
                    self._active_counts[skill.name] = remaining
                else:
                    self._active_counts.pop(skill.name, None)
                self.active_skill = next(iter(self._active_counts), None)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "loaded": sorted(self._skills),
                "active": self.active_skill,
                "failed": self.failed_skill,
                "states": {name: asdict(state) for name, state in self._states.items()},
            }
