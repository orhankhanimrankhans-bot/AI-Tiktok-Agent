from __future__ import annotations

import html
import logging
import re
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Callable

from PySide6.QtCore import QPointF, QProcess, QRectF, QThread, QTimer, Qt, Signal
from PySide6.QtGui import QColor, QFont, QKeySequence, QPainter, QPainterPath, QPen, QShortcut, QBrush, QLinearGradient, QRadialGradient
from PySide6.QtWidgets import (
    QApplication,
    QFrame,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPushButton,
    QScrollArea,
    QSizePolicy,
    QStackedWidget,
    QPlainTextEdit,
    QTextBrowser,
    QVBoxLayout,
    QWidget,
)
from .dialogs import JarvisDialogStyle,show_confirmation
from observability import get_logger, log_event, request_context


logger = get_logger("dashboard")


@dataclass(frozen=True)
class StatusItem:
    label: str
    value: str
    tone: str = "muted"


COLORS = {
    "background": "#060B12",
    "panel": "#0B1320",
    "panel_alt": "#0E1827",
    "border": "#1D3045",
    "text": "#E9F2FA",
    "muted": "#7F93A8",
    "cyan": "#45D8FF",
    "cyan_soft": "#173447",
    "green": "#51E6A8",
    "amber": "#F7C66C",
    "red": "#FF7285",
}


class CoreVoiceButton(QPushButton):
    """Compact Jarvis Core control that starts/stops the voice session."""

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self._state = "Ready"
        self.setObjectName("coreVoiceButton")
        self.setFixedSize(72, 72)
        self.setCursor(Qt.CursorShape.PointingHandCursor)
        self.setToolTip("Start Jarvis voice conversation")
        self.setAccessibleName("Jarvis Core voice control")
        self.setFocusPolicy(Qt.FocusPolicy.StrongFocus)

    def set_core_state(self, state: str) -> None:
        self._state = state or "Ready"
        active = self._state in {"Listening", "Processing", "Speaking"}
        self.setToolTip(
            "Stop Jarvis voice conversation"
            if active
            else "Start Jarvis voice conversation"
        )
        self.update()

    def paintEvent(self, event) -> None:  # noqa: N802 - Qt API name
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        rect = self.rect().adjusted(4, 4, -4, -4)
        center = rect.center()
        radius = min(rect.width(), rect.height()) // 2 - 2

        state_color = {
            "Listening": QColor(COLORS["amber"]),
            "Processing": QColor(COLORS["cyan"]),
            "Speaking": QColor(COLORS["green"]),
            "Error": QColor(COLORS["red"]),
            "Stopped": QColor(COLORS["muted"]),
            "Idle": QColor(COLORS["muted"]),
            "Ready": QColor(COLORS["cyan"]),
        }.get(self._state, QColor(COLORS["cyan"]))

        if not self.isEnabled():
            state_color = QColor(COLORS["muted"])

        # 3D shadow/depth.
        shadow = QColor(0, 0, 0, 150)
        painter.setBrush(shadow)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(QPointF(center.x() + 3, center.y() + 5), radius, radius)

        # Outer glow halo.
        glow = QRadialGradient(center, radius + 12)
        glow.setColorAt(0.45, QColor(state_color.red(), state_color.green(), state_color.blue(), 0))
        glow.setColorAt(0.78, QColor(state_color.red(), state_color.green(), state_color.blue(), 70))
        glow.setColorAt(1.0, QColor(state_color.red(), state_color.green(), state_color.blue(), 0))
        painter.setBrush(QBrush(glow))
        painter.drawEllipse(center, radius + 9, radius + 9)

        # Metallic/glass outer shell.
        shell = QRadialGradient(
            QPointF(center.x() - radius * 0.28, center.y() - radius * 0.32),
            radius * 1.25,
        )
        shell.setColorAt(0.00, QColor(75, 112, 136, 245))
        shell.setColorAt(0.30, QColor(25, 52, 70, 245))
        shell.setColorAt(0.72, QColor(8, 20, 31, 250))
        shell.setColorAt(1.00, QColor(2, 8, 14, 255))
        painter.setBrush(QBrush(shell))
        painter.setPen(QPen(QColor(state_color.red(), state_color.green(), state_color.blue(), 210), 2.2))
        painter.drawEllipse(center, radius, radius)

        # Inner recessed ring.
        inner_r = radius - 9
        painter.setBrush(QColor(3, 12, 20, 245))
        painter.setPen(QPen(QColor(113, 148, 169, 110), 1.2))
        painter.drawEllipse(center, inner_r, inner_r)

        # Inner luminous core.
        core_r = radius - 17
        core_grad = QRadialGradient(
            QPointF(center.x() - 5, center.y() - 7),
            core_r * 1.4,
        )
        core_grad.setColorAt(0.0, QColor(38, 82, 104, 245))
        core_grad.setColorAt(0.55, QColor(10, 31, 45, 250))
        core_grad.setColorAt(1.0, QColor(2, 10, 17, 255))
        painter.setBrush(QBrush(core_grad))
        painter.setPen(QPen(QColor(state_color.red(), state_color.green(), state_color.blue(), 225), 1.8))
        painter.drawEllipse(center, core_r, core_r)

        # Top-left glass highlight for a raised 3D feel.
        painter.setPen(QPen(QColor(255, 255, 255, 85), 2.0))
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.drawArc(
            int(center.x() - core_r),
            int(center.y() - core_r),
            int(core_r * 2),
            int(core_r * 2),
            38 * 16,
            104 * 16,
        )

        # Jarvis J logo.
        painter.setPen(QColor(COLORS["text"]) if self.isEnabled() else QColor(COLORS["muted"]))
        painter.setFont(QFont("Segoe UI", 19, QFont.Weight.Bold))
        painter.drawText(
            int(center.x() - 18),
            int(center.y() - 20),
            36,
            38,
            Qt.AlignmentFlag.AlignCenter,
            "J",
        )

        # Small glowing AI node.
        node_glow = QColor(state_color)
        node_glow.setAlpha(85)
        painter.setBrush(node_glow)
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(QPointF(center.x() + 11, center.y() - 11), 6.5, 6.5)

        painter.setBrush(state_color)
        painter.drawEllipse(QPointF(center.x() + 11, center.y() - 11), 3.2, 3.2)

        # Subtle lower rim for depth.
        painter.setPen(QPen(QColor(0, 0, 0, 170), 2))
        painter.drawArc(
            int(center.x() - radius + 2),
            int(center.y() - radius + 2),
            int((radius - 2) * 2),
            int((radius - 2) * 2),
            205 * 16,
            125 * 16,
        )




