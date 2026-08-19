"""Automated coverage for the Jarvis ChatGPT conversation boundary."""

from __future__ import annotations

import io
import json
import socket
import unittest
import urllib.error
from unittest.mock import Mock, patch

from jarvis.conversation import JarvisConversation
from jarvis.llm_client import (
    LLMAuthenticationError,
    LLMTimeoutError,
    OpenAIResponsesClient,
    LLMResponse,
    ToolCall,
)


class FakeHTTPResponse:
    def __init__(self, payload: dict):
        self.body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self.body


class ChatGPTClientTests(unittest.TestCase):
    def test_successful_api_call(self):
        transport = Mock(return_value=FakeHTTPResponse({
            "id": "resp_123",
            "output": [{"type": "message", "content": [{"type": "output_text", "text": "Hello"}]}],
        }))
        client = OpenAIResponsesClient(api_key="test-key", model="test-model", urlopen=transport)

        result = client.create_response(messages=[{"role": "user", "content": "Hi"}], system_prompt="Be helpful")

        self.assertEqual(result.text, "Hello")
        request = transport.call_args.args[0]
        payload = json.loads(request.data)
        self.assertEqual(payload["model"], "test-model")
        self.assertEqual(payload["input"][-1]["content"], "Hi")

    def test_timeout_is_retried_then_classified(self):
        transport = Mock(side_effect=socket.timeout("slow"))
        client = OpenAIResponsesClient(api_key="test-key", model="test-model", timeout=0.1,
                                       max_retries=1, urlopen=transport, sleep=Mock())
        with self.assertRaises(LLMTimeoutError):
            client.create_response(messages=[], system_prompt="test")
        self.assertEqual(transport.call_count, 2)

    def test_failed_authentication_is_not_retried(self):
        error = urllib.error.HTTPError("https://api.openai.com/v1/responses", 401, "Unauthorized", {}, io.BytesIO())
        transport = Mock(side_effect=error)
        client = OpenAIResponsesClient(api_key="bad-key", model="test-model", max_retries=2,
                                       urlopen=transport, sleep=Mock())
        with self.assertRaises(LLMAuthenticationError):
            client.create_response(messages=[], system_prompt="test")
        transport.assert_called_once()


class ConversationHistoryTests(unittest.TestCase):
    def test_history_and_current_turn_are_sent_in_order(self):
        client = Mock()
        client.model = "test-model"
        client.create_response.return_value.text = "new answer"
        conversation = JarvisConversation(client=client)
        history = [
            {"role": "user", "content": "first question"},
            {"role": "assistant", "content": "first answer"},
        ]
        with patch("jarvis.conversation.memory.get_recent_messages", return_value=history):
            conversation.respond("follow up")

        messages = client.create_response.call_args.kwargs["messages"]
        self.assertEqual([item["content"] for item in messages], ["first question", "first answer", "follow up"])

    def test_structured_tool_intent_is_parsed_without_execution(self):
        client = OpenAIResponsesClient(api_key="test-key", model="test-model")
        result = client._parse_response(json.dumps({
            "id": "resp_tool",
            "output": [{"type": "function_call", "name": "open_application",
                        "arguments": "{\"application\":\"notepad\"}", "call_id": "call_1"}],
        }))
        self.assertEqual(result.tool_calls[0].name, "open_application")
        self.assertEqual(result.tool_calls[0].arguments, {"application": "notepad"})

    def test_python_registry_executes_structured_tool_intent(self):
        from jarvis.main import Jarvis

        llm_result = LLMResponse(tool_calls=(ToolCall("open_application", {"application": "notepad"}),))
        tool_result = Mock(message="Notepad opened", success=True)
        with (
            patch("jarvis.main.conversation.respond", return_value=llm_result),
            patch("jarvis.main.conversation.save_turn") as save_turn,
            patch("jarvis.main.tools.execute", return_value=tool_result) as execute,
        ):
            response = Jarvis().process("please open my editor")

        self.assertEqual(response, "Notepad opened")
        execute.assert_called_once_with("open_application", application="notepad")
        save_turn.assert_called_once_with("please open my editor", "Notepad opened")


if __name__ == "__main__":
    unittest.main()
