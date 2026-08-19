"""Reusable three-column node editor and secure credential UI."""
from __future__ import annotations
import json
from PySide6.QtCore import Qt,QThread,Signal
from PySide6.QtWidgets import (QCheckBox,QComboBox,QDialog,QFormLayout,QFrame,QHBoxLayout,QLabel,QLineEdit,
 QPlainTextEdit,QPushButton,QStackedWidget,QTabWidget,QTableWidget,QTableWidgetItem,QVBoxLayout,QWidget)
from .credentials.store import CredentialError,CredentialStore
from .connectors.facebook import FacebookConnector
from .connectors.google_drive import GoogleDriveConnector
from .providers import ProviderIconRegistry
from ..dialogs import JarvisDialogStyle

def _schema(value):
    if isinstance(value,dict): return {key:_schema(item) for key,item in value.items()}
    if isinstance(value,list): return [_schema(value[0])] if value else []
    return type(value).__name__

class DataViewer(QTabWidget):
    def __init__(self,empty_text,parent=None):
        super().__init__(parent); self.empty_text=empty_text
        self.schema=QPlainTextEdit(); self.table=QTableWidget(); self.json=QPlainTextEdit()
        self.schema.setReadOnly(True); self.json.setReadOnly(True)
        self.addTab(self.schema,"Schema"); self.addTab(self.table,"Table"); self.addTab(self.json,"JSON"); self.set_data(None)
    def set_data(self,value):
        if value is None:
            self.schema.setPlainText(self.empty_text); self.json.setPlainText(self.empty_text); self.table.setRowCount(0); self.table.setColumnCount(0); return
        self.schema.setPlainText(json.dumps(_schema(value),indent=2,ensure_ascii=False)); self.json.setPlainText(json.dumps(value,indent=2,ensure_ascii=False,default=str))
        rows=value if isinstance(value,list) else ([value] if isinstance(value,dict) else [])
        columns=[]; [columns.append(key) for row in rows if isinstance(row,dict) for key in row if key not in columns]
        self.table.setColumnCount(len(columns)); self.table.setHorizontalHeaderLabels(columns); self.table.setRowCount(len(rows))
        for r,row in enumerate(rows):
            for c,key in enumerate(columns): self.table.setItem(r,c,QTableWidgetItem(str(row.get(key,""))))

class ExpressionField(QWidget):
    def __init__(self,value="",parent=None):
        super().__init__(parent); layout=QVBoxLayout(self); layout.setContentsMargins(0,0,0,0); modes=QHBoxLayout()
        self.fixed=QPushButton("Fixed"); self.expression=QPushButton("Expression")
        self.fixed.setCheckable(True); self.expression.setCheckable(True); modes.addWidget(self.fixed); modes.addWidget(self.expression); modes.addStretch(); layout.addLayout(modes)
        self.edit=QLineEdit(str(value)); layout.addWidget(self.edit)
        expression=str(value).strip().startswith("{{"); self.expression.setChecked(expression); self.fixed.setChecked(not expression)
        self.fixed.clicked.connect(lambda:self._mode(False)); self.expression.clicked.connect(lambda:self._mode(True))
    def _mode(self,expression):
        self.expression.setChecked(expression); self.fixed.setChecked(not expression)
        self.edit.setPlaceholderText("{{$json.value}}" if expression else "Enter a fixed value")
    def value(self): return self.edit.text()

class CredentialTestThread(QThread):
    completed=Signal(object)
    def __init__(self,provider,credential_id): super().__init__(); self.provider=provider; self.credential_id=credential_id
    def run(self):
        try:
            store=CredentialStore()
            connector=FacebookConnector(store.load_facebook(self.credential_id)) if self.provider=="facebook" else GoogleDriveConnector(store.load_google_drive(self.credential_id))
            self.completed.emit({"success":True,"output":connector.test_connection()})
        except Exception as exc: self.completed.emit({"success":False,"error":str(exc)})

