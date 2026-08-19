"""Shared, serializable models used by Jarvis Core."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any
from uuid import uuid4


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class AgentStatus(str, Enum):
    OFFLINE = "OFFLINE"
    IDLE = "IDLE"
    THINKING = "THINKING"
    WAITING = "WAITING"
    WORKING = "WORKING"
    REVIEWING = "REVIEWING"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"


class TaskStatus(str, Enum):
    PENDING = "PENDING"
    READY = "READY"
    RUNNING = "RUNNING"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    PAUSED = "PAUSED"
    BLOCKED = "BLOCKED"
    FAILED = "FAILED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    REVIEW_REQUIRED = "REVIEW_REQUIRED"


class PermissionLevel(int, Enum):
    """Impact level checked before a registered tool can execute."""

    READ_ONLY = 0
    SAFE_ACTION = 1
    CONFIRM_REQUIRED = 2
    ADMIN_HIGH_IMPACT = 3


class ApprovalStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    DENIED = "DENIED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class ToolExecutionStatus(str, Enum):
    REQUESTED = "REQUESTED"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    DENIED = "DENIED"
    CANCELLED = "CANCELLED"


class Priority(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


@dataclass(slots=True, frozen=True)
class ToolDefinition:
    name: str
    description: str
    input_schema: dict[str, Any]
    permission_level: PermissionLevel
    timeout_seconds: int = 30
    category: str = "SYSTEM"
    enabled: bool = True

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["permission_level"] = self.permission_level.value
        return value


@dataclass(slots=True)
class ToolCall:
    tool: str
    arguments: dict[str, Any] = field(default_factory=dict)
    objective_id: str | None = None
    task_id: str | None = None
    requested_by: str = "user"
    operation_id: str = field(default_factory=lambda: str(uuid4()))
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class ToolResult:
    tool: str
    success: bool
    message: str
    data: dict[str, Any] = field(default_factory=dict)
    call_id: str | None = None
    error_code: str | None = None
    started_at: str | None = None
    completed_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class Approval:
    tool_call_id: str
    permission_level: PermissionLevel
    summary: str
    consequences: str = ""
    id: str = field(default_factory=lambda: str(uuid4()))
    status: ApprovalStatus = ApprovalStatus.PENDING
    requested_at: str = field(default_factory=utc_now)
    resolved_at: str | None = None
    resolved_by: str | None = None

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["permission_level"] = self.permission_level.value
        value["status"] = self.status.value
        return value


@dataclass(slots=True)
class Objective:
    title: str
    description: str = ""
    priority: Priority = Priority.MEDIUM
    category: str = "CONTENT"
    approval_required: bool = True
    input_data: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid4()))
    status: TaskStatus = TaskStatus.PENDING
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["priority"] = self.priority.value
        value["status"] = self.status.value
        return value


@dataclass(slots=True)
class Task:
    title: str
    agent_id: str
    action: str
    objective_id: str
    description: str = ""
    category: str = "CONTENT"
    priority: Priority = Priority.MEDIUM
    dependencies: list[str] = field(default_factory=list)
    input_data: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: str(uuid4()))
    status: TaskStatus = TaskStatus.PENDING
    progress: int = 0
    retries: int = 0
    max_retries: int = 1
    output_data: dict[str, Any] = field(default_factory=dict)
    error_message: str | None = None
    created_at: str = field(default_factory=utc_now)
    started_at: str | None = None
    completed_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["priority"] = self.priority.value
        value["status"] = self.status.value
        return value


@dataclass(slots=True)
class AgentProfile:
    id: str
    name: str
    role: str
    description: str
    capabilities: list[str]
    tools: list[str]
    status: AgentStatus = AgentStatus.IDLE
    current_task_id: str | None = None
    retry_count: int = 0
    completed_tasks: int = 0
    failed_tasks: int = 0
    last_activity: str = field(default_factory=utc_now)

    def to_dict(self) -> dict[str, Any]:
        value = asdict(self)
        value["status"] = self.status.value
        return value
