from __future__ import annotations

import unittest

from app.language.urdu import UrduCommandNormalizer, parse_number
from app.whatsapp.intent import WhatsAppIntentParser
from app.whatsapp.models import WhatsAppIntentType


class UrduLanguageTests(unittest.TestCase):
    def setUp(self) -> None:
        self.normalizer = UrduCommandNormalizer()

    def test_application_commands(self) -> None:
        cases = {
            "WhatsApp kholo": "open WhatsApp",
            "واٹس ایپ کھولو": "open WhatsApp",
            "Chrome khol do": "open Chrome",
            "کروم کھولو": "open Chrome",
            "VS Code open karo": "open VS Code",
            "نوٹ پیڈ کھول دو": "open Notepad",
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                self.assertEqual(self.normalizer.normalize(source).normalized, expected)

    def test_whatsapp_message_extraction(self) -> None:
        cases = [
            ("Basit ko message karo ke main aa raha hoon", "Basit", "main aa raha hoon"),
            ("Sulaiman ko bolo main 10 minute mein pohanchunga", "Sulaiman", "main 10 minute mein pohanchunga"),
            ("باسط کو میسج کرو کہ میں آ رہا ہوں", "باسط", "میں آ رہا ہوں"),
            ("سلیمان کو بتاؤ کہ میں دس منٹ میں پہنچوں گا", "سلیمان", "میں دس منٹ میں پہنچوں گا"),
        ]
        for source, recipient, message in cases:
            with self.subTest(source=source):
                normalized = self.normalizer.normalize(source).normalized
                intent = WhatsAppIntentParser().parse(normalized)
                self.assertEqual(intent.intent, WhatsAppIntentType.SEND_MESSAGE)
                self.assertEqual(intent.recipient_query, recipient)
                self.assertEqual(intent.message, message)

    def test_language_detection(self) -> None:
        self.assertEqual(self.normalizer.normalize("واٹس ایپ کھولو").language, "ur")
        self.assertEqual(self.normalizer.normalize("WhatsApp kholo").language, "ur-roman")
        self.assertEqual(self.normalizer.normalize("WhatsApp کھولو").language, "mixed")

    def test_numbers(self) -> None:
        for source, expected in [("چالیس", 40), ("chalees", 40), ("۴۰", 40), ("pachas", 50), ("تیس", 30)]:
            self.assertEqual(parse_number(source), expected)

    def test_tiktok_command(self) -> None:
        result = self.normalizer.normalize("black holes ke bare mein TikTok video banao")
        self.assertEqual(result.normalized, "create TikTok video about black holes")


if __name__ == "__main__":
    unittest.main()
