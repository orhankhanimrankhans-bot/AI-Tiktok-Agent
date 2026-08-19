"""Central authorization policy for every Jarvis tool invocation."""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from threading import RLock

from app.core.models import PermissionLevel, ToolDefinition


class AutonomyMode(str, Enum):
    MANUAL = "MANUAL"
    ASSISTED = "ASSISTED"
    AUTONOMOUS = "AUTONOMOUS"


class PermissionDecision(str, Enum):
    ALLOW = "ALLOW"
    CONFIRM = "CONFIRM"
    DENY = "DENY"


@dataclass(slots=True, frozen=True)
class PermissionCheck:
    decision: PermissionDecision
    reason: str


class PermissionManager:
    def __init__(self, mode: AutonomyMode = AutonomyMode.ASSISTED, safe_mode: bool = False) -> None:
        self.mode = mode
        self.safe_mode = safe_mode
        self._emergency_stopped = False
        self._lock = RLock()

    @property
    def emergency_stopped(self) -> bool:
        with self._lock:
            return self._emergency_stopped

    def emergency_stop(self) -> None:
        with self._lock:
            self._emergency_stopped = True

    def reactivate(self) -> None:
        with self._lock:
            self._emergency_stopped = False

    def check(self, tool: ToolDefinition) -> PermissionCheck:
        if not tool.enabled:
            return PermissionCheck(PermissionDecision.DENY, "This tool is disabled.")
        if self.emergency_stopped:
            return PermissionCheck(PermissionDecision.DENY, "Jarvis emergency stop is active.")
        level = tool.permission_level
        if self.safe_mode and level >= PermissionLevel.CONFIRM_REQUIRED:
            return PermissionCheck(PermissionDecision.DENY, "Safe mode blocks consequential actions.")
        if level == PermissionLevel.READ_ONLY:
            return PermissionCheck(PermissionDecision.ALLOW, "Read-only action.")
        if level == PermissionLevel.SAFE_ACTION:
            if self.mode == AutonomyMode.MANUAL:
                return PermissionCheck(PermissionDecision.CONFIRM, "Manual mode requires approval.")
            return PermissionCheck(PermissionDecision.ALLOW, "Safe action allowed by autonomy mode.")
        return PermissionCheck(PermissionDecision.CONFIRM, "Explicit user approval is required.")