class CredentialEditor(QDialog):
    saved=Signal(str)
    def __init__(self,provider,credential_id,parent=None):
        super().__init__(parent); self.provider=provider; self.credential_id=credential_id; self.worker=None
        self.setWindowTitle("Credential"); self.resize(760,500); outer=QVBoxLayout(self)
        header=QHBoxLayout(); icon=QLabel(); icon.setPixmap(ProviderIconRegistry.icon(provider).pixmap(44,44)); header.addWidget(icon)
        title=QLabel("Facebook Graph account" if provider=="facebook" else "Google Drive account"); title.setStyleSheet("font-size:20px;font-weight:700"); header.addWidget(title); header.addStretch(); outer.addLayout(header)
        body=QHBoxLayout(); navigation=QFrame(); navigation.setFixedWidth(150); nav=QVBoxLayout(navigation); nav.addWidget(QLabel("Connection")); nav.addWidget(QLabel("Sharing")); nav.addWidget(QLabel("Details")); nav.addStretch(); body.addWidget(navigation)
        form_host=QWidget(); form=QFormLayout(form_host); self.name=QLineEdit(credential_id); self.secret=QLineEdit(); self.secret.setEchoMode(QLineEdit.EchoMode.Password); self.secret.setPlaceholderText("••••••••••••••••")
        form.addRow("Credential ID",self.name); form.addRow("Authentication",QLabel("Access Token")); form.addRow("Access Token",self.secret)
        if provider=="facebook": self.version=QLineEdit("v25.0"); form.addRow("Graph API Version",self.version)
        self.banner=QLabel(); self.banner.setWordWrap(True); self.banner.hide(); form.addRow(self.banner)
        actions=QHBoxLayout(); test=QPushButton("Test Connection"); save=QPushButton("Save securely"); actions.addWidget(test); actions.addWidget(save); form.addRow(actions)
        test.clicked.connect(self.test_connection); save.clicked.connect(self.save_secret); body.addWidget(form_host,1); outer.addLayout(body,1)
        self.setStyleSheet("QDialog{background:#15191D;color:#F3F5F7;} QLineEdit{background:#0F1316;color:white;border:1px solid #46515A;border-radius:7px;padding:9px;} QPushButton{padding:9px 14px;background:#252B30;color:white;border:1px solid #48525A;border-radius:7px;}")
        JarvisDialogStyle.apply(self)
    def save_secret(self):
        if not self.secret.text(): self._banner(False,"Enter an access token. Existing secrets remain hidden and cannot be displayed."); return
        try:
            credential_id=self.name.text().strip(); CredentialStore.save_secret(self.provider,credential_id,self.secret.text()); self.secret.clear(); self.saved.emit(credential_id); self._banner(True,"Credential saved securely in Windows Credential Manager.")
        except CredentialError as exc: self._banner(False,str(exc))
    def test_connection(self):
        if self.secret.text(): self.save_secret()
        self._banner(True,"Testing connection..."); self.worker=CredentialTestThread(self.provider,self.name.text().strip()); self.worker.completed.connect(self._tested); self.worker.start()
    def _tested(self,result): self._banner(result["success"],"Connection successful" if result["success"] else "Couldn't connect with these settings\n"+result["error"])
    def _banner(self,success,text):
        self.banner.setText(text); self.banner.setStyleSheet("padding:12px;border-radius:7px;background:%s;color:white;" % ("#164A35" if success else "#5A2327")); self.banner.show()

