"""Central Jarvis intent routing and tool orchestration tests."""

from __future__ import annotations

import logging
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from jarvis.llm_client import LLMResponse, ToolCall
from jarvis.orchestrator import JarvisOrchestrator


class FakeMessaging:
    def __init__(self):
        self.context = SimpleNamespace(
            pending_contacts=[],
            awaiting_message_text=False,
            awaiting_confirmation=False,
            pending_message=None,
            active_contact=None,
        )
        self.contact = SimpleNamespace(display_name="Basit", id="basit", phone="+100")

    def resolve_recipient(self, recipient):
        if recipient.casefold() != "basit":
            return {"status": "NOT_FOUND", "message": "Contact not found"}
        self.context.active_contact = self.contact
        return {"status": "RESOLVED", "contact": self.contact, "message": "Basit"}

    def begin_message(self, contact):
        self.context.active_contact = contact
        self.context.awaiting_message_text = True
        self.context.awaiting_confirmation = False

    def set_message_text(self, text):
        self.context.awaiting_message_text = False
        self.context.pending_message = text
        return {"status": "MESSAGE_READY", "contact": self.context.active_contact, "message_text": text}

    def mark_draft_prepared(self, text):
        self.context.pending_message = text
        self.context.awaiting_confirmation = True

    @staticmethod
    def confirmation_intent(text):
        return "confirm" if text.casefold() == "send karo" else "cancel" if text.casefold() == "cancel" else "unclear"

    def clear_message(self):
        self.context.awaiting_message_text = False
        self.context.awaiting_confirmation = False
        self.context.pending_message = None
        self.context.active_contact = None


class OrchestrationTests(unittest.TestCase):
    def setUp(self):
        self.conversation = Mock()
        self.conversation.save_turn = Mock()
        self.conversation.failure_message = Mock(return_value="Service unavailable")
        self.tools = Mock()
        self.tools.has_tool.side_effect = lambda name: name == "open_application"
        self.messaging = FakeMessaging()
        self.whatsapp = Mock()
        self.memory = Mock()
        self.orchestrator = JarvisOrchestrator(
            conversation=self.conversation,
            tools=self.tools,
            messaging=self.messaging,
            whatsapp=self.whatsapp,
            memory=self.memory,
            direct_router=Mock(return_value=None),
        )

    def test_multiturn_whatsapp_conversation_flow(self):
        self.conversation.respond.return_value = LLMResponse(tool_calls=(
            ToolCall("start_whatsapp_message", {"recipient": "Basit", "message": None, "confidence": 0.98}),
        ))
        first = self.orchestrator.handle("Basit ko message karo")

        prepared = SimpleNamespace(success=True, message="prepared")
        sent = SimpleNamespace(success=True, message="Message sent")
        self.whatsapp.prepare_message.return_value = prepared
        self.whatsapp.send_prepared_message.return_value = sent
        second = self.orchestrator.handle("Main aa raha hoon.")
        third = self.orchestrator.handle("send karo")

        self.assertEqual(first, "Basit ko kya message karun?")
        self.assertIn("Draft ready", second)
        self.assertEqual(third, "Message sent")
        self.assertEqual(self.whatsapp.prepare_message.call_count, 2)
        self.whatsapp.prepare_message.assert_called_with(
            contact=self.messaging.contact,
            message_text="Main aa raha hoon.",
        )
        self.assertEqual(self.conversation.save_turn.call_count, 3)

    def test_high_confidence_tool_invocation(self):
        self.conversation.respond.return_value = LLMResponse(tool_calls=(
            ToolCall("open_application", {"application": "notepad", "confidence": 0.91}),
        ))
        self.tools.execute.return_value = SimpleNamespace(success=True, message="Opened Notepad")

        response = self.orchestrator.handle("Open my text editor")

        self.assertEqual(response, "Opened Notepad")
        self.tools.execute.assert_called_once_with("open_application", application="notepad")

    def test_low_confidence_intent_requests_clarification(self):
        self.conversation.respond.return_value = LLMResponse(tool_calls=(
            ToolCall("open_application", {"application": "notepad", "confidence": 0.2}),
        ))

        response = self.orchestrator.handle("Do that thing")

        self.assertIn("clarify", response.casefold())
        self.tools.execute.assert_not_called()

    def test_tool_error_recovers_without_leaking_exception(self):
        self.conversation.respond.return_value = LLMResponse(tool_calls=(
            ToolCall("open_application", {"application": "notepad", "confidence": 0.95}),
        ))
        self.tools.execute.side_effect = RuntimeError("sensitive failure")

        response = self.orchestrator.handle("Open Notepad")

        self.assertIn("could not complete", response)
        self.assertNotIn("sensitive failure", response)

    def test_orchestration_logging_has_intent_confidence_and_completion(self):
        self.conversation.respond.return_value = LLMResponse(tool_calls=(
            ToolCall("open_application", {"application": "notepad", "confidence": 0.88}),
        ))
        self.tools.execute.return_value = SimpleNamespace(success=True, message="Opened")

        with self.assertLogs("jarvis.orchestrator", level=logging.INFO) as captured:
            self.orchestrator.handle("Open Notepad")

        output = "\n".join(captured.output)
        self.assertIn("Central request orchestration started", output)
        self.assertIn("Structured ChatGPT intent detected", output)
        self.assertIn("Central request orchestration completed", output)


if __name__ == "__main__":
    unittest.main()
