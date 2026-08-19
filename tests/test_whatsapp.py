from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import json
import unittest

from app.whatsapp.agent import WhatsAppAgent
from app.whatsapp.contacts import ContactResolver
from app.whatsapp.intent import WhatsAppIntentParser
from app.whatsapp.models import ResolutionStatus, WhatsAppIntentType


class WhatsAppTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.root = Path(self.temporary.name)
        data = self.root / "data"
        data.mkdir()
        (data / "contacts.json").write_text(json.dumps({"contacts": [
            {"id": "sulaiman", "display_name": "Muhammad Sulaiman", "phone_number": "+966500000001",
             "aliases": ["Sulaiman", "Muhammad Suleman", "Mohammad Sulaiman"], "whatsapp_enabled": True},
            {"id": "basit", "display_name": "Basit", "phone_number": "+966500000002",
             "aliases": [], "whatsapp_enabled": True},
        ]}), encoding="utf-8")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_intent_variations(self) -> None:
        parser = WhatsAppIntentParser()
        cases = {
            "Open WhatsApp.": WhatsAppIntentType.OPEN,
            "Message Basit.": WhatsAppIntentType.SEND_MESSAGE,
            "Tell Sulaiman I'm outside.": WhatsAppIntentType.SEND_MESSAGE,
            "Send Basit a WhatsApp saying hello.": WhatsAppIntentType.SEND_MESSAGE,
            "Open Muhammad Sulaiman's chat.": WhatsAppIntentType.OPEN_CHAT,
            "open my whatsapp and message to Muhammad Sulaiman and tell him I will call later": WhatsAppIntentType.SEND_MESSAGE,
            "open my WhatsApp and message to Mohammed Suleman say hi": WhatsAppIntentType.SEND_MESSAGE,
        }
        for command, expected in cases.items():
            with self.subTest(command=command):
                self.assertEqual(parser.parse(command).intent, expected)

    def test_contact_resolution(self) -> None:
        resolver = ContactResolver(self.root / "data" / "contacts.json")
        self.assertEqual(resolver.resolve("basit").contact.display_name, "Basit")
        self.assertEqual(resolver.resolve("Sulaiman").contact.display_name, "Muhammad Sulaiman")
        self.assertEqual(resolver.resolve("Muhammad Suleman").contact.display_name, "Muhammad Sulaiman")
        self.assertEqual(resolver.resolve("unknown").status, ResolutionStatus.NOT_FOUND)

    def test_say_separator_does_not_become_part_of_contact(self) -> None:
        intent = WhatsAppIntentParser().parse(
            "open my WhatsApp and message to Mohammed Suleman say hi"
        )
        self.assertEqual(intent.recipient_query, "Mohammed Suleman")
        self.assertEqual(intent.message, "hi")

    def test_followup_context(self) -> None:
        agent = WhatsAppAgent(self.root, dry_run=True)
        first = agent.execute("Message Basit")
        self.assertEqual(first.status, "MESSAGE_REQUIRED")
        second = agent.execute("Tell him I'll arrive in ten minutes")
        self.assertEqual(second.status, "DRY_RUN")

    def test_duplicate_send_is_blocked(self) -> None:
        agent = WhatsAppAgent(self.root, dry_run=True)
        first = agent.execute("Tell Basit hello")
        second = agent.execute("Tell Basit hello")
        self.assertEqual(first.status, "DRY_RUN")
        self.assertEqual(second.status, "DUPLICATE_BLOCKED")


if __name__ == "__main__":
    unittest.main()