class CommandPipeline(QWidget):
    """Reference-style Jarvis command routing HUD.

    This remains presentation-only. Existing backend routing/state methods are
    preserved through set_route()/clear_route().
    """

    ROUTES = ("Chat", "Voice", "WhatsApp", "TikTok", "Tools", "Memory")

    def __init__(self, parent: QWidget | None = None) -> None:
        super().__init__(parent)
        self.setMinimumHeight(335)
        self.setSizePolicy(QSizePolicy.Policy.Expanding, QSizePolicy.Policy.Fixed)
        self._active_route: str | None = "Voice"
        self._phase = 0.0
        self._state = "Idle"
        self._timer = QTimer(self)
        self._timer.timeout.connect(self._advance)
        self._timer.setInterval(34)
        self._timer.start()

    def set_route(self, route: str | None, state: str = "Running") -> None:
        self._active_route = route if route in self.ROUTES else None
        self._state = state
        if not self._timer.isActive():
            self._timer.start()
        self.update()

    def clear_route(self) -> None:
        self._active_route = None
        self._state = "Idle"
        self.update()

    def _advance(self) -> None:
        self._phase = (self._phase + 0.012) % 1.0
        self.update()

    @staticmethod
    def _rounded_rect(painter: QPainter, rect: QRectF, radius: float,
                      fill: QColor, border: QColor, width: float = 1.0) -> None:
        painter.setBrush(fill)
        painter.setPen(QPen(border, width))
        painter.drawRoundedRect(rect, radius, radius)

    @staticmethod
    def _lerp(a: QPointF, b: QPointF, t: float) -> QPointF:
        return QPointF(a.x() + (b.x() - a.x()) * t,
                       a.y() + (b.y() - a.y()) * t)

    def _draw_glow_line(self, painter: QPainter, path: QPainterPath,
                        active: bool = False, color: QColor | None = None) -> None:
        c = color or QColor(41, 194, 255)
        if active:
            painter.setPen(QPen(QColor(c.red(), c.green(), c.blue(), 38), 11))
            painter.drawPath(path)
            painter.setPen(QPen(QColor(c.red(), c.green(), c.blue(), 95), 5.2))
            painter.drawPath(path)
            painter.setPen(QPen(QColor(c.red(), c.green(), c.blue(), 245), 2.2))
        else:
            painter.setPen(QPen(QColor(c.red(), c.green(), c.blue(), 105), 1.35))
        painter.drawPath(path)

    def _draw_card(self, painter: QPainter, rect: QRectF, icon: str,
                   title: str, subtitle: str = "", active: bool = False,
                   accent: QColor | None = None) -> None:
        accent = accent or QColor(32, 196, 255)
        # 3D lower shadow.
        self._rounded_rect(
            painter, rect.translated(0, 3), 10,
            QColor(0, 0, 0, 150), QColor(0, 0, 0, 0), 0
        )
        fill = QColor(5, 16, 26, 248)
        border = QColor(accent.red(), accent.green(), accent.blue(), 230 if active else 105)
        if active:
            glow_rect = rect.adjusted(-3, -3, 3, 3)
            self._rounded_rect(
                painter, glow_rect, 12,
                QColor(accent.red(), accent.green(), accent.blue(), 18),
                QColor(accent.red(), accent.green(), accent.blue(), 100), 2.0
            )
        self._rounded_rect(painter, rect, 10, fill, border, 1.35 if active else 1.0)

        icon_box = QRectF(rect.x() + 11, rect.y() + 9, 29, 29)
        self._rounded_rect(
            painter, icon_box, 7,
            QColor(accent.red(), accent.green(), accent.blue(), 36),
            QColor(accent.red(), accent.green(), accent.blue(), 118), 0.8
        )
        painter.setPen(accent)
        painter.setFont(QFont("Segoe UI Symbol", 14, QFont.Weight.Bold))
        painter.drawText(icon_box, Qt.AlignmentFlag.AlignCenter, icon)

        painter.setPen(QColor(238, 247, 252))
        painter.setFont(QFont("Segoe UI", 10, QFont.Weight.DemiBold))
        title_rect = QRectF(rect.x() + 52, rect.y() + 7, rect.width() - 58, 20)
        painter.drawText(title_rect, Qt.AlignmentFlag.AlignVCenter, title)

        if subtitle:
            painter.setPen(QColor(117, 145, 165))
            painter.setFont(QFont("Segoe UI", 7))
            sub_rect = QRectF(rect.x() + 52, rect.y() + 26, rect.width() - 58, 15)
            painter.drawText(sub_rect, Qt.AlignmentFlag.AlignVCenter, subtitle)

    def _draw_engine(self, painter: QPainter, center: QPointF, radius: float) -> None:
        # Outer glow.
        glow = QRadialGradient(center, radius * 1.25)
        glow.setColorAt(0.0, QColor(0, 210, 255, 60))
        glow.setColorAt(0.55, QColor(0, 145, 255, 25))
        glow.setColorAt(1.0, QColor(0, 120, 255, 0))
        painter.setBrush(QBrush(glow))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(center, radius * 1.22, radius * 1.22)

        for mul, alpha, width in ((1.0, 180, 1.2), (.84, 95, 1), (.66, 75, 1), (.48, 55, 1)):
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.setPen(QPen(QColor(19, 188, 255, alpha), width))
            painter.drawEllipse(center, radius * mul, radius * mul)

        # Rotating segmented ring.
        painter.setPen(QPen(QColor(25, 213, 255, 205), 2.6))
        start = int((self._phase * 360.0) * 16)
        for i in range(8):
            painter.drawArc(
                QRectF(center.x()-radius*.93, center.y()-radius*.93,
                       radius*1.86, radius*1.86),
                start + i * 45 * 16, 18 * 16
            )

        # Atom/orbit curves.
        painter.save()
        painter.translate(center)
        painter.setBrush(Qt.BrushStyle.NoBrush)
        painter.setPen(QPen(QColor(140, 234, 255, 185), 1.05))
        for angle in (0, 58, 118):
            painter.save()
            painter.rotate(angle)
            painter.drawEllipse(QRectF(-radius*.72, -radius*.24, radius*1.44, radius*.48))
            painter.restore()

        core = QRadialGradient(QPointF(0, 0), radius * .46)
        core.setColorAt(0.0, QColor(245, 255, 255, 255))
        core.setColorAt(.15, QColor(80, 231, 255, 245))
        core.setColorAt(.52, QColor(0, 147, 255, 145))
        core.setColorAt(1.0, QColor(0, 100, 210, 0))
        painter.setBrush(QBrush(core))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(QPointF(0, 0), radius*.47, radius*.47)

        # Tiny particle sparks.
        painter.setBrush(QColor(105, 225, 255, 210))
        for i in range(22):
            a = (i * 37 + self._phase * 360) * 0.0174533
            rr = radius * (.24 + ((i * 17) % 60) / 100.0)
            x = __import__("math").cos(a) * rr
            y = __import__("math").sin(a) * rr
            painter.drawEllipse(QPointF(x, y), 1.25, 1.25)
        painter.restore()

    def paintEvent(self, event) -> None:  # noqa: N802
        del event
        painter = QPainter(self)
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)

        w = float(self.width())
        h = float(self.height())

        # Background / grid.
        bg = QLinearGradient(0, 0, 0, h)
        bg.setColorAt(0.0, QColor(4, 18, 30, 238))
        bg.setColorAt(1.0, QColor(1, 9, 17, 248))
        painter.fillRect(self.rect(), QBrush(bg))

        painter.setPen(QPen(QColor(27, 85, 115, 35), 1))
        grid = 26
        x = 8
        while x < w:
            painter.drawLine(int(x), 0, int(x), int(h))
            x += grid
        y = 8
        while y < h:
            painter.drawLine(0, int(y), int(w), int(y))
            y += grid

        # Reference proportions.
        src_controls_x = w * .018
        source_x = w * .145
        source_w = w * .165
        source_h = 46.0
        hub = QPointF(w * .46, h * .52)
        route_x = w * .63
        route_w = w * .16
        engine_center = QPointF(w * .905, h * .47)

        # ADD SOURCE / CONNECT DATA control rail.
        control_w = w * .082
        ctrl1 = QRectF(src_controls_x, h*.20, control_w, 85)
        ctrl2 = QRectF(src_controls_x, h*.52, control_w, 82)
        for rect, icon, label in (
            (ctrl1, "+", "ADD SOURCE"),
            (ctrl2, "▶", "CONNECT DATA"),
        ):
            self._rounded_rect(painter, rect, 13, QColor(5, 20, 31, 235),
                               QColor(21, 103, 139, 165), 1)
            ib = QRectF(rect.center().x()-23, rect.y()+13, 46, 46)
            self._rounded_rect(painter, ib, 11, QColor(6, 30, 45, 230),
                               QColor(21, 131, 178, 150), 1)
            painter.setPen(QColor(61, 209, 255))
            painter.setFont(QFont("Segoe UI Symbol", 22, QFont.Weight.Light))
            painter.drawText(ib, Qt.AlignmentFlag.AlignCenter, icon)
            painter.setPen(QColor(171, 197, 212))
            painter.setFont(QFont("Segoe UI", 7, QFont.Weight.Bold))
            painter.drawText(QRectF(rect.x()+2, rect.bottom()-23, rect.width()-4, 18),
                             Qt.AlignmentFlag.AlignCenter, label)

        sources = (
            ("▧", "UPLOAD", "PDF, DOCX, TXT", QColor(45, 209, 224)),
            ("◉", "WEBSITE", "URL / LINKS", QColor(255, 151, 34)),
            ("▶", "YOUTUBE", "VIDEO CONTENT", QColor(197, 81, 255)),
            ("▰", "FILES", "DATA FILES", QColor(29, 224, 150)),
        )
        sy = h * .12
        source_centers = []
        for i, (icon, title, sub, accent) in enumerate(sources):
            rect = QRectF(source_x, sy + i * (source_h + 8), source_w, source_h)
            self._draw_card(painter, rect, icon, title, sub, False, accent)
            source_centers.append((QPointF(rect.right(), rect.center().y()), accent))

        # Source -> hub colored pipes.
        for i, (start, accent) in enumerate(source_centers):
            path = QPainterPath(start)
            c1 = QPointF(w*.355, start.y())
            c2 = QPointF(w*.395, hub.y())
            path.cubicTo(c1, c2, hub)
            painter.setPen(QPen(QColor(accent.red(), accent.green(), accent.blue(), 210),
                                2.1, Qt.PenStyle.DashLine))
            painter.drawPath(path)

            # Moving packet.
            t = (self._phase + i * .21) % 1.0
            p0 = start
            p1 = hub
            # approximate packet along chord for smooth animated cue
            packet = self._lerp(p0, p1, t)
            painter.setBrush(accent)
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawEllipse(packet, 3.3, 3.3)

        # Hub glow and 3D rings.
        hub_glow = QRadialGradient(hub, 48)
        hub_glow.setColorAt(0.0, QColor(225, 255, 255, 255))
        hub_glow.setColorAt(.12, QColor(0, 224, 255, 230))
        hub_glow.setColorAt(.42, QColor(0, 133, 255, 100))
        hub_glow.setColorAt(1.0, QColor(0, 120, 255, 0))
        painter.setBrush(QBrush(hub_glow))
        painter.setPen(Qt.PenStyle.NoPen)
        painter.drawEllipse(hub, 48, 48)
        for rr, a in ((34, 190), (27, 110), (17, 90)):
            painter.setBrush(Qt.BrushStyle.NoBrush)
            painter.setPen(QPen(QColor(19, 188, 255, a), 1.5))
            painter.drawEllipse(hub, rr, rr)

        # Hub -> route cards.
        route_h = 43.0
        route_gap = 7.0
        total = len(self.ROUTES) * route_h + (len(self.ROUTES)-1)*route_gap
        ry = max(10.0, (h-total)/2.0)

        route_icons = {
            "Chat": "☵",
            "Voice": "♩",
            "WhatsApp": "◉",
            "TikTok": "♪",
            "Tools": "⌕",
            "Memory": "♧",
        }

        for i, route in enumerate(self.ROUTES):
            rect = QRectF(route_x, ry + i*(route_h+route_gap), route_w, route_h)
            active = route == (self._active_route or "Voice")
            end = QPointF(rect.x(), rect.center().y())

            path = QPainterPath(hub)
            path.cubicTo(QPointF(w*.54, hub.y()),
                         QPointF(w*.565, end.y()), end)
            self._draw_glow_line(painter, path, active)

            # terminal node
            painter.setBrush(QColor(70, 217, 255) if active else QColor(50, 153, 196))
            painter.setPen(Qt.PenStyle.NoPen)
            painter.drawEllipse(QPointF(end.x()-7, end.y()), 3.3, 3.3)

            self._draw_card(
                painter, rect, route_icons[route], route, "",
                active, QColor(26, 197, 255)
            )

        # Engine visual + labels.
        radius = min(w*.082, h*.27)
        self._draw_engine(painter, engine_center, radius)

        painter.setPen(QColor(21, 211, 255))
        painter.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
        engine_label = QRectF(engine_center.x()-90, engine_center.y()+radius+7, 180, 22)
        painter.drawText(engine_label, Qt.AlignmentFlag.AlignCenter, "STRONG ENGINE")

        cfg = QRectF(engine_center.x()-77, engine_center.y()+radius+31, 154, 38)
        self._rounded_rect(painter, cfg.translated(0, 3), 10,
                           QColor(0,0,0,150), QColor(0,0,0,0), 0)
        self._rounded_rect(painter, cfg, 10,
                           QColor(2, 38, 58, 245), QColor(0, 194, 255, 220), 1.2)
        painter.setPen(QColor(31, 214, 255))
        painter.setFont(QFont("Segoe UI", 10, QFont.Weight.Bold))
        painter.drawText(cfg, Qt.AlignmentFlag.AlignCenter, "⚙  CONFIGURE")

        # Routing caption.
        painter.setPen(QColor(24, 207, 255))
        painter.setFont(QFont("Segoe UI", 9))
        label = f"Routing → {self._active_route or 'Idle'}"
        painter.drawText(QRectF(14, h-24, w*.42, 18),
                         Qt.AlignmentFlag.AlignLeft | Qt.AlignmentFlag.AlignVCenter, label)


