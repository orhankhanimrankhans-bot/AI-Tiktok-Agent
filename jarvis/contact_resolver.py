from __future__ import annotations

import json
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import List, Optional

from .config import DATA_DIR


@dataclass
class Contact:
    id: str
    display_name: str
    phone: str
    aliases: List[str]


@dataclass
class ContactMatch:
    status: str
    contact: Optional[Contact]
    confidence: float
    alternatives: List[Contact]


class ContactResolver:
    """
    Resolve spoken/written names to contacts from data/contacts.json.

    Possible status values:
    - EXACT
    - FUZZY
    - AMBIGUOUS
    - NOT_FOUND
    """

    def __init__(self) -> None:
        self.contacts_path: Path = DATA_DIR / "contacts.json"
        self.contacts: List[Contact] = []
        self.reload()

    # =========================================================
    # Loading
    # =========================================================

    def reload(self) -> None:
        self.contacts = []

        if not self.contacts_path.exists():
            return

        with self.contacts_path.open(
            "r",
            encoding="utf-8-sig",
        ) as file:
            data = json.load(file)

        raw_contacts = data.get("contacts", [])

        for index, item in enumerate(raw_contacts):
            display_name = str(
                item.get("display_name", "")
            ).strip()

            # Ignore obviously broken contact names such as single letters.
            if len(self.normalize(display_name)) < 3:
                continue

            # Support old single-phone format
            phone = str(
                item.get("phone")
                or item.get("phone_number")
                or ""
            ).strip()

            # Support contacts.json generated from VCF:
            # "phones": [{"raw": "...", "normalized": "..."}]
            if not phone:
                phones = item.get("phones") or []

                if isinstance(phones, list):
                    for phone_item in phones:

                        if isinstance(phone_item, dict):
                            candidate = str(
                                phone_item.get("normalized")
                                or phone_item.get("raw")
                                or ""
                            ).strip()

                        else:
                            candidate = str(
                                phone_item
                            ).strip()

                        if candidate:
                            phone = candidate
                            break

            if not display_name:
                continue

            contact_id = str(
                item.get("id")
                or self._make_id(display_name, index)
            )

            aliases = item.get("aliases") or []

            if not isinstance(aliases, list):
                aliases = []

            # Always include canonical display name.
            all_aliases = [display_name]

            for alias in aliases:
                alias = str(alias).strip()

                # Ignore useless one/two-character aliases such as B, S, M.
                normalized_alias = self.normalize(alias)

                if len(normalized_alias) < 3:
                    continue

                if alias and alias not in all_aliases:
                    all_aliases.append(alias)

            self.contacts.append(
                Contact(
                    id=contact_id,
                    display_name=display_name,
                    phone=phone,
                    aliases=all_aliases,
                )
            )

    # =========================================================
    # Normalization
    # =========================================================

    @staticmethod
    def _make_id(name: str, index: int) -> str:
        cleaned = re.sub(
            r"[^a-zA-Z0-9]+",
            "_",
            name.casefold(),
        ).strip("_")

        return cleaned or f"contact_{index}"

    @staticmethod
    def normalize(text: str) -> str:
        value = text.casefold().strip()

        # Urdu / Arabic character normalization
        replacements = {
            "ي": "ی",
            "ى": "ی",
            "ك": "ک",
            "ۀ": "ہ",
            "ة": "ہ",
        }

        for source, target in replacements.items():
            value = value.replace(source, target)

        # Remove punctuation but preserve Urdu/Latin letters/numbers.
        value = re.sub(
            r"[^\w\u0600-\u06FF\s]+",
            " ",
            value,
        )

        value = re.sub(
            r"\s+",
            " ",
            value,
        ).strip()

        return value

    @classmethod
    def similarity(
        cls,
        left: str,
        right: str,
    ) -> float:
        left_n = cls.normalize(left)
        right_n = cls.normalize(right)

        if not left_n or not right_n:
            return 0.0

        return SequenceMatcher(
            None,
            left_n,
            right_n,
        ).ratio() * 100.0

    # =========================================================
    # Matching
    # =========================================================

    def resolve(
        self,
        query: str,
        fuzzy_threshold: float = 82.0,
        ambiguity_margin: float = 4.0,
    ) -> ContactMatch:

        query_n = self.normalize(query)

        if not query_n:
            return ContactMatch(
                status="NOT_FOUND",
                contact=None,
                confidence=0.0,
                alternatives=[],
            )

        # -----------------------------------------------------
        # Exact alias matching
        # -----------------------------------------------------

        exact_matches: List[Contact] = []

        for contact in self.contacts:
            for alias in contact.aliases:
                if self.normalize(alias) == query_n:
                    exact_matches.append(contact)
                    break

        if len(exact_matches) == 1:
            return ContactMatch(
                status="EXACT",
                contact=exact_matches[0],
                confidence=100.0,
                alternatives=[],
            )

        if len(exact_matches) > 1:
            return ContactMatch(
                status="AMBIGUOUS",
                contact=None,
                confidence=100.0,
                alternatives=exact_matches[:8],
            )

        # -----------------------------------------------------
        # Partial-name matches
        # Example:
        # "Sulaiman" may match "Muhammad Sulaiman"
        # -----------------------------------------------------

        partial_matches: List[Contact] = []

        for contact in self.contacts:
            for alias in contact.aliases:
                alias_n = self.normalize(alias)

                if (
                    query_n in alias_n
                    or alias_n in query_n
                ):
                    partial_matches.append(contact)
                    break

        # Remove duplicates while preserving order.
        unique_partial = []

        seen_ids = set()

        for contact in partial_matches:
            if contact.id not in seen_ids:
                seen_ids.add(contact.id)
                unique_partial.append(contact)

        if len(unique_partial) == 1:
            return ContactMatch(
                status="FUZZY",
                contact=unique_partial[0],
                confidence=94.0,
                alternatives=[],
            )

        # Multiple partial matches should NOT be guessed.
        if len(unique_partial) > 1:
            return ContactMatch(
                status="AMBIGUOUS",
                contact=None,
                confidence=94.0,
                alternatives=unique_partial[:8],
            )

        # -----------------------------------------------------
        # Fuzzy matching
        # -----------------------------------------------------

        scored = []

        for contact in self.contacts:
            best_score = 0.0

            for alias in contact.aliases:
                score = self.similarity(
                    query,
                    alias,
                )

                if score > best_score:
                    best_score = score

            scored.append(
                (
                    best_score,
                    contact,
                )
            )

        scored.sort(
            key=lambda item: item[0],
            reverse=True,
        )

        if not scored:
            return ContactMatch(
                status="NOT_FOUND",
                contact=None,
                confidence=0.0,
                alternatives=[],
            )

        best_score, best_contact = scored[0]

        if best_score < fuzzy_threshold:
            return ContactMatch(
                status="NOT_FOUND",
                contact=None,
                confidence=best_score,
                alternatives=[],
            )

        # -----------------------------------------------------
        # Ambiguity protection
        # -----------------------------------------------------

        close_matches = [
            contact
            for score, contact in scored
            if (
                score >= fuzzy_threshold
                and best_score - score
                <= ambiguity_margin
            )
        ]

        if len(close_matches) > 1:
            return ContactMatch(
                status="AMBIGUOUS",
                contact=None,
                confidence=best_score,
                alternatives=close_matches[:8],
            )

        return ContactMatch(
            status="FUZZY",
            contact=best_contact,
            confidence=best_score,
            alternatives=[],
        )

    # =========================================================
    # Helpers for Jarvis
    # =========================================================

    def get_contact(
        self,
        contact_id: str,
    ) -> Optional[Contact]:

        for contact in self.contacts:
            if contact.id == contact_id:
                return contact

        return None

    def describe_match(
        self,
        match: ContactMatch,
    ) -> str:

        if match.status in {"EXACT", "FUZZY"}:
            if match.contact:
                return match.contact.display_name

        if match.status == "AMBIGUOUS":
            names = [
                contact.display_name
                for contact in match.alternatives
            ]

            return ", ".join(names)

        return "Contact not found"


contact_resolver = ContactResolver()
