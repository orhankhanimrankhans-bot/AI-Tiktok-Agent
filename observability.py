"""Shared structured logging and request correlation for Jarvis services."""

from __future__ import annotations

import contextlib
import contextvars
import json
import logging
import os
import re
import sys
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4


PROJECT_ROOT = Path(__file__).resolve().parent
_frozen_root = Path(os.getenv("LOCALAPPDATA", PROJECT_ROOT)) / "Jarvis"
USER_DATA_ROOT = Path(os.getenv("JARVIS_USER_DATA_DIR", "")).expanduser() if os.getenv("JARVIS_USER_DATA_DIR") else (_frozen_root if getattr(sys, "frozen", False) else PROJECT_ROOT)
LOG_DIR = USER_DATA_ROOT / "logs"
LOG_FILE = LOG_DIR / "jarvis.jsonl"

_request_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "jarvis_request_id",
    default="system",
)

_SECRET_FIELDS = {"api_key", "access_token", "refresh_token", "client_secret", "authorization", "password"}
_SECRET_PATTERNS = (
    re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"),
    re.compile(r"\bAIza[0-9A-Za-z_-]{16,}\b"),
    re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"(?i)\b(api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\s*[:=]\s*[^\s,;]+"),
)


def redact_sensitive(value: Any, key: str = "") -> Any:
    """Remove credential-shaped content before it reaches any log handler."""
    normalized = key.casefold()
    if normalized in _SECRET_FIELDS or any(marker in normalized for marker in _SECRET_FIELDS):
        return "[REDACTED]"
    if isinstance(value, str):
        redacted = value
        for pattern in _SECRET_PATTERNS:
            redacted = pattern.sub("[REDACTED]", redacted)
        return redacted
    if isinstance(value, dict):
        return {item_key: redact_sensitive(item_value, str(item_key)) for item_key, item_value in value.items()}
    if isinstance(value, (list, tuple)):
        sanitized = [redact_sensitive(item) for item in value]
        return tuple(sanitized) if isinstance(value, tuple) else sanitized
    return value


class JsonFormatter(logging.Formatter):
    """Render one machine-readable JSON object per log record."""

    _standard = set(logging.makeLogRecord({}).__dict__) | {
        "message",
        "asctime",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "request_id": getattr(record, "request_id", None) or get_request_id(),
            "event": getattr(record, "event", "log"),
            "message": redact_sensitive(record.getMessage()),
        }
        for key, value in record.__dict__.items():
            if key in self._standard or key.startswith("_"):
                continue
            try:
                json.dumps(value)
                payload[key] = redact_sensitive(value, key)
            except (TypeError, ValueError):
                payload[key] = redact_sensitive(repr(value), key)
        if record.exc_info:
            payload["exception"] = redact_sensitive(self.formatException(record.exc_info))
        return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


class RequestContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if not getattr(record, "request_id", None):
            record.request_id = get_request_id()
        return True


def configure_logging() -> None:
    """Configure the project logger once without replacing host handlers."""

    project_logger = logging.getLogger("jarvis")
    if getattr(project_logger, "_jarvis_configured", False):
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    level_name = os.getenv("JARVIS_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    formatter = JsonFormatter()
    context_filter = RequestContextFilter()

    file_handler = RotatingFileHandler(
        LOG_FILE,
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    file_handler.addFilter(context_filter)
    project_logger.addHandler(file_handler)

    if os.getenv("JARVIS_LOG_CONSOLE", "0").strip() == "1":
        console = logging.StreamHandler(sys.stderr)
        console.setFormatter(formatter)
        console.addFilter(context_filter)
        project_logger.addHandler(console)

    project_logger.setLevel(level)
    project_logger.propagate = False
    project_logger._jarvis_configured = True  # type: ignore[attr-defined]


def get_logger(component: str) -> logging.Logger:
    configure_logging()
    return logging.getLogger(f"jarvis.{component}")


def get_request_id() -> str:
    return _request_id.get()


def create_request_id() -> str:
    return uuid4().hex


@contextlib.contextmanager
def request_context(request_id: str | None = None) -> Iterator[str]:
    value = (request_id or create_request_id()).strip()
    token = _request_id.set(value)
    try:
        yield value
    finally:
        _request_id.reset(token)


def log_event(
    logger: logging.Logger,
    level: int,
    event: str,
    message: str,
    **fields: Any,
) -> None:
    logger.log(level, message, extra={"event": event, **fields})
