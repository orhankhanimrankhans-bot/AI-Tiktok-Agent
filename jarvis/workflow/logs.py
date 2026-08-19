"""Sanitized workflow log event model."""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime
from observability import redact_sensitive
@dataclass(frozen=True)
class WorkflowLogEvent:
    timestamp:str; message:str
    @classmethod
    def create(cls,message): return cls(datetime.now().strftime("%H:%M:%S"),str(redact_sensitive(message)))
