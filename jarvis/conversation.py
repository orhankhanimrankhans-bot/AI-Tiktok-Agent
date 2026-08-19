"""Persistent Jarvis conversation service backed by OpenAI Responses."""

from __future__ import annotations

import logging
from pathlib import Path

from observability import get_logger, log_event
from . import config
from .llm_client import (
    DESKTOP_TOOL_DEFINITIONS,
    LLMAuthenticationError,
    LLMInvalidResponseError,
    LLMNetworkError,
    LLMRateLimitError,
    LLMResponse,
    LLMTimeoutError,
    OpenAIResponsesClient,
)
from .memory import memory

logger = get_logger("conversation")


DEFAULT_SYSTEM_PROMPT = """
You are JARVIS, the user's personal AI assistant running on Windows.

CONVERSATION FIRST
- Speak naturally, like a capable personal assistant, not like a command parser.
- Understand English, Urdu, Roman Urdu, and natural mixed Pakistani Urdu/English.
- The user may switch languages inside the same sentence. Follow the meaning, not the language label.
- Reply in the user's dominant language and style. If they speak Urdu, answer naturally in Urdu.
  If they use Roman Urdu, answer naturally in Roman Urdu. If they use English, answer in English.
- Keep ordinary spoken answers concise, warm, direct, and easy to listen to.
- Do not sound robotic, bureaucratic, or like a debug console.
- Do not repeat the user's whole sentence unless repetition is useful for clarification.

UNDERSTANDING UNCLEAR SPEECH
- Voice transcripts may contain wrong, missing, or distorted words.
- Never invent a meaning when the sentence is genuinely unclear.
- If most of the meaning is understandable, use the understood part and ask one short clarification
  only for the uncertain part.
- If the request cannot be understood reliably, politely say that you did not fully understand and
  ask the user to repeat or rephrase it.
- Match the clarification language to the user.
  Examples:
  Urdu: "مجھے آخری بات پوری طرح سمجھ نہیں آئی، دوبارہ بتا دیں؟"
  Roman Urdu: "Mujhe aakhri baat poori tarah samajh nahi aayi, dobara bata dein?"
  English: "I didn't fully understand that. Could you say it again?"
- Do not expose internal labels such as "skill failed", "invalid intent", "invalid response",
  "conversation skill", stack traces, or implementation details to the user for an unclear request.

CONTEXT AND FOLLOW-UPS
- Use recent conversation context for follow-up references.
- Resolve natural references such as "it", "that video", "usko", "isko", "woh wala",
  "same one", and "previous one" from recent context when the reference is reasonably clear.
- If a reference could point to more than one thing, ask a brief clarification instead of guessing.
- Treat short conversational replies such as "haan", "theek hai", "bilkul", "yes", "no",
  "acha", "hmm", and "kar do" in the context of the immediately preceding turn.
- Do not force every user message into an action. Normal conversation should remain conversation.

ACTIONS AND SAFETY BOUNDARY
- Never claim a computer action succeeded unless the Python tool layer reports success.
- Never invent contacts, files, application state, WhatsApp sends, or TikTok publishing.
- WhatsApp and TikTok are handled by dedicated Python workflows, not conversational text.
- Use an available function only when the user clearly requests that exact desktop action.
- Include an honest confidence score with every function call.
- If action intent is ambiguous or confidence is below 0.65, call request_clarification
  with one concise, natural question instead of selecting an action.
- When asking clarification, do not mention confidence scores or internal routing.

WHATSAPP
- For a request to message a person on WhatsApp, call start_whatsapp_message.
- Do not claim the message was sent.
- ChatGPT may identify recipient/message intent only.
- Python resolves the contact, prepares the draft, asks for explicit confirmation,
  and performs the send action.

TIKTOK
- TikTok creation/publishing remains owned by the dedicated Python workflow.
- Do not claim a TikTok was created or published unless the Python workflow reports success.
- If the user is merely discussing a TikTok idea, converse normally rather than executing an action.

GENERAL RESPONSE RULE
- Respond only to the current request while preserving useful recent context.
- Prefer a helpful clarification over an error-looking response whenever the user's meaning,
  rather than the underlying system, is uncertain.
""".strip()


