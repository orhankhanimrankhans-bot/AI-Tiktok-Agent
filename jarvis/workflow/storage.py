"""Local workflow definitions and execution-record persistence."""

from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path

from observability import redact_sensitive

from .models import WorkflowDefinition, WorkflowExecutionRecord


class WorkflowStore:
    @staticmethod
    def save(workflow: WorkflowDefinition, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        from .models import utc_now
        workflow.updated_at = utc_now()
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(workflow.to_dict(), indent=2), encoding="utf-8")
        os.replace(temporary, path)

    @staticmethod
    def load(path: Path) -> WorkflowDefinition:
        if not path.exists():
            return WorkflowDefinition()
        return WorkflowDefinition.from_dict(json.loads(path.read_text(encoding="utf-8")))


class ExecutionStore:
    def __init__(self, directory: Path) -> None:
        self.directory = Path(directory)

    def save(self, record: WorkflowExecutionRecord) -> None:
        self.directory.mkdir(parents=True, exist_ok=True)
        payload = redact_sensitive(asdict(record))
        (self.directory / f"{record.execution_id}.json").write_text(
            json.dumps(payload, indent=2), encoding="utf-8"
        )

    def list(self) -> list[dict]:
        if not self.directory.exists():
            return []
        records = []
        for path in sorted(self.directory.glob("*.json"), reverse=True):
            try:
                records.append(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, json.JSONDecodeError):
                continue
        return records
