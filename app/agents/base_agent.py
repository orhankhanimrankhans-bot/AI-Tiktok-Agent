"""Common agent lifecycle and structured task reporting."""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.core.event_bus import Event, EventBus
from app.core.models import AgentProfile, AgentStatus, Task, TaskStatus, utc_now
from app.core.task_manager import TaskManager


class BaseAgent(ABC):
    def __init__(self, profile: AgentProfile, tasks: TaskManager, events: EventBus) -> None:
        self.profile = profile
        self.tasks = tasks
        self.events = events

    def health(self) -> dict[str, Any]:
        return {"agent_id": self.profile.id, "status": self.profile.status.value, "healthy": True}

    def _status(self, status: AgentStatus, task: Task | None = None) -> None:
        self.profile.status = status
        self.profile.current_task_id = task.id if task else None
        self.profile.last_activity = utc_now()
        self.events.publish(Event(f"AGENT_{status.value}", self.profile.to_dict(),
                                  task.objective_id if task else None, task.id if task else None, self.profile.id))

    def execute(self, task: Task) -> dict[str, Any]:
        self._status(AgentStatus.WORKING, task)
        task.status, task.progress, task.started_at = TaskStatus.RUNNING, 5, utc_now()
        self.tasks.update_task(task, "TASK_STARTED")
        try:
            output = self.execute_task(task, self.tasks.dependency_output(task))
            task.output_data = output or {}
            task.status, task.progress, task.completed_at = TaskStatus.COMPLETED, 100, utc_now()
            self.tasks.update_task(task, "TASK_COMPLETED")
            self.tasks.checkpoint(task.objective_id, task.action, task.output_data)
            self.profile.completed_tasks += 1
            self._status(AgentStatus.IDLE)
            return task.output_data
        except Exception as error:
            task.retries += 1
            task.error_message = str(error)
            if task.retries <= task.max_retries:
                task.status, task.progress = TaskStatus.PENDING, 0
                self.tasks.update_task(task, "TASK_RETRY")
                self._status(AgentStatus.WAITING)
            else:
                task.status, task.completed_at = TaskStatus.FAILED, utc_now()
                self.tasks.update_task(task, "TASK_FAILED")
                self.profile.failed_tasks += 1
                self._status(AgentStatus.FAILED)
            raise

    @abstractmethod
    def execute_task(self, task: Task, context: dict[str, Any]) -> dict[str, Any]:
        """Run the allowlisted capability associated with a task."""

