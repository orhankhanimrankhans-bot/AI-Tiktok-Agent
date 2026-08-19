"""Dedicated WhatsApp coordinator with contact resolution and duplicate protection."""

from __future__ import annotations

import hashlib
import os
import time
from pathlib import Path

from app.whatsapp.adapter import WhatsAppAdapter
from app.whatsapp.contacts import ContactResolver
from app.whatsapp.intent import WhatsAppIntentParser
from app.whatsapp.models import ResolutionStatus, WhatsAppIntentType, WhatsAppResult


class WhatsAppAgent:
    def __init__(self, project_root: Path, dry_run: bool | None = None) -> None:
        self.parser = WhatsAppIntentParser(int(os.getenv("WHATSAPP_CONTEXT_TIMEOUT_SECONDS", "120")))
        self.contacts = ContactResolver(project_root / "data" / "contacts.json")
        if dry_run is None:
            dry_run = os.getenv("WHATSAPP_DRY_RUN", "0").strip() != "0"
        self.adapter = WhatsAppAdapter(dry_run=dry_run)
        self._operations: set[str] = set()
        self.state = "IDLE"

    def handles(self, command: str) -> bool:
        return self.parser.parse(command).intent != WhatsAppIntentType.UNKNOWN

    def execute(self, command: str) -> WhatsAppResult:
        intent = self.parser.parse(command)
        if intent.intent == WhatsAppIntentType.OPEN:
            return self.adapter.open()
        if intent.intent == WhatsAppIntentType.UNKNOWN:
            return WhatsAppResult(False, "NOT_UNDERSTOOD", "I couldn't understand that WhatsApp request.")
        resolution = self.contacts.resolve(intent.recipient_query or "")
        if resolution.status == ResolutionStatus.AMBIGUOUS:
            return WhatsAppResult(False, "AMBIGUOUS", f"Which contact do you mean: {', '.join(resolution.alternatives)}?")
        if not resolution.contact:
            return WhatsAppResult(False, "CONTACT_NOT_FOUND", f"I couldn't find {intent.recipient_query} in Jarvis contacts.")
        contact = resolution.contact
        if intent.intent == WhatsAppIntentType.OPEN_CHAT:
            return self.adapter.compose(contact, "", self._operation_id(contact.id, "open_chat"))
        if not intent.message:
            return WhatsAppResult(False, "MESSAGE_REQUIRED", f"What would you like me to tell {contact.display_name}?")
        operation_id = self._operation_id(contact.id, intent.message)
        if operation_id in self._operations:
            return WhatsAppResult(False, "DUPLICATE_BLOCKED", "That message request was already processed.", operation_id)
        self._operations.add(operation_id)
        return self.adapter.compose(contact, intent.message, operation_id)

    @staticmethod
    def _operation_id(contact_id: str, message: str) -> str:
        bucket = int(time.time() // 120)
        digest = hashlib.sha256(f"{contact_id}|{message}|{bucket}".encode("utf-8")).hexdigest()[:12]
        return f"wa_{digest}"
