"""Allowlisted tool registration, schema validation, authorization, and auditing."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable
import logging
from observability import get_logger, log_event


logger = get_logger("agent.tools")

from app.core.event_bus import Event, EventBus
from app.core.models import Approval, ToolCall, ToolDefinition, ToolResult, utc_now
from app.core.permission_manager import PermissionDecision, PermissionManager
from app.core.task_manager import TaskManager


ToolHandler = Callable[..., dict[str, Any] | ToolResult | None]


@dataclass(slots=True)
class RegisteredTool:
    definition: ToolDefinition
    handler: ToolHandler


class ToolValidationError(ValueError):
    pass


class ToolRegistry:
    def __init__(self, tasks: TaskManager, events: EventBus, permissions: PermissionManager) -> None:
        self.tasks = tasks
        self.events = events
        self.permissions = permissions
        self._tools: dict[str, RegisteredTool] = {}

    def register(self, definition: ToolDefinition, handler: ToolHandler) -> None:
        if not definition.name or definition.name in self._tools:
            raise ValueError(f"Tool name is empty or already registered: {definition.name}")
        self._tools[definition.name] = RegisteredTool(definition, handler)

    def list(self) -> list[dict[str, Any]]:
        return [item.definition.to_dict() for item in self._tools.values()]

    def definition(self, name: str) -> ToolDefinition:
        try:
            return self._tools[name].definition
        except KeyError as error:
            raise ToolValidationError(f"Unknown tool: {name}") from error

    @staticmethod
    def _validate(schema: dict[str, Any], arguments: dict[str, Any]) -> None:
        if not isinstance(arguments, dict):
            raise ToolValidationError("Tool arguments must be an object.")
        properties = schema.get("properties", {})
        unknown = set(arguments) - set(properties)
        if unknown and schema.get("additionalProperties", False) is False:
            raise ToolValidationError(f"Unknown argument(s): {', '.join(sorted(unknown))}")
        missing = set(schema.get("required", [])) - set(arguments)
        if missing:
            raise ToolValidationError(f"Missing argument(s): {', '.join(sorted(missing))}")
        types = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list, "object": dict}
        for name, value in arguments.items():
            expected = properties.get(name, {}).get("type")
            if expected in types and (not isinstance(value, types[expected]) or expected == "integer" and isinstance(value, bool)):
                raise ToolValidationError(f"Argument '{name}' must be {expected}.")

    def request(self, call: ToolCall) -> ToolResult | Approval:
        registered = self._tools.get(call.tool)
        if registered is None:
            raise ToolValidationError(f"Unknown tool: {call.tool}")
        self._validate(registered.definition.input_schema, call.arguments)
        self.tasks.record_tool_call(call)
        decision = self.permissions.check(registered.definition)
        if decision.decision == PermissionDecision.DENY:
            result = ToolResult(call.tool, False, decision.reason, call_id=call.id, error_code="PERMISSION_DENIED")
            return self.tasks.record_tool_result(call, result)
        if decision.decision == PermissionDecision.CONFIRM:
            return self.tasks.create_approval(Approval(
                tool_call_id=call.id,
                permission_level=registered.definition.permission_level,
                summary=f"Run {call.tool}",
                consequences=decision.reason,
            ))
        return self._execute(registered, call)

    def _execute(self, registered: RegisteredTool, call: ToolCall) -> ToolResult:
        started = utc_now()
        log_event(logger, logging.INFO, "execution.started", "Agent tool execution started", tool=call.tool, module_selection="app.tools", task_id=call.task_id, objective_id=call.objective_id)
        self.events.publish(Event("TOOL_STARTED", call.to_dict(), call.objective_id, call.task_id))
        try:
            output = registered.handler(**call.arguments)
            if isinstance(output, ToolResult):
                result = output
                result.call_id = call.id
            else:
                result = ToolResult(call.tool, True, f"{call.tool} completed.", output or {}, call.id, started_at=started)
        except Exception as error:
            logger.exception("Agent tool failed gracefully", extra={"event": "execution.failed", "tool": call.tool, "task_id": call.task_id, "objective_id": call.objective_id})
            result = ToolResult(call.tool, False, str(error), call_id=call.id, error_code=type(error).__name__, started_at=started)
        log_event(logger, logging.INFO if result.success else logging.WARNING, "execution.completed", "Agent tool execution completed", tool=call.tool, success=result.success, task_id=call.task_id, objective_id=call.objective_id)
        return self.tasks.record_tool_result(call, result)

    def execute_approved(self, call: ToolCall, approval_id: str) -> ToolResult:
        pending = self.tasks.get_approval(approval_id)
        if pending is None or pending.tool_call_id != call.id:
            raise ToolValidationError("Approval does not belong to this tool call.")
        self.tasks.resolve_approval(approval_id, approved=True)
        registered = self._tools.get(call.tool)
        if registered is None:
            raise ToolValidationError(f"Unknown tool: {call.tool}")
        self._validate(registered.definition.input_schema, call.arguments)
        if self.permissions.emergency_stopped:
            return self.tasks.record_tool_result(call, ToolResult(
                call.tool, False, "Jarvis emergency stop is active.", call_id=call.id,
                error_code="EMERGENCY_STOP",
            ))
        return self._execute(registered, call)
