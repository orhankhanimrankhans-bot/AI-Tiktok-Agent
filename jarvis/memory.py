import logging
import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import List, Dict

from .config import DATA_DIR, MAX_CONVERSATION_HISTORY
from observability import get_logger, log_event


logger = get_logger("memory")


class JarvisMemory:
    """
    Separate memory for Jarvis.

    Important:
    This does NOT modify the existing TikTok Agent database/pipeline.
    """

    def __init__(self, db_path: Path | None = None):
        self.db_path: Path = db_path or (DATA_DIR / "jarvis_memory.db")
        self._initialize_database()

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(self.db_path)
        try:
            yield connection
        finally:
            connection.close()

    def _initialize_database(self):
        with self._connect() as conn:
            cursor = conn.cursor()

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS conversation_memory (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    language TEXT DEFAULT 'auto',
                    created_at TEXT NOT NULL
                )
                """
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS pending_tasks (
                    kind TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    payload TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS preferences (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

            cursor.execute(
                """
                CREATE TABLE IF NOT EXISTS action_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    action TEXT NOT NULL,
                    target TEXT,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )

            conn.commit()

    # ---------------------------------------------------------
    # Conversation Memory
    # ---------------------------------------------------------

    def add_message(
        self,
        role: str,
        content: str,
        language: str = "auto",
    ) -> None:

        if role not in {"user", "assistant", "system"}:
            raise ValueError(f"Invalid conversation role: {role}")

        content = content.strip()

        if not content:
            return

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO conversation_memory
                (role, content, language, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    role,
                    content,
                    language,
                    datetime.now().isoformat(),
                ),
            )

            conn.commit()

        log_event(logger, logging.DEBUG, "memory.message_saved", "Conversation message saved", role=role, language=language, content_length=len(content))

    def get_recent_messages(
        self,
        limit: int = MAX_CONVERSATION_HISTORY,
    ) -> List[Dict[str, str]]:

        with self._connect() as conn:
            cursor = conn.cursor()

            cursor.execute(
                """
                SELECT role, content, language, created_at
                FROM conversation_memory
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            )

            rows = cursor.fetchall()

        rows.reverse()

        return [
            {
                "role": row[0],
                "content": row[1],
                "language": row[2],
                "created_at": row[3],
            }
            for row in rows
        ]

    def clear_conversation(self) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM conversation_memory")
            conn.commit()
        log_event(logger, logging.INFO, "memory.cleared", "Conversation memory cleared", success=True)

    # ---------------------------------------------------------
    # Preferences
    # ---------------------------------------------------------

    def set_preference(self, key: str, value: str) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO preferences (key, value, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(key)
                DO UPDATE SET
                    value = excluded.value,
                    updated_at = excluded.updated_at
                """,
                (
                    key,
                    value,
                    datetime.now().isoformat(),
                ),
            )

            conn.commit()
        log_event(logger, logging.INFO, "memory.preference_saved", "Preference saved", key=key, value_length=len(value))

    def get_preference(
        self,
        key: str,
        default: str | None = None,
    ) -> str | None:

        with self._connect() as conn:
            cursor = conn.cursor()

            cursor.execute(
                """
                SELECT value
                FROM preferences
                WHERE key = ?
                """,
                (key,),
            )

            row = cursor.fetchone()

        if row:
            return row[0]

        return default

    # ---------------------------------------------------------
    # Action History
    # ---------------------------------------------------------

    def record_action(
        self,
        action: str,
        target: str | None,
        status: str,
    ) -> None:

        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO action_history
                (action, target, status, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    action,
                    target,
                    status,
                    datetime.now().isoformat(),
                ),
            )

            conn.commit()
        log_event(logger, logging.INFO, "memory.action_recorded", "Action audit saved", action=action, target=target, status=status)

    # ---------------------------------------------------------
    # Persistent pending workflows
    # ---------------------------------------------------------

    def save_pending_task(self, kind: str, status: str, payload: dict) -> None:
        serialized = json.dumps(payload, ensure_ascii=False)
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO pending_tasks (kind, status, payload, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(kind) DO UPDATE SET
                    status = excluded.status,
                    payload = excluded.payload,
                    updated_at = excluded.updated_at
                """,
                (kind, status, serialized, datetime.now().isoformat()),
            )
            conn.commit()
        log_event(logger, logging.INFO, "memory.pending_task_saved", "Pending workflow state saved", kind=kind, status=status)

    def get_pending_task(self, kind: str) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT status, payload, updated_at FROM pending_tasks WHERE kind = ?",
                (kind,),
            ).fetchone()
        if not row:
            return None
        try:
            payload = json.loads(row[1])
        except json.JSONDecodeError:
            logger.exception("Pending workflow payload was invalid", extra={"event": "memory.pending_task_invalid", "kind": kind})
            return None
        return {"kind": kind, "status": row[0], "payload": payload, "updated_at": row[2]}

    def clear_pending_task(self, kind: str) -> None:
        with self._connect() as conn:
            conn.execute("DELETE FROM pending_tasks WHERE kind = ?", (kind,))
            conn.commit()
        log_event(logger, logging.INFO, "memory.pending_task_cleared", "Pending workflow state cleared", kind=kind)


# Shared Jarvis memory instance
memory = JarvisMemory()