class StatusPill(QLabel):
    def __init__(self, text: str, tone: str = "muted") -> None:
        super().__init__(text)
        self.set_tone(tone)
        self.setAlignment(Qt.AlignmentFlag.AlignCenter)

    def set_tone(self, tone: str) -> None:
        tone_color = {
            "ready": COLORS["green"],
            "warning": COLORS["amber"],
            "error": COLORS["red"],
            "muted": COLORS["muted"],
        }.get(tone, COLORS["muted"])
        self.setStyleSheet(
            f"""
            QLabel {{
                color: {tone_color};
                background: #101D2A;
                border: 1px solid {tone_color};
                border-radius: 9px;
                padding: 3px 8px;
                font-size: 10px;
                font-weight: 700;
            }}
            """
        )


class SpeechPreloadThread(QThread):
    """Warm the local speech model after the dashboard is already visible."""

    completed = Signal(bool)

    def __init__(self, speech_engine) -> None:
        super().__init__()
        self.speech_engine = speech_engine

    def run(self) -> None:
        try:
            success = bool(self.speech_engine.preload())
        except Exception:
            logger.exception(
                "Background speech preload failed",
                extra={"event": "dashboard.speech_preload_failed"},
            )
            success = False

        if not self.isInterruptionRequested():
            self.completed.emit(success)


class JarvisRequestThread(QThread):
    response_ready = Signal(str)
    request_failed = Signal(str)
    state_changed = Signal(str)

    def __init__(
        self,
        handler: Callable[[str], str],
        user_text: str,
    ) -> None:
        super().__init__()
        self.handler = handler
        self.user_text = user_text
        self._cancelled = False

    def cancel(self) -> None:
        self._cancelled = True
        self.requestInterruption()

    def run(self) -> None:
        with request_context() as request_id:
            try:
                self.state_changed.emit("Thinking")
                log_event(logger, logging.INFO, "dashboard.request_started", "Dashboard background request started", module_selection="jarvis.main")
                self.state_changed.emit("Executing")
                response = self.handler(self.user_text)
                if not self._cancelled:
                    self.response_ready.emit(response or "")
            except Exception:
                logger.exception("Dashboard request worker failed", extra={"event": "dashboard.request_failed"})
                if not self._cancelled:
                    self.request_failed.emit(
                        "Jarvis could not complete that request. "
                        f"Please try again. Reference: {request_id[:8]}"
                    )


class DashboardActionThread(QThread):
    """Run update/backup maintenance without blocking the Qt event loop."""

    completed = Signal(str)
    failed = Signal(str)

    def __init__(self, action: Callable[[], str]) -> None:
        super().__init__()
        self.action = action

    def run(self) -> None:
        try:
            result = str(self.action())
            if not self.isInterruptionRequested():
                self.completed.emit(result)
        except Exception as error:
            logger.exception("Dashboard maintenance action failed", extra={"event": "dashboard.maintenance_failed"})
            if not self.isInterruptionRequested():
                self.failed.emit(f"Operation failed safely: {type(error).__name__}. See Logs for details.")


class JarvisVoiceThread(QThread):
    state_changed = Signal(str)
    transcript_ready = Signal(str, str)
    response_ready = Signal(str)
    request_failed = Signal(str)

    def __init__(
        self,
        listener: Callable[[], dict],
        handler: Callable[[str], str],
        speaker: Callable[[str], bool],
        max_recovery_attempts: int = 3,
        recovery_delay_seconds: float = 0.5,
    ) -> None:
        super().__init__()
        self.listener = listener
        self.handler = handler
        self.speaker = speaker
        self._stop_requested = False
        self.max_recovery_attempts = max(0, max_recovery_attempts)
        self.recovery_delay_seconds = max(0.0, recovery_delay_seconds)
        self.state = "Idle"

    def request_stop(self) -> None:
        self._stop_requested = True

    def _set_state(self, state: str) -> None:
        self.state = state
        self.state_changed.emit(state)
        log_event(logger, logging.INFO, "voice.state_changed", "Continuous voice state changed", state=state)

    def run(self) -> None:
        consecutive_errors = 0
        while not self._stop_requested:
            with request_context() as request_id:
                try:
                    self._set_state("Listening")
                    log_event(logger, logging.INFO, "voice.listening", "Voice listening cycle started", interface="dashboard")
                    result = self.listener()

                    if self._stop_requested:
                        break

                    transcript = str(result.get("text", "")).strip()
                    language = str(result.get("language", "unknown"))

                    if not transcript:
                        log_event(logger, logging.INFO, "voice.empty", "Voice cycle returned no transcript", success=False)
                        consecutive_errors = 0
                        continue

                    log_event(logger, logging.INFO, "voice.transcribed", "Voice transcript ready", user_input=transcript, language=language)
                    self.transcript_ready.emit(transcript, language)
                    self._set_state("Processing")
                    response = self.handler(transcript) or ""
                    self.response_ready.emit(response)

                    if response and not self._stop_requested:
                        self._set_state("Speaking")
                        spoken = self.speaker(response)
                        log_event(logger, logging.INFO if spoken else logging.WARNING, "voice.spoken", "Voice response completed", success=bool(spoken))
                    consecutive_errors = 0
                except Exception as error:
                    consecutive_errors += 1
                    logger.exception("Continuous voice cycle failed", extra={"event": "voice.cycle_failed", "attempt": consecutive_errors})
                    self.request_failed.emit(
                        "Voice input had a temporary problem and will retry. "
                        f"Reference: {request_id[:8]}"
                    )
                    if consecutive_errors > self.max_recovery_attempts:
                        log_event(logger, logging.ERROR, "voice.recovery_exhausted", "Continuous voice recovery attempts exhausted", success=False, error_type=type(error).__name__)
                        break
                    if self.recovery_delay_seconds:
                        self.msleep(int(self.recovery_delay_seconds * 1000))

            if not self._stop_requested:
                self.msleep(250)

        self._set_state("Stopped")


