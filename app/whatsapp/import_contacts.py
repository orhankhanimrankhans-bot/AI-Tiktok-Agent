"""Import private vCard contacts into Jarvis's ignored local contact directory."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import logging
import quopri
import re
from pathlib import Path
from typing import Iterable
from observability import get_logger


logger = get_logger("contact_import")


def _unfold(lines: Iterable[str]) -> list[str]:
    unfolded: list[str] = []
    for raw in lines:
        line = raw.rstrip("\r\n")
        if line.startswith((" ", "\t")) and unfolded:
            unfolded[-1] += line[1:]
        else:
            unfolded.append(line)
    return unfolded


def _decode_value(header: str, value: str) -> str:
    upper = header.upper()
    try:
        if "ENCODING=QUOTED-PRINTABLE" in upper:
            charset = "utf-8"
            match = re.search(r"CHARSET=([^;:]+)", header, re.I)
            if match:
                charset = match.group(1)
            return quopri.decodestring(value).decode(charset, errors="replace")
        if "ENCODING=B" in upper or "ENCODING=BASE64" in upper:
            return base64.b64decode(value).decode("utf-8", errors="replace")
    except (ValueError, LookupError):
        logger.debug("Contact value decoding failed; preserving raw value", exc_info=True, extra={"event": "contacts.decode_fallback"})
    return value.replace("\\,", ",").replace("\\;", ";").replace("\\n", " ").strip()


def _phone(value: str) -> str | None:
    value = value.removeprefix("tel:").strip()
    prefix = "+" if value.startswith("+") else ""
    digits = "".join(character for character in value if character.isdigit())
    if not 8 <= len(digits) <= 15:
        return None
    return prefix + digits


def parse_vcf(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8-sig", errors="replace")
    cards: list[list[str]] = []
    current: list[str] | None = None
    for line in _unfold(text.splitlines()):
        if line.upper() == "BEGIN:VCARD":
            current = []
        elif line.upper() == "END:VCARD" and current is not None:
            cards.append(current)
            current = None
        elif current is not None:
            current.append(line)

    contacts: list[dict] = []
    seen: set[str] = set()
    for card in cards:
        name = ""
        phones: list[str] = []
        for line in card:
            if ":" not in line:
                continue
            header, value = line.split(":", 1)
            property_name = header.split(";", 1)[0].upper()
            if property_name == "FN":
                name = _decode_value(header, value)
            elif property_name == "TEL":
                normalized = _phone(_decode_value(header, value))
                if normalized:
                    phones.append(normalized)
        if not name:
            continue
        for index, phone in enumerate(dict.fromkeys(phones), start=1):
            identity = phone.lstrip("+")
            if identity in seen:
                continue
            seen.add(identity)
            display = name if len(phones) == 1 else f"{name} ({index})"
            contacts.append({
                "id": "contact_" + hashlib.sha256(identity.encode()).hexdigest()[:16],
                "display_name": display,
                "phone_number": phone,
                "aliases": list(dict.fromkeys([name, display])),
                "whatsapp_enabled": True,
            })
    return contacts


def import_contacts(source: Path, destination: Path) -> dict[str, int]:
    imported = parse_vcf(source)
    existing: list[dict] = []
    if destination.exists():
        existing = json.loads(destination.read_text(encoding="utf-8")).get("contacts", [])
    by_phone = {str(item.get("phone_number", "")).lstrip("+"): item for item in existing}
    added = 0
    for item in imported:
        key = item["phone_number"].lstrip("+")
        if key not in by_phone:
            by_phone[key] = item
            added += 1
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps({"contacts": list(by_phone.values())}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return {"cards_with_valid_numbers": len(imported), "added": added, "total": len(by_phone)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Import a VCF into Jarvis contacts")
    parser.add_argument("source", type=Path)
    parser.add_argument("--destination", type=Path, default=Path("data/contacts.json"))
    args = parser.parse_args()
    result = import_contacts(args.source, args.destination)
    print(json.dumps(result))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
