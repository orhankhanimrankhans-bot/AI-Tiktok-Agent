"""Central single-agent request orchestration for every Jarvis interface."""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from observability import get_logger, log_event
from . import config
from .llm_client import LLMResponse, ToolCall
from .skills import SkillContext, SkillRegistry
from .skills.builtin import AutomationSkill, ConversationSkill, WhatsAppSkill


logger = get_logger("orchestrator")


@dataclass(frozen=True)
class ConversationContext:
    pending_contact_selection: bool
    awaiting_message_text: bool
    awaiting_confirmation: bool
    active_contact: str | None


@dataclass(frozen=True)
class OrchestrationStep:
    kind: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    confidence: float = 1.0
    agent: str = "primary"


@dataclass(frozen=True)
class ExecutionPlan:
    """Future multi-agent boundary; currently executed sequentially by one agent."""

    steps: tuple[OrchestrationStep, ...]
    strategy: str = "single_agent_sequential"


class ToolRouter:
    def __init__(self, tools, confidence_threshold: float) -> None:
        self.tools = tools
        self.confidence_threshold = confidence_threshold

    def plan(self, call: ToolCall) -> ExecutionPlan:
        arguments = dict(call.arguments)
        try:
            confidence = float(arguments.pop("confidence", 1.0))
        except (TypeError, ValueError):
            confidence = 0.0
        confidence = min(1.0, max(0.0, confidence))
        kind = "clarification" if call.name == "request_clarification" else "workflow" if call.name == "start_whatsapp_message" else "tool"
        return ExecutionPlan((OrchestrationStep(kind, call.name, arguments, confidence),))

    def clarification(self, step: OrchestrationStep) -> str | None:
        if step.kind == "clarification":
            return str(step.arguments.get("question") or "Could you clarify what you want me to do?").strip()
        if step.confidence < self.confidence_threshold:
            return "I am not confident which action you want. Could you clarify the exact action?"
        if step.kind == "tool" and not self.tools.has_tool(step.name):
            return "I understood that as an action, but it is not an available Jarvis tool. What should I do instead?"
        return None