class NodeEditorDialog(QDialog):
    test_requested=Signal(object,object)
    def __init__(self,node,descriptor,input_data=None,last_result=None,parent=None):
        super().__init__(parent); self.node=node; self.descriptor=descriptor; self.widgets={}; self.setWindowTitle(node.title); self.resize(1180,720)
        outer=QVBoxLayout(self); header=QHBoxLayout(); icon=QLabel(); icon.setPixmap(ProviderIconRegistry.icon(descriptor.provider,node.type).pixmap(46,46)); header.addWidget(icon)
        title=QLabel(node.title); title.setStyleSheet("font-size:21px;font-weight:700"); header.addWidget(title); header.addStretch(); close=QPushButton("✕"); close.clicked.connect(self.accept); header.addWidget(close); outer.addLayout(header)
        columns=QHBoxLayout(); left=QVBoxLayout(); left.addWidget(QLabel("INPUT")); self.input=DataViewer("No input connected"); self.input.set_data(input_data); left.addWidget(self.input); columns.addLayout(left,1)
        center=QVBoxLayout(); tabs=QTabWidget(); parameters=QWidget(); self.form=QFormLayout(parameters); self._build_parameters(); settings=QWidget(); settings_form=QFormLayout(settings)
        self.node_name=QLineEdit(node.title); self.retry=QCheckBox(); self.retry.setChecked(bool(node.settings.get("_retry",False))); self.timeout=QLineEdit(str(node.settings.get("_timeout",60))); self.continue_failure=QCheckBox(); self.continue_failure.setChecked(bool(node.settings.get("_continue_on_failure",False))); self.disabled=QCheckBox(); self.disabled.setChecked(bool(node.settings.get("_disabled",False))); self.notes=QPlainTextEdit(str(node.settings.get("_notes",""))); self.notes.setMaximumHeight(80)
        settings_form.addRow("Node name",self.node_name); settings_form.addRow("Retry on failure",self.retry); settings_form.addRow("Timeout (seconds)",self.timeout); settings_form.addRow("Continue on failure",self.continue_failure); settings_form.addRow("Disabled",self.disabled); settings_form.addRow("Notes",self.notes)
        tabs.addTab(parameters,"Parameters"); tabs.addTab(settings,"Settings"); center.addWidget(tabs); self.execute=QPushButton("▶ Execute Step"); self.execute.setObjectName("executeStep"); self.execute.clicked.connect(self._execute); center.addWidget(self.execute); columns.addLayout(center,1)
        right=QVBoxLayout(); right.addWidget(QLabel("OUTPUT")); self.output=DataViewer("No output data\n\nExecute step"); right.addWidget(self.output); columns.addLayout(right,1); outer.addLayout(columns,1)
        buttons=QHBoxLayout(); cancel=QPushButton("Cancel"); save=QPushButton("Save node"); cancel.clicked.connect(self.reject); save.clicked.connect(self._save_accept); buttons.addStretch(); buttons.addWidget(cancel); buttons.addWidget(save); outer.addLayout(buttons)
        if last_result: self.input.set_data(last_result.get("input")); self.output.set_data(last_result)
        self.setStyleSheet("QDialog{background:#111518;color:#F3F5F7;} QTabWidget::pane{border:1px solid #353D43;} QLineEdit,QComboBox,QPlainTextEdit,QTableWidget{background:#0D1114;color:#E8EDF0;border:1px solid #3A444C;border-radius:6px;padding:7px;} QPushButton{background:#242B30;color:#F3F5F7;border:1px solid #46515A;border-radius:7px;padding:8px 12px;} QPushButton#executeStep{background:#087D98;border-color:#23D7FF;font-weight:700;padding:11px;}")
        JarvisDialogStyle.apply(self)
    def _add_line(self,label,key,expression=False):
        value=self.node.settings.get(key,""); widget=ExpressionField(value) if expression else QLineEdit(str(value)); self.widgets[key]=widget; self.form.addRow(label,widget)
    def _add_combo(self,label,key,values):
        widget=QComboBox(); widget.addItems(values); current=str(self.node.settings.get(key,values[0])); widget.setCurrentText(current); self.widgets[key]=widget; self.form.addRow(label,widget)
    def _credential(self,provider):
        row=QWidget(); box=QHBoxLayout(row); box.setContentsMargins(0,0,0,0); combo=QComboBox(); refs=[r for r in CredentialStore().references() if r["provider"]==provider]
        for ref in refs: combo.addItem(ref["display_name"],ref["id"])
        default=self.node.settings.get("credential_id",f"{provider}_default")
        if combo.findData(default)<0: combo.addItem("Create new credential",default)
        combo.setCurrentIndex(max(0,combo.findData(default))); edit=QPushButton("Edit")
        def open_editor():
            editor=CredentialEditor(provider,str(combo.currentData()),self)
            def select_saved(credential_id):
                if combo.findData(credential_id)<0: combo.addItem(credential_id,credential_id)
                combo.setCurrentIndex(combo.findData(credential_id))
            editor.saved.connect(select_saved); editor.exec()
        edit.clicked.connect(open_editor); box.addWidget(combo,1); box.addWidget(edit); self.widgets["credential_id"]=combo; self.form.addRow("Credential",row)
    def _build_parameters(self):
        t=self.node.type
        if t.startswith("facebook"):
            self._credential("facebook"); self._add_combo("Host URL","host_url",["Default"]); self._add_combo("HTTP Request Method","method",["GET","POST","DELETE"]); self._add_combo("Graph API Version","graph_version",["Default","v25.0"])
            self._add_line("Node","node"); self._add_line("Edge","edge"); self._add_line("Fields","fields",True); self._add_line("Body (JSON)","body")
        elif t.startswith("google_drive"):
            self._credential("google_drive")
            if t=="google_drive_search":
                for label,key in (("Folder","folder_id"),("Query","query"),("File type","file_type"),("Maximum results","maximum_results")): self._add_line(label,key,key=="query")
            else: self._add_line("File ID","file_id",True)
            if t=="google_drive_delete": self.widgets["delete_only_if_previous_succeeded"]=QCheckBox(); self.widgets["delete_only_if_previous_succeeded"].setChecked(self.node.settings.get("delete_only_if_previous_succeeded",True)); self.form.addRow("Delete only after success",self.widgets["delete_only_if_previous_succeeded"])
        elif t=="schedule_trigger":
            self._add_combo("Trigger interval","interval",["every_x_minutes","hourly","daily","weekly","custom"]); self._add_line("Every","every"); self._add_line("Time","time"); self._add_line("Timezone","timezone"); self.widgets["enabled"]=QCheckBox(); self.widgets["enabled"].setChecked(self.node.settings.get("enabled",True)); self.form.addRow("Enabled",self.widgets["enabled"])
        elif t=="limit": self._add_line("Max Items","maximum_items")
        else:
            for key,value in self.node.settings.items(): self._add_line(key.replace("_"," ").title(),key,isinstance(value,str) and value.startswith("{{"))
    def settings(self):
        result=dict(self.node.settings)
        for key,widget in self.widgets.items():
            if isinstance(widget,ExpressionField): value=widget.value()
            elif isinstance(widget,QLineEdit): value=widget.text()
            elif isinstance(widget,QComboBox): value=widget.currentData() if key=="credential_id" else widget.currentText()
            elif isinstance(widget,QCheckBox): value=widget.isChecked()
            else: continue
            if key in {"every","maximum_results","maximum_items"}:
                try: value=int(value)
                except ValueError: pass
            result[key]=value
        if self.node.type=="facebook_graph_api":
            node=str(result.pop("node","me")).strip(); edge=str(result.pop("edge","")).strip(); result["operation"]="custom_graph_request"; result["endpoint"]="/".join(part for part in (node,edge) if part)
            params=dict(result.get("params") or {}); fields=result.pop("fields",""); result["params"]={**params,**({"fields":fields} if fields else {})}
            body=result.get("body"); result["data"]=json.loads(body) if isinstance(body,str) and body.strip() else {}
        result["_timeout"]=int(self.timeout.text() or 60); result["_notes"]=self.notes.toPlainText(); result["_retry"]=self.retry.isChecked(); result["_continue_on_failure"]=self.continue_failure.isChecked(); result["_disabled"]=self.disabled.isChecked()
        return result
    def _execute(self):
        try: self.node.settings=self.settings()
        except (ValueError,json.JSONDecodeError) as exc: self.output.set_data({"status":"failed","error":str(exc)}); return
        self.execute.setEnabled(False); self.execute.setText("Executing..."); self.test_requested.emit(self.node,{})
    def show_result(self,record):
        result=record.node_results[-1] if record.node_results else {"status":record.status,"errors":record.errors}; self.output.set_data(result); self.execute.setEnabled(True); self.execute.setText("▶ Execute Step")
    def _save_accept(self):
        try: self.node.settings=self.settings(); self.node.title=self.node_name.text().strip() or self.node.title; self.accept()
        except (ValueError,json.JSONDecodeError) as exc: self.output.set_data({"status":"failed","error":str(exc)})
