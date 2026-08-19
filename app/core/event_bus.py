"""Small in-process event bus used by the dashboard and task manager."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from threading import RLock
from typing import Any, Callable
from uuid import uuid4
from observability import get_logger


logger = get_logger("event_bus")


@dataclass(slots=True)
class Event:
    type: str
    payload: dict[str, Any] = field(default_factory=dict)
    objective_id: str | None = None
    task_id: str | None = None
    agent_id: str | None = None
    id: str = field(default_factory=lambda: str(uuid4()))
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
    )

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


EventHandler = Callable[[Event], None]


class EventBus:
    """Thread-safe, local pub/sub without an external message broker."""

    def __init__(self) -> None:
        self._handlers: dict[str, list[EventHandler]] = {}
        self._lock = RLock()

    def subscribe(self, event_type: str, handler: EventHandler) -> Callable[[], None]:
        with self._lock:
            self._handlers.setdefault(event_type, []).append(handler)

        def unsubscribe() -> None:
            with self._lock:
                handlers = self._handlers.get(event_type, [])
                if handler in handlers:
                    handlers.remove(handler)

        return unsubscribe

    def publish(self, event: Event) -> None:
        with self._lock:
            handlers = [*self._handlers.get(event.type, []), *self._handlers.get("*", [])]
        for handler in handlers:
            try:
                handler(event)
            except Exception:
                # Observer failures must not interrupt pipeline work.
                logger.exception("Event subscriber failed; pipeline continued", extra={"event": "event_bus.subscriber_failed", "event_type": event.type, "handler": repr(handler)})
                continue
