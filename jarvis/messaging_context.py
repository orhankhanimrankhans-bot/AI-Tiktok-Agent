from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional
import time

from .contact_resolver import Contact, contact_resolver
from .memory import memory


@dataclass
class MessagingContext:
    pending_query: Optional[str] = None
    pending_contacts: List[Contact] = field(default_factory=list)
    pending_contact_started_at: Optional[float] = None
    active_contact: Optional[Contact] = None

    # New messaging state
    awaiting_message_text: bool = False
    pending_message: Optional[str] = None
    awaiting_confirmation: bool = False
    draft_prepared: bool = False


class MessagingManager:
    def __init__(self) -> None:
        self.context = MessagingContext()
        self.restore_pending_task()

    def _persist(self, status: str) -> None:
        contact = self.context.active_contact
        memory.save_pending_task(
            "whatsapp_message",
            status,
            {
                "contact_id": contact.id if contact else None,
                "pending_message": self.context.pending_message,
            },
        )

    def restore_pending_task(self) -> bool:
        task = memory.get_pending_task("whatsapp_message")
        if not task:
            return False
        contact_id = str(task.get("payload", {}).get("contact_id") or "")
        contact = contact_resolver.get_contact(contact_id)
        if not contact:
            memory.clear_pending_task("whatsapp_message")
            return False
        status = task.get("status")
        self.context.active_contact = contact
        self.context.pending_message = task.get("payload", {}).get("pending_message")
        self.context.awaiting_message_text = status == "awaiting_message"
        self.context.awaiting_confirmation = status == "awaiting_confirmation"
        self.context.draft_prepared = self.context.awaiting_confirmation
        return self.context.awaiting_message_text or self.context.awaiting_confirmation

    def begin_message(
        self,
        contact: Contact,
    ):
        self.context.active_contact = contact
        self.context.awaiting_message_text = True
        self.context.pending_message = None
        self.context.awaiting_confirmation = False
        self.context.draft_prepared = False
        self._persist("awaiting_message")

    def set_message_text(
        self,
        text: str,
    ):
        contact = self.context.active_contact

        if not contact:
            return {
                "status": "NO_CONTACT",
                "message": "Koi active contact nahi hai.",
            }

        cleaned = text.strip()

        # Roman Urdu command prefixes remove کریں
        prefixes = [
            r"^usko\s+bolo\s+",
            r"^usay\s+bolo\s+",
            r"^use\s+bolo\s+",
            r"^usko\s+batao\s+",
            r"^usay\s+batao\s+",
            r"^usko\s+(?:message|msg)\s+(?:karo|kar do|bhejo|bhej do)[,;:\-]*\s*",
            r"^usay\s+(?:message|msg)\s+(?:karo|kar do|bhejo|bhej do)[,;:\-]*\s*",
            r"^use\s+(?:message|msg)\s+(?:karo|kar do|bhejo|bhej do)[,;:\-]*\s*",
            r"^keh\s+do\s+",
            r"^bolo\s+",
        ]

        # Urdu prefixes
        urdu_prefixes = [
            r"^اسے\s+کہو\s+",
            r"^اس\s+کو\s+کہو\s+",
            r"^اسے\s+بتاؤ\s+",
            r"^اس\s+کو\s+بتاؤ\s+",
            r"^اسے\s+(?:میسج|پیغام)\s+(?:کرو|بھیجو|بھیج\s+دو)[،,:;\-]*\s*",
            r"^اس\s+کو\s+(?:میسج|پیغام)\s+(?:کرو|بھیجو|بھیج\s+دو)[،,:;\-]*\s*",
            r"^کہہ\s+دو\s+",
        ]

        import re

        for pattern in prefixes + urdu_prefixes:
            cleaned = re.sub(
                pattern,
                "",
                cleaned,
                flags=re.IGNORECASE,
            ).strip()

        if not cleaned:
            return {
                "status": "EMPTY_MESSAGE",
                "message": "Message kya bhejna hai?",
            }

        self.context.pending_message = cleaned
        self.context.awaiting_message_text = False

        return {
            "status": "MESSAGE_READY",
            "contact": contact,
            "message_text": cleaned,
        }

    def mark_draft_prepared(self, message_text: str) -> None:
        self.context.pending_message = message_text.strip()
        self.context.awaiting_message_text = False
        self.context.awaiting_confirmation = True
        self.context.draft_prepared = True
        self._persist("awaiting_confirmation")

    @staticmethod
    def confirmation_intent(text: str) -> str:
        value = " ".join(text.casefold().strip().split())
        if value in {
            "send", "send it", "send karo", "send kar do", "bhejo", "bhej do",
            "yes", "yes send", "haan", "han", "ہاں", "بھیجو", "بھیج دو",
        }:
            return "confirm"
        if value in {
            "cancel", "cancel karo", "mat bhejo", "don't send", "do not send",
            "no", "nahi", "nahin", "نہیں", "مت بھیجو",
        }:
            return "cancel"
        return "unclear"

    def clear_message(self):
        self.context.awaiting_message_text = False
        self.context.pending_message = None
        self.context.awaiting_confirmation = False
        self.context.draft_prepared = False
        self.context.active_contact = None
        memory.clear_pending_task("whatsapp_message")

    def _pref_key(self, query: str) -> str:
        normalized = contact_resolver.normalize(query)
        return f"contact_preference:{normalized}"

    def resolve_recipient(self, query: str):
        # First check whether Jarvis already learned this name.
        saved_contact_id = memory.get_preference(
            self._pref_key(query)
        )

        if saved_contact_id:
            saved = contact_resolver.get_contact(saved_contact_id)

            if saved:
                self.context.active_contact = saved

                return {
                    "status": "RESOLVED",
                    "contact": saved,
                    "message": saved.display_name,
                }

        match = contact_resolver.resolve(query)

        if match.status in {"EXACT", "FUZZY"} and match.contact:
            self.context.active_contact = match.contact

            return {
                "status": "RESOLVED",
                "contact": match.contact,
                "message": match.contact.display_name,
            }

        if match.status == "AMBIGUOUS":
            self.context.pending_query = query
            self.context.pending_contacts = match.alternatives
            self.context.pending_contact_started_at = time.monotonic()

            names = [
                c.display_name
                for c in match.alternatives
            ]

            return {
                "status": "AMBIGUOUS",
                "contact": None,
                "alternatives": names,
                "message": self._ambiguity_question(names),
            }

        return {
            "status": "NOT_FOUND",
            "contact": None,
            "message": f"Mujhe {query} contact nahi mila.",
        }

    def _ambiguity_question(
        self,
        names: List[str],
    ) -> str:

        if not names:
            return "Kaunsa contact?"

        if len(names) == 1:
            return f"Kya aap {names[0]} ki baat kar rahe hain?"

        return (
            "Mujhe ek se zyada contacts mile hain: "
            + ", ".join(names)
            + ". Aap kaunsa contact keh rahe hain?"
        )

    def clear_pending_contact_selection(self) -> None:
        """Clear only ambiguous contact-selection state."""
        self.context.pending_query = None
        self.context.pending_contacts = []
        self.context.pending_contact_started_at = None

    def pending_contact_selection_is_fresh(self, max_age_seconds: float = 90.0) -> bool:
        """Return True only while a recent ambiguous-contact question is active."""
        if not self.context.pending_contacts:
            return False

        started = self.context.pending_contact_started_at
        if started is None:
            return False

        return (time.monotonic() - started) <= max_age_seconds

    def choose_pending_contact(
        self,
        answer: str,
    ):
        contacts = self.context.pending_contacts

        if not contacts:
            return {
                "status": "NO_PENDING_CONTACT",
                "message": "Koi contact selection pending nahi hai.",
            }

        value = contact_resolver.normalize(answer)

        # Support first / second / third
        ordinal_map = {
            "first": 0,
            "pehla": 0,
            "پہلا": 0,

            "second": 1,
            "doosra": 1,
            "dusra": 1,
            "دوسرا": 1,

            "third": 2,
            "teesra": 2,
            "تیسرا": 2,
        }

        selected = None

        if value in ordinal_map:
            index = ordinal_map[value]

            if index < len(contacts):
                selected = contacts[index]

        # Try matching the spoken answer against pending contacts.
        if selected is None:
            best_score = 0.0

            for contact in contacts:
                score = contact_resolver.similarity(
                    answer,
                    contact.display_name,
                )

                if score > best_score:
                    best_score = score
                    selected = contact

            if best_score < 70:
                selected = None

        if selected is None:
            return {
                "status": "UNRESOLVED",
                "message": (
                    "Mujhe contact clear nahi hua. "
                    "Naam dobara bata dein."
                ),
            }

        # Remember the user's choice for future commands.
        if self.context.pending_query:
            memory.set_preference(
                self._pref_key(
                    self.context.pending_query
                ),
                selected.id,
            )

        self.context.active_contact = selected
        self.context.pending_query = None
        self.context.pending_contacts = []
        self.context.pending_contact_started_at = None

        return {
            "status": "RESOLVED",
            "contact": selected,
            "message": (
                f"Theek hai, {selected.display_name}. "
                "Main ye choice yaad rakhunga."
            ),
        }

    def current_contact(self) -> Optional[Contact]:
        return self.context.active_contact


messaging = MessagingManager()