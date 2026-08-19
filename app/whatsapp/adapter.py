"""WhatsApp deep-link adapter. It composes safely and never claims an unverified send."""

from __future__ import annotations

import os
from urllib.parse import quote

from app.whatsapp.contacts import normalize_phone_number
from app.whatsapp.models import Contact, WhatsAppResult


class WhatsAppAdapter:
    def __init__(self, dry_run: bool = True) -> None:
        self.dry_run = dry_run

    def open(self) -> WhatsAppResult:
        if not self.dry_run:
            os.startfile("whatsapp:")  # type: ignore[attr-defined]
        return WhatsAppResult(True, "DRY_RUN" if self.dry_run else "OPEN_REQUESTED", "WhatsApp open requested.")

    def compose(self, contact: Contact, message: str, operation_id: str) -> WhatsAppResult:
        phone = normalize_phone_number(contact.phone_number).lstrip("+")
        url = f"https://wa.me/{phone}?text={quote(message, safe='')}"
        if self.dry_run:
            return WhatsAppResult(True, "DRY_RUN", f"Would compose a message to {contact.display_name}.", operation_id)
        os.startfile(url)  # type: ignore[attr-defined]
        return WhatsAppResult(
            False, "COMPOSED_UNVERIFIED",
            f"The message was composed for {contact.display_name}, but Jarvis did not press Send or verify delivery.",
            operation_id,
        )
