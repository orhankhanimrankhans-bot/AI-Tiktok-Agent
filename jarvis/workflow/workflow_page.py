"""Functional, original Jarvis workflow-builder page for the desktop UI."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import json

from PySide6.QtCore import QPointF, QRectF, QThread, QTimer, Qt, Signal
from PySide6.QtGui import QColor, QBrush, QFont, QKeySequence, QPainter, QPainterPath, QPen, QShortcut
from PySide6.QtWidgets import (
    QAbstractItemView, QComboBox, QDialog, QDialogButtonBox, QFileDialog, QFormLayout, QFrame, QGraphicsItem,
    QGraphicsObject, QGraphicsScene, QGraphicsView, QGridLayout, QHBoxLayout,
    QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox, QPlainTextEdit, QPushButton, QStackedWidget,
    QTableWidget, QTableWidgetItem, QTextEdit, QTreeWidget, QTreeWidgetItem,
    QVBoxLayout, QWidget,
)

from .executor import WorkflowExecutor
from .connector_registry import build_default_registry
from .models import WorkflowConnection, WorkflowDefinition, WorkflowNodeData
from .node_config_panel import NodeConfigDialog
from .node_editor import NodeEditorDialog
from .schedule_editor import ScheduleTriggerEditor
from .node_picker import NodePickerPanel
from .providers import ProviderIconRegistry
from .storage import ExecutionStore, WorkflowStore
from .scheduler import schedule_event, schedule_trigger
from ..dialogs import JarvisDialogStyle,get_open_file_name,show_confirmation


NODE_CATEGORIES = {
    "Triggers": ["Manual Trigger", "Schedule", "Webhook", "File Added", "Message Received"],
    "Jarvis": ["Ask Jarvis", "Memory", "Voice Command", "Tool Call"],
    "Social": ["WhatsApp", "TikTok", "Facebook", "YouTube"],
    "Data": ["Upload File", "Website", "HTTP Request", "JSON", "Text"],
    "Logic": ["If / Else", "Delay", "Filter", "Merge", "Loop"],
}


class WorkflowNode(QGraphicsObject):
    """Movable workflow node with input/output connectors."""

    moved = Signal()
    edit_requested = Signal(object)
    add_requested = Signal(object)
    port_drag_started = Signal(str,object)
    port_drag_moved = Signal(object)
    port_drag_ended = Signal(str,object)

    def __init__(self, data: WorkflowNodeData) -> None:
        super().__init__()
        self.data = data
        self.setPos(data.x, data.y)
        self.setFlags(
            QGraphicsItem.GraphicsItemFlag.ItemIsMovable
            | QGraphicsItem.GraphicsItemFlag.ItemIsSelectable
            | QGraphicsItem.GraphicsItemFlag.ItemSendsGeometryChanges
        )
        self.setAcceptHoverEvents(True)
        self._hovered = False
        self._port_press = False; self._port_dragging = False; self._press_scene_pos = QPointF()

    def boundingRect(self) -> QRectF:  # noqa: N802
        return QRectF(0, 0, 190, 76)

    def input_point(self) -> QPointF:
        return self.mapToScene(QPointF(0, 38))

    def output_point(self) -> QPointF:
        return self.mapToScene(QPointF(190, 38))

    def paint(self, painter: QPainter, option, widget=None) -> None:
        del option, widget
        rect = self.boundingRect()
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        painter.setBrush(QColor("#24292E") if not self.isSelected() else QColor("#263940"))
        state_colors={"running":"#E5BD45","waiting":"#E5BD45","success":"#43D58A","failed":"#F06464","not_configured":"#68727A"}
        border = "#23D7FF" if self.isSelected() or self._hovered else state_colors.get(self.data.status,"#454C53")
        painter.setPen(QPen(QColor(border), 1.5))
        painter.drawRoundedRect(rect, 10, 10)
        painter.setBrush(QColor("#152D34")); painter.setPen(Qt.PenStyle.NoPen)
        painter.drawRoundedRect(QRectF(13, 16, 42, 42), 9, 9)
        provider=str(self.data.settings.get("provider") or ("google_drive" if self.data.type.startswith("google_drive") else self.data.type.split("_")[0]))
        icon=ProviderIconRegistry.icon(provider,self.data.type); painter.drawPixmap(QRectF(16,19,36,36).toRect(),icon.pixmap(36,36))
        painter.setPen(QColor("#F3F5F7")); painter.setFont(QFont("Segoe UI", 10, QFont.Weight.DemiBold))
        painter.drawText(QRectF(67, 14, 108, 25), Qt.AlignmentFlag.AlignVCenter, self.data.title)
        painter.setPen(QColor("#9AA3AB")); painter.setFont(QFont("Segoe UI", 8))
        painter.drawText(QRectF(67, 38, 108, 22), Qt.AlignmentFlag.AlignVCenter, f"{self.data.subtitle} · {self.data.status.replace('_',' ').title()}")
        painter.setBrush(QColor("#23D7FF")); painter.setPen(QPen(QColor("#101315"), 2))
        if not self.data.type.endswith("trigger"): painter.drawEllipse(QPointF(0, 38), 6 if self._hovered else 5, 6 if self._hovered else 5)
        painter.drawEllipse(QPointF(190, 38), 7, 7)
        painter.setPen(QColor("#071014")); painter.setFont(QFont("Segoe UI",8,QFont.Weight.Bold)); painter.drawText(QRectF(184,31,12,14),Qt.AlignmentFlag.AlignCenter,"+")

    def hoverEnterEvent(self, event) -> None:  # noqa: N802
        self._hovered = True; self.update(); super().hoverEnterEvent(event)

    def hoverLeaveEvent(self, event) -> None:  # noqa: N802
        self._hovered = False; self.update(); super().hoverLeaveEvent(event)

    def itemChange(self, change, value):  # noqa: N802
        if change == QGraphicsItem.GraphicsItemChange.ItemPositionHasChanged:
            self.data.x, self.data.y = self.pos().x(), self.pos().y()
            self.moved.emit()
        return super().itemChange(change, value)

    def mouseDoubleClickEvent(self, event) -> None:  # noqa: N802
        self.edit_requested.emit(self.data); super().mouseDoubleClickEvent(event)

    def mousePressEvent(self,event) -> None:  # noqa: N802
        if (event.pos()-QPointF(190,38)).manhattanLength() <= 16:
            self._port_press=True; self._port_dragging=False; self._press_scene_pos=event.scenePos(); event.accept(); return
        super().mousePressEvent(event)

    def mouseMoveEvent(self,event) -> None:  # noqa: N802
        if self._port_press:
            if not self._port_dragging and (event.scenePos()-self._press_scene_pos).manhattanLength()>6:
                self._port_dragging=True; self.port_drag_started.emit(self.data.id,self.output_point())
            if self._port_dragging: self.port_drag_moved.emit(event.scenePos())
            event.accept(); return
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self,event) -> None:  # noqa: N802
        if self._port_press:
            if self._port_dragging: self.port_drag_ended.emit(self.data.id,event.scenePos())
            else: self.add_requested.emit(self.data)
            self._port_press=False; self._port_dragging=False; event.accept(); return
        super().mouseReleaseEvent(event)


class WorkflowCanvas(QGraphicsView):
    """Dotted, zoomable graphics canvas with live connection painting."""
    delete_requested = Signal()
    connection_requested = Signal(str,str)

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setScene(QGraphicsScene(self))
        self.scene().setSceneRect(-1200, -800, 2400, 1600)
        self.setRenderHints(QPainter.RenderHint.Antialiasing | QPainter.RenderHint.TextAntialiasing)
        self.setDragMode(QGraphicsView.DragMode.RubberBandDrag)
        self.setTransformationAnchor(QGraphicsView.ViewportAnchor.AnchorUnderMouse)
        self.setFrameShape(QFrame.Shape.NoFrame)
        self.setStyleSheet("background:#151719; border:1px solid #353A40; border-radius:10px;")
        self.nodes: dict[str, WorkflowNode] = {}
        self.connections = []
        self._preview_source=None; self._preview_end=None

    def drawBackground(self, painter: QPainter, rect: QRectF) -> None:  # noqa: N802
        painter.fillRect(rect, QColor("#151719"))
        painter.setPen(Qt.PenStyle.NoPen); painter.setBrush(QColor(71, 80, 87, 75))
        spacing = 24
        left = int(rect.left()) - (int(rect.left()) % spacing)
        top = int(rect.top()) - (int(rect.top()) % spacing)
        for x in range(left, int(rect.right()) + spacing, spacing):
            for y in range(top, int(rect.bottom()) + spacing, spacing):
                painter.drawEllipse(QPointF(x, y), 1, 1)

    def drawForeground(self, painter: QPainter, rect: QRectF) -> None:  # noqa: N802
        del rect
        painter.setRenderHint(QPainter.RenderHint.Antialiasing)
        for connection in self.connections:
            source, target = self.nodes.get(connection.source), self.nodes.get(connection.target)
            if source is None or target is None:
                continue
            start, end = source.output_point(), target.input_point()
            path = QPainterPath(start)
            distance = max(65.0, abs(end.x() - start.x()) * .45)
            path.cubicTo(start + QPointF(distance, 0), end - QPointF(distance, 0), end)
            painter.setPen(QPen(QColor(35, 215, 255, 55), 6)); painter.drawPath(path)
            color={"running":"#E5BD45","success":"#43D58A","failed":"#F06464"}.get(source.data.status,"#5F9EAC")
            painter.setPen(QPen(QColor(color), 2)); painter.drawPath(path)
        if self._preview_source is not None and self._preview_end is not None:
            start,end=self._preview_source,self._preview_end; distance=max(65.0,abs(end.x()-start.x())*.45); path=QPainterPath(start); path.cubicTo(start+QPointF(distance,0),end-QPointF(distance,0),end)
            painter.setPen(QPen(QColor("#23D7FF"),2,Qt.PenStyle.DashLine)); painter.drawPath(path)

    def begin_connection(self,source_id,start) -> None:
        self._preview_source=start; self._preview_end=start; self.viewport().update()
    def move_connection(self,end) -> None:
        self._preview_end=end; self.viewport().update()
    def end_connection(self,source_id,end) -> None:
        target=next((node_id for node_id,item in self.nodes.items() if (item.input_point()-end).manhattanLength()<=24),None)
        self._preview_source=None; self._preview_end=None; self.viewport().update()
        if target and target!=source_id: self.connection_requested.emit(source_id,target)

    def load_workflow(self, workflow: WorkflowDefinition) -> None:
        self.scene().clear(); self.nodes.clear(); self.connections = workflow.connections
        for data in workflow.nodes:
            node = WorkflowNode(data); node.moved.connect(self.scene().update)
            self.nodes[data.id] = node; self.scene().addItem(node)

    def zoom_in(self) -> None:
        self.scale(1.15, 1.15)

    def zoom_out(self) -> None:
        self.scale(1 / 1.15, 1 / 1.15)

    def fit_workflow(self) -> None:
        items = list(self.nodes.values())
        if items:
            self.fitInView(self.scene().itemsBoundingRect().adjusted(-80, -80, 80, 80), Qt.AspectRatioMode.KeepAspectRatio)
        else:
            self.resetTransform(); self.centerOn(0, 0)

    def set_pan_mode(self) -> None:
        next_mode = self.dragMode() != QGraphicsView.DragMode.ScrollHandDrag
        self.setDragMode(QGraphicsView.DragMode.ScrollHandDrag if next_mode else QGraphicsView.DragMode.RubberBandDrag)

    def wheelEvent(self, event) -> None:  # noqa: N802
        self.scale(1.15, 1.15) if event.angleDelta().y() > 0 else self.scale(1 / 1.15, 1 / 1.15); event.accept()

    def keyPressEvent(self, event) -> None:  # noqa: N802
        if event.key() == Qt.Key.Key_Delete: self.delete_requested.emit(); event.accept(); return
        super().keyPressEvent(event)


class NodeSelectionDialog(QDialog):
    def __init__(self, parent=None) -> None:
        super().__init__(parent); self.setObjectName("nodeSelectionDialog"); self.setWindowTitle("Add workflow node"); self.resize(500, 600)
        layout = QVBoxLayout(self); layout.setContentsMargins(18, 18, 18, 16); layout.setSpacing(12)
        title = QLabel("Choose a Jarvis workflow step"); title.setObjectName("nodeDialogTitle"); layout.addWidget(title)
        hint = QLabel("Select a step below. Facebook is available inside Social."); hint.setObjectName("nodeDialogHint"); layout.addWidget(hint)
        self.tree = QTreeWidget(); self.tree.setObjectName("nodeTree"); self.tree.setHeaderHidden(True); self.tree.setIndentation(22)
        for category, names in NODE_CATEGORIES.items():
            root = QTreeWidgetItem([category])
            for name in names: root.addChild(QTreeWidgetItem([name]))
            self.tree.addTopLevelItem(root)
        self.tree.expandAll()
        self.tree.itemDoubleClicked.connect(lambda item, _column: self.accept() if item.parent() else None)
        layout.addWidget(self.tree)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Ok)
        self.add_button = buttons.button(QDialogButtonBox.StandardButton.Ok); self.add_button.setText("Add Node"); self.add_button.setEnabled(False)
        buttons.button(QDialogButtonBox.StandardButton.Cancel).setText("Cancel")
        self.tree.currentItemChanged.connect(lambda item, _previous: self.add_button.setEnabled(bool(item and item.parent())))
        buttons.accepted.connect(self.accept); buttons.rejected.connect(self.reject); layout.addWidget(buttons)
        self.setStyleSheet("""
            QDialog#nodeSelectionDialog { background:#15191D; color:#F3F5F7; }
            QLabel#nodeDialogTitle { color:#F3F5F7; font-size:18px; font-weight:700; }
            QLabel#nodeDialogHint { color:#9AA3AB; font-size:11px; }
            QTreeWidget#nodeTree { background:#101417; color:#DCE4E8; border:1px solid #3A4249; border-radius:8px; padding:8px; outline:0; }
            QTreeWidget#nodeTree::item { min-height:30px; border-radius:5px; padding:2px 6px; }
            QTreeWidget#nodeTree::item:hover { background:#222C31; color:#FFFFFF; }
            QTreeWidget#nodeTree::item:selected { background:#17576A; color:#FFFFFF; }
            QDialogButtonBox QPushButton { min-width:92px; padding:8px 14px; color:#F3F5F7; background:#252B30; border:1px solid #48525A; border-radius:7px; }
            QDialogButtonBox QPushButton:hover { border-color:#23D7FF; }
            QDialogButtonBox QPushButton:disabled { color:#667078; background:#1B1F22; border-color:#30363B; }
        """)
        JarvisDialogStyle.apply(self)

    def selected_node(self) -> tuple[str, str] | None:
        item = self.tree.currentItem()
        return (item.parent().text(0), item.text(0)) if item and item.parent() else None


class JarvisAIDialog(QDialog):
    def __init__(self, parent=None) -> None:
        super().__init__(parent); self.setWindowTitle("Build a workflow with Jarvis"); self.resize(520, 250); JarvisDialogStyle.apply(self)
        layout = QVBoxLayout(self); layout.addWidget(QLabel("Build a workflow with Jarvis"))
        self.prompt = QTextEdit(); self.prompt.setPlaceholderText("Describe what you want Jarvis to automate...")
        self.prompt.setPlainText("Every morning create a TikTok video and prepare it for publishing.")
        layout.addWidget(self.prompt)
        buttons = QDialogButtonBox(); cancel = buttons.addButton("Cancel", QDialogButtonBox.ButtonRole.RejectRole)
        generate = buttons.addButton("Generate Workflow", QDialogButtonBox.ButtonRole.AcceptRole)
        cancel.clicked.connect(self.reject); generate.clicked.connect(self.accept); layout.addWidget(buttons)


class ExecutionThread(QThread):
    completed = Signal(object); log_line = Signal(str); node_status = Signal(str,str)
    def __init__(self, workflow: WorkflowDefinition, store: ExecutionStore, initial_input=None, jarvis_process=None) -> None:
        super().__init__(); self.workflow = workflow; self.store = store; self.initial_input = initial_input or {}; self.jarvis_process=jarvis_process
    def run(self) -> None:
        executor = WorkflowExecutor(store=self.store, logger=self.log_line.emit, jarvis_process=self.jarvis_process,status_callback=self.node_status.emit)
        self.completed.emit(executor.run(self.workflow, self.initial_input))


class FacebookNodeDialog(QDialog):
    """Edits safe Facebook settings and runs a real adapter-backed Test Step."""
    OPERATIONS = (("Test Connection", "test_connection"), ("List Pages", "list_pages"), ("Get Page Information", "get_page_info"), ("Create Page Post", "create_page_post"), ("Upload Page Video", "upload_page_video"), ("Check Video Status", "check_video_status"))
    def __init__(self, node: WorkflowNodeData, store: ExecutionStore, parent=None) -> None:
        super().__init__(parent); self.node = node; self.store = store; self.worker = None; JarvisDialogStyle.apply(self)
        self.setWindowTitle("Facebook Graph API Node"); self.resize(600, 590); layout = QVBoxLayout(self)
        form = QFormLayout(); self.credential = QLineEdit(str(node.settings.get("credential_id", "facebook_default")))
        self.operation = QComboBox()
        for label, value in self.OPERATIONS: self.operation.addItem(label, value)
        index = self.operation.findData(node.settings.get("operation", "get_page_info")); self.operation.setCurrentIndex(max(0, index))
        self.page_id = QLineEdit(str(node.settings.get("page_id", ""))); self.page_id.setPlaceholderText("Real Facebook Page ID")
        self.message = QLineEdit(str(node.settings.get("message", "{{$json.caption}}"))); self.message.setPlaceholderText("{{$json.caption}}")
        video_row = QHBoxLayout(); self.video_path = QLineEdit(str(node.settings.get("video_path", "{{$json.video_path}}")))
        browse = QPushButton("Browse"); browse.clicked.connect(self._browse); video_row.addWidget(self.video_path); video_row.addWidget(browse)
        self.description = QLineEdit(str(node.settings.get("description", "{{$json.caption}}")))
        self.publish_id = QLineEdit(str(node.settings.get("publish_id", "{{$json.publish_id}}")))
        form.addRow("Credential ID", self.credential); form.addRow("Operation", self.operation); form.addRow("Page", self.page_id)
        form.addRow("Message", self.message); form.addRow("Video file", video_row); form.addRow("Description", self.description); form.addRow("Publish ID", self.publish_id); layout.addLayout(form)
        self.test_button = QPushButton("Test Step — Real Meta API"); self.test_button.clicked.connect(self.test_step); layout.addWidget(self.test_button)
        layout.addWidget(QLabel("OUTPUT")); self.output = QPlainTextEdit(); self.output.setReadOnly(True); layout.addWidget(self.output, 1)
        buttons = QDialogButtonBox(QDialogButtonBox.StandardButton.Cancel | QDialogButtonBox.StandardButton.Save)
        buttons.accepted.connect(self._save_and_accept); buttons.rejected.connect(self.reject); layout.addWidget(buttons)

    def _browse(self) -> None:
        path, _ = get_open_file_name(self, "Select Facebook video", "", "Videos (*.mp4 *.mov *.mkv *.avi)")
        if path: self.video_path.setText(path)

    def settings(self) -> dict:
        return {"connector": "facebook", "credential_id": self.credential.text().strip() or "facebook_default", "operation": self.operation.currentData(), "page_id": self.page_id.text().strip(), "message": self.message.text(), "video_path": self.video_path.text(), "description": self.description.text(), "publish_id": self.publish_id.text()}

    def _save_and_accept(self) -> None:
        self.node.type = "facebook"; self.node.settings = self.settings(); self.accept()

    def test_step(self) -> None:
        self.node.type = "facebook"; self.node.settings = self.settings(); self.test_button.setEnabled(False); self.output.setPlainText("Calling Meta Graph API...")
        trigger=WorkflowNodeData("facebook_test_trigger","manual_trigger","Manual Trigger")
        test_workflow = WorkflowDefinition(name="Facebook Test", nodes=[trigger,self.node], connections=[WorkflowConnection(trigger.id,self.node.id)])
        self.worker = ExecutionThread(test_workflow, self.store, {"caption": "Jarvis workflow test", "video_path": ""})
        self.worker.completed.connect(self._show_test_result); self.worker.finished.connect(lambda: self.test_button.setEnabled(True)); self.worker.start()

    def _show_test_result(self, record) -> None:
        payload = record.node_results[-1] if record.node_results else {"status": record.status, "errors": record.errors}
        self.output.setPlainText(json.dumps(payload, indent=2, ensure_ascii=False))


class WorkflowPage(QWidget):
    """Integrated Jarvis Workflow editor, history and evaluation workspace."""

    def __init__(self, parent=None, storage_path: Path | None = None) -> None:
        super().__init__(parent); self.setObjectName("workflowPage")
        self.storage_path = storage_path or Path(__file__).resolve().parents[2] / "data" / "workflows" / "my_workflow.json"
        self.execution_store = ExecutionStore(self.storage_path.parent / "executions")
        self.run_thread = None
        self.test_thread = None
        self.dirty = False
        self.jarvis_process = None
        self.registry = build_default_registry(None, Path(__file__).resolve().parents[2])
        self._last_schedule_slot = None
        self._add_after_node_id = None
        try: self.workflow = WorkflowStore.load(self.storage_path)
        except (OSError, ValueError, TypeError): self.workflow = WorkflowDefinition()
        self.tab_buttons = {}; self._build_ui(); self._install_shortcuts(); self.canvas.load_workflow(self.workflow); self._wire_node_edit_signals(); self._update_empty_state(); self.show_tab("EDITOR")
        self.schedule_timer = QTimer(self); self.schedule_timer.setInterval(1_000); self.schedule_timer.timeout.connect(self._check_schedule); self.schedule_timer.start()

    def _build_ui(self) -> None:
        outer = QVBoxLayout(self); outer.setContentsMargins(18, 12, 18, 14); outer.setSpacing(10)
        header = QFrame(); header.setObjectName("workflowHeader"); row = QHBoxLayout(header); row.setContentsMargins(14, 9, 14, 9)
        logo = QLabel("Ⓙ⟷"); logo.setObjectName("workflowLogo"); row.addWidget(logo)
        identity = QVBoxLayout(); crumb = QLabel("Jarvis / Workflow"); crumb.setObjectName("workflowCrumb")
        self.name_input = QLineEdit(self.workflow.name); self.name_input.setObjectName("workflowName"); self.name_input.editingFinished.connect(self._sync_name)
        identity.addWidget(crumb); identity.addWidget(self.name_input); row.addLayout(identity); row.addStretch(1)
        for label in ("EDITOR", "EXECUTIONS", "EVALUATIONS"):
            button = QPushButton(label); button.setObjectName("workflowTab"); button.clicked.connect(lambda _c=False, name=label: self.show_tab(name))
            self.tab_buttons[label] = button; row.addWidget(button)
        row.addStretch(1)
        for label, handler, object_name in (("▶ Run Workflow", self.run_workflow, "workflowAction"), ("Save", self.save_workflow, "workflowAction"), ("Publish", self.publish_workflow, "workflowPublish")):
            button = QPushButton(label); button.setObjectName(object_name); button.clicked.connect(handler); row.addWidget(button)
        outer.addWidget(header)
        self.stack = QStackedWidget(); self.editor_page = self._build_editor(); self.executions_page = self._build_executions(); self.evaluations_page = self._build_evaluations()
        for page in (self.editor_page, self.executions_page, self.evaluations_page): self.stack.addWidget(page)
        outer.addWidget(self.stack, 1); self.setStyleSheet(self._stylesheet())

    def _install_shortcuts(self) -> None:
        self.shortcuts=[]
        for sequence,callback in (("Ctrl+S",self.save_workflow),("Ctrl+0",self.canvas.fit_workflow),("Ctrl++",self.canvas.zoom_in),("Ctrl+-",self.canvas.zoom_out),("Escape",self.node_picker.hide)):
            shortcut=QShortcut(QKeySequence(sequence),self); shortcut.activated.connect(callback); self.shortcuts.append(shortcut)

    def _build_editor(self) -> QWidget:
        page = QWidget(); layout = QVBoxLayout(page); layout.setContentsMargins(0, 0, 0, 0); layout.setSpacing(6)
        canvas_shell = QWidget(); grid = QGridLayout(canvas_shell); grid.setContentsMargins(0, 0, 0, 0)
        self.canvas = WorkflowCanvas(); self.canvas.delete_requested.connect(self.delete_selected); self.canvas.connection_requested.connect(self._create_connection); grid.addWidget(self.canvas, 0, 0, 2, 2)
        self.empty_state = QFrame(); self.empty_state.setObjectName("emptyWorkflow"); empty = QHBoxLayout(self.empty_state)
        add = QPushButton("＋\nAdd first step..."); add.setObjectName("emptyAction"); add.clicked.connect(self.open_node_selector)
        ai = QPushButton("Ⓙ✦\nBuild with Jarvis AI"); ai.setObjectName("emptyAction"); ai.clicked.connect(self.open_ai_builder)
        empty.addWidget(add); empty.addWidget(QLabel("or")); empty.addWidget(ai); grid.addWidget(self.empty_state, 0, 0, 2, 2, Qt.AlignmentFlag.AlignCenter)
        toolbar = QFrame(); toolbar.setObjectName("floatingToolbar"); tools = QVBoxLayout(toolbar); tools.setContentsMargins(5, 5, 5, 5)
        for icon, tip, handler in (("+", "Add node", self.open_node_selector), ("⌕", "Search nodes", self.search_nodes), ("▤", "Workflow details", self.workflow_details), ("↔", "Auto layout", self.auto_layout), ("Ⓙ", "Build with Jarvis AI", self.open_ai_builder)):
            button = QPushButton(icon); button.setObjectName("canvasTool"); button.setToolTip(tip); button.clicked.connect(handler); tools.addWidget(button)
        grid.addWidget(toolbar, 0, 1, Qt.AlignmentFlag.AlignTop | Qt.AlignmentFlag.AlignRight)
        controls = QFrame(); controls.setObjectName("canvasControls"); control_row = QHBoxLayout(controls); control_row.setContentsMargins(5, 4, 5, 4)
        for text, tip, handler in (("Fit", "Fit workflow", self.canvas.fit_workflow), ("+", "Zoom in", self.canvas.zoom_in), ("−", "Zoom out", self.canvas.zoom_out), ("✥", "Selection / pan mode", self.canvas.set_pan_mode)):
            button = QPushButton(text); button.setObjectName("canvasTool"); button.setToolTip(tip); button.clicked.connect(handler); control_row.addWidget(button)
        grid.addWidget(controls, 1, 0, Qt.AlignmentFlag.AlignBottom | Qt.AlignmentFlag.AlignLeft)
        workspace=QWidget(); workspace_row=QHBoxLayout(workspace); workspace_row.setContentsMargins(0,0,0,0); workspace_row.setSpacing(8)
        workspace_row.addWidget(canvas_shell,1)
        self.node_picker=NodePickerPanel(self.registry); self.node_picker.hide(); self.node_picker.closed.connect(self.node_picker.hide); self.node_picker.node_selected.connect(self._add_descriptor)
        workspace_row.addWidget(self.node_picker)
        layout.addWidget(workspace, 1)
        self.logs_button = QPushButton("LOGS  ▴"); self.logs_button.setObjectName("logsToggle"); self.logs_button.clicked.connect(self.toggle_logs); layout.addWidget(self.logs_button)
        self.logs = QListWidget(); self.logs.setObjectName("workflowLogs"); self.logs.setMaximumHeight(120); self.logs.addItem("Workflow ready."); layout.addWidget(self.logs)
        return page

    def _build_executions(self) -> QWidget:
        page = QWidget(); layout = QVBoxLayout(page); title = QLabel("Execution History"); title.setObjectName("workflowPageTitle"); layout.addWidget(title)
        self.execution_table = QTableWidget(0, 5); self.execution_table.setHorizontalHeaderLabels(["Execution ID", "Workflow", "Started", "Duration", "Status"])
        self.execution_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers); self.execution_table.horizontalHeader().setStretchLastSection(True); self.execution_table.cellClicked.connect(self.inspect_execution); layout.addWidget(self.execution_table, 1)
        self.execution_detail=QPlainTextEdit(); self.execution_detail.setReadOnly(True); self.execution_detail.setPlaceholderText("Select an execution to inspect node input/output and errors."); self.execution_detail.setMaximumHeight(210); layout.addWidget(self.execution_detail); return page

    def _build_evaluations(self) -> QWidget:
        page = QWidget(); layout = QVBoxLayout(page); title = QLabel("Workflow Evaluation"); title.setObjectName("workflowPageTitle"); layout.addWidget(title)
        cards = QHBoxLayout(); self.metric_labels = {}
        for heading, value in (("Workflow Health", "No runs"), ("Success Rate", "—"), ("Average Time", "—"), ("Total Runs", "0")):
            card = QFrame(); card.setObjectName("metricCard"); box = QVBoxLayout(card); box.addWidget(QLabel(heading)); metric = QLabel(value); metric.setObjectName("metricValue"); box.addWidget(metric); cards.addWidget(card)
            self.metric_labels[heading] = metric
        layout.addLayout(cards); self.recommendations = QLabel("No execution data yet.")
        self.recommendations.setObjectName("recommendations"); self.recommendations.setAlignment(Qt.AlignmentFlag.AlignTop); layout.addWidget(self.recommendations, 1); return page

    def show_tab(self, name: str) -> None:
        index = {"EDITOR": 0, "EXECUTIONS": 1, "EVALUATIONS": 2}.get(name, 0); self.stack.setCurrentIndex(index)
        for label, button in self.tab_buttons.items():
            button.setProperty("active", label == name); button.style().unpolish(button); button.style().polish(button)
        if name == "EXECUTIONS": self.refresh_executions()
        if name == "EVALUATIONS": self.refresh_evaluations()

    def _sync_name(self) -> None: self.workflow.name = self.name_input.text().removesuffix(" *").strip() or "My Workflow"
    def _log(self, text: str) -> None: self.logs.addItem(f"{datetime.now():%H:%M:%S}  {text}"); self.logs.scrollToBottom()
    def _update_empty_state(self) -> None: self.empty_state.setVisible(not self.workflow.nodes)

    def add_node(self, category: str, title: str) -> None:
        count = len(self.workflow.nodes); subtitle = category
        node = self.workflow.add_node(category.lower(), title, subtitle, -380 + (count % 4) * 240, -80 + (count // 4) * 130)
        item = WorkflowNode(node); item.moved.connect(self.canvas.scene().update); item.edit_requested.connect(self.edit_node); self.canvas.nodes[node.id] = item; self.canvas.connections = self.workflow.connections; self.canvas.scene().addItem(item)
        self._update_empty_state(); self.canvas.scene().update(); self._log(f"{title} added.")

    def open_node_selector(self) -> None:
        self._add_after_node_id=None
        self.node_picker.open_for(not self.workflow.nodes)

    def open_node_selector_after(self,node_id: str) -> None:
        self._add_after_node_id=node_id; self.node_picker.open_for(False)

    def _add_descriptor(self, descriptor) -> None:
        count=len(self.workflow.nodes)
        source=self.canvas.nodes.get(self._add_after_node_id) if self._add_after_node_id else None
        x,y=(source.data.x+250,source.data.y) if source else (-380+(count%4)*240,-80+(count//4)*130)
        node=self.workflow.add_node(descriptor.id,descriptor.name,descriptor.provider.replace("_"," ").title(),x,y)
        if source and self.workflow.connections:
            self.workflow.connections[-1].source=source.data.id
        node.settings=dict(descriptor.defaults); node.status="idle" if descriptor.implemented else "not_configured"
        item=WorkflowNode(node); item.moved.connect(self._mark_dirty); item.edit_requested.connect(self.edit_node); self.canvas.nodes[node.id]=item; self.canvas.connections=self.workflow.connections; self.canvas.scene().addItem(item)
        item.add_requested.connect(lambda data:self.open_node_selector_after(data.id)); item.setSelected(True)
        item.port_drag_started.connect(self.canvas.begin_connection); item.port_drag_moved.connect(self.canvas.move_connection); item.port_drag_ended.connect(self.canvas.end_connection)
        self.node_picker.hide(); self._add_after_node_id=None; self._mark_dirty(); self._update_empty_state(); self.canvas.scene().update(); self._log(f"{descriptor.name} added.")
        QTimer.singleShot(0,lambda:self.edit_node(node))

    def open_ai_builder(self) -> None:
        dialog = JarvisAIDialog(self)
        if dialog.exec() != QDialog.DialogCode.Accepted or not dialog.prompt.toPlainText().strip(): return
        self.workflow.nodes.clear(); self.workflow.connections.clear(); self.canvas.load_workflow(self.workflow)
        for category, title in (("Triggers", "Schedule"), ("Jarvis", "Ask Jarvis"), ("Jarvis", "Create Script"), ("Jarvis", "Generate Voice"), ("Jarvis", "Render Video"), ("Social", "TikTok")): self.add_node(category, title)
        self.auto_layout(); self._log("Jarvis AI generated a draft workflow.")

    def run_workflow(self, initial_input=None) -> None:
        if self.run_thread and self.run_thread.isRunning(): self._log("Workflow is already running."); return
        self._sync_name(); self.save_workflow(); self._log("Workflow execution started.")
        self.run_thread = ExecutionThread(self.workflow, self.execution_store,initial_input=initial_input,jarvis_process=self.jarvis_process)
        self.run_thread.log_line.connect(self._log); self.run_thread.node_status.connect(self._node_status_changed); self.run_thread.completed.connect(self._execution_finished); self.run_thread.start()

    def _node_status_changed(self,node_id: str,status: str) -> None:
        item=self.canvas.nodes.get(node_id)
        if item: item.data.status=status; item.update()
        for connection in self.workflow.connections:
            if connection.source==node_id: connection.status=status
        self.canvas.viewport().update()

    def _check_schedule(self) -> None:
        trigger = schedule_trigger(self.workflow)
        if self.workflow.status != "published" or trigger is None or (self.run_thread and self.run_thread.isRunning()):
            return
        try:
            event = schedule_event(trigger)
        except ValueError as exc:
            self._log(f"Schedule error: {exc}"); return
        if event:
            slot,payload=event
        else:
            slot,payload=None,None
        if slot and slot != self._last_schedule_slot:
            self._last_schedule_slot = slot
            if trigger.settings.get("execute_once"): trigger.settings["_executed_once"]=True; self._mark_dirty()
            self._log("Scheduled workflow trigger is due.")
            self.run_workflow({"_schedule_payload":payload})

    def save_workflow(self) -> None:
        self._sync_name()
        try: WorkflowStore.save(self.workflow, self.storage_path); self.dirty=False; self.name_input.setText(self.workflow.name); self._log(f"Workflow saved to {self.storage_path.name}.")
        except OSError as exc: self._log(f"Save failed: {exc}")

    def publish_workflow(self) -> None:
        self.workflow.status = "published"; self.save_workflow(); self._log("Workflow marked as published.")

    def toggle_logs(self) -> None:
        visible = not self.logs.isVisible(); self.logs.setVisible(visible); self.logs_button.setText("LOGS  ▴" if visible else "LOGS  ▾")

    def auto_layout(self) -> None:
        for index, node in enumerate(self.workflow.nodes): node.x, node.y = -480 + (index % 4) * 270, -120 + (index // 4) * 150
        self.canvas.load_workflow(self.workflow); self._wire_node_edit_signals(); self.canvas.fit_workflow(); self._log("Workflow layout updated.")

    def search_nodes(self) -> None:
        self.open_node_selector()

    def workflow_details(self) -> None:
        self._log(f"{len(self.workflow.nodes)} nodes · {len(self.workflow.connections)} connections · {self.workflow.status}.")

    def set_jarvis_backend(self, process) -> None:
        self.jarvis_process=process; self.registry=build_default_registry(process,Path(__file__).resolve().parents[2]); self.node_picker.registry=self.registry

    def _mark_dirty(self) -> None:
        self.dirty=True
        if not self.name_input.text().endswith(" *"): self.name_input.setText(self.workflow.name+" *")

    def edit_node(self, node: WorkflowNodeData) -> None:
        descriptor=self.registry.descriptor(node.type)
        if node.type=="schedule_trigger":
            latest=getattr(self,"_latest_node_results",{}).get(node.id); dialog=ScheduleTriggerEditor(node,latest,self); dialog.test_requested.connect(lambda selected,data:self._test_editor_node(dialog,selected,data))
        elif descriptor is None:
            latest=getattr(self,"_latest_node_results",{}).get(node.id); dialog=NodeConfigDialog(node,self,latest); dialog.test_requested.connect(lambda selected:self._test_generic_node(dialog,selected))
        else:
            latest=getattr(self,"_latest_node_results",{}).get(node.id); input_data=self._input_for_node(node.id)
            dialog=NodeEditorDialog(node,descriptor,input_data,latest,self); dialog.test_requested.connect(lambda selected,data:self._test_editor_node(dialog,selected,data))
        if dialog.exec()==QDialog.DialogCode.Accepted: self._mark_dirty(); self.canvas.load_workflow(self.workflow); self._wire_node_edit_signals(); self._log(f"{node.title} configuration saved.")

    def _input_for_node(self,node_id: str) -> dict:
        latest=getattr(self,"_latest_node_results",{})
        connection=next((item for item in self.workflow.connections if item.target==node_id),None)
        if not connection: return {}
        result=latest.get(connection.source,{})
        return dict(result.get("output") or {})

    def _test_editor_node(self,dialog,node,input_data) -> None:
        if node.type in {"manual_trigger","schedule_trigger"}: test_workflow=WorkflowDefinition(name=f"Test {node.title}",nodes=[node])
        else:
            trigger=WorkflowNodeData("test_manual_trigger","manual_trigger","Manual Trigger")
            test_workflow=WorkflowDefinition(name=f"Test {node.title}",nodes=[trigger,node],connections=[WorkflowConnection(trigger.id,node.id)])
        self.test_thread=ExecutionThread(test_workflow,self.execution_store,input_data or self._input_for_node(node.id),self.jarvis_process)
        self.test_thread.log_line.connect(self._log); self.test_thread.node_status.connect(self._node_status_changed); self.test_thread.completed.connect(dialog.show_result); self.test_thread.start()

    def _test_generic_node(self, dialog, node) -> None:
        try: node.settings=json.loads(dialog.parameters.toPlainText() or "{}")
        except json.JSONDecodeError as exc: dialog.output_view.setPlainText(f"Invalid settings JSON: {exc}"); return
        dialog.test_button.setEnabled(False)
        if node.type=="manual_trigger": test_workflow=WorkflowDefinition(name=f"Test {node.title}",nodes=[node])
        else:
            trigger=WorkflowNodeData("test_manual_trigger","manual_trigger","Manual Trigger")
            test_workflow=WorkflowDefinition(name=f"Test {node.title}",nodes=[trigger,node],connections=[WorkflowConnection(trigger.id,node.id)])
        self.test_thread=ExecutionThread(test_workflow,self.execution_store,dialog.input_data(),self.jarvis_process)
        self.test_thread.completed.connect(dialog.show_result); self.test_thread.start()

    def _wire_node_edit_signals(self) -> None:
        for item in self.canvas.nodes.values():
            item.edit_requested.connect(self.edit_node); item.moved.connect(self._mark_dirty); item.add_requested.connect(lambda data:self.open_node_selector_after(data.id))
            item.port_drag_started.connect(self.canvas.begin_connection); item.port_drag_moved.connect(self.canvas.move_connection); item.port_drag_ended.connect(self.canvas.end_connection)

    def _create_connection(self,source_id: str,target_id: str) -> None:
        target_node=next((node for node in self.workflow.nodes if node.id==target_id),None)
        if target_node and target_node.type.endswith("trigger"):
            self._log("Invalid connection rejected: trigger nodes cannot have inputs."); return
        if any(item.source==source_id and item.target==target_id for item in self.workflow.connections):
            self._log("Connection already exists."); return
        connection=WorkflowConnection(source_id,target_id); self.workflow.connections.append(connection)
        try:
            from .engine import WorkflowEngine
            WorkflowEngine.dependency_order(self.workflow)
        except ValueError:
            self.workflow.connections.remove(connection); self._log("Invalid connection rejected: it would create a cycle."); return
        self.canvas.connections=self.workflow.connections; self.canvas.viewport().update(); self._mark_dirty(); self._log("Nodes connected.")

    def delete_selected(self) -> None:
        selected=[item for item in self.canvas.scene().selectedItems() if isinstance(item,WorkflowNode)]
        if not selected: return
        if any(item.data.settings for item in selected) and not show_confirmation(self,"Delete node","Delete the selected node(s) and their connections?","Delete","Cancel",destructive=True): return
        for item in selected: self.workflow.remove_node(item.data.id)
        self.canvas.load_workflow(self.workflow); self._wire_node_edit_signals(); self._mark_dirty(); self._update_empty_state(); self._log(f"Deleted {len(selected)} node(s).")

    def _execution_finished(self, record) -> None:
        self._latest_node_results={item.get("node_id"):item for item in record.node_results}
        self.save_workflow(); self.canvas.load_workflow(self.workflow); self._wire_node_edit_signals()
        self._log(f"Workflow finished with status: {record.status}."); self.refresh_executions()

    def refresh_executions(self) -> None:
        records = self.execution_store.list(); self._execution_records=records; self.execution_table.setRowCount(len(records))
        for row, record in enumerate(records):
            started, finished = record.get("started_at", ""), record.get("finished_at", ""); duration = "—"
            if started and finished:
                try: duration = f"{(datetime.fromisoformat(finished)-datetime.fromisoformat(started)).total_seconds():.1f}s"
                except ValueError: pass
            values = (record.get("execution_id", "")[:12], record.get("workflow_name", ""), started[:19].replace("T", " "), duration, record.get("status", ""))
            for column, value in enumerate(values): self.execution_table.setItem(row, column, QTableWidgetItem(str(value)))

    def inspect_execution(self,row,column=0) -> None:
        del column
        if 0 <= row < len(getattr(self,"_execution_records",[])): self.execution_detail.setPlainText(json.dumps(self._execution_records[row],indent=2,ensure_ascii=False))

    def refresh_evaluations(self) -> None:
        records=self.execution_store.list(); total=len(records); successes=sum(1 for item in records if item.get("status")=="success")
        durations=[float(item.get("duration_seconds",0)) for item in records]
        failed=[item for item in records if item.get("status")=="failed"]
        self.metric_labels["Workflow Health"].setText("Good" if total and not failed else ("Needs attention" if failed else "No runs"))
        self.metric_labels["Success Rate"].setText(f"{successes/total*100:.0f}%" if total else "—")
        self.metric_labels["Average Time"].setText(f"{sum(durations)/len(durations):.1f}s" if durations else "—")
        self.metric_labels["Total Runs"].setText(str(total))
        last_error=(failed[0].get("errors") or ["None"])[0] if failed else "None"
        self.recommendations.setText(f"Last Failure\n\n{last_error}")

    @staticmethod
    def _stylesheet() -> str:
        return """
        QWidget#workflowPage { background:#0E1114; color:#F3F5F7; font-family:'Segoe UI'; }
        QFrame#workflowHeader { background:#1C2024; border:1px solid #353A40; border-radius:10px; }
        QLabel#workflowLogo { color:#23D7FF; font-size:24px; font-weight:700; padding:4px; }
        QLabel#workflowCrumb { color:#9AA3AB; font-size:11px; }
        QLineEdit#workflowName { color:#F3F5F7; background:transparent; border:0; font-size:17px; font-weight:600; max-width:240px; }
        QPushButton#workflowTab { background:#171A1D; color:#9AA3AB; border:1px solid transparent; border-radius:8px; padding:9px 14px; font-weight:600; }
        QPushButton#workflowTab[active='true'] { background:#242A2F; color:#F3F5F7; border-color:#4A535B; }
        QPushButton#workflowAction, QPushButton#workflowPublish { border:1px solid #465059; border-radius:8px; padding:9px 16px; background:#23282D; color:#F3F5F7; }
        QPushButton#workflowPublish { background:#168AA3; border-color:#23D7FF; font-weight:700; }
        QFrame#emptyWorkflow { background:rgba(20,23,25,220); border:1px solid #353A40; border-radius:14px; padding:12px; }
        QPushButton#emptyAction { min-width:190px; min-height:95px; background:#202429; border:1px solid #454C53; border-radius:12px; color:#F3F5F7; font-size:14px; }
        QPushButton#emptyAction:hover { border-color:#23D7FF; background:#242C30; }
        QFrame#floatingToolbar, QFrame#canvasControls { background:#202428; border:1px solid #3D444A; border-radius:9px; }
        QPushButton#canvasTool { min-width:30px; min-height:30px; background:transparent; color:#DDE4E8; border:0; border-radius:6px; }
        QPushButton#canvasTool:hover { background:#343A40; color:#23D7FF; }
        QPushButton#logsToggle { text-align:left; background:#1C2024; color:#B8C0C6; border:1px solid #353A40; border-radius:7px; padding:7px 12px; }
        QListWidget#workflowLogs, QTableWidget { background:#151719; color:#CFD5DA; border:1px solid #353A40; gridline-color:#353A40; }
        QLabel#workflowPageTitle { font-size:20px; font-weight:600; color:#F3F5F7; padding:10px; }
        QFrame#metricCard { background:#1C2024; border:1px solid #353A40; border-radius:10px; padding:14px; }
        QLabel#metricValue { color:#23D7FF; font-size:25px; font-weight:700; }
        QLabel#recommendations { background:#1C2024; border:1px solid #353A40; border-radius:10px; color:#C8D0D5; padding:20px; }
        """
