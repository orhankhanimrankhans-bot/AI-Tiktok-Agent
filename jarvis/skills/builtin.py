"""Built-in adapters around existing Jarvis capabilities."""

from __future__ import annotations

import logging

from observability import get_logger, log_event

from .base import BaseSkill, SkillContext, SkillResult


logger = get_logger("skills.builtin")


class ConversationSkill(BaseSkill):
    name = "conversation"
    description = "Conversation brain and intent detection"
    intents = ("conversation",)
    priority = 1000

    def execute(self, context: SkillContext) -> SkillResult:
        """
        Run the conversation brain without leaking internal failures.

        On a genuine conversation-service failure, return success=False.
        The orchestrator already knows how to return the friendly response
        from failed skills, so it must not try to interpret a missing
        LLMResponse payload.
        """
        try:
            detected = context.conversation.respond(
                context.user_input
            )
        except Exception as error:
            logger.exception(
                "Conversation skill recovered from conversation failure",
                extra={
                    "event": "skill.conversation_recovered",
                    "error_type": type(error).__name__,
                },
            )

            try:
                response = context.conversation.failure_message(
                    error
                )
            except Exception:
                response = (
                    "Mujhe aapki baat process karne mein problem aayi. "
                    "Aap dobara keh dein?"
                )

            return SkillResult(
                False,
                response,
                error,
            )

        response_text = str(
            getattr(detected, "text", "") or ""
        ).strip()

        tool_calls = getattr(
            detected,
            "tool_calls",
            None,
        )

        if not response_text and not tool_calls:
            response_text = (
                "Mujhe aapki baat poori tarah samajh nahi aayi. "
                "Dobara bata dein?"
            )

            log_event(
                logger,
                logging.INFO,
                "skill.conversation_clarification",
                "Empty conversation result converted to natural clarification",
                success=True,
            )

        return SkillResult(
            True,
            response_text,
            detected,
        )


class AutomationSkill(BaseSkill):
    name = "automation"
    description = "Existing Python tool execution"
    priority = 100

    def __init__(self, tools) -> None:
        self.tools = tools

    def can_handle(self, context: SkillContext) -> bool:
        return self.tools.has_tool(context.intent)

    def execute(self, context: SkillContext) -> SkillResult:
        result = self.tools.execute(
            context.intent,
            **context.arguments,
        )

        return SkillResult(
            bool(result.success),
            result.message,
            result,
        )


class WhatsAppSkill(BaseSkill):
    name = "whatsapp"
    description = "Confirmed semantic WhatsApp workflow"
    intents = ("start_whatsapp_message",)
    priority = 50

    def __init__(self, starter) -> None:
        self.starter = starter

    def execute(self, context: SkillContext) -> SkillResult:
        return SkillResult(
            True,
            self.starter(context.arguments),
        )