from __future__ import annotations

import ctypes
import logging
import re
import time
import urllib.parse
import webbrowser
from dataclasses import dataclass
from typing import Optional

import pyperclip
import psutil
import win32api
import win32con
import win32gui
import win32process

from pywinauto import Desktop
from pywinauto.keyboard import send_keys

from .contact_resolver import Contact
from .memory import memory
from observability import get_logger, log_event


logger = get_logger("whatsapp")


@dataclass
class WhatsAppResult:
    success: bool
    status: str
    message: str
    contact: Optional[str] = None


class WhatsAppAdapter:
    """
    Safe WhatsApp integration.

    Stage 1:
    - Validate contact
    - Validate phone number
    - Build official wa.me link
    - Open exact conversation
    - Prefill message

    Automatic pressing of SEND will be added only after
    exact-chat verification passes.
    """

    def __init__(self) -> None:
        self.prepared_contact: Optional[Contact] = None
        self.prepared_message: Optional[str] = None

    def _force_foreground(self, hwnd: int) -> bool:
        try:
            # Restore WhatsApp if minimized.
            win32gui.ShowWindow(
                hwnd,
                win32con.SW_RESTORE,
            )

            # A short ALT key event allows Windows to grant
            # foreground activation to this process.
            win32api.keybd_event(
                win32con.VK_MENU,
                0,
                0,
                0,
            )

            win32api.keybd_event(
                win32con.VK_MENU,
                0,
                win32con.KEYEVENTF_KEYUP,
                0,
            )

            time.sleep(0.05)

            win32gui.SetForegroundWindow(hwnd)

            time.sleep(0.3)

            return (
                win32gui.GetForegroundWindow()
                == hwnd
            )

        except Exception:
            logger.debug("WhatsApp foreground activation failed", exc_info=True, extra={"event": "whatsapp.focus_failed"})
            return False

    # =========================================================
    # Phone normalization
    # =========================================================

    @staticmethod
    def normalize_phone(phone: str) -> str:
        """
        wa.me expects an international number containing digits only.

        Example:
            +92 300 1234567
        becomes:
            923001234567
        """

        value = str(phone or "").strip()

        digits = re.sub(
            r"\D",
            "",
            value,
        )

        return digits

    # =========================================================
    # Validation
    # =========================================================

    def validate_contact(
        self,
        contact: Contact,
    ) -> WhatsAppResult:

        if not contact:
            return WhatsAppResult(
                success=False,
                status="NO_CONTACT",
                message="Contact available nahi hai.",
            )

        phone = self.normalize_phone(
            contact.phone
        )

        if not phone:
            return WhatsAppResult(
                success=False,
                status="NO_PHONE",
                contact=contact.display_name,
                message=(
                    f"{contact.display_name} ka phone number "
                    "contacts file mein available nahi hai."
                ),
            )

        # Basic sanity check only.
        if len(phone) < 8 or len(phone) > 15:
            return WhatsAppResult(
                success=False,
                status="INVALID_PHONE",
                contact=contact.display_name,
                message=(
                    f"{contact.display_name} ka phone number "
                    "valid format mein nahi lag raha."
                ),
            )

        return WhatsAppResult(
            success=True,
            status="VALID",
            contact=contact.display_name,
            message="Contact valid hai.",
        )

    # =========================================================
    # Build official WhatsApp link
    # =========================================================

    def build_message_url(
        self,
        contact: Contact,
        message_text: str,
    ) -> str:

        phone = self.normalize_phone(
            contact.phone
        )

        message_text = (
            message_text or ""
        ).strip()

        encoded_message = urllib.parse.quote(
            message_text,
            safe="",
        )

        return (
            f"https://wa.me/{phone}"
            f"?text={encoded_message}"
        )

    # =========================================================
    # Open exact chat with prefilled message
    # =========================================================

    def prepare_message(
        self,
        contact: Contact,
        message_text: str,
    ) -> WhatsAppResult:

        log_event(logger, logging.INFO, "execution.started", "WhatsApp message preparation started", module_selection="whatsapp_adapter", contact=contact.display_name)

        validation = self.validate_contact(
            contact
        )

        if not validation.success:
            return validation

        message_text = (
            message_text or ""
        ).strip()

        if not message_text:
            return WhatsAppResult(
                success=False,
                status="EMPTY_MESSAGE",
                contact=contact.display_name,
                message="Message khaali hai.",
            )

        try:
            url = self.build_message_url(
                contact,
                message_text,
            )

            opened = webbrowser.open(
                url,
                new=0,
            )

            if not opened:
                memory.record_action(
                    action="whatsapp_prepare_message",
                    target=contact.display_name,
                    status="failed",
                )

                return WhatsAppResult(
                    success=False,
                    status="OPEN_FAILED",
                    contact=contact.display_name,
                    message=(
                        "WhatsApp conversation open "
                        "confirm nahi hui."
                    ),
                )
            # ---------------------------------------------------------
            # Force composer to contain ONLY the exact prepared message
            # ---------------------------------------------------------

            time.sleep(1.0)

            whatsapp_hwnds = []

            def _collect_whatsapp(hwnd, _):
                try:
                    if not win32gui.IsWindowVisible(hwnd):
                        return

                    _, pid = win32process.GetWindowThreadProcessId(hwnd)

                    if (
                        psutil.Process(pid)
                        .name()
                        .casefold()
                        == "whatsapp.root.exe"
                    ):
                        whatsapp_hwnds.append(hwnd)

                except Exception:
                    logger.debug("Window candidate could not be inspected during preparation", exc_info=True, extra={"event": "whatsapp.window_candidate_skipped"})

            win32gui.EnumWindows(
                _collect_whatsapp,
                None,
            )

            if not whatsapp_hwnds:
                return WhatsAppResult(
                    success=False,
                    status="WHATSAPP_NOT_FOUND",
                    contact=contact.display_name,
                    message="WhatsApp window nahi mili.",
                )

            window = Desktop(
                backend="uia"
            ).window(handle=whatsapp_hwnds[0])

            window_rect = window.rectangle()

            # Find the real composer and collapse duplicate UIA
            # representations by physical rectangle.
            composers_by_rect = {}

            expected_name = (
                f"type a message to {contact.display_name}"
                .casefold()
            )

            for edit in window.descendants(
                control_type="Edit"
            ):
                try:
                    if not edit.is_visible():
                        continue

                    rect = edit.rectangle()

                    if rect.width() <= 0 or rect.height() <= 0:
                        continue

                    # Composer is in the lower portion of WhatsApp.
                    if rect.top < (
                        window_rect.top
                        + int(window_rect.height() * 0.60)
                    ):
                        continue

                    name = (
                        edit.element_info.name
                        or ""
                    ).strip().casefold()

                    # Exact recipient verification.
                    if name != expected_name:
                        continue

                    key = (
                        rect.left,
                        rect.top,
                        rect.right,
                        rect.bottom,
                    )

                    composers_by_rect.setdefault(
                        key,
                        edit,
                    )

                except Exception:
                    logger.debug("Composer candidate could not be inspected during preparation", exc_info=True, extra={"event": "whatsapp.composer_candidate_skipped"})
                    continue

            if len(composers_by_rect) != 1:
                return WhatsAppResult(
                    success=False,
                    status="COMPOSER_NOT_UNIQUE",
                    contact=contact.display_name,
                    message=(
                        "Exact WhatsApp composer uniquely verify "
                        "nahi hua. Draft change nahi kiya."
                    ),
                )

            composer = next(
                iter(composers_by_rect.values())
            )

            old_clipboard = None

            try:
                try:
                    old_clipboard = pyperclip.paste()
                except Exception:
                    logger.debug("Clipboard snapshot was unavailable", exc_info=True, extra={"event": "whatsapp.clipboard_snapshot_failed"})

                hwnd = whatsapp_hwnds[0]

                if not self._force_foreground(hwnd):
                    raise RuntimeError(
                        "WhatsApp foreground activation failed"
                    )

                # Focus the recipient-verified composer semantically.
                composer.click_input()
                time.sleep(0.15)

                if win32gui.GetForegroundWindow() != hwnd:
                    raise RuntimeError(
                        "WhatsApp composer lost foreground focus"
                    )

                # Replace stale/concatenated draft exactly.
                pyperclip.copy(message_text)
                send_keys("^a", pause=0.05)
                send_keys("^v", pause=0.05)

                time.sleep(0.4)

                verified_text = (
                    composer.get_value()
                    or ""
                ).strip()

            except Exception as exc:
                return WhatsAppResult(
                    success=False,
                    status="DRAFT_SET_FAILED",
                    contact=contact.display_name,
                    message=f"WhatsApp draft set nahi hua: {exc}",
                )

            finally:
                if old_clipboard is not None:
                    try:
                        pyperclip.copy(old_clipboard)
                    except Exception:
                        logger.debug("Clipboard restore failed", exc_info=True, extra={"event": "whatsapp.clipboard_restore_failed"})

            if verified_text != message_text:
                return WhatsAppResult(
                    success=False,
                    status="DRAFT_VERIFY_FAILED",
                    contact=contact.display_name,
                    message=(
                        "WhatsApp draft exact message se match "
                        "nahi hua. Message prepare nahi kiya."
                    ),
                )

            self.prepared_contact = contact
            self.prepared_message = message_text

            memory.record_action(
                action="whatsapp_prepare_message",
                target=contact.display_name,
                status="success",
            )

            return WhatsAppResult(
                success=True,
                status="MESSAGE_PREPARED",
                contact=contact.display_name,
                message=(
                    f"{contact.display_name} ki WhatsApp chat "
                    "message ke saath open kar di hai."
                ),
            )

        except Exception as exc:

            memory.record_action(
                action="whatsapp_prepare_message",
                target=contact.display_name,
                status="failed",
            )

            return WhatsAppResult(
                success=False,
                status="ERROR",
                contact=contact.display_name,
                message=(
                    "WhatsApp open karte waqt error aaya: "
                    f"{exc}"
                ),
            )

    def send_prepared_message(self) -> WhatsAppResult:
        """
        Send one explicitly prepared WhatsApp message.

        Safety checks:
        - Prepared recipient/message must exist.
        - Exact recipient must match the WhatsApp composer.
        - Exact draft text must match.
        - Duplicate UIA Send representations are deduplicated
          by their physical rectangle.
        - Send is invoked exactly once.
        - Success is reported only if composer clears afterward.
        """

        contact = self.prepared_contact
        expected_message = (self.prepared_message or "").strip()
        log_event(logger, logging.INFO, "execution.started", "WhatsApp send verification started", module_selection="whatsapp_adapter", contact=contact.display_name if contact else None)

        if contact is None or not expected_message:
            return WhatsAppResult(
                success=False,
                status="NO_PREPARED_MESSAGE",
                message="Koi WhatsApp message send ke liye ready nahi hai.",
            )

        # ---------------------------------------------------------
        # Find the real WhatsApp Desktop window by process
        # ---------------------------------------------------------

        whatsapp_hwnds = []

        def collect_whatsapp(hwnd, _):
            try:
                if not win32gui.IsWindowVisible(hwnd):
                    return

                _, pid = win32process.GetWindowThreadProcessId(hwnd)

                process_name = (
                    psutil.Process(pid)
                    .name()
                    .casefold()
                )

                if process_name == "whatsapp.root.exe":
                    whatsapp_hwnds.append(hwnd)

            except Exception:
                logger.debug("Window candidate could not be inspected during send", exc_info=True, extra={"event": "whatsapp.window_candidate_skipped"})

        win32gui.EnumWindows(
            collect_whatsapp,
            None,
        )

        if not whatsapp_hwnds:
            return WhatsAppResult(
                success=False,
                status="WHATSAPP_NOT_FOUND",
                contact=contact.display_name,
                message="WhatsApp window nahi mili. Message send nahi kiya.",
            )

        hwnd = whatsapp_hwnds[0]

        try:
            window = Desktop(
                backend="uia"
            ).window(handle=hwnd)

            window_rect = window.rectangle()

        except Exception as exc:
            return WhatsAppResult(
                success=False,
                status="WHATSAPP_UIA_FAILED",
                contact=contact.display_name,
                message=f"WhatsApp UI access nahi ho saka: {exc}",
            )

        # ---------------------------------------------------------
        # Find exact composer semantically
        # ---------------------------------------------------------

        try:
            edits = window.descendants(
                control_type="Edit"
            )

        except Exception as exc:
            return WhatsAppResult(
                success=False,
                status="COMPOSER_SEARCH_FAILED",
                contact=contact.display_name,
                message=f"WhatsApp composer search fail hui: {exc}",
            )

        composer_by_rect = {}

        expected_contact = (
            contact.display_name
            .strip()
            .casefold()
        )

        bottom_zone = (
            window_rect.top
            + int(window_rect.height() * 0.60)
        )

        for edit in edits:
            try:
                if not edit.is_visible():
                    continue

                rect = edit.rectangle()

                if rect.width() <= 0 or rect.height() <= 0:
                    continue

                # Composer is in lower part of WhatsApp.
                if rect.top < bottom_zone:
                    continue

                name = (
                    edit.element_info.name
                    or ""
                ).strip()

                name_lower = name.casefold()

                if "type a message to" not in name_lower:
                    continue

                # Critical recipient verification.
                if expected_contact not in name_lower:
                    continue

                key = (
                    rect.left,
                    rect.top,
                    rect.right,
                    rect.bottom,
                )

                composer_by_rect.setdefault(
                    key,
                    edit,
                )

            except Exception:
                logger.debug("Composer candidate could not be inspected during send", exc_info=True, extra={"event": "whatsapp.composer_candidate_skipped"})
                continue

        if len(composer_by_rect) != 1:
            return WhatsAppResult(
                success=False,
                status="COMPOSER_AMBIGUOUS",
                contact=contact.display_name,
                message=(
                    "Exact WhatsApp message box uniquely verify "
                    "nahi hua. Message send nahi kiya."
                ),
            )

        composer = next(
            iter(composer_by_rect.values())
        )

        composer_rect = composer.rectangle()

        # ---------------------------------------------------------
        # Verify exact draft text
        # ---------------------------------------------------------

        try:
            current_message = (
                composer.get_value()
                or ""
            ).strip()

        except Exception:
            try:
                current_message = (
                    composer.window_text()
                    or ""
                ).strip()

            except Exception as exc:
                return WhatsAppResult(
                    success=False,
                    status="COMPOSER_READ_FAILED",
                    contact=contact.display_name,
                    message=f"WhatsApp draft read nahi hua: {exc}",
                )

        if current_message != expected_message:
            return WhatsAppResult(
                success=False,
                status="MESSAGE_MISMATCH",
                contact=contact.display_name,
                message=(
                    "WhatsApp draft expected message se match "
                    "nahi karta. Message send nahi kiya."
                ),
            )

        # ---------------------------------------------------------
        # Find + deduplicate semantic Send button
        # ---------------------------------------------------------

        try:
            send_candidates = window.descendants(
                title="Send",
                control_type="Button",
            )

        except Exception as exc:
            return WhatsAppResult(
                success=False,
                status="SEND_BUTTON_SEARCH_FAILED",
                contact=contact.display_name,
                message=f"WhatsApp Send button search fail hui: {exc}",
            )

        buttons_by_rect = {}

        for button in send_candidates:
            try:
                if not button.is_visible():
                    continue

                if not button.is_enabled():
                    continue

                rect = button.rectangle()

                if rect.width() <= 0 or rect.height() <= 0:
                    continue

                # Must be physically inside current WhatsApp window.
                if not (
                    rect.left >= window_rect.left
                    and rect.top >= window_rect.top
                    and rect.right <= window_rect.right
                    and rect.bottom <= window_rect.bottom
                ):
                    continue

                # Send button should be beside the composer.
                if rect.left < composer_rect.right - 30:
                    continue

                # It should vertically overlap the composer area.
                if (
                    rect.bottom < composer_rect.top - 20
                    or rect.top > composer_rect.bottom + 20
                ):
                    continue

                key = (
                    rect.left,
                    rect.top,
                    rect.right,
                    rect.bottom,
                )

                # 79 duplicate UIA representations collapse to one.
                buttons_by_rect.setdefault(
                    key,
                    button,
                )

            except Exception:
                logger.debug("Send button candidate could not be inspected", exc_info=True, extra={"event": "whatsapp.send_candidate_skipped"})
                continue

        if len(buttons_by_rect) != 1:
            return WhatsAppResult(
                success=False,
                status="SEND_BUTTON_AMBIGUOUS",
                contact=contact.display_name,
                message=(
                    f"Unique Send button verify nahi hua "
                    f"(physical candidates: {len(buttons_by_rect)}). "
                    "Message send nahi kiya."
                ),
            )

        send_button = next(
            iter(buttons_by_rect.values())
        )

        # ---------------------------------------------------------
        # Explicit confirmation already happened via "send karo".
        # Invoke exactly ONE semantic button.
        # ---------------------------------------------------------

        try:
            try:
                send_button.invoke()

            except AttributeError:
                # UIA InvokePattern fallback.
                send_button.iface_invoke.Invoke()

        except Exception as exc:
            memory.record_action(
                action="whatsapp_send_message",
                target=contact.display_name,
                status="failed",
            )

            return WhatsAppResult(
                success=False,
                status="SEND_INVOKE_FAILED",
                contact=contact.display_name,
                message=f"WhatsApp Send invoke fail hua: {exc}",
            )

        # IMPORTANT:
        # Once Invoke has happened, don't allow the same prepared
        # message to be sent again accidentally.
        self.prepared_contact = None
        self.prepared_message = None

        memory.record_action(
            action="whatsapp_send_message",
            target=contact.display_name,
            status="attempted",
        )

        # ---------------------------------------------------------
        # Verify delivery action locally:
        # successful Send should clear the composer.
        # ---------------------------------------------------------

        composer_cleared = False

        for _ in range(10):
            time.sleep(0.2)

            try:
                value = (
                    composer.get_value()
                    or ""
                ).strip()

                if value == "":
                    composer_cleared = True
                    break

            except Exception:
                # UI element can refresh after Send.
                # Don't assume success from an exception.
                logger.debug("Composer refreshed while verifying send", exc_info=True, extra={"event": "whatsapp.composer_refresh"})

        if not composer_cleared:
            memory.record_action(
                action="whatsapp_send_message",
                target=contact.display_name,
                status="unverified",
            )

            return WhatsAppResult(
                success=False,
                status="SEND_UNVERIFIED",
                contact=contact.display_name,
                message=(
                    "Send button invoke hua, lekin message send "
                    "verify nahi ho saka. Main dobara automatically "
                    "send nahi karunga."
                ),
            )

        memory.record_action(
            action="whatsapp_send_message",
            target=contact.display_name,
            status="success",
        )

        return WhatsAppResult(
            success=True,
            status="SENT",
            contact=contact.display_name,
            message=(
                f"Message {contact.display_name} ko send kar diya hai."
            ),
        )

whatsapp = WhatsAppAdapter()