class DashboardWindow(QMainWindow):
    NAV_ITEMS = (
        "Home", "Chat", "Voice", "WhatsApp", "TikTok", "Memory",
        "Tasks", "Logs", "Updates", "Backups", "Settings", "System Health",
    )

    def __init__(self) -> None:
        super().__init__()
        self.jarvis = None
        self.request_thread: QThread | None = None
        self.speech = None
        self.status_pills: dict[str, StatusPill] = {}
        self.nav_buttons: dict[str, QPushButton] = {}
        self.top_mode_buttons: dict[str, QPushButton] = {}
        self.pages: dict[str, QWidget] = {}
        self.last_user_message = ""
        self.last_assistant_message = ""
        self.theme_name = "dark"
        self.maintenance_thread: DashboardActionThread | None = None
        self.speech_preload_thread: SpeechPreloadThread | None = None
        self.setWindowTitle("Jarvis Control Center")
        self.resize(1660, 929)
        self.setMinimumSize(1180, 700)

        root = QWidget()
        root.setObjectName("root")
        self.setCentralWidget(root)

        layout = QHBoxLayout(root)
        layout.setContentsMargins(0, 0, 0, 0)
        layout.setSpacing(0)
        self.sidebar = self._build_sidebar()
        self.page_stack = self._build_command_pages()
        self.status_panel = self._build_status_panel()
        layout.addWidget(self.sidebar)
        layout.addWidget(self.page_stack, 1)
        layout.addWidget(self.status_panel)

        self.setStyleSheet(self._stylesheet())
        self._install_shortcuts()
        self._navigate("Home")
        self._connect_backend()
        self.skill_status_timer = QTimer(self)
        self.skill_status_timer.timeout.connect(self._refresh_skill_status)
        self.skill_status_timer.start(300)

    def _build_sidebar(self) -> QWidget:
        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(228)

        layout = QVBoxLayout(sidebar)
        layout.setContentsMargins(18, 24, 18, 20)
        layout.setSpacing(8)

        brand = QLabel("JARVIS")
        brand.setObjectName("brand")
        subtitle = QLabel("CONTROL CENTER")
        subtitle.setObjectName("brandSubtitle")
        layout.addWidget(brand)
        layout.addWidget(subtitle)
        layout.addSpacing(24)

        sections = [
            ("◉", "Jarvis Core", True),
            ("◫", "Memory", False),
            ("◇", "Skills", False),
            ("◎", "Persona", False),
            ("✓", "Tasks", False),
            ("⌁", "Agent Office", False),
            ("▶", "TikTok Pipeline", False),
            ("◌", "Actions", False),
            ("≡", "Logs", False),
            ("⚙", "Settings", False),
        ]

        for icon, label, active in sections:
            button = QPushButton(f"{icon}   {label}")
            button.setObjectName("navActive" if active else "navButton")
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.setEnabled(active)
            layout.addWidget(button)

        layout.addStretch(1)

        mode = QLabel("ASSISTED MODE")
        mode.setObjectName("modeLabel")
        layout.addWidget(mode)

        version = QLabel("UI shell · backend wiring pending")
        version.setWordWrap(True)
        version.setObjectName("smallMuted")
        layout.addWidget(version)
        return sidebar

    def _build_core_panel(self) -> QWidget:
        panel = QWidget()
        panel.setObjectName("corePanel")

        layout = QVBoxLayout(panel)
        layout.setContentsMargins(12, 6, 12, 12)
        layout.setSpacing(10)

        layout.addWidget(self._build_top_mode_bar())

        header = QFrame()
        header.setObjectName("headerCard")
        header_row = QHBoxLayout(header)
        header_row.setContentsMargins(20, 12, 18, 12)
        header_row.setSpacing(12)

        titles = QVBoxLayout()
        titles.setSpacing(1)
        title = QLabel("Jarvis Core")
        title.setObjectName("pageTitle")
        subtitle = QLabel("Conversation and command center")
        subtitle.setObjectName("pageSubtitle")
        titles.addWidget(title)
        titles.addWidget(subtitle)
        header_row.addLayout(titles)
        header_row.addStretch(1)

        self.restart_button = QPushButton("↻  Restart")
        self.restart_button.setObjectName("miniButton")
        self.restart_button.setFixedWidth(92)
        self.restart_button.setToolTip("Restart Jarvis Control Center")
        self.restart_button.clicked.connect(self._restart_application)
        header_row.addWidget(self.restart_button)

        self.core_voice_button = CoreVoiceButton()
        self.core_voice_button.setEnabled(False)
        self.core_voice_button.setFixedSize(68, 68)
        self.core_voice_button.clicked.connect(self._start_voice_request)
        header_row.addWidget(self.core_voice_button)

        self.activity_pill = StatusPill("THINKING", "warning")
        header_row.addWidget(self.activity_pill)
        layout.addWidget(header)

        self.notification_label = QLabel("")
        self.notification_label.setObjectName("notification")
        self.notification_label.setWordWrap(True)
        self.notification_label.hide()
        layout.addWidget(self.notification_label)

        pipeline_card = QFrame()
        pipeline_card.setObjectName("pipelineCard")
        pipeline_layout = QVBoxLayout(pipeline_card)
        pipeline_layout.setContentsMargins(13, 10, 13, 10)
        pipeline_layout.setSpacing(4)

        pipeline_title = QLabel("♩  COMMAND PIPELINE  ─────")
        pipeline_title.setObjectName("sectionTitle")
        pipeline_layout.addWidget(pipeline_title)

        self.command_pipeline = CommandPipeline()
        pipeline_layout.addWidget(self.command_pipeline)
        layout.addWidget(pipeline_card)

        conversation = QFrame()
        conversation.setObjectName("conversationCard")
        conversation_layout = QVBoxLayout(conversation)
        conversation_layout.setContentsMargins(14, 9, 14, 12)
        conversation_layout.setSpacing(7)

        conversation_header = QHBoxLayout()
        chat_title = QLabel("▣  CONVERSATION")
        chat_title.setObjectName("sectionTitle")
        conversation_header.addWidget(chat_title)
        conversation_header.addStretch(1)

        self.copy_button = QPushButton("▣  Copy last")
        self.copy_button.setObjectName("miniButton")
        self.copy_button.clicked.connect(self._copy_last_response)
        self.regenerate_button = QPushButton("↻  Regenerate")
        self.regenerate_button.setObjectName("miniButton")
        self.regenerate_button.clicked.connect(self._regenerate_last_response)
        conversation_header.addWidget(self.copy_button)
        conversation_header.addWidget(self.regenerate_button)
        conversation_layout.addLayout(conversation_header)

        self.chat_view = QTextBrowser()
        self.chat_view.setObjectName("chatView")
        self.chat_view.setOpenExternalLinks(False)
        self.chat_view.setMinimumHeight(140)
        self.chat_view.setHtml(
            "<div style='color:#7F93A8; text-align:center; margin-top:26px;'>"
            "Connecting to Jarvis backend…</div>"
        )
        conversation_layout.addWidget(self.chat_view, 1)

        input_row = QHBoxLayout()
        input_row.setSpacing(10)
        self.message_input = QLineEdit()
        self.message_input.setPlaceholderText("Message Jarvis in English, Urdu, or Roman Urdu...")
        self.message_input.setEnabled(False)
        self.message_input.returnPressed.connect(self._submit_message)

        self.voice_button = QPushButton("♩  Voice")
        self.voice_button.setObjectName("voiceAction")
        self.voice_button.setEnabled(False)
        self.voice_button.clicked.connect(self._start_voice_request)

        self.send_button = QPushButton("➤  Send")
        self.send_button.setObjectName("primaryButton")
        self.send_button.setEnabled(False)
        self.send_button.clicked.connect(self._submit_message)

        input_row.addWidget(self.message_input, 1)
        input_row.addWidget(self.voice_button)
        input_row.addWidget(self.send_button)
        conversation_layout.addLayout(input_row)

        layout.addWidget(conversation, 1)
        return panel

    def _build_status_panel(self) -> QWidget:
        panel = QFrame()
        panel.setObjectName("statusPanel")
        panel.setFixedWidth(294)

        outer = QVBoxLayout(panel)
        outer.setContentsMargins(13, 18, 12, 14)
        outer.setSpacing(10)

        title = QLabel("●  LIVE STATUS  ─────")
        title.setObjectName("liveTitle")
        outer.addWidget(title)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll.setFrameShape(QFrame.Shape.NoFrame)
        scroll.setHorizontalScrollBarPolicy(Qt.ScrollBarPolicy.ScrollBarAlwaysOff)

        content = QWidget()
        content_layout = QVBoxLayout(content)
        content_layout.setContentsMargins(0, 0, 0, 0)
        content_layout.setSpacing(10)

        groups = [
            (
                "COMMAND RUNTIME",
                [
                    StatusItem("AI state", "Thinking", "warning"),
                    StatusItem("Active task", "Voice conversation", "warning"),
                    StatusItem("Tools running", "0"),
                    StatusItem("Voice", "Listening", "warning"),
                    StatusItem("API status", "Ready", "ready"),
                    StatusItem("Loaded skills", "4", "ready"),
                    StatusItem("Active skill", "None"),
                    StatusItem("Failed skill", "None"),
                ],
            ),
            (
                "SYSTEM",
                [
                    StatusItem("Dashboard", "Ready", "ready"),
                    StatusItem("Jarvis backend", "Connected", "ready"),
                    StatusItem("Current activity", "Listening", "warning"),
                ],
            ),
            (
                "INTERFACES",
                [
                    StatusItem("Text input", "Ready", "ready"),
                    StatusItem("Voice input", "Listening", "warning"),
                    StatusItem("WhatsApp action", "None"),
                ],
            ),
            (
                "WORKFLOWS",
                [
                    StatusItem("TikTok pipeline", "Not queried"),
                ],
            ),
        ]

        for group_name, items in groups:
            content_layout.addWidget(self._status_group(group_name, items))

        content_layout.addStretch(1)
        scroll.setWidget(content)
        outer.addWidget(scroll, 1)

        health_note = QLabel(
            "Statuses become live only after their backend adapters are connected."
        )
        health_note.setObjectName("smallMuted")
        health_note.setWordWrap(True)
        outer.addWidget(health_note)
        return panel

    def _status_group(self, title: str, items: list[StatusItem]) -> QWidget:
        group = QFrame()
        group.setObjectName("statusGroup")
        layout = QVBoxLayout(group)
        layout.setContentsMargins(14, 14, 14, 14)
        layout.setSpacing(10)

        heading = QLabel(title)
        heading.setObjectName("groupTitle")
        layout.addWidget(heading)

        for item in items:
            row = QHBoxLayout()
            label = QLabel(item.label)
            label.setObjectName("statusLabel")
            row.addWidget(label)
            row.addStretch(1)
            pill = StatusPill(item.value, item.tone)
            self.status_pills[item.label] = pill
            row.addWidget(pill)
            layout.addLayout(row)

        return group

    def _connect_backend(self) -> None:
        try:
            from .main import Jarvis
            from .speech import speech

            self.jarvis = Jarvis()
            self.speech = speech
            workflow_page = self.pages.get("Workflow")
            if workflow_page is not None:
                workflow_page.set_jarvis_backend(self.jarvis.process)
        except Exception as exc:
            logger.exception("Dashboard backend failed to load", extra={"event": "dashboard.startup_failed"})
            self._set_request_state("Error")
            self._set_status("Jarvis backend", "Error", "error")
            self._set_status("API status", "Error", "error")
            self._set_status("Text input", "Unavailable", "error")
            self._set_status("Current activity", "Error", "error")
            self.chat_view.setHtml(
                "<div style='color:#FF7285;'><b>Jarvis backend failed "
                f"to load.</b><br>{html.escape(str(exc))}</div>"
            )
            self.health_summary.setText("Dashboard: Ready\nBackend: Error\nAPI: Error\nMemory: Unknown")
            self._notify("Jarvis backend could not start. See Logs for details.", "error")
            return

        self._set_status("Jarvis backend", "Connected", "ready")
        self._set_status("API status", "Ready", "ready")
        log_event(logger, logging.INFO, "dashboard.started", "Dashboard backend connected", success=True)
        self._set_status("Text input", "Ready", "ready")
        self._set_status("Current activity", "Idle", "muted")
        self.message_input.setEnabled(True)
        self.message_input.setPlaceholderText(
            "Message Jarvis in English, Urdu, or Roman Urdu…"
        )
        self.send_button.setEnabled(True)
        speech_status = self.speech.status()
        voice_ready = bool(
            speech_status.get("microphone")
            and speech_status.get("speech_to_text")
        )
        self.voice_button.setEnabled(voice_ready)
        self.core_voice_button.setEnabled(voice_ready)
        self.core_voice_button.set_core_state("Ready" if voice_ready else "Error")
        self._set_status(
            "Voice input",
            "Ready" if voice_ready else "Unavailable",
            "ready" if voice_ready else "error",
        )
        self._load_conversation_history()
        self._update_whatsapp_progress()
        self._refresh_memory()
        self._refresh_skill_status()
        self.health_summary.setText("Dashboard: Ready\nBackend: Connected\nAPI: Ready\nMemory: Available")
        self._notify("AI Command Center is ready.", "ready")
        self.message_input.setFocus()

        # Do not block application startup while Whisper warms up.
        # The dashboard becomes usable immediately and speech preloads in background.
        QTimer.singleShot(50, self._start_background_speech_preload)

    def _start_background_speech_preload(self) -> None:
        if self.speech is None:
            return

        if (
            self.speech_preload_thread is not None
            and self.speech_preload_thread.isRunning()
        ):
            return

        thread = SpeechPreloadThread(self.speech)
        self.speech_preload_thread = thread
        thread.completed.connect(self._speech_preload_completed)
        thread.finished.connect(thread.deleteLater)
        thread.start()

    def _speech_preload_completed(self, success: bool) -> None:
        self.speech_preload_thread = None
        if success:
            log_event(
                logger,
                logging.INFO,
                "dashboard.speech_preload_completed",
                "Speech model warmed in background",
                success=True,
            )
        else:
            log_event(
                logger,
                logging.WARNING,
                "dashboard.speech_preload_completed",
                "Speech model background warm-up was unavailable",
                success=False,
            )

    def _load_conversation_history(self) -> None:
        """Render persisted turns without making dashboard startup fragile."""
        self.chat_view.clear()
        try:
            from .memory import memory

            messages = memory.get_recent_messages()
        except Exception:
            logger.exception("Dashboard history failed to load", extra={"event": "dashboard.history_failed"})
            self._append_system_message(
                "Jarvis is ready, but previous conversation history could not be loaded."
            )
            return

        if not messages:
            self._append_system_message("Jarvis is ready. Start a conversation.")
            return

        for item in messages:
            role = item.get("role", "")
            if role not in {"user", "assistant"}:
                continue
            self._append_chat_message(
                "You" if role == "user" else "Jarvis",
                item.get("content", ""),
                role,
                timestamp=item.get("created_at"),
            )
        log_event(logger, logging.INFO, "dashboard.history_loaded", "Persisted dashboard history loaded", message_count=len(messages), success=True)

    def _set_status(self, label: str, value: str, tone: str) -> None:
        pill = self.status_pills.get(label)
        if pill is None:
            return
        pill.setText(value)
        pill.set_tone(tone)

    def _set_request_state(self, state: str) -> None:
        tone = {
            "Ready": "ready",
            "Thinking": "warning",
            "Executing": "warning",
            "Error": "error",
        }.get(state, "muted")
        self.activity_pill.setText(state.upper())
        self.activity_pill.set_tone(tone)
        self._set_status("Current activity", state, tone)
        self._set_status("AI state", state, tone)
        self._set_status("Active task", "Chat request" if state in {"Thinking", "Executing"} else "None", tone if state != "Ready" else "muted")
        self._set_status("Tools running", "1" if state == "Executing" else "0", "warning" if state == "Executing" else "muted")
        log_event(logger, logging.INFO, "dashboard.state_changed", "Dashboard request state changed", state=state)

    @staticmethod
    def _pipeline_route_for_text(text: str) -> str:
        """Map a user request to the dashboard module shown in the visual pipeline."""
        value = " ".join(text.casefold().strip().split())

        if any(word in value for word in ("whatsapp", "message", "msg", "bhejo", "send karo")):
            return "WhatsApp"

        if any(word in value for word in ("tiktok", "tik tok", "video", "short video")):
            return "TikTok"

        if any(word in value for word in ("memory", "remember", "yaad", "recall")):
            return "Memory"

        if any(word in value for word in (
            "open ",
            "launch ",
            "file",
            "folder",
            "website",
            "chrome",
            "vscode",
            "vs code",
            "tool",
        )):
            return "Tools"

        return "Chat"

    def _set_pipeline_from_text(self, text: str) -> None:
        if hasattr(self, "command_pipeline"):
            self.command_pipeline.set_route(
                self._pipeline_route_for_text(text),
                "Running",
            )

    def _submit_message(self) -> None:
        if self.jarvis is None or self.request_thread is not None:
            return

        user_text = self.message_input.text().strip()
        if not user_text:
            return

        self.message_input.clear()
        self.last_user_message = user_text
        self._append_chat_message("You", user_text, "user")
        self._set_pipeline_from_text(user_text)
        self._set_busy(True)

        self.request_thread = JarvisRequestThread(
            self.jarvis.process,
            user_text,
        )
        self.request_thread.response_ready.connect(
            self._request_finished
        )
        self.request_thread.request_failed.connect(
            self._request_failed
        )
        self.request_thread.state_changed.connect(
            self._set_request_state
        )
        self.request_thread.finished.connect(
            self.request_thread.deleteLater
        )
        self.request_thread.start()

    def _set_busy(self, busy: bool) -> None:
        self.message_input.setEnabled(not busy)
        self.send_button.setEnabled(not busy)
        if self.speech is not None:
            status = self.speech.status()
            voice_ready = bool(
                status.get("microphone")
                and status.get("speech_to_text")
            )
            self.voice_button.setEnabled(not busy and voice_ready)
            self.core_voice_button.setEnabled(not busy and voice_ready)
        if busy:
            self._set_request_state("Thinking")
        else:
            self._set_request_state("Ready")

    def _request_finished(self, response: str) -> None:
        self._append_chat_message(
            "Jarvis",
            response or "Jarvis returned an empty response.",
            "assistant",
        )
        self.request_thread = None
        self._update_whatsapp_progress(response)
        if hasattr(self, "command_pipeline"):
            self.command_pipeline.clear_route()
        self._set_busy(False)
        self._notify("Response received.", "ready")
        log_event(logger, logging.INFO, "dashboard.response_received", "Dashboard response rendered", success=True, response_length=len(response or ""))
        self.message_input.setFocus()

    def _update_whatsapp_progress(self, response: str = "") -> None:
        """Mirror the persisted semantic workflow without controlling execution."""
        try:
            from .messaging_context import messaging

            context = messaging.context
            if context.awaiting_confirmation:
                value, tone = "Awaiting confirm", "warning"
            elif context.awaiting_message_text:
                value, tone = "Awaiting message", "warning"
            elif "whatsapp" in response.casefold() or "message sent" in response.casefold():
                value, tone = "Completed", "ready"
            else:
                value, tone = "None", "muted"
            self._set_status("WhatsApp action", value, tone)
            log_event(logger, logging.INFO, "dashboard.whatsapp_progress", "WhatsApp workflow progress updated", state=value)
        except Exception:
            logger.exception("Dashboard WhatsApp progress failed gracefully", extra={"event": "dashboard.whatsapp_progress_failed"})

    def _request_failed(self, error: str) -> None:
        self._append_chat_message("System", error, "error")
        self.request_thread = None
        if hasattr(self, "command_pipeline"):
            self.command_pipeline.clear_route()
        self._set_busy(False)
        self._set_request_state("Error")
        log_event(logger, logging.WARNING, "dashboard.request_recovered", "Dashboard displayed a friendly request error", success=False)
        self.message_input.setFocus()

    def _start_voice_request(self) -> None:
        if isinstance(self.request_thread, JarvisVoiceThread):
            self.request_thread.request_stop()
            self.voice_button.setText("Stopping…")
            self.voice_button.setEnabled(False)
            self.core_voice_button.setEnabled(False)
            self.core_voice_button.set_core_state("Stopped")
            self._append_system_message(
                "Voice conversation will stop after the current listening cycle."
            )
            return

        if (
            self.jarvis is None
            or self.speech is None
            or self.request_thread is not None
        ):
            return

        self._set_busy(True)
        if hasattr(self, "command_pipeline"):
            self.command_pipeline.set_route("Voice", "Listening")
        self._set_voice_state("Listening")
        self.voice_button.setText("Stop Voice")
        self.voice_button.setEnabled(True)
        self.core_voice_button.setEnabled(True)
        self.core_voice_button.set_core_state("Listening")
        self._append_system_message(
            "Continuous voice conversation started. Click Stop Voice to end it."
        )

        thread = JarvisVoiceThread(
            self.speech.listen,
            self.jarvis.process,
            self.speech.speak,
            max_recovery_attempts=self.speech.voice_recovery_attempts,
            recovery_delay_seconds=self.speech.voice_recovery_delay,
        )
        self.request_thread = thread
        thread.state_changed.connect(self._set_voice_state)
        thread.transcript_ready.connect(self._voice_transcript_ready)
        thread.response_ready.connect(self._voice_response_ready)
        thread.request_failed.connect(self._voice_failed)
        thread.finished.connect(self._voice_completed)
        thread.finished.connect(thread.deleteLater)
        thread.start()

    def _set_voice_state(self, state: str) -> None:
        tone = {
            "Listening": "warning",
            "Processing": "warning",
            "Speaking": "ready",
            "Idle": "muted",
            "Stopped": "muted",
        }.get(state, "muted")
        self._set_status("Voice input", state, tone)
        self._set_status("Current activity", state, tone)
        self._set_status("Voice", state, tone)
        self._set_status("Active task", "Voice conversation" if state in {"Listening", "Processing", "Speaking"} else "None", tone)
        self.core_voice_button.set_core_state(state)

    def _voice_transcript_ready(
        self,
        transcript: str,
        language: str,
    ) -> None:
        self._append_chat_message(
            f"You · voice [{language}]",
            transcript,
            "user",
        )
        if hasattr(self, "command_pipeline"):
            route = self._pipeline_route_for_text(transcript)
            self.command_pipeline.set_route(route, "Running")

    def _voice_response_ready(self, response: str) -> None:
        self._append_chat_message(
            "Jarvis",
            response or "Jarvis returned an empty response.",
            "assistant",
        )

    def _voice_failed(self, error: str) -> None:
        self._append_chat_message("Voice error", error, "error")
        self._set_status("Voice input", "Error", "error")
        self._set_status("Current activity", "Error", "error")
        self.core_voice_button.set_core_state("Error")

    def _voice_completed(self) -> None:
        failed = self.status_pills["Voice input"].text() == "Error"
        self.request_thread = None
        if hasattr(self, "command_pipeline"):
            self.command_pipeline.clear_route()
        self._set_busy(False)
        self.voice_button.setText("Voice")
        self.core_voice_button.setEnabled(True)
        if not failed:
            self.core_voice_button.set_core_state("Ready")
            self._set_status("Voice input", "Ready", "ready")
            self._set_status("Current activity", "Idle", "muted")
            self._append_system_message("Voice conversation stopped.")
        else:
            self.core_voice_button.set_core_state("Error")
        self.message_input.setFocus()

    def _append_system_message(self, text: str) -> None:
        safe_text = html.escape(text)
        self.chat_view.append(
            "<div style='color:#7F93A8; margin:8px 0;'>"
            f"{safe_text}</div>"
        )

    def _append_chat_message(
        self,
        sender: str,
        text: str,
        role: str,
        timestamp: str | None = None,
    ) -> None:
        palette = {
            "user": ("#45D8FF", "#102B3B"),
            "assistant": ("#51E6A8", "#10271F"),
            "error": ("#FF7285", "#331823"),
        }
        accent, background = palette.get(
            role,
            ("#7F93A8", "#101A25"),
        )
        safe_sender = html.escape(sender)
        safe_text = self._render_message_html(text)
        safe_time = html.escape(self._format_timestamp(timestamp))
        self.chat_view.append(
            f"<div style='background:{background}; border-left:3px solid "
            f"{accent}; padding:10px 12px; margin:8px 0;'>"
            f"<div style='color:{accent}; font-weight:700; "
            f"margin-bottom:4px;'>{safe_sender}"
            f"<span style='color:#7F93A8; font-size:10px; font-weight:400; margin-left:8px;'>{safe_time}</span></div>"
            f"<div style='color:#E9F2FA;'>{safe_text}</div></div>"
        )
        scrollbar = self.chat_view.verticalScrollBar()
        scrollbar.setValue(scrollbar.maximum())
        if role == "user":
            self.last_user_message = text
        elif role == "assistant":
            self.last_assistant_message = text

    @staticmethod
    def _render_message_html(text: str) -> str:
        """Render fenced code blocks safely while keeping ordinary text escaped."""
        parts = re.split(r"(```[\s\S]*?```)", text)
        rendered: list[str] = []
        for part in parts:
            if part.startswith("```") and part.endswith("```"):
                block = part[3:-3]
                language, separator, code = block.partition("\n")
                if not separator:
                    language, code = "code", language
                rendered.append(
                    "<div style='color:#7F93A8;font-size:10px;margin-top:8px;'>"
                    f"{html.escape(language.strip() or 'code')}</div>"
                    "<pre style='background:#050A10;border:1px solid #29445D;"
                    "padding:10px;white-space:pre-wrap;color:#E9F2FA;'>"
                    f"{html.escape(code.rstrip())}</pre>"
                )
            else:
                rendered.append(html.escape(part).replace("\n", "<br>"))
        return "".join(rendered)

    @staticmethod
    def _format_timestamp(value: str | None) -> str:
        if value:
            try:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                return parsed.astimezone().strftime("%Y-%m-%d %H:%M")
            except (ValueError, OSError):
                logger.warning("Invalid conversation timestamp", extra={"event": "dashboard.timestamp_invalid"})
        return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M")

    @staticmethod
    def _stylesheet(theme: str = "dark") -> str:
        # The dashboard reference is a fixed dark HUD theme.  Light mode still
        # keeps all functional controls available, but the command center itself
        # intentionally preserves the high-tech visual identity.
        return """
        * {
            font-family: "Segoe UI";
            color: #D9EDF8;
        }
        QMainWindow, QWidget#root {
            background: #01070B;
        }
        QWidget#corePanel {
            background: #020A10;
        }
        QFrame#sidebar {
            background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                stop:0 #02090E, stop:1 #04111A);
            border-right: 1px solid #0A4966;
        }
        QFrame#statusPanel {
            background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                stop:0 #031019, stop:1 #02080D);
            border-left: 1px solid #0A4966;
        }

        QLabel#brand {
            color: #25D7FF;
            font-size: 24px;
            font-weight: 900;
            letter-spacing: 2px;
        }
        QLabel#brandSubtitle {
            color: #A1C2D2;
            font-size: 8px;
            font-weight: 700;
            letter-spacing: 1px;
        }
        QLabel#pageTitle {
            color: #F2F5F7;
            font-size: 27px;
            font-weight: 800;
        }
        QLabel#pageSubtitle {
            color: #8AA2B3;
            font-size: 11px;
        }
        QLabel#sectionTitle, QLabel#liveTitle {
            color: #45DEFF;
            font-size: 13px;
            font-weight: 800;
        }
        QLabel#liveTitle {
            color: #50F5F1;
        }
        QLabel#groupTitle {
            color: #45DFFF;
            font-size: 11px;
            font-weight: 800;
        }
        QLabel#smallMuted, QLabel#centerMuted {
            color: #829BAA;
            font-size: 10px;
        }
        QLabel#statusLabel {
            color: #AFC3CF;
            font-size: 10px;
        }

        QPushButton#navButton, QPushButton#navActive {
            min-height: 31px;
            max-height: 31px;
            border: 1px solid transparent;
            border-radius: 8px;
            color: #AFC7D5;
            font-size: 13px;
            text-align: left;
            padding: 3px 12px;
            background: transparent;
        }
        QPushButton#navButton:hover {
            color: #E8F9FF;
            background: rgba(8, 66, 88, 80);
            border-color: #0A5774;
        }
        QPushButton#navActive {
            color: #F1FBFF;
            background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                stop:0 #07314A, stop:.55 #063454, stop:1 #03121C);
            border: 1px solid #00BFFD;
            font-weight: 700;
        }

        QLabel#modeLabel {
            color: #38F6D4;
            background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                stop:0 #07352D, stop:1 #06231F);
            border: 1px solid #00DDB2;
            border-radius: 10px;
            padding: 10px 6px;
            font-size: 11px;
            font-weight: 900;
        }

        QFrame#topModeBar {
            background: transparent;
            border: none;
        }
        QPushButton#topModeButton, QPushButton#topModeActive {
            color: #BACED8;
            background: #020A10;
            border: 1px solid #0B4963;
            padding: 7px 18px;
            font-size: 12px;
            font-weight: 800;
        }
        QPushButton#topModeActive {
            color: #25E6FF;
            background: qlineargradient(x1:0,y1:0,x2:0,y2:1,
                stop:0 #08283A, stop:1 #02111A);
            border: 1px solid #0586BC;
        }

        QFrame#headerCard {
            background: qlineargradient(x1:0,y1:0,x2:1,y2:0,
                stop:0 #07131E, stop:.75 #04101A, stop:1 #061724);
            border: 1px solid #071E2B;
            border-radius: 12px;
        }
        QFrame#pipelineCard, QFrame#conversationCard, QFrame#card, QFrame#statusGroup {
            background: qlineargradient(x1:0,y1:0,x2:0,y2:1,
                stop:0 #03111B, stop:1 #020A10);
            border: 1px solid #075779;
            border-radius: 12px;
        }
        QFrame#statusGroup {
            border-color: #0A4863;
            border-radius: 10px;
        }

        QTextBrowser#chatView, QPlainTextEdit#logsView, QPlainTextEdit {
            color: #D8EAF3;
            background: #020B12;
            border: 1px solid #075779;
            border-radius: 9px;
            padding: 8px;
            font-size: 11px;
            selection-background-color: #0A5D7B;
        }
        QLineEdit {
            color: #E8F7FD;
            background: #020B12;
            border: 1px solid #0A7397;
            border-radius: 9px;
            padding: 11px 13px;
            font-size: 12px;
        }
        QLineEdit:focus {
            border: 1px solid #15CBFF;
        }
        QLineEdit:disabled {
            color: #5D7481;
        }

        QPushButton#coreVoiceButton, QPushButton#brandCore {
            background: transparent;
            border: none;
            padding: 0;
        }
        QPushButton#coreVoiceButton:focus {
            border: 1px solid #14CFFF;
            border-radius: 34px;
        }

        QPushButton#primaryButton, QPushButton#voiceAction, QPushButton#miniButton,
        QPushButton#secondaryButton {
            border-radius: 9px;
            padding: 9px 15px;
            font-weight: 800;
            font-size: 11px;
        }
        QPushButton#primaryButton {
            color: #001017;
            background: qlineargradient(x1:0,y1:0,x2:0,y2:1,
                stop:0 #41E8FF, stop:1 #09B8F3);
            border: 1px solid #54EAFF;
        }
        QPushButton#voiceAction {
            color: #30DFFF;
            background: #031723;
            border: 1px solid #08779A;
        }
        QPushButton#miniButton, QPushButton#secondaryButton {
            color: #D6ECF7;
            background: #03131D;
            border: 1px solid #0A6383;
        }
        QPushButton#miniButton {
            padding: 7px 12px;
        }
        QPushButton:hover {
            border-color: #2ADFFF;
        }
        QPushButton:disabled {
            color: #506873;
            background: #071018;
            border-color: #16313E;
        }

        QScrollArea, QScrollArea > QWidget > QWidget {
            background: transparent;
            border: none;
        }
        QScrollBar:vertical {
            background: #031019;
            width: 7px;
            border-radius: 3px;
        }
        QScrollBar::handle:vertical {
            background: #0A84AF;
            border-radius: 3px;
            min-height: 28px;
        }
        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
            height: 0;
        }
        """


    # Command-center UI composition. These methods intentionally consume the
    # existing backend facade and never execute workflow logic themselves.
    def _build_sidebar(self) -> QWidget:
        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(242)

        layout = QVBoxLayout(sidebar)
        layout.setContentsMargins(15, 18, 14, 18)
        layout.setSpacing(6)

        # Logo row.
        logo_row = QHBoxLayout()
        logo_row.setSpacing(10)
        brand_icon = CoreVoiceButton()
        brand_icon.setObjectName("brandCore")
        brand_icon.setFixedSize(64, 64)
        brand_icon.set_core_state("Ready")
        brand_icon.setFocusPolicy(Qt.FocusPolicy.NoFocus)
        logo_row.addWidget(brand_icon)

        brand_text = QVBoxLayout()
        brand_text.setSpacing(0)
        brand = QLabel("JARVIS")
        brand.setObjectName("brand")
        subtitle = QLabel("AI COMMAND CENTER")
        subtitle.setObjectName("brandSubtitle")
        brand_text.addStretch(1)
        brand_text.addWidget(brand)
        brand_text.addWidget(subtitle)
        brand_text.addStretch(1)
        logo_row.addLayout(brand_text, 1)
        layout.addLayout(logo_row)
        layout.addSpacing(14)

        icons = ("⌂", "▣", "♩", "◉", "♪", "♧", "✓", "▤", "↻", "▰", "⚙", "〽")
        for icon, label in zip(icons, self.NAV_ITEMS):
            button = QPushButton(f"{icon}   {label}")
            button.setObjectName("navButton")
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.clicked.connect(lambda _checked=False, name=label: self._navigate(name))
            self.nav_buttons[label] = button
            layout.addWidget(button)

        layout.addStretch(1)

        mode = QLabel("⬡  ASSISTED MODE")
        mode.setObjectName("modeLabel")
        mode.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(mode)

        tagline = QLabel("Smarter. Faster. Always with You")
        tagline.setObjectName("smallMuted")
        tagline.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(tagline)

        layout.addSpacing(8)
        version = QLabel("v2.5.0")
        version.setObjectName("smallMuted")
        layout.addWidget(version)
        return sidebar


    def _build_top_mode_bar(self) -> QWidget:
        bar = QFrame()
        bar.setObjectName("topModeBar")
        bar.setFixedHeight(45)

        row = QHBoxLayout(bar)
        row.setContentsMargins(0, 0, 0, 0)
        row.setSpacing(0)
        row.addStretch(1)

        for label in ("DASHBOARD", "WORKFLOW", "TOOLS"):
            button = QPushButton(label)
            button.setObjectName("topModeActive" if label == "DASHBOARD" else "topModeButton")
            button.setCursor(Qt.CursorShape.PointingHandCursor)
            button.setFixedSize(168 if label == "DASHBOARD" else 135, 38)
            if label == "DASHBOARD":
                button.clicked.connect(lambda: self._navigate("Home"))
            elif label == "WORKFLOW":
                button.clicked.connect(lambda: self._navigate("Workflow"))
            else:
                button.clicked.connect(
                    lambda _checked=False:
                    self._notify("Tools remain available from the Jarvis command center.", "ready")
                )
            self.top_mode_buttons[label] = button
            row.addWidget(button)

        row.addStretch(1)
        return bar

    def _build_command_pages(self) -> QStackedWidget:
        stack = QStackedWidget(); stack.setObjectName("corePanel")
        builders = {
            "Home": self._build_core_panel,
            "Chat": self._build_home_page,
            "Voice": lambda: self._build_info_page("Voice", "Continuous voice session", "Start or stop hands-free conversation from Chat. Live session state is shown on the right."),
            "WhatsApp": lambda: self._build_info_page("WhatsApp", "Safe messaging workflow", "Contact resolution, draft preparation, confirmation, and sending remain owned by the existing Python workflow."),
            "TikTok": lambda: self._build_info_page("TikTok", "Production pipeline", "Monitor the existing TikTok workflow without changing its automation or publishing behavior."),
            "Memory": self._build_memory_page,
            "Tasks": lambda: self._build_info_page("Tasks", "Active and pending work", "The active request and running tools are summarized in Live Status."),
            "Logs": self._build_logs_page,
            "Updates": self._build_updates_page,
            "Backups": self._build_backups_page,
            "Settings": self._build_settings_page,
            "System Health": self._build_health_page,
        }
        for name in self.NAV_ITEMS:
            page = builders[name](); self.pages[name] = page; stack.addWidget(page)
        from .workflow import WorkflowPage
        workflow_page = WorkflowPage()
        self.pages["Workflow"] = workflow_page
        stack.addWidget(workflow_page)
        return stack

    def _page_shell(self, title_text: str, subtitle_text: str) -> tuple[QWidget, QVBoxLayout]:
        page = QWidget(); page.setObjectName("corePanel")
        layout = QVBoxLayout(page); layout.setContentsMargins(30, 24, 30, 24); layout.setSpacing(16)
        title = QLabel(title_text); title.setObjectName("pageTitle")
        subtitle = QLabel(subtitle_text); subtitle.setObjectName("pageSubtitle")
        layout.addWidget(title); layout.addWidget(subtitle)
        return page, layout

    def _build_home_page(self) -> QWidget:
        page, layout = self._page_shell("Chat", "Jarvis conversation workspace")
        card = QFrame(); card.setObjectName("card"); card_layout = QVBoxLayout(card)
        card_layout.setContentsMargins(28, 28, 28, 28)
        heading = QLabel("JARVIS CORE")
        heading.setObjectName("sectionTitle")
        heading.setAlignment(Qt.AlignmentFlag.AlignCenter)
        card_layout.addStretch(1)
        card_layout.addWidget(heading)
        note = QLabel("Use the compact Core control in Chat to start or stop the voice session. Chat, messaging, memory, tasks, logs, and health remain available from the command center.")
        note.setObjectName("centerMuted"); note.setAlignment(Qt.AlignmentFlag.AlignCenter); note.setWordWrap(True); card_layout.addWidget(note)
        open_chat = QPushButton("Open Jarvis Home  (Ctrl+K)"); open_chat.setObjectName("primaryButton")
        open_chat.clicked.connect(lambda: self._navigate("Home")); card_layout.addWidget(open_chat, 0, Qt.AlignmentFlag.AlignCenter)
        card_layout.addStretch(1)
        layout.addWidget(card, 1); return page

    def _build_info_page(self, title: str, subtitle: str, detail: str) -> QWidget:
        page, layout = self._page_shell(title, subtitle)
        card = QFrame(); card.setObjectName("card"); card_layout = QVBoxLayout(card); card_layout.setContentsMargins(22, 22, 22, 22)
        heading = QLabel(f"{title} workspace"); heading.setObjectName("sectionTitle")
        body = QLabel(detail); body.setObjectName("centerMuted"); body.setWordWrap(True)
        card_layout.addWidget(heading); card_layout.addWidget(body); card_layout.addStretch(1); layout.addWidget(card, 1)
        return page

    def _build_memory_page(self) -> QWidget:
        page, layout = self._page_shell("Memory", "Recent conversation context")
        self.memory_view = QTextBrowser(); self.memory_view.setObjectName("chatView"); layout.addWidget(self.memory_view, 1)
        refresh = QPushButton("Refresh memory"); refresh.setObjectName("secondaryButton"); refresh.clicked.connect(self._refresh_memory)
        layout.addWidget(refresh, 0, Qt.AlignmentFlag.AlignRight); return page

    def _build_logs_page(self) -> QWidget:
        page, layout = self._page_shell("Logs", "Detailed structured runtime events")
        self.logs_view = QPlainTextEdit(); self.logs_view.setObjectName("logsView"); self.logs_view.setReadOnly(True)
        layout.addWidget(self.logs_view, 1)
        refresh = QPushButton("Refresh logs  (Ctrl+L)"); refresh.setObjectName("secondaryButton"); refresh.clicked.connect(self._refresh_logs)
        layout.addWidget(refresh, 0, Qt.AlignmentFlag.AlignRight); return page

    def _build_updates_page(self) -> QWidget:
        page, layout = self._page_shell("Updates", "Verified downloads and recoverable upgrades")
        self.update_view = QPlainTextEdit(); self.update_view.setReadOnly(True); layout.addWidget(self.update_view, 1)
        self.update_button = QPushButton("Check for updates"); self.update_button.setObjectName("primaryButton"); self.update_button.clicked.connect(self._check_for_updates)
        layout.addWidget(self.update_button, 0, Qt.AlignmentFlag.AlignRight); return page

    def _build_backups_page(self) -> QWidget:
        page, layout = self._page_shell("Backups", "Protected memory, configuration, and prompts")
        self.backup_view = QPlainTextEdit(); self.backup_view.setReadOnly(True); layout.addWidget(self.backup_view, 1)
        controls = QHBoxLayout()
        self.backup_button = QPushButton("Create backup"); self.backup_button.setObjectName("primaryButton"); self.backup_button.clicked.connect(self._create_backup)
        self.restore_button = QPushButton("Restore latest"); self.restore_button.setObjectName("secondaryButton"); self.restore_button.clicked.connect(self._restore_latest_backup)
        controls.addWidget(self.backup_button); controls.addWidget(self.restore_button); controls.addStretch(1); layout.addLayout(controls)
        return page

    def _build_settings_page(self) -> QWidget:
        page, layout = self._page_shell("Settings", "Validated configuration and plugin controls")
        card = QFrame(); card.setObjectName("card"); card_layout = QVBoxLayout(card); card_layout.setContentsMargins(22, 22, 22, 22)
        card_layout.addWidget(QLabel("Theme"))
        row = QHBoxLayout()
        for label, theme in (("Dark", "dark"), ("Light", "light")):
            button = QPushButton(label); button.setObjectName("secondaryButton"); button.clicked.connect(lambda _c=False, value=theme: self._apply_theme(value)); row.addWidget(button)
        row.addStretch(1); card_layout.addLayout(row)
        shortcuts = QLabel("Ctrl+K Chat · Ctrl+L Logs · Ctrl+, Settings · Ctrl+Shift+V Voice · Esc stop voice")
        shortcuts.setObjectName("centerMuted"); shortcuts.setWordWrap(True); card_layout.addWidget(shortcuts)
        card_layout.addWidget(QLabel("Configuration diagnostics (secrets redacted)"))
        self.config_view = QPlainTextEdit(); self.config_view.setReadOnly(True); self.config_view.setMaximumHeight(145); card_layout.addWidget(self.config_view)
        card_layout.addWidget(QLabel("Plugin lifecycle"))
        self.plugin_view = QPlainTextEdit(); self.plugin_view.setReadOnly(True); self.plugin_view.setMaximumHeight(145); card_layout.addWidget(self.plugin_view)
        controls = QHBoxLayout()
        start_plugins = QPushButton("Start enabled plugins"); start_plugins.setObjectName("secondaryButton"); start_plugins.clicked.connect(self._start_plugins)
        stop_plugins = QPushButton("Stop plugins"); stop_plugins.setObjectName("secondaryButton"); stop_plugins.clicked.connect(self._stop_plugins)
        controls.addWidget(start_plugins); controls.addWidget(stop_plugins); controls.addStretch(1); card_layout.addLayout(controls)
        layout.addWidget(card, 1); return page

    def _build_health_page(self) -> QWidget:
        page, layout = self._page_shell("System Health", "Live frontend view of connected services")
        self.health_summary = QLabel("Dashboard: Ready\nBackend: connecting\nAPI: checking\nMemory: checking")
        self.health_summary.setObjectName("centerMuted"); self.health_summary.setWordWrap(True)
        card = QFrame(); card.setObjectName("card"); card_layout = QVBoxLayout(card); card_layout.setContentsMargins(22, 22, 22, 22)
        card_layout.addWidget(self.health_summary); card_layout.addStretch(1); layout.addWidget(card, 1); return page

    def _navigate(self, name: str) -> None:
        # Home owns the complete command-center UI. Chat remains a navigation
        # alias so existing shortcuts and user habits open the same workspace.
        page = self.pages.get("Home" if name == "Chat" else name)
        if page is None: return
        self.page_stack.setCurrentWidget(page)
        for label, button in self.nav_buttons.items():
            button.setObjectName("navActive" if label == name else "navButton")
            button.style().unpolish(button); button.style().polish(button)
        active_mode = "WORKFLOW" if name == "Workflow" else "DASHBOARD"
        for label, button in self.top_mode_buttons.items():
            button.setObjectName("topModeActive" if label == active_mode else "topModeButton")
            button.style().unpolish(button); button.style().polish(button)
        if name == "Logs": self._refresh_logs()
        elif name == "Memory": self._refresh_memory()
        elif name in {"Updates", "Backups"}: self._refresh_deployment_pages()
        elif name in {"Settings", "System Health"}: self._refresh_configuration_and_plugins()
        log_event(logger, logging.INFO, "dashboard.navigation", "Command Center page selected", page=name)

    def _install_shortcuts(self) -> None:
        self.shortcuts = []
        for sequence, callback in (
            ("Ctrl+K", lambda: (self._navigate("Chat"), self.message_input.setFocus())),
            ("Ctrl+L", lambda: self._navigate("Logs")),
            ("Ctrl+,", lambda: self._navigate("Settings")),
            ("Ctrl+Shift+V", self._start_voice_request),
            ("Escape", self._stop_voice_shortcut),
        ):
            shortcut = QShortcut(QKeySequence(sequence), self); shortcut.activated.connect(callback); self.shortcuts.append(shortcut)

    def _stop_voice_shortcut(self) -> None:
        if isinstance(self.request_thread, JarvisVoiceThread): self._start_voice_request()

    def _copy_last_response(self) -> None:
        if not self.last_assistant_message:
            self._notify("No assistant response to copy.", "warning"); return
        QApplication.clipboard().setText(self.last_assistant_message)
        self._notify("Last response copied.", "ready")

    def _regenerate_last_response(self) -> None:
        if not self.last_user_message or self.request_thread is not None:
            self._notify("No message is available to regenerate.", "warning"); return
        self._navigate("Chat"); self.message_input.setText(self.last_user_message); self._submit_message()

    def _notify(self, message: str, tone: str = "ready") -> None:
        self.notification_label.setText(message); self.notification_label.setProperty("tone", tone); self.notification_label.show()
        QTimer.singleShot(4500, self.notification_label.hide)

    def _restart_application(self) -> None:
        project_root = str(Path(__file__).resolve().parents[1])
        arguments = [] if getattr(sys, "frozen", False) else [
            "-X", "utf8", "-m", "jarvis.dashboard",
        ]
        result = QProcess.startDetached(sys.executable, arguments, project_root)
        started = result[0] if isinstance(result, tuple) else bool(result)
        if not started:
            self._notify("Jarvis could not restart. Please restart it manually.", "error")
            return
        QApplication.quit()

    def _refresh_memory(self) -> None:
        try:
            from .memory import memory
            messages = memory.get_recent_messages()
            self.memory_view.setPlainText("\n\n".join(f"{m.get('role', 'unknown').upper()} · {m.get('created_at', '')}\n{m.get('content', '')}" for m in messages) or "No saved conversation yet.")
            self._set_status("Memory", f"{len(messages)} turns", "ready")
        except Exception:
            logger.exception("Dashboard memory view failed", extra={"event": "dashboard.memory_view_failed"})
            self.memory_view.setPlainText("Memory is temporarily unavailable."); self._set_status("Memory", "Error", "error")

    def _refresh_logs(self) -> None:
        try:
            from observability import LOG_FILE
            lines = LOG_FILE.read_text(encoding="utf-8", errors="replace").splitlines()[-300:]
            self.logs_view.setPlainText("\n".join(lines) or "No structured events recorded yet.")
        except (OSError, ImportError, AttributeError):
            logger.exception("Dashboard logs view failed", extra={"event": "dashboard.logs_view_failed"})
            self.logs_view.setPlainText("Logs are temporarily unavailable.")

    def _refresh_skill_status(self) -> None:
        try:
            orchestrator = getattr(self.jarvis, "orchestrator", None)
            registry = getattr(orchestrator, "skills", None)
            if registry is None:
                raise AttributeError("skills registry unavailable")
            snapshot = registry.snapshot()
            loaded = snapshot.get("loaded", [])
            active = snapshot.get("active") or "None"
            failed = snapshot.get("failed") or "None"
            self._set_status("Loaded skills", str(len(loaded)), "ready" if loaded else "warning")
            self._set_status("Active skill", active, "warning" if active != "None" else "muted")
            self._set_status("Failed skill", failed, "error" if failed != "None" else "muted")
        except (AttributeError, TypeError):
            self._set_status("Loaded skills", "Unavailable", "error")
            self._set_status("Active skill", "None", "muted")

    def _refresh_deployment_pages(self) -> None:
        try:
            from . import config
            from . import __version__

            notifications = list(getattr(self.jarvis, "notifications", [])) if self.jarvis else []
            self.update_view.setPlainText(
                f"Installed version: {__version__}\nManifest: {config.JARVIS_UPDATE_MANIFEST_URL or 'Not configured'}\n"
                + ("\n".join(notifications[-10:]) if notifications else "No update notifications.")
            )
            backups = sorted(config.BACKUPS_DIR.glob("jarvis-*.zip"), reverse=True)
            self.backup_view.setPlainText("\n".join(str(path) for path in backups[:20]) or "No backups created yet.")
        except Exception:
            logger.exception("Deployment pages failed to refresh", extra={"event": "dashboard.deployment_refresh_failed"})

    def _run_maintenance(self, action: Callable[[], str]) -> None:
        if self.maintenance_thread is not None:
            self._notify("Another maintenance operation is already running.", "warning"); return
        for button in (self.update_button, self.backup_button, self.restore_button): button.setEnabled(False)
        thread = DashboardActionThread(action); self.maintenance_thread = thread
        thread.completed.connect(lambda message: self._notify(message, "ready"))
        thread.failed.connect(lambda message: self._notify(message, "error"))
        thread.finished.connect(self._maintenance_finished)
        thread.finished.connect(thread.deleteLater)
        thread.start()

    def _maintenance_finished(self) -> None:
        self.maintenance_thread = None
        for button in (self.update_button, self.backup_button, self.restore_button): button.setEnabled(True)
        self._refresh_deployment_pages()

    def _check_for_updates(self) -> None:
        if self.jarvis is None: return
        from . import config
        def action():
            manifest = self.jarvis.updates.check(config.JARVIS_UPDATE_MANIFEST_URL)
            return "Jarvis is up to date." if manifest is None else f"Jarvis {manifest.version} is available. Download requires explicit approval."
        self._run_maintenance(action)

    def _create_backup(self) -> None:
        if self.jarvis is None: return
        self._run_maintenance(lambda: f"Backup created: {self.jarvis.backups.create_backup('manual').name}")

    def _restore_latest_backup(self) -> None:
        if self.jarvis is None: return
        from . import config
        backups = sorted(config.BACKUPS_DIR.glob("jarvis-*.zip"), reverse=True)
        if not backups:
            self._notify("No backup is available to restore.", "warning"); return
        if not show_confirmation(self,"Restore backup",f"Restore {backups[0].name}? Current memory and settings will be replaced.","Restore","Cancel",destructive=True): return
        self._run_maintenance(lambda: "Backup restored. Restart Jarvis." if self.jarvis.backups.restore(backups[0]) else "Restore failed.")

    def _refresh_configuration_and_plugins(self) -> None:
        try:
            report = self.jarvis.config_report
            safe = report.safe_summary()
            issues = safe.pop("issues")
            lines = [f"{key}: {value}" for key, value in safe.items()]
            lines.extend(f"[{item['severity'].upper()}] {item['key']}: {item['message']}" for item in issues)
            self.config_view.setPlainText("\n".join(lines))
            states = self.jarvis.plugins.snapshot()
            self.plugin_view.setPlainText("\n".join(
                f"{name}: {state['phase']}" + (f" ({state['error']})" if state['error'] else "")
                for name, state in states.items()
            ) or "No plugins registered.")
            failed = sum(1 for state in states.values() if state["phase"] == "failed")
            self.health_summary.setText(
                f"Dashboard: Ready\nConfiguration: {'Valid' if report.valid else 'Needs attention'}\n"
                f"Plugins: {len(states) - failed} healthy, {failed} failed\nSecrets: Redacted"
            )
        except (AttributeError, TypeError):
            self.config_view.setPlainText("Configuration diagnostics are unavailable.")
            self.plugin_view.setPlainText("Plugin manager is unavailable.")

    def _start_plugins(self) -> None:
        if self.jarvis is None: return
        results = self.jarvis.plugins.start_all()
        self._refresh_configuration_and_plugins()
        self._notify(f"Started {sum(results.values())} plugin(s).", "ready" if all(results.values()) else "warning")

    def _stop_plugins(self) -> None:
        if self.jarvis is None: return
        results = self.jarvis.plugins.stop_all()
        self._refresh_configuration_and_plugins()
        self._notify(f"Stopped {sum(results.values())} plugin(s).", "ready" if all(results.values()) else "warning")

    def closeEvent(self, event) -> None:  # noqa: N802 - Qt API name
        if hasattr(self, "skill_status_timer"):
            self.skill_status_timer.stop()

        if (
            self.speech_preload_thread is not None
            and self.speech_preload_thread.isRunning()
        ):
            self.speech_preload_thread.requestInterruption()

        worker = self.request_thread
        if isinstance(worker, JarvisVoiceThread):
            worker.request_stop()
        elif isinstance(worker, JarvisRequestThread):
            worker.cancel()
        if worker is not None and worker.isRunning():
            log_event(logger, logging.INFO, "dashboard.worker_cancelled", "Dashboard requested background worker cancellation during close", worker_type=type(worker).__name__)
        if self.maintenance_thread is not None and self.maintenance_thread.isRunning():
            self.maintenance_thread.requestInterruption()
            log_event(logger, logging.INFO, "dashboard.maintenance_cancelled", "Dashboard requested maintenance cancellation during close")
        if self.jarvis is not None:
            try:
                self.jarvis.shutdown()
            except Exception:
                logger.exception("Dashboard plugin shutdown failed gracefully", extra={"event": "dashboard.shutdown_failed"})
        super().closeEvent(event)

    def _apply_theme(self, theme: str) -> None:
        self.theme_name = theme if theme in {"dark", "light"} else "dark"
        self.setStyleSheet(self._stylesheet(self.theme_name)); self._notify(f"{self.theme_name.title()} theme applied.")

    def resizeEvent(self, event) -> None:  # noqa: N802 - Qt API name
        super().resizeEvent(event); self._apply_responsive_layout()

    def _apply_responsive_layout(self) -> None:
        if not hasattr(self, "status_panel"): return
        compact = self.width() < 1280
        self.status_panel.setVisible(not compact)
        self.sidebar.setFixedWidth(196 if self.width() < 1180 else 242)


def main() -> None:
    app = QApplication.instance() or QApplication(sys.argv)
    app.setApplicationName("Jarvis Control Center")
    JarvisDialogStyle.install(app)
    window = DashboardWindow()
    window.show()
    raise SystemExit(app.exec())


if __name__ == "__main__":
    main()
