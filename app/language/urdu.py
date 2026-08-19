"""Data-oriented Urdu, Roman Urdu, and mixed-command normalization."""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


URDU_DIGITS = {"۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4", "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9"}
NUMBER_WORDS = {
    "zero": 0, "sifar": 0, "صفر": 0, "aik": 1, "ek": 1, "ایک": 1,
    "do": 2, "دو": 2, "teen": 3, "تین": 3, "char": 4, "chaar": 4, "چار": 4,
    "panch": 5, "پانچ": 5, "chay": 6, "چھ": 6, "saat": 7, "سات": 7,
    "aath": 8, "آٹھ": 8, "nau": 9, "نو": 9, "das": 10, "دس": 10,
    "bees": 20, "بیس": 20, "tees": 30, "تیس": 30, "chalees": 40, "چالیس": 40,
    "pachas": 50, "پچاس": 50, "saath": 60, "ساٹھ": 60, "sattar": 70, "ستر": 70,
    "assi": 80, "اسی": 80, "nabbe": 90, "نوے": 90, "sau": 100, "سو": 100,
}
ROMAN_MARKERS = {"kholo", "karo", "kar", "ko", "bolo", "batao", "bhejo", "banao", "mein", "mera", "aur", "ke", "bare"}


@dataclass(slots=True, frozen=True)
class LanguageResult:
    original: str
    normalized: str
    language: str
    confidence: float


def parse_number(value: str) -> int | None:
    cleaned = "".join(URDU_DIGITS.get(char, char) for char in value.casefold().strip())
    if cleaned.isdigit():
        return int(cleaned)
    return NUMBER_WORDS.get(cleaned)


class UrduCommandNormalizer:
    APP_ALIASES = {
        "واٹس ایپ": "WhatsApp", "واٹس ایپ": "WhatsApp", "واٹس اپ": "WhatsApp",
        "کروم": "Chrome", "وی ایس کوڈ": "VS Code", "نوٹ پیڈ": "Notepad",
    }

    def detect(self, text: str) -> tuple[str, float]:
        if re.search(r"[\u0600-\u06ff]", text):
            return ("mixed" if re.search(r"[A-Za-z]", text) else "ur", .98)
        words = set(re.findall(r"[a-z]+", text.casefold()))
        hits = len(words & ROMAN_MARKERS)
        return ("ur-roman", min(.98, .72 + hits * .06)) if hits else ("en", .95)

    @staticmethod
    def _space(text: str) -> str:
        return " ".join(text.strip().strip("۔.!?").split())

    def normalize(self, command: str) -> LanguageResult:
        original = unicodedata.normalize("NFKC", command)
        text = self._space(original)
        language, confidence = self.detect(text)
        text = re.sub(r"^(?:hello\s+)?jarvis[،,. ]*", "", text, flags=re.I)
        for alias, canonical in self.APP_ALIASES.items():
            text = text.replace(alias, canonical)

        # WhatsApp and messaging fast paths; preserve the message verbatim.
        patterns = [
            (r"^(.+?)\s+ko\s+(?:message\s+)?(?:karo|bhejo|send karo)\s+(?:ke|keh)\s+(.+)$", r"message \1 saying \2"),
            (r"^(.+?)\s+ko\s+(?:bolo|batao|keh do)\s+(.+)$", r"message \1 saying \2"),
            (r"^(.+?)\s+ko\s+message\s+karo$", r"message \1"),
            (r"^(.+?)\s+ki\s+chat\s+kholo$", r"open \1's WhatsApp chat"),
            (r"^(.+?)\s+کو\s+(?:میسج|پیغام)\s+(?:کرو|بھیجو)\s+کہ\s+(.+)$", r"message \1 saying \2"),
            (r"^(.+?)\s+کو\s+(?:بتاؤ|کہو|کہہ دو)\s+کہ?\s*(.+)$", r"message \1 saying \2"),
            (r"^(.+?)\s+کو\s+(?:میسج|پیغام)\s+(?:کرو|بھیجو)$", r"message \1"),
            (r"^(.+?)\s+کی\s+چیٹ\s+کھولو$", r"open \1's WhatsApp chat"),
        ]
        for pattern, replacement in patterns:
            if re.fullmatch(pattern, text, re.I):
                text = re.sub(pattern, replacement, text, flags=re.I)
                return LanguageResult(original, self._space(text), language, confidence)

        text = re.sub(r"^(WhatsApp|Chrome|VS Code|Notepad)\s+(?:kholo|khol do|open karo|open kar do|کھولو|کھول دو|اوپن کرو)$", r"open \1", text, flags=re.I)
        video = re.fullmatch(r"(.+?)\s+ke\s+bare\s+mein\s+(?:TikTok\s+)?video\s+banao", text, re.I)
        if video:
            text = f"create TikTok video about {video.group(1)}"
        return LanguageResult(original, self._space(text), language, confidence)
