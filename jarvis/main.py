from __future__ import annotations

import argparse
import logging
import re
import sys
from typing import Optional

from observability import get_logger, get_request_id, log_event, request_context
from app.core.jarvis_core import JarvisCore as TikTokJarvisCore
from app.memory import DATABASE as TIKTOK_DATABASE

# Force UTF-8 for Urdu / multilingual terminal output on Windows
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")


if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


if hasattr(sys.stdin, "reconfigure"):
    sys.stdin.reconfigure(encoding="utf-8")

from .conversation import conversation
from .memory import memory
from .speech import speech
from .tools import tools
from .messaging_context import messaging
from .whatsapp_adapter import whatsapp
from .orchestrator import JarvisOrchestrator
from . import config
from .plugins import PluginManager
from .plugins.diagnostics import DiagnosticsPlugin
from .deployment.crash_reporting import install_crash_handler
from .deployment.diagnostics import startup_diagnostics
from .deployment import BackupManager, UpdateManager
from . import __version__


logger = get_logger("desktop.request")


class Jarvis:
    """
    First runnable Jarvis Core.

    Current capabilities:
    - Natural conversation through Ollama
    - English / Urdu / Roman Urdu input
    - Recent conversation memory
    - Open registered Windows applications
    - Open current project in VS Code
    - List project files
    - Text mode
    - Voice mode

    IMPORTANT:
    Professional WhatsApp contact/message sending will be connected
    as a dedicated messaging agent in the next phase.
    """

    def __init__(self) -> None:
        self.running = True
        self._tiktok_core: Optional[TikTokJarvisCore] = None

        # Speech is warmed by the dashboard in a background thread.
        # Avoid blocking Jarvis startup on Whisper model loading.
        install_crash_handler(config.LOGS_DIR)
        self.config_report = config.validate_configuration()
        self.startup_report = startup_diagnostics(
            user_root=config.USER_DATA_ROOT,
            database=config.DATA_DIR / "jarvis_memory.db",
            config_report=self.config_report,
        )
        log_event(logger, logging.INFO, "startup.diagnostics", "Startup diagnostics completed", **self.startup_report)
        self.notifications: list[str] = []
        self.backups = BackupManager(
            config.DATA_DIR / "jarvis_memory.db",
            config.USER_DATA_ROOT / ".env",
            config.USER_DATA_ROOT / "prompts",
            config.BACKUPS_DIR,
        )
        if config.JARVIS_AUTO_BACKUP:
            try:
                self.backups.create_automatic_backup_if_due()
            except Exception:
                logger.exception("Automatic startup backup failed gracefully", extra={"event": "backup.automatic_failed"})
        self.updates = UpdateManager(
            __version__,
            config.UPDATES_DIR,
            notifier=self.notifications.append,
        )
        for issue in self.config_report.issues:
            log_event(
                logger,
                logging.ERROR if issue.severity == "error" else logging.WARNING,
                "configuration.issue",
                issue.message,
                config_key=issue.key,
                severity=issue.severity,
                success=False,
            )
        self.plugins = PluginManager(
            enabled=config.JARVIS_ENABLED_PLUGINS,
            disabled=config.JARVIS_DISABLED_PLUGINS,
            context={"config_report": self.config_report},
        )
        self.plugins.register(DiagnosticsPlugin())
        self.plugins.start_all()
        self.orchestrator = JarvisOrchestrator(
            conversation=conversation,
            tools=tools,
            messaging=messaging,
            whatsapp=whatsapp,
            memory=memory,
            direct_router=self.route_direct_command,
        )

    def shutdown(self) -> None:
        self.plugins.shutdown_all()
        self.running = False

    # ============================================================
    # Normalization
    # ============================================================

    @staticmethod
    def normalize(text: str) -> str:
        text = text.strip()
        text = re.sub(r"\s+", " ", text)
        return text

    @staticmethod
    def lower(text: str) -> str:
        return text.casefold().strip()

    def _get_tiktok_core(self) -> TikTokJarvisCore:
        """Create the TikTok supervisor only when a TikTok command is used."""
        if self._tiktok_core is None:
            self._tiktok_core = TikTokJarvisCore(TIKTOK_DATABASE)
            self._tiktok_core.initialize()

        return self._tiktok_core

    # ============================================================
    # Exit commands
    # ============================================================

    def is_exit_command(self, text: str) -> bool:
        normalized = self.lower(text)

        exit_phrases = {
            "exit",
            "quit",
            "stop jarvis",
            "close jarvis",
            "jarvis stop",
            "jarvis band karo",
            "jarvis band kar do",
            "band ho jao",
            "Ø¨Ù†Ø¯ ÛÙˆ Ø¬Ø§Ø¤",
            "Ø¬Ø§Ø±ÙˆØ³ Ø¨Ù†Ø¯ Ú©Ø±Ùˆ",
        }

        return normalized in exit_phrases

    # ============================================================
    # Application detection
    # ============================================================

    def detect_application(self, text: str) -> Optional[str]:
        value = self.lower(text)

        aliases = {
            "whatsapp": [
                "whatsapp",
                "what's app",
                "ÙˆØ§Ù¹Ø³ Ø§ÛŒÙ¾",
                "ÙˆØ§Ù¹Ø³Ø§Ù¾",
                "ÙˆØ§Ù¹Ø³ Ø§Ù¾",
            ],

            "chrome": [
                "chrome",
                "google chrome",
                "Ú©Ø±ÙˆÙ…",
            ],

            "vscode": [
                "vs code",
                "vscode",
                "visual studio code",
                "ÙˆÛŒ Ø§ÛŒØ³ Ú©ÙˆÚˆ",
            ],

            "notepad": [
                "notepad",
                "note pad",
                "Ù†ÙˆÙ¹ Ù¾ÛŒÚˆ",
            ],

            "calculator": [
                "calculator",
                "calc",
                "Ú©ÛŒÙ„Ú©ÙˆÙ„ÛŒÙ¹Ø±",
            ],

            "edge": [
                "microsoft edge",
                "edge",
                "Ø§ÛŒØ¬",
            ],

            "explorer": [
                "file explorer",
                "explorer",
                "ÙØ§Ø¦Ù„ Ø§ÛŒÚ©Ø³Ù¾Ù„ÙˆØ±Ø±",
            ],
        }

        for canonical, names in aliases.items():
            for alias in names:
                if alias.casefold() in value:
                    return canonical

        return None

    # ============================================================
    # Intent helpers
    # ============================================================

    def looks_like_open_command(self, text: str) -> bool:
        value = self.lower(text)

        words = [
            "open",
            "kholo",
            "khol do",
            "open karo",
            "open kar do",
            "chalao",
            "chala do",
            "Ú©Ú¾ÙˆÙ„Ùˆ",
            "Ú©Ú¾ÙˆÙ„ Ø¯Ùˆ",
            "Ø§ÙˆÙ¾Ù† Ú©Ø±Ùˆ",
            "Ø§ÙˆÙ¾Ù† Ú©Ø± Ø¯Ùˆ",
            "Ú†Ù„Ø§ Ø¯Ùˆ",
        ]

        return any(word in value for word in words)

    def looks_like_message_command(self, text: str) -> bool:
        value = self.lower(text)

        words = [
            "message",
            "msg",
            "whatsapp karo",
            "message karo",
            "message send",
            "ko bolo",
            "ko batao",
            "ko keh do",
            "Ù…ÛŒØ³Ø¬",
            "Ù¾ÛŒØºØ§Ù…",
            "Ú©Ùˆ Ø¨ØªØ§Ø¤",
            "Ú©Ùˆ Ú©ÛÙˆ",
            "Ú©Ùˆ Ú©ÛÛ Ø¯Ùˆ",
        ]

        return any(word in value for word in words)

    # ============================================================
    # Direct command router
    # ============================================================

    def extract_message_recipient(self, text: str) -> Optional[str]:
        value = self.normalize(text)

        patterns = [
            # Mixed Urdu / Roman Urdu.
            r"^(.+?)\s+(?:ko|Ú©Ùˆ)\s+(?:whatsapp\s+)?(?:message|msg|Ù…ÛŒØ³Ø¬|Ù¾ÛŒØºØ§Ù…)\s+(?:send\s+)?(?:karo|kar do|bhejo|bhej do|Ú©Ø±Ùˆ|Ø¨Ú¾ÛŒØ¬Ùˆ|Ø¨Ú¾ÛŒØ¬ Ø¯Ùˆ)",

            # Roman Urdu:
            # "Basit ko message karo"
            r"^(.+?)\s+ko\s+(?:whatsapp\s+)?(?:message|msg)\s+(?:send\s+)?(?:karo|kar do|bhejo|bhej do)",

            # "Sulaiman ko bolo..."
            r"^(.+?)\s+ko\s+(?:bolo|batao|keh do)",

            # English:
            # "message Basit"
            r"^(?:whatsapp\s+)?(?:message|msg)\s+(?:to\s+)?(.+?)(?:\s+(?:and|saying|that)\s+|$)",

            # Urdu:
            r"^(.+?)\s+Ú©Ùˆ\s+(?:Ù…ÛŒØ³Ø¬|Ù¾ÛŒØºØ§Ù…)\s+(?:Ú©Ø±Ùˆ|Ø¨Ú¾ÛŒØ¬Ùˆ|Ø¨Ú¾ÛŒØ¬ Ø¯Ùˆ)",        ]

        for pattern in patterns:
            match = re.search(
                pattern,
                value,
                flags=re.IGNORECASE,
            )

            if match:
                recipient = match.group(1).strip()

                # Remove optional wake word.
                recipient = re.sub(
                    r"^(jarvis|Ø¬Ø§Ø±ÙˆØ³|Ø¬Ø§Ø±ÙˆÛŒØ³)[,ØŒ\s]+",
                    "",
                    recipient,
                    flags=re.IGNORECASE,
                ).strip()

                return recipient

        return None

    def route_direct_command(self, text: str) -> Optional[str]:
        """
        Fast deterministic path for obvious commands.

        Returns:
            response text if handled
            None if Jarvis should use conversation AI
        """

        value = self.lower(text)

        # --------------------------------------------------------
        # TikTok video creation
        # --------------------------------------------------------

        tiktok_topic = TikTokJarvisCore.extract_tiktok_topic(text)

        # Whisper can occasionally omit the word "TikTok". In this project,
        # a direct "create/make/generate a video about X" command means the
        # TikTok production pipeline.
        if not tiktok_topic:
            video_match = re.match(
                r"(?i)^\s*(?:jarvis[\s,:-]*)?(?:please\s+)?"
                r"(?:create|make|generate|produce|build)\s+(?:a\s+)?"
                r"video\s+(?:about|on)\s+(.+?)\s*$",
                text,
            )
            if video_match:
                tiktok_topic = video_match.group(1).strip().strip("\"'").strip()

        if tiktok_topic:
            log_event(
                logger,
                logging.INFO,
                "intent.selected",
                "TikTok creation command selected",
                intent="create_tiktok",
                module_selection="app.core.jarvis_core",
                topic=tiktok_topic,
            )

            core = self._get_tiktok_core()

            core.create_tiktok_video(
                topic=tiktok_topic,
                raw_demo_mode=False,
            )

            return (
                f"TikTok video package for {tiktok_topic} is ready. "
                "Publishing was not automatic; review is required before posting."
            )

        # --------------------------------------------------------
        # Send currently prepared WhatsApp message
        # --------------------------------------------------------

        send_phrases = {
            "send karo",
            "send kar do",
            "bhejo",
            "bhej do",
            "message send karo",
            "Ø³ÛŒÙ†Úˆ Ú©Ø±Ùˆ",
            "Ø¨Ú¾ÛŒØ¬Ùˆ",
            "Ø¨Ú¾ÛŒØ¬ Ø¯Ùˆ",
        }

        if value in send_phrases:

            result = whatsapp.send_prepared_message()

            return result.message

        # --------------------------------------------------------
        # System status
        # --------------------------------------------------------

        if value in {
            "status",
            "jarvis status",
            "system status",
            "jarvis ka status batao",
            "Ø¬Ø§Ø±ÙˆØ³ Ú©Ø§ Ø§Ø³Ù¹ÛŒÙ¹Ø³ Ø¨ØªØ§Ø¤",
        }:
            status = speech.status()

            return (
                f"Jarvis online hai. "
                f"Microphone: {status['microphone']}, "
                f"speech recognition: {status['speech_to_text']}, "
                f"TTS: {status['text_to_speech']}."
            )

        # --------------------------------------------------------
        # Show available tools
        # --------------------------------------------------------

        if value in {
            "tools",
            "list tools",
            "show tools",
            "tools dikhao",
            "Ù¹ÙˆÙ„Ø² Ø¯Ú©Ú¾Ø§Ø¤",
        }:
            names = ", ".join(tools.names())
            return f"Available tools: {names}"

        # --------------------------------------------------------
        # Project files
        # --------------------------------------------------------

        file_phrases = [
            "list project files",
            "show project files",
            "project files dikhao",
            "project ki files dikhao",
            "Ù¾Ø±ÙˆØ¬ÛŒÚ©Ù¹ Ú©ÛŒ ÙØ§Ø¦Ù„ÛŒÚº Ø¯Ú©Ú¾Ø§Ø¤",
        ]

        if any(phrase in value for phrase in file_phrases):
            result = tools.execute(
                "list_project_files"
            )

            if not result.success:
                return result.message

            items = result.data.get("items", []) if result.data else []

            names = [
                item["name"]
                for item in items[:15]
            ]

            return (
                "Project mein yeh items hain: "
                + ", ".join(names)
            )

        # --------------------------------------------------------
        # Open current project in VS Code
        # --------------------------------------------------------

        project_phrases = [
            "open my project",
            "open project",
            "project vscode mein kholo",
            "project vs code mein kholo",
            "mera project kholo",
            "Ù…ÛŒØ±Ø§ Ù¾Ø±ÙˆØ¬ÛŒÚ©Ù¹ Ú©Ú¾ÙˆÙ„Ùˆ",
        ]

        if any(phrase in value for phrase in project_phrases):
            result = tools.execute(
                "open_project_in_vscode"
            )

            return result.message

        # --------------------------------------------------------
        # WhatsApp messaging â€” protected for next phase
        # --------------------------------------------------------

        if self.looks_like_message_command(text):

            recipient_query = self.extract_message_recipient(text)

            if recipient_query:

                result = messaging.resolve_recipient(
                    recipient_query
                )

                if result["status"] == "AMBIGUOUS":
                    return result["message"]

                if result["status"] == "NOT_FOUND":
                    return result["message"]

                if result["status"] == "RESOLVED":

                    contact = result["contact"]

                    messaging.begin_message(contact)

                    return f"{contact.display_name} Ú©Ùˆ Ú©ÛŒØ§ Ù…ÛŒØ³Ø¬ Ú©Ø±ÙˆÚºØŸ"

            if (
                "whatsapp" in value
                or "ÙˆØ§Ù¹Ø³ Ø§ÛŒÙ¾" in value
                or "Ù…ÛŒØ³Ø¬" in value
                or "message" in value
            ):
                return (
                    "WhatsApp samajh gaya. "
                    "Professional contact aur message sending layer "
                    "abhi next phase mein connect hogi. "
                    "Main abhi bina verified contact ke message send nahi karunga."
                )

        # --------------------------------------------------------
        # Open registered application
        # --------------------------------------------------------

        if self.looks_like_open_command(text):
            application = self.detect_application(text)

            if application:
                result = tools.execute(
                    "open_application",
                    application=application,
                )

                if result.success:
                    friendly_names = {
                        "whatsapp": "WhatsApp",
                        "chrome": "Chrome",
                        "vscode": "VS Code",
                        "notepad": "Notepad",
                        "calculator": "Calculator",
                        "edge": "Microsoft Edge",
                        "explorer": "File Explorer",
                    }

                    name = friendly_names.get(
                        application,
                        application,
                    )

                    return f"{name} open kar diya hai."

                return result.message

        return None

    # ============================================================
    # Main processing
    # ============================================================

    def process(self, user_text: str) -> str:
        """Process one correlated request without leaking exceptions to the UI."""

        inherited_id = get_request_id()
        with request_context(None if inherited_id == "system" else inherited_id) as request_id:
            log_event(
                logger,
                logging.INFO,
                "request.received",
                "Jarvis request received",
                user_input=user_text,
                interface="desktop",
            )
            try:
                response = self._process_request(user_text)
            except Exception:
                logger.exception(
                    "Unhandled Jarvis request failure",
                    extra={
                        "event": "request.failed",
                        "module_selection": "unknown",
                    },
                )
                return (
                    "Jarvis request process nahi kar saka. "
                    f"Reference: {request_id[:8]}"
                )

            log_event(
                logger,
                logging.INFO,
                "request.completed",
                "Jarvis request completed",
                success=True,
                response_length=len(response or ""),
            )
            return response

    def _process_request(self, user_text: str) -> str:
        user_text = self.normalize(user_text)

        if not user_text:
            return ""

        if self.is_exit_command(user_text):
            log_event(logger, logging.INFO, "intent.selected", "Exit intent selected", intent="exit", module_selection="jarvis.main")
            self.running = False
            return "Theek hai. Jarvis band ho raha hai."

        return self.orchestrator.handle(user_text)

        # A contact clarification is currently pending.
        if messaging.context.pending_contacts:
            log_event(logger, logging.INFO, "intent.selected", "Pending contact selection", intent="contact_clarification", module_selection="messaging_context")

            selection = messaging.choose_pending_contact(
                user_text
            )

            if selection["status"] == "RESOLVED":

                contact = selection["contact"]

                messaging.begin_message(contact)

                response = (
                    f"{contact.display_name} Ú©Ùˆ Ú©ÛŒØ§ Ù…ÛŒØ³Ø¬ Ú©Ø±ÙˆÚºØŸ"
                )

                memory.add_message(
                    role="user",
                    content=user_text,
                )

                memory.add_message(
                    role="assistant",
                    content=response,
                )

                return response

            if selection["status"] == "UNRESOLVED":
                return selection["message"]

        # Waiting for the actual WhatsApp message text.
        if messaging.context.awaiting_message_text:
            log_event(logger, logging.INFO, "intent.selected", "Pending message text", intent="message_text", module_selection="messaging_context")

            result = messaging.set_message_text(
                user_text
            )

            if result["status"] == "MESSAGE_READY":

                contact = result["contact"]
                message_text = result["message_text"]

                whatsapp_result = whatsapp.prepare_message(
                    contact=contact,
                    message_text=message_text,
                )

                if whatsapp_result.success:
                    send_result = whatsapp.send_prepared_message()
                    response = send_result.message
                    log_event(
                        logger,
                        logging.INFO if send_result.success else logging.WARNING,
                        "execution.completed",
                        "WhatsApp send execution completed",
                        intent="whatsapp_message",
                        module_selection="whatsapp_adapter",
                        success=send_result.success,
                        status=send_result.status,
                        contact=contact.display_name,
                    )
                else:
                    response = whatsapp_result.message
                    log_event(
                        logger,
                        logging.WARNING,
                        "execution.failed",
                        "WhatsApp preparation failed",
                        intent="whatsapp_message",
                        module_selection="whatsapp_adapter",
                        success=False,
                        status=whatsapp_result.status,
                        contact=contact.display_name,
                    )

                messaging.clear_message()

                memory.add_message(
                    role="user",
                    content=user_text,
                )

                memory.add_message(
                    role="assistant",
                    content=response,
                )

                return response

        # First try deterministic tools.
        direct_response = self.route_direct_command(user_text)

        if direct_response is not None:
            log_event(logger, logging.INFO, "intent.selected", "Deterministic command handled", intent="direct_command", module_selection="jarvis.main", success=True)
            memory.add_message(
                role="user",
                content=user_text,
            )

            memory.add_message(
                role="assistant",
                content=direct_response,
            )

            return direct_response

        # Otherwise use conversational intelligence.
        log_event(logger, logging.INFO, "intent.selected", "ChatGPT conversation engine selected", intent="conversation", module_selection="openai")
        try:
            llm_result = conversation.respond(user_text)
        except Exception as error:
            logger.exception("ChatGPT conversation recovered from failure", extra={"event": "conversation.failed", "module_selection": "openai"})
            return conversation.failure_message(error)

        if llm_result.tool_calls:
            # The model selects only from schemas; Python remains the executor.
            tool_call = llm_result.tool_calls[0]
            log_event(logger, logging.INFO, "intent.selected", "ChatGPT structured tool intent selected", intent=tool_call.name, module_selection="jarvis.tools")
            tool_result = tools.execute(tool_call.name, **tool_call.arguments)
            response = tool_result.message
            conversation.save_turn(user_text, response)
            return response

        conversation.save_turn(user_text, llm_result.text)
        return llm_result.text

    # ============================================================
    # Text mode
    # ============================================================

    def run_text_mode(self) -> None:
        print()
        print("=" * 60)
        print("JARVIS AI")
        print("Text Mode")
        print("=" * 60)
        print()
        print("Type your message.")
        print("Type 'exit' to stop.")
        print()

        while self.running:
            try:
                user_text = input("You: ").strip()

                if not user_text:
                    continue

                response = self.process(user_text)

                if response:
                    print(f"Jarvis: {response}")
                    print()

            except KeyboardInterrupt:
                print()
                print("Jarvis: Stopping.")
                break

            except EOFError:
                break

            except Exception as exc:
                logger.exception("Text mode recovered from request error", extra={"event": "text_mode.recovered"})
                print(
                    f"[Jarvis Error] {exc}"
                )

    # ============================================================
    # Voice mode
    # ============================================================

    def run_voice_mode(self) -> None:
        print()
        print("=" * 60)
        print("JARVIS AI")
        print("Voice Mode")
        print("=" * 60)
        print()
        print("Press ENTER to speak, or type a command directly.")
        print("Type q + ENTER to quit.")
        print()

        while self.running:
            try:
                command = input(
                    "[ENTER = talk | type command | q = quit] "
                ).strip()

                if command.casefold() == "q":
                    break

                # If the user typed a command, process that exact text.
                # The previous version discarded typed text and always opened
                # the microphone, which is why typed TikTok commands failed.
                if command:
                    response = self.process(command)

                    if response:
                        print(
                            f"Jarvis: {response}"
                        )
                        speech.speak(response)

                    continue

                print("Listening...")

                result = speech.listen()

                transcript = (
                    result.get("text", "")
                    .strip()
                )

                language = result.get(
                    "language",
                    "unknown",
                )

                if not transcript:
                    print(
                        "Jarvis: Mujhe awaaz samajh nahi aayi."
                    )
                    continue

                print(
                    f"You [{language}]: {transcript}"
                )

                response = self.process(
                    transcript
                )

                print(
                    f"Jarvis: {response}"
                )

                speech.speak(response)

            except KeyboardInterrupt:
                print()
                break

            except Exception as exc:
                logger.exception(
                    "Voice mode recovered from request error",
                    extra={"event": "voice_mode.recovered"},
                )
                print(
                    f"[Voice Error] {exc}"
                )

                print(
                    "Jarvis: Voice system mein problem aayi hai."
                )


# ================================================================
# CLI
# ================================================================

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Jarvis local AI assistant"
    )

    parser.add_argument(
        "--voice",
        action="store_true",
        help="Start Jarvis in microphone voice mode",
    )

    parser.add_argument(
        "--status",
        action="store_true",
        help="Show Jarvis speech status",
    )

    args = parser.parse_args()

    jarvis = Jarvis()

    try:
        if args.status:
            print(speech.status())
            return
        if args.voice:
            jarvis.run_voice_mode()
        else:
            jarvis.run_text_mode()
    finally:
        jarvis.shutdown()


if __name__ == "__main__":
    main()