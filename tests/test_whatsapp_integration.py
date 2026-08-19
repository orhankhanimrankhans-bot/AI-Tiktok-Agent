"""Persistent ChatGPT-to-Python WhatsApp workflow integration tests."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

from jarvis.contact_resolver import Contact
from jarvis.llm_client import LLMResponse, ToolCall
from jarvis.memory import JarvisMemory
from jarvis.messaging_context import MessagingManager
from jarvis.orchestrator import JarvisOrchestrator


class FakeContactResolver:
    def __init__(self, contact):
        self.contact = contact

    @staticmethod
    def normalize(value):
        return value.casefold().strip()

    def get_contact(self, contact_id):
        return self.contact if contact_id == self.contact.id else None

    def resolve(self, query):
        if query.casefold().strip() == "basit":
            return SimpleNamespace(status="EXACT", contact=self.contact, alternatives=[])
        return SimpleNamespace(status="NOT_FOUND", contact=None, alternatives=[])


class WhatsAppWorkflowIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.memory = JarvisMemory.__new__(JarvisMemory)
        self.memory.db_path = Path(self.temp.name) / "memory.db"
        self.memory._initialize_database()
        self.contact = Contact("basit", "Basit", "+100000000", ["Basit"])
        self.resolver = FakeContactResolver(self.contact)
        self.memory_patch = patch("jarvis.messaging_context.memory", self.memory)
        self.resolver_patch = patch("jarvis.messaging_context.contact_resolver", self.resolver)
        self.memory_patch.start()
        self.resolver_patch.start()

    def tearDown(self):
        self.resolver_patch.stop()
        self.memory_patch.stop()
        self.temp.cleanup()

    def make_orchestrator(self, manager, conversation=None, whatsapp=None):
        conversation = conversation or Mock()
        conversation.save_turn = Mock()
        tools = Mock()
        tools.has_tool.return_value = False
        return JarvisOrchestrator(
            conversation=conversation,
            tools=tools,
            messaging=manager,
            whatsapp=whatsapp or Mock(),
            memory=self.memory,
            direct_router=Mock(return_value=None),
        )

    def test_chatgpt_intent_uses_python_contact_resolution(self):
        manager = MessagingManager()
        conversation = Mock()
        conversation.respond.return_value = LLMResponse(tool_calls=(
            ToolCall("start_whatsapp_message", {"recipient": "Basit", "message": None, "confidence": 0.99}),
        ))
        orchestrator = self.make_orchestrator(manager, conversation=conversation)

        response = orchestrator.handle("Basit ko message karo")

        self.assertEqual(response, "Basit ko kya message karun?")
        self.assertTrue(manager.context.awaiting_message_text)
        self.assertEqual(manager.context.active_contact.display_name, "Basit")

    def test_draft_preparation_requires_confirmation_before_send(self):
        manager = MessagingManager()
        manager.begin_message(self.contact)
        whatsapp = Mock()
        whatsapp.prepare_message.return_value = SimpleNamespace(success=True, status="MESSAGE_PREPARED", message="prepared")
        whatsapp.send_prepared_message.return_value = SimpleNamespace(success=True, status="MESSAGE_SENT", message="sent")
        orchestrator = self.make_orchestrator(manager, whatsapp=whatsapp)

        draft_response = orchestrator.handle("Main aa raha hoon")

        self.assertIn("send karun", draft_response)
        whatsapp.send_prepared_message.assert_not_called()
        self.assertTrue(manager.context.awaiting_confirmation)

        send_response = orchestrator.handle("send karo")
        self.assertEqual(send_response, "sent")
        whatsapp.send_prepared_message.assert_called_once_with()
        self.assertIsNone(self.memory.get_pending_task("whatsapp_message"))

    def test_duplicate_confirmation_does_not_send_twice(self):
        manager = MessagingManager()
        manager.begin_message(self.contact)
        whatsapp = Mock()
        whatsapp.prepare_message.return_value = SimpleNamespace(success=True, status="MESSAGE_PREPARED", message="prepared")
        whatsapp.send_prepared_message.return_value = SimpleNamespace(success=True, status="MESSAGE_SENT", message="sent")
        conversation = Mock()
        conversation.respond.return_value = LLMResponse(text="There is no pending message to send.")
        orchestrator = self.make_orchestrator(manager, conversation=conversation, whatsapp=whatsapp)

        orchestrator.handle("hello")
        orchestrator.handle("send karo")
        second = orchestrator.handle("send karo")

        self.assertEqual(second, "There is no pending message to send.")
        whatsapp.send_prepared_message.assert_called_once_with()

    def test_pending_confirmation_recovers_after_restart(self):
        first_manager = MessagingManager()
        first_manager.begin_message(self.contact)
        first_manager.set_message_text("Main aa raha hoon")
        first_manager.mark_draft_prepared("Main aa raha hoon")

        restarted_manager = MessagingManager()
        self.assertTrue(restarted_manager.context.awaiting_confirmation)
        self.assertEqual(restarted_manager.context.pending_message, "Main aa raha hoon")
        self.assertEqual(restarted_manager.context.active_contact.display_name, "Basit")

        whatsapp = Mock()
        whatsapp.prepare_message.return_value = SimpleNamespace(success=True, status="MESSAGE_PREPARED", message="prepared")
        whatsapp.send_prepared_message.return_value = SimpleNamespace(success=True, status="MESSAGE_SENT", message="sent after restart")
        orchestrator = self.make_orchestrator(restarted_manager, whatsapp=whatsapp)

        self.assertEqual(orchestrator.handle("send karo"), "sent after restart")
        whatsapp.prepare_message.assert_called_once_with(contact=self.contact, message_text="Main aa raha hoon")


if __name__ == "__main__":
    unittest.main()