class JarvisOrchestrator:
    def __init__(self, *, conversation, tools, messaging, whatsapp, memory,
                 direct_router: Callable[[str], str | None],
                 skills: SkillRegistry | None = None) -> None:
        self.conversation = conversation
        self.tools = tools
        self.messaging = messaging
        self.whatsapp = whatsapp
        self.memory = memory
        self.direct_router = direct_router
        self.tool_router = ToolRouter(tools, config.JARVIS_INTENT_CONFIDENCE_THRESHOLD)
        self.skills = skills or SkillRegistry(
            enabled=config.JARVIS_ENABLED_SKILLS,
            disabled=config.JARVIS_DISABLED_SKILLS,
        )
        if skills is None:
            self.skills.register(ConversationSkill())
            self.skills.register(AutomationSkill(tools))
            self.skills.register(WhatsAppSkill(self._start_whatsapp))
            for skill_type in self.skills.discover("jarvis.skills.catalog"):
                self.skills.register(skill_type())

    def context(self) -> ConversationContext:
        # Ambiguous contact selection should never hijack future unrelated
        # conversation forever. The messaging manager timestamps this state.
        if self.messaging.context.pending_contacts:
            if not self.messaging.pending_contact_selection_is_fresh():
                self.messaging.clear_pending_contact_selection()

        active = self.messaging.context.active_contact
        return ConversationContext(
            pending_contact_selection=bool(self.messaging.context.pending_contacts),
            awaiting_message_text=bool(self.messaging.context.awaiting_message_text),
            awaiting_confirmation=bool(self.messaging.context.awaiting_confirmation),
            active_contact=getattr(active, "display_name", None),
        )

    def handle(self, user_input: str) -> str:
        context = self.context()
        log_event(logger, logging.INFO, "orchestration.started", "Central request orchestration started", user_input=user_input, context=context.__dict__, strategy="single_agent_sequential")

        contextual = self._handle_context(user_input, context)
        if contextual is not None:
            return self._complete(user_input, contextual, "context", 1.0)

        # Preserve high-confidence deterministic/safety routes and existing workflows.
        direct = self.direct_router(user_input)
        if direct is not None:
            return self._complete(user_input, direct, "deterministic", 1.0)

        conversation_result = self.skills.execute(SkillContext(
            user_input=user_input,
            intent="conversation",
            conversation=self.conversation,
        ))
        if not conversation_result.success:
            return self._complete(user_input, conversation_result.response, "skill_unavailable", 0.0)
        detected = conversation_result.payload
        if not isinstance(detected, LLMResponse):
            return self._complete(user_input, "The conversation skill returned an invalid response.", "skill_invalid", 0.0)

        if not detected.tool_calls:
            return self._complete(user_input, detected.text, "conversation", 1.0)

        plan = self.tool_router.plan(detected.tool_calls[0])
        step = plan.steps[0]
        log_event(logger, logging.INFO, "orchestration.intent_detected", "Structured ChatGPT intent detected", intent=step.name, confidence=step.confidence, module_selection="tool_router", strategy=plan.strategy)
        clarification = self.tool_router.clarification(step)
        if clarification:
            return self._complete(user_input, clarification, "clarification", step.confidence)

        routed = self.skills.execute(SkillContext(
            user_input=user_input,
            intent=step.name,
            arguments=step.arguments,
            conversation=self.conversation,
        ))
        response = routed.response
        if not routed.success:
            log_event(logger, logging.WARNING, "orchestration.execution_failed", "Orchestrated skill returned failure", intent=step.name, success=False)
        return self._complete(user_input, response, step.name, step.confidence)

    @staticmethod
    def _looks_like_normal_conversation(user_input: str) -> bool:
        """Detect obvious non-contact conversation while a contact choice is pending."""
        value = " ".join(user_input.casefold().strip().split())

        if not value:
            return False

        conversational_starts = (
            "hello",
            "hi ",
            "hi,",
            "hey",
            "how are you",
            "how're you",
            "what ",
            "why ",
            "when ",
            "where ",
            "who ",
            "can you ",
            "could you ",
            "tell me ",
            "thank you",
            "thanks",
            "assalam",
            "salam",
            "kaise ho",
            "kya haal",
            "aap kaise",
            "tum kaise",
        )

        if value in {"hi", "hello", "hey", "thanks", "thank you"}:
            return True

        if value.startswith(conversational_starts):
            return True

        # A full question is much more likely to be a new conversational turn
        # than a contact-selection answer such as "first" or "Basit Ahmed".
        if user_input.strip().endswith("?") and len(value.split()) >= 3:
            return True

        return False

    def _handle_context(self, user_input: str, context: ConversationContext) -> str | None:
        if context.pending_contact_selection:
            # If the user clearly starts a new normal conversation, abandon only
            # the old ambiguous-contact choice and continue through normal routing.
            if self._looks_like_normal_conversation(user_input):
                self.messaging.clear_pending_contact_selection()
                return None

            selection = self.messaging.choose_pending_contact(user_input)
            if selection["status"] == "RESOLVED":
                contact = selection["contact"]
                self.messaging.begin_message(contact)
                return f"{contact.display_name} ko kya message karun?"
            return selection.get("message")

        if context.awaiting_confirmation:
            decision = self.messaging.confirmation_intent(user_input)
            if decision == "cancel":
                self.messaging.clear_message()
                log_event(logger, logging.INFO, "whatsapp.cancelled", "Pending WhatsApp draft cancelled", success=True)
                return "Theek hai, WhatsApp message cancel kar diya."
            if decision != "confirm":
                return "Draft ready hai. Send karun? Please say 'send karo' or 'cancel'."
            contact = self.messaging.context.active_contact
            message_text = (self.messaging.context.pending_message or "").strip()
            response = self._send_message(contact, message_text)
            self.messaging.clear_message()
            return response

        if context.awaiting_message_text:
            result = self.messaging.set_message_text(user_input)
            if result["status"] != "MESSAGE_READY":
                return result.get("message")
            return self._prepare_draft(result["contact"], result["message_text"])
        return None

    def _start_whatsapp(self, arguments: dict[str, Any]) -> str:
        recipient = str(arguments.get("recipient", "")).strip()
        if not recipient:
            return "Who should I message?"
        resolved = self.messaging.resolve_recipient(recipient)
        if resolved["status"] != "RESOLVED":
            return resolved["message"]
        contact = resolved["contact"]
        message = str(arguments.get("message") or "").strip()
        self.messaging.begin_message(contact)
        if not message:
            return f"{contact.display_name} ko kya message karun?"
        prepared = self.messaging.set_message_text(message)
        return self._prepare_draft(contact, prepared["message_text"])

    def _prepare_draft(self, contact, message_text: str) -> str:
        prepared = self.whatsapp.prepare_message(contact=contact, message_text=message_text)
        if not prepared.success:
            self.messaging.clear_message()
            log_event(logger, logging.WARNING, "whatsapp.draft_failed", "WhatsApp draft preparation failed", success=False, status=getattr(prepared, "status", "unknown"))
            return prepared.message
        self.messaging.mark_draft_prepared(message_text)
        log_event(logger, logging.INFO, "whatsapp.draft_ready", "WhatsApp draft prepared and awaiting confirmation", success=True, contact=contact.display_name)
        return f"Draft ready hai for {contact.display_name}: “{message_text}” — send karun?"

    def _send_message(self, contact, message_text: str) -> str:
        if contact is None or not message_text:
            return "Pending WhatsApp draft restore nahi ho saka. Please start again."
        # Re-verify the exact recipient and draft, including after a process restart.
        prepared = self.whatsapp.prepare_message(contact=contact, message_text=message_text)
        if not prepared.success:
            return prepared.message
        sent = self.whatsapp.send_prepared_message()
        log_event(logger, logging.INFO if sent.success else logging.WARNING, "whatsapp.send_completed", "Confirmed WhatsApp send completed", success=sent.success, status=getattr(sent, "status", "unknown"), contact=contact.display_name)
        return sent.message

    def _complete(self, user_input: str, response: str | None, intent: str, confidence: float) -> str:
        final = (response or "").strip()
        self.conversation.save_turn(user_input, final)
        log_event(logger, logging.INFO, "orchestration.completed", "Central request orchestration completed", intent=intent, confidence=confidence, success=True, response_length=len(final))
        return final