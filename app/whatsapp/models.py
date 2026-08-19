from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any
from uuid import uuid4


class WhatsAppIntentType(str, Enum):
    OPEN = "whatsapp_open"
    OPEN_CHAT = "whatsapp_open_chat"
    SEND_MESSAGE = "whatsapp_send_message"
    UNKNOWN = "unknown"


class ResolutionStatus(str, Enum):
    EXACT = "EXACT"
    FUZZY = "FUZZY"
    AMBIGUOUS = "AMBIGUOUS"
    NOT_FOUND = "NOT_FOUND"


@dataclass(slots=True)
class Contact:
    display_name: str
    phone_number: str
    aliases: list[str] = field(default_factory=list)
    whatsapp_enabled: bool = True
    id: str = field(default_factory=lambda: str(uuid4()))


@dataclass(slots=True)
class ContactMatch:
    status: ResolutionStatus
    contact: Contact | None = None
    confidence: float = 0
    matched_alias: str | None = None
    alternatives: list[str] = field(default_factory=list)


@dataclass(slots=True)
class WhatsAppIntent:
    intent: WhatsAppIntentType
    recipient_query: str | None = None
    message: str | None = None


@dataclass(slots=True)
class WhatsAppResult:
    success: bool
    status: str
    message: str
    operation_id: str | None = None
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
