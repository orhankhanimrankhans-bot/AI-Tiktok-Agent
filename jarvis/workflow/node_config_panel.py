"""Generic node parameter/input/output panel contract."""
from __future__ import annotations
import json
from PySide6.QtCore import Signal
from PySide6.QtWidgets import QDialog,QDialogButtonBox,QFrame,QLabel,QPlainTextEdit,QPushButton,QVBoxLayout
from ..dialogs import JarvisDialogStyle

class NodeConfigPanel(QFrame):
    test_requested=Signal(object); closed=Signal()
    def __init__(self,parent=None):
        super().__init__(parent); self.setFixedWidth(400); self.node=None
        layout=QVBoxLayout(self); self.title=QLabel("Node"); layout.addWidget(self.title); self.status=QLabel("Idle"); layout.addWidget(self.status)
        for label,name in (("INPUT","input_view"),("OUTPUT","output_view")):
            layout.addWidget(QLabel(label)); view=QPlainTextEdit(); view.setReadOnly(True); setattr(self,name,view); layout.addWidget(view)
        test=QPushButton("Test Step"); test.clicked.connect(lambda:self.test_requested.emit(self.node)); layout.addWidget(test)
    def set_node(self,node,input_data=None,output_data=None):
        self.node=node; self.title.setText(node.title); self.status.setText(node.status.title())
        self.input_view.setPlainText(json.dumps(input_data or {},indent=2,ensure_ascii=False)); self.output_view.setPlainText(json.dumps(output_data or {},indent=2,ensure_ascii=False))

class NodeConfigDialog(QDialog):
    test_requested=Signal(object)
    def __init__(self,node,parent=None,last_result=None):
        super().__init__(parent); self.node=node; self.setWindowTitle(f"Configure {node.title}"); self.resize(560,620); JarvisDialogStyle.apply(self)
        layout=QVBoxLayout(self); layout.addWidget(QLabel(f"{node.title}\nStatus: {node.status}")); layout.addWidget(QLabel("PARAMETERS / CREDENTIAL REFERENCES"))
        help_text={
            "schedule_trigger":"Trigger interval: every_x_minutes, hourly, daily, weekly, or custom. Set every, time (HH:MM), timezone, weekday, and enabled.",
            "google_drive_search":"Set credential_id, folder_id, query, file_type, and maximum_results. Tokens are never stored here.",
            "limit":"Set maximum_items. The files/items list is truncated without inventing data.",
            "google_drive_download":"Map file_id (for example {{$json.files[0].id}}). Download destination is restricted to the Jarvis workflow directory by default.",
            "google_drive_delete":"Map one exact file_id. Keep delete_only_if_previous_succeeded enabled for Facebook workflows.",
        }.get(node.type)
        if help_text:
            hint=QLabel(help_text); hint.setWordWrap(True); hint.setStyleSheet("color:#9AA3AB;padding:4px;"); layout.addWidget(hint)
        self.parameters=QPlainTextEdit(json.dumps(node.settings,indent=2,ensure_ascii=False)); layout.addWidget(self.parameters)
        layout.addWidget(QLabel("INPUT")); self.input_view=QPlainTextEdit("{}"); self.input_view.setMaximumHeight(90); layout.addWidget(self.input_view)
        layout.addWidget(QLabel("OUTPUT / ERROR")); self.output_view=QPlainTextEdit(); self.output_view.setReadOnly(True); layout.addWidget(self.output_view)
        if last_result: self.input_view.setPlainText(json.dumps(last_result.get("input",{}),indent=2,ensure_ascii=False)); self.output_view.setPlainText(json.dumps(last_result,indent=2,ensure_ascii=False))
        self.test_button=QPushButton("Test Step"); self.test_button.clicked.connect(lambda:self.test_requested.emit(self.node)); layout.addWidget(self.test_button)
        buttons=QDialogButtonBox(QDialogButtonBox.StandardButton.Save|QDialogButtonBox.StandardButton.Cancel); buttons.accepted.connect(self.save); buttons.rejected.connect(self.reject); layout.addWidget(buttons)
    def save(self):
        try: self.node.settings=json.loads(self.parameters.toPlainText() or "{}")
        except json.JSONDecodeError as exc: self.output_view.setPlainText(f"Invalid settings JSON: {exc}"); return
        self.accept()
    def input_data(self):
        try: return json.loads(self.input_view.toPlainText() or "{}")
        except json.JSONDecodeError: return {}
    def show_result(self,record):
        payload=record.node_results[-1] if record.node_results else {"status":record.status,"errors":record.errors}; self.output_view.setPlainText(json.dumps(payload,indent=2,ensure_ascii=False)); self.test_button.setEnabled(True)