class JarvisConversation:
    def __init__(self, client: OpenAIResponsesClient | None = None) -> None:
        self.client = client or OpenAIResponsesClient(
            api_key=config.OPENAI_API_KEY,
            model=config.JARVIS_OPENAI_MODEL,
            timeout=config.JARVIS_OPENAI_TIMEOUT,
            max_retries=config.JARVIS_OPENAI_MAX_RETRIES,
        )

    def _system_prompt(self) -> str:
        if config.JARVIS_SYSTEM_PROMPT:
            return config.JARVIS_SYSTEM_PROMPT

        if config.JARVIS_SYSTEM_PROMPT_FILE:
            path = Path(config.JARVIS_SYSTEM_PROMPT_FILE)

            if not path.is_absolute():
                path = config.PROJECT_ROOT / path

            try:
                prompt = path.read_text(
                    encoding="utf-8"
                ).strip()
            except OSError:
                logger.exception(
                    "Configured system prompt could not be read",
                    extra={"event": "conversation.prompt_failed"},
                )
            else:
                if prompt:
                    return prompt

        return DEFAULT_SYSTEM_PROMPT

    def _build_messages(
        self,
        user_text: str,
    ) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = []

        recent = memory.get_recent_messages()[
            -config.MAX_CONVERSATION_HISTORY :
        ]

        for item in recent:
            role = item.get("role")
            text = item.get(
                "content",
                "",
            ).strip()

            if role in {"user", "assistant"} and text:
                messages.append(
                    {
                        "role": role,
                        "content": text,
                    }
                )

        messages.append(
            {
                "role": "user",
                "content": user_text,
            }
        )

        return messages

    def respond(
        self,
        user_text: str,
    ) -> LLMResponse:
        user_text = user_text.strip()

        if not user_text:
            return LLMResponse()

        log_event(
            logger,
            logging.INFO,
            "execution.started",
            "ChatGPT conversation started",
            module_selection="openai",
            model=self.client.model,
        )

        return self.client.create_response(
            messages=self._build_messages(
                user_text
            ),
            system_prompt=self._system_prompt(),
            tools=DESKTOP_TOOL_DEFINITIONS,
        )

    def save_turn(
        self,
        user_text: str,
        assistant_text: str,
        language: str = "auto",
    ) -> None:
        memory.add_message(
            role="user",
            content=user_text,
            language=language,
        )

        memory.add_message(
            role="assistant",
            content=assistant_text,
            language=language,
        )

    @staticmethod
    def failure_message(
        error: Exception,
    ) -> str:
        # These are genuine service/configuration failures, not
        # "I didn't understand you" cases. Keep them friendly while
        # preserving enough information for the user to recover.
        if isinstance(
            error,
            LLMAuthenticationError,
        ):
            return (
                "Mujhe AI service se connect karne mein authentication "
                "problem aa rahi hai. OPENAI_API_KEY check kar dein."
            )

        if isinstance(
            error,
            LLMRateLimitError,
        ):
            return (
                "AI service abhi busy hai. Thori dair baad dobara "
                "koshish karte hain."
            )

        if isinstance(
            error,
            LLMTimeoutError,
        ):
            return (
                "Response aane mein zyada waqt lag gaya. "
                "Aap dobara keh dein."
            )

        if isinstance(
            error,
            LLMNetworkError,
        ):
            return (
                "AI service se connection nahi ban raha. "
                "Network check karke dobara koshish karein."
            )

        if isinstance(
            error,
            LLMInvalidResponseError,
        ):
            return (
                "Mujhe jawab theek tarah receive nahi hua. "
                "Aap apni baat dobara keh dein."
            )

        return (
            "Main is waqt aapki request process nahi kar saka. "
            "Aap dobara keh dein."
        )

    def reply(
        self,
        user_text: str,
        language: str = "auto",
    ) -> str:
        user_text = user_text.strip()

        if not user_text:
            return ""

        try:
            result = self.respond(
                user_text
            )

            if result.tool_calls:
                return (
                    "This request needs the Jarvis tool layer."
                )

            response = (
                result.text or ""
            ).strip()

            # Never expose an empty conversational result to voice/dashboard.
            if not response:
                response = (
                    "Mujhe aapki baat poori tarah samajh nahi aayi. "
                    "Dobara bata dein?"
                )

        except (
            LLMAuthenticationError,
            LLMRateLimitError,
            LLMTimeoutError,
            LLMNetworkError,
            LLMInvalidResponseError,
        ) as error:
            logger.exception(
                "ChatGPT conversation failed gracefully",
                extra={
                    "event": "conversation.failed",
                    "error_type": type(error).__name__,
                },
            )

            return self.failure_message(
                error
            )

        self.save_turn(
            user_text,
            response,
            language,
        )

        log_event(
            logger,
            logging.INFO,
            "execution.completed",
            "ChatGPT conversation completed",
            module_selection="openai",
            success=True,
            response_length=len(response),
        )

        return response


conversation = JarvisConversation()