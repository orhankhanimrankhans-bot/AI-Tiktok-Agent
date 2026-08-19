"""Private local contact directory with conservative fuzzy resolution."""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher
from pathlib import Path

from app.whatsapp.models import Contact, ContactMatch, ResolutionStatus


def normalize_name(value: str) -> str:
    return " ".join(re.sub(r"[^\w\s]", " ", value.casefold(), flags=re.UNICODE).split())


def normalize_phone_number(value: str) -> str:
    value = value.strip()
    prefix = "+" if value.startswith("+") else ""
    digits = "".join(character for character in value if character.isdigit())
    if not digits or len(digits) < 8 or len(digits) > 15:
        raise ValueError("Phone number must include 8 to 15 digits and an international country code.")
    return prefix + digits


class ContactResolver:
    def __init__(self, path: Path, fuzzy_threshold: float = 0.84) -> None:
        self.path = path
        self.fuzzy_threshold = fuzzy_threshold
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def contacts(self) -> list[Contact]:
        if not self.path.exists():
            return []
        raw = json.loads(self.path.read_text(encoding="utf-8"))
        return [Contact(**item) for item in raw.get("contacts", []) if item.get("whatsapp_enabled", True)]

    def save(self, contacts: list[Contact]) -> None:
        payload = {"contacts": [
            {"id": item.id, "display_name": item.display_name,
             "phone_number": normalize_phone_number(item.phone_number),
             "aliases": item.aliases, "whatsapp_enabled": item.whatsapp_enabled}
            for item in contacts
        ]}
        self.path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    def resolve(self, query: str) -> ContactMatch:
        normalized = normalize_name(query)
        candidates: list[tuple[float, Contact, str]] = []
        for contact in self.contacts():
            for label in [contact.display_name, *contact.aliases]:
                alias = normalize_name(label)
                score = 1.0 if normalized == alias else SequenceMatcher(None, normalized, alias).ratio()
                candidates.append((score, contact, label))
        if not candidates:
            return ContactMatch(ResolutionStatus.NOT_FOUND)
        candidates.sort(key=lambda item: item[0], reverse=True)
        best_score, best, alias = candidates[0]
        close = {item[1].id: item[1].display_name for item in candidates if item[0] >= max(self.fuzzy_threshold, best_score - .04)}
        if len(close) > 1:
            return ContactMatch(ResolutionStatus.AMBIGUOUS, confidence=best_score, alternatives=list(close.values()))
        if best_score < self.fuzzy_threshold:
            return ContactMatch(ResolutionStatus.NOT_FOUND, confidence=best_score)
        status = ResolutionStatus.EXACT if best_score == 1 else ResolutionStatus.FUZZY
        return ContactMatch(status, best, best_score, alias)
