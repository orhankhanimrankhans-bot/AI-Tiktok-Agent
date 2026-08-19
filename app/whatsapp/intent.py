"""Fast deterministic WhatsApp intent parsing and short-lived follow-up context."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass

from app.whatsapp.models import WhatsAppIntent, WhatsAppIntentType


@dataclass(slots=True)
class MessagingContext:
    recipient_query: str
    expires_at: float


class WhatsAppIntentParser:
    def __init__(self, context_timeout_seconds: int = 120) -> None:
        self.context_timeout_seconds = context_timeout_seconds
        self.context: MessagingContext | None = None

    @staticmethod
    def _clean(text: str) -> str:
        return " ".join(text.strip().strip(".").split())

    def parse(self, command: str) -> WhatsAppIntent:
        text = self._clean(command)
        text = re.sub(r"^(?:hello\s+)?jarvis[,. ]*", "", text, flags=re.I)
        text = re.sub(r"^(?:please\s+)?open\s+(?:my\s+)?whatsapp\s+and\s+", "", text, flags=re.I)
        if re.fullmatch(r"(?:please\s+)?open\s+(?:my\s+)?whatsapp", text, re.I):
            return WhatsAppIntent(WhatsAppIntentType.OPEN)
        pronoun_followup = re.fullmatch(r"(?:tell\s+(?:him|her)|usay|usko|اسے|اس\s+کو)\s+(.+)", text, re.I)
        if pronoun_followup and self.context and self.context.expires_at >= time.monotonic():
            return WhatsAppIntent(
                WhatsAppIntentType.SEND_MESSAGE,
                self.context.recipient_query,
                self._clean(pronoun_followup.group(1)),
            )
        patterns = [
            r"(?:open)\s+(.+?)(?:'s)?\s+(?:whatsapp\s+)?chat$",
            r"send\s+(.+?)\s+a\s+whatsapp\s+saying\s+(.+)$",
            r"(?:message|whatsapp)\s+(?:to\s+)?(.+?)\s+(?:and\s+)?(?:tell\s+(?:him|her)\s+|saying\s+|say\s+)(.+)$",
            r"send\s+(?:a\s+message\s+to\s+)?(.+?)\s+(?:on\s+whatsapp\s+)?(?:saying\s+)(.+)$",
            r"(?:on\s+whatsapp\s+)?tell\s+(.+?)\s+(.+)$",
            r"(?:message|whatsapp)\s+(?:to\s+)?(.+)$",
        ]
        for index, pattern in enumerate(patterns):
            match = re.fullmatch(pattern, text, re.I)
            if not match:
                continue
            recipient = self._clean(match.group(1))
            message = self._clean(match.group(2)) if match.lastindex and match.lastindex > 1 else None
            self.context = MessagingContext(recipient, time.monotonic() + self.context_timeout_seconds)
            intent = WhatsAppIntentType.OPEN_CHAT if index == 0 else WhatsAppIntentType.SEND_MESSAGE
            return WhatsAppIntent(intent, recipient, message)
        if self.context and self.context.expires_at >= time.monotonic():
            followup = re.sub(r"^(?:tell\s+(?:him|her)\s+)", "", text, flags=re.I)
            if followup != text or not re.match(r"^(?:open|message|whatsapp|send)\b", text, re.I):
                return WhatsAppIntent(WhatsAppIntentType.SEND_MESSAGE, self.context.recipient_query, self._clean(followup))
        return WhatsAppIntent(WhatsAppIntentType.UNKNOWN)
