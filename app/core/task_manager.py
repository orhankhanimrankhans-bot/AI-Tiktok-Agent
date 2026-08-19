"""SQLite-backed objectives, tasks, checkpoints, and event history."""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from pathlib import Path
from threading import RLock
from typing import Any, Iterable, Iterator

from app.core.event_bus import Event, EventBus
from app.core.models import (
    Approval,
    ApprovalStatus,
    Objective,
    PermissionLevel,
    Priority,
    Task,
    TaskStatus,
    ToolCall,
    ToolExecutionStatus,
    ToolResult,
    utc_now,
)


class TaskManager:
    def __init__(self, database: Path, events: EventBus) -> None:
        self.database = database
        self.events = events
        self._lock = RLock()

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.database)
        connection.row_factory = sqlite3.Row
        try:
            yield connection
            connection.commit()
        finally:
            connection.close()

    def initialize(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS objectives (
                    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
                    priority TEXT NOT NULL, category TEXT NOT NULL,
                    approval_required INTEGER NOT NULL, status TEXT NOT NULL,
                    input_data TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    id TEXT PRIMARY KEY, objective_id TEXT NOT NULL, agent_id TEXT NOT NULL,
                    action TEXT NOT NULL, title TEXT NOT NULL, description TEXT NOT NULL,
                    category TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
                    dependencies TEXT NOT NULL, progress INTEGER NOT NULL, retries INTEGER NOT NULL,
                    max_retries INTEGER NOT NULL, input_data TEXT NOT NULL, output_data TEXT NOT NULL,
                    error_message TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_tasks_objective ON tasks(objective_id);
                CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
                CREATE TABLE IF NOT EXISTS agent_events (
                    id TEXT PRIMARY KEY, type TEXT NOT NULL, objective_id TEXT, task_id TEXT,
                    agent_id TEXT, payload TEXT NOT NULL, created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS checkpoints (
                    objective_id TEXT NOT NULL, checkpoint TEXT NOT NULL, data TEXT NOT NULL,
                    created_at TEXT NOT NULL, PRIMARY KEY(objective_id, checkpoint)
                );
                CREATE TABLE IF NOT EXISTS system_settings (
                    key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS tool_executions (
                    id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, tool TEXT NOT NULL,
                    arguments TEXT NOT NULL, objective_id TEXT, task_id TEXT,
                    requested_by TEXT NOT NULL, status TEXT NOT NULL, result TEXT,
                    error_code TEXT, created_at TEXT NOT NULL, started_at TEXT, completed_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_tool_executions_status ON tool_executions(status);
                CREATE TABLE IF NOT EXISTS approvals (
                    id TEXT PRIMARY KEY, tool_call_id TEXT NOT NULL, permission_level INTEGER NOT NULL,
                    summary TEXT NOT NULL, consequences TEXT NOT NULL, status TEXT NOT NULL,
                    requested_at TEXT NOT NULL, resolved_at TEXT, resolved_by TEXT,
                    FOREIGN KEY(tool_call_id) REFERENCES tool_executions(id)
                );
                CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
                """
            )
        self.events.subscribe("*", self._persist_event)

    def _persist_event(self, event: Event) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO agent_events VALUES (?, ?, ?, ?, ?, ?, ?)",
                (event.id, event.type, event.objective_id, event.task_id, event.agent_id,
                 json.dumps(event.payload), event.created_at),
            )

    def create_objective(self, objective: Objective) -> Objective:
        with self._connect() as connection:
            connection.execute(
                "INSERT INTO objectives VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (objective.id, objective.title, objective.description, objective.priority.value,
                 objective.category, int(objective.approval_required), objective.status.value,
                 json.dumps(objective.input_data), objective.created_at, objective.updated_at),
            )
        self.events.publish(Event("OBJECTIVE_CREATED", objective.to_dict(), objective.id))
        return objective

    def add_tasks(self, tasks: Iterable[Task]) -> list[Task]:
        items = list(tasks)
        with self._connect() as connection:
            connection.executemany(
                "INSERT INTO tasks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [(task.id, task.objective_id, task.agent_id, task.action, task.title,
                  task.description, task.category, task.priority.value, task.status.value,
                  json.dumps(task.dependencies), task.progress, task.retries, task.max_retries,
                  json.dumps(task.input_data), json.dumps(task.output_data), task.error_message,
                  task.created_at, task.started_at, task.completed_at) for task in items],
            )
        for task in items:
            self.events.publish(Event("TASK_CREATED", task.to_dict(), task.objective_id, task.id, task.agent_id))
        return items

    @staticmethod
    def _task(row: sqlite3.Row) -> Task:
        return Task(
            id=row["id"], objective_id=row["objective_id"], agent_id=row["agent_id"],
            action=row["action"], title=row["title"], description=row["description"],
            category=row["category"], priority=Priority(row["priority"]), status=TaskStatus(row["status"]),
            dependencies=json.loads(row["dependencies"]), progress=row["progress"], retries=row["retries"],
            max_retries=row["max_retries"], input_data=json.loads(row["input_data"]),
            output_data=json.loads(row["output_data"]), error_message=row["error_message"],
            created_at=row["created_at"], started_at=row["started_at"], completed_at=row["completed_at"],
        )

    def get_task(self, task_id: str) -> Task | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return self._task(row) if row else None

    def list_tasks(self, objective_id: str | None = None) -> list[Task]:
        query = "SELECT * FROM tasks" + (" WHERE objective_id = ?" if objective_id else "") + " ORDER BY created_at"
        with self._connect() as connection:
            rows = connection.execute(query, (objective_id,) if objective_id else ()).fetchall()
        return [self._task(row) for row in rows]

    def ready_tasks(self, objective_id: str | None = None) -> list[Task]:
        all_tasks = self.list_tasks(objective_id)
        completed = {task.id for task in all_tasks if task.status == TaskStatus.COMPLETED}
        priority_order = {Priority.CRITICAL: 0, Priority.HIGH: 1, Priority.MEDIUM: 2, Priority.LOW: 3}
        return sorted(
            [task for task in all_tasks if task.status == TaskStatus.PENDING and set(task.dependencies) <= completed],
            key=lambda task: (priority_order[task.priority], task.created_at),
        )

    def update_task(self, task: Task, event_type: str = "TASK_PROGRESS") -> Task:
        with self._connect() as connection:
            connection.execute(
                """UPDATE tasks SET status=?, progress=?, retries=?, output_data=?, error_message=?,
                   started_at=?, completed_at=? WHERE id=?""",
                (task.status.value, task.progress, task.retries, json.dumps(task.output_data),
                 task.error_message, task.started_at, task.completed_at, task.id),
            )
        self.events.publish(Event(event_type, task.to_dict(), task.objective_id, task.id, task.agent_id))
        return task

    def dependency_output(self, task: Task) -> dict[str, Any]:
        context: dict[str, Any] = {}
        for dependency in task.dependencies:
            source = self.get_task(dependency)
            if source:
                context.update(source.output_data)
        return context

    def checkpoint(self, objective_id: str, name: str, data: dict[str, Any]) -> None:
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO checkpoints VALUES (?, ?, ?, ?)",
                (objective_id, name, json.dumps(data), utc_now()),
            )
        self.events.publish(Event("MEMORY_UPDATED", {"checkpoint": name}, objective_id))

    def recent_events(self, limit: int = 100) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM agent_events ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [{**dict(row), "payload": json.loads(row["payload"])} for row in rows]

    def record_tool_call(
        self,
        call: ToolCall,
        status: ToolExecutionStatus = ToolExecutionStatus.REQUESTED,
    ) -> ToolCall:
        """Persist a validated request before any side effect can occur."""
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO tool_executions
                   (id, operation_id, tool, arguments, objective_id, task_id, requested_by,
                    status, result, error_code, created_at, started_at, completed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL)""",
                (call.id, call.operation_id, call.tool, json.dumps(call.arguments),
                 call.objective_id, call.task_id, call.requested_by, status.value, call.created_at),
            )
        self.events.publish(Event("TOOL_REQUESTED", call.to_dict(), call.objective_id, call.task_id))
        return call

    def record_tool_result(self, call: ToolCall, result: ToolResult) -> ToolResult:
        status = ToolExecutionStatus.SUCCEEDED if result.success else ToolExecutionStatus.FAILED
        with self._connect() as connection:
            connection.execute(
                """UPDATE tool_executions SET status=?, result=?, error_code=?, started_at=?,
                   completed_at=? WHERE id=?""",
                (status.value, json.dumps(result.to_dict()), result.error_code,
                 result.started_at, result.completed_at, call.id),
            )
        event_type = "TOOL_COMPLETED" if result.success else "TOOL_FAILED"
        self.events.publish(Event(event_type, result.to_dict(), call.objective_id, call.task_id))
        return result

    def create_approval(self, approval: Approval) -> Approval:
        with self._connect() as connection:
            connection.execute(
                """INSERT INTO approvals VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (approval.id, approval.tool_call_id, approval.permission_level.value,
                 approval.summary, approval.consequences, approval.status.value,
                 approval.requested_at, approval.resolved_at, approval.resolved_by),
            )
            connection.execute(
                "UPDATE tool_executions SET status=? WHERE id=?",
                (ToolExecutionStatus.WAITING_APPROVAL.value, approval.tool_call_id),
            )
        self.events.publish(Event("APPROVAL_REQUIRED", approval.to_dict()))
        return approval

    def get_approval(self, approval_id: str) -> Approval | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone()
        if row is None:
            return None
        return Approval(
            id=row["id"], tool_call_id=row["tool_call_id"],
            permission_level=PermissionLevel(int(row["permission_level"])),
            summary=row["summary"], consequences=row["consequences"],
            status=ApprovalStatus(row["status"]), requested_at=row["requested_at"],
            resolved_at=row["resolved_at"], resolved_by=row["resolved_by"],
        )

    def resolve_approval(
        self,
        approval_id: str,
        approved: bool,
        resolved_by: str = "user",
    ) -> Approval:
        status = ApprovalStatus.APPROVED if approved else ApprovalStatus.DENIED
        resolved_at = utc_now()
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM approvals WHERE id=?", (approval_id,)).fetchone()
            if row is None:
                raise KeyError("Approval was not found.")
            if row["status"] != ApprovalStatus.PENDING.value:
                raise ValueError("Approval has already been resolved.")
            connection.execute(
                "UPDATE approvals SET status=?, resolved_at=?, resolved_by=? WHERE id=?",
                (status.value, resolved_at, resolved_by, approval_id),
            )
            if not approved:
                connection.execute(
                    "UPDATE tool_executions SET status=? WHERE id=?",
                    (ToolExecutionStatus.DENIED.value, row["tool_call_id"]),
                )
        approval = Approval(
            id=row["id"], tool_call_id=row["tool_call_id"],
            permission_level=PermissionLevel(int(row["permission_level"])), summary=row["summary"],
            consequences=row["consequences"], status=status,
            requested_at=row["requested_at"], resolved_at=resolved_at, resolved_by=resolved_by,
        )
        self.events.publish(Event("APPROVAL_GRANTED" if approved else "APPROVAL_DENIED", approval.to_dict()))
        return approval
