"""Professional Schedule Trigger editor with dynamic multi-rule configuration."""
from __future__ import annotations
import json
from PySide6.QtCore import Qt,Signal
from PySide6.QtWidgets import (QCheckBox,QComboBox,QDialog,QFormLayout,QFrame,QHBoxLayout,QLabel,QLineEdit,QPlainTextEdit,
 QPushButton,QScrollArea,QTabWidget,QVBoxLayout,QWidget)
from ..dialogs import JarvisDialogStyle,show_confirmation,show_message
from .connectors.schedule_trigger import DISPLAY_TYPES,INTERVAL_TYPES,ScheduleTriggerConnector,default_rules,normalize_settings
from .node_editor import DataViewer,ExpressionField
from .providers import ProviderIconRegistry

HOUR_LABELS=["Midnight"]+[f"{hour}am" for hour in range(1,12)]+["Noon"]+[f"{hour}pm" for hour in range(1,12)]

class DarkToggleSwitch(QCheckBox):
    def __init__(self,checked=False,parent=None):
        super().__init__(parent); self.setChecked(bool(checked)); self.setText("On" if checked else "Off"); self.toggled.connect(lambda value:self.setText("On" if value else "Off"))

class RuleCard(QFrame):
    delete_requested=Signal(object)
    def __init__(self,index,rule,parent=None):
        super().__init__(parent); self.index=index; self.rule=dict(rule); self.fields={}; self.setObjectName("scheduleRule")
        outer=QVBoxLayout(self); header=QHBoxLayout(); self.toggle=QPushButton(f"▾  Trigger Interval {index+1}"); self.toggle.setCheckable(True); self.toggle.setChecked(True); self.toggle.setObjectName("ruleHeader")
        remove=QPushButton("Delete"); remove.setObjectName("ruleDelete"); remove.clicked.connect(lambda:self.delete_requested.emit(self)); header.addWidget(self.toggle,1); header.addWidget(remove); outer.addLayout(header)
        self.body=QWidget(); self.form=QFormLayout(self.body); self.form.setContentsMargins(8,6,8,8); self.interval=QComboBox()
        for label,value in zip(DISPLAY_TYPES,INTERVAL_TYPES): self.interval.addItem(label,value)
        self.interval.setCurrentIndex(max(0,self.interval.findData(str(rule.get("interval_type","seconds")).casefold()))); self.form.addRow("Trigger Interval",self.interval); outer.addWidget(self.body)
        self.toggle.toggled.connect(self.body.setVisible); self.interval.currentIndexChanged.connect(self._rebuild); self._rebuild()
    def _clear_dynamic(self):
        while self.form.rowCount()>1: self.form.removeRow(1)
        self.fields={}
    def _expression(self,label,key,default):
        widget=ExpressionField(self.rule.get(key,default)); self.fields[key]=widget; self.form.addRow(label,widget)
    def _hour(self):
        combo=QComboBox()
        for value,label in enumerate(HOUR_LABELS): combo.addItem(label,value)
        combo.setCurrentIndex(max(0,combo.findData(int(self.rule.get("hour",0))))); self.fields["hour"]=combo; self.form.addRow("Trigger at Hour",combo)
    def _rebuild(self):
        self._clear_dynamic(); kind=str(self.interval.currentData())
        if kind=="seconds": self._expression("Seconds Between Triggers","seconds",30)
        elif kind=="minutes": self._expression("Minutes Between Triggers","minutes",5)
        elif kind=="hours": self._expression("Hours Between Triggers","hours",1); self._expression("Trigger at Minute","minute",0)
        elif kind=="days": self._expression("Days Between Triggers","days",1); self._hour(); self._expression("Trigger at Minute","minute",0)
        elif kind=="weeks":
            self._expression("Weeks Between Triggers","weeks",1); self._expression("Trigger on","weekdays","Monday"); self._hour(); self._expression("Trigger at Minute","minute",0)
        elif kind=="months":
            self._expression("Months Between Triggers","months",1); self._expression("Day of Month","day_of_month",1); self._hour(); self._expression("Trigger at Minute","minute",0)
        else:
            self._expression("Cron Expression","cron_expression","* * * * *"); hint=QLabel("Use standard five-field cron format: minute hour day month weekday"); hint.setObjectName("ruleHint"); hint.setWordWrap(True); self.form.addRow("",hint)
    def values(self):
        result={"interval_type":str(self.interval.currentData())}
        for key,widget in self.fields.items():
            if isinstance(widget,ExpressionField):
                value=widget.value()
                if key=="weekdays": value=[item.strip().title() for item in value.split(",") if item.strip()]
                elif not value.strip().startswith("{{"):
                    try: value=int(value)
                    except ValueError: pass
            else: value=widget.currentData()
            result[key]=value
        return result

class MockDataDialog(QDialog):
    def __init__(self,value,parent=None):
        super().__init__(parent); self.setWindowTitle("Set mock trigger data"); self.resize(560,420); layout=QVBoxLayout(self)
        layout.addWidget(QLabel("Enter a JSON object to pass to downstream nodes during testing.")); self.editor=QPlainTextEdit(json.dumps(value or {},indent=2,ensure_ascii=False)); layout.addWidget(self.editor,1)
        row=QHBoxLayout(); cancel=QPushButton("Cancel"); save=QPushButton("Use mock data"); cancel.clicked.connect(self.reject); save.clicked.connect(self._accept); row.addStretch(); row.addWidget(cancel); row.addWidget(save); layout.addLayout(row); self.value=None; JarvisDialogStyle.apply(self)
    def _accept(self):
        try: value=json.loads(self.editor.toPlainText() or "{}")
        except json.JSONDecodeError as exc: show_message(self,"Invalid mock data","Mock data must be valid JSON.","warning",str(exc)); return
        if not isinstance(value,dict): show_message(self,"Invalid mock data","Mock data must be a JSON object.","warning"); return
        self.value=value; self.accept()

class ScheduleTriggerEditor(QDialog):
    test_requested=Signal(object,object)
    def __init__(self,node,last_result=None,parent=None):
        super().__init__(parent); self.node=node; self.rule_cards=[]; self.setObjectName("scheduleEditor"); self.setWindowTitle("Schedule Trigger"); self.resize(1180,740)
        settings=normalize_settings(node.settings); outer=QVBoxLayout(self)
        header=QHBoxLayout(); icon=QLabel(); icon.setPixmap(ProviderIconRegistry.icon("schedule","schedule_trigger").pixmap(46,46)); header.addWidget(icon)
        title=QLabel("Schedule Trigger"); title.setObjectName("scheduleTitle"); header.addWidget(title); header.addStretch(); docs=QPushButton("Docs"); docs.clicked.connect(self._docs); close=QPushButton("✕"); close.clicked.connect(self.accept); header.addWidget(docs); header.addWidget(close); outer.addLayout(header)
        body=QHBoxLayout(); configuration=QVBoxLayout(); self.tabs=QTabWidget(); self.tabs.setObjectName("scheduleTabs"); parameters=QWidget(); parameters.setObjectName("scheduleParameters"); parameters_layout=QVBoxLayout(parameters)
        banner=QLabel("This workflow will run on the schedule you define here once you publish it.\nFor testing, return to the canvas and click Execute Workflow."); banner.setObjectName("scheduleInfo"); banner.setWordWrap(True); parameters_layout.addWidget(banner)
        heading=QHBoxLayout(); heading.addWidget(QLabel("Trigger Rules")); heading.addStretch(); add=QPushButton("+ Add Rule"); add.clicked.connect(self.add_rule); heading.addWidget(add); parameters_layout.addLayout(heading)
        scroll=QScrollArea(); scroll.setObjectName("scheduleScroll"); scroll.setWidgetResizable(True); scroll.setFrameShape(QFrame.Shape.NoFrame); self.rules_host=QWidget(); self.rules_host.setObjectName("scheduleRulesHost"); self.rules_layout=QVBoxLayout(self.rules_host); self.rules_layout.setAlignment(Qt.AlignmentFlag.AlignTop); scroll.setWidget(self.rules_host); parameters_layout.addWidget(scroll,1)
        for rule in settings["rules"]: self.add_rule(rule)
        options=QWidget(); options.setObjectName("scheduleSettings"); form=QFormLayout(options); self.timezone=QLineEdit(str(settings.get("timezone","local"))); self.enabled=DarkToggleSwitch(settings.get("enabled",True)); form.addRow("Timezone",self.timezone); form.addRow("Enabled",self.enabled)
        self.always_output=DarkToggleSwitch(settings.get("always_output_data",True)); self.execute_once=DarkToggleSwitch(settings.get("execute_once",False)); self.retry=DarkToggleSwitch(settings.get("_retry",False)); self.on_error=QComboBox(); self.on_error.addItem("Stop Workflow","stop"); self.on_error.addItem("Continue","continue"); self.on_error.setCurrentIndex(max(0,self.on_error.findData(settings.get("on_error","stop"))))
        self.notes=QPlainTextEdit(str(settings.get("_notes",""))); self.notes.setMaximumHeight(100); self.display_note=DarkToggleSwitch(settings.get("display_note_in_flow",False))
        for label,widget in (("Always Output Data",self.always_output),("Execute Once",self.execute_once),("Retry On Fail",self.retry),("On Error",self.on_error),("Notes",self.notes),("Display Note in Flow?",self.display_note)): form.addRow(label,widget)
        version=QLabel("Schedule Trigger node version 1.0"); version.setObjectName("versionLabel"); form.addRow(version)
        self.tabs.addTab(parameters,"Parameters"); self.tabs.addTab(options,"Settings"); configuration.addWidget(self.tabs); body.addLayout(configuration,3)
        output_column=QVBoxLayout(); self.execute_button=QPushButton("▶ Execute Step"); self.execute_button.setObjectName("executeSchedule"); self.execute_button.clicked.connect(self.execute_test); output_column.addWidget(self.execute_button); output_column.addWidget(QLabel("OUTPUT"))
        self.empty=QFrame(); empty_layout=QVBoxLayout(self.empty); empty_layout.addStretch(); message=QLabel("No trigger output"); message.setAlignment(Qt.AlignmentFlag.AlignCenter); empty_layout.addWidget(message)
        self.test_button=QPushButton("Test this trigger"); self.test_button.clicked.connect(self.execute_test); empty_layout.addWidget(self.test_button,0,Qt.AlignmentFlag.AlignCenter); mock=QPushButton("set mock data"); mock.setObjectName("mockLink"); mock.clicked.connect(self.set_mock_data); empty_layout.addWidget(mock,0,Qt.AlignmentFlag.AlignCenter); empty_layout.addStretch()
        self.output=DataViewer("No trigger output"); self.output.hide(); output_column.addWidget(self.empty,1); output_column.addWidget(self.output,1); body.addLayout(output_column,2); outer.addLayout(body,1)
        footer=QHBoxLayout(); cancel=QPushButton("Cancel"); save=QPushButton("Save node"); cancel.clicked.connect(self.reject); save.clicked.connect(self.save); footer.addStretch(); footer.addWidget(cancel); footer.addWidget(save); outer.addLayout(footer)
        if last_result: self.show_data(last_result)
        self.setStyleSheet("""
          QDialog#scheduleEditor{background:#111518;color:#F1F5F8;} QWidget#scheduleParameters,QWidget#scheduleSettings,QWidget#scheduleRulesHost,QScrollArea#scheduleScroll,QScrollArea#scheduleScroll QWidget#qt_scrollarea_viewport{background:#111518;color:#F1F5F8;}
          QTabWidget#scheduleTabs::pane{background:#111518;border:1px solid #343F46;} QTabWidget#scheduleTabs QTabBar::tab{background:#171D21;color:#9EABB3;border:1px solid #343F46;padding:9px 18px;} QTabWidget#scheduleTabs QTabBar::tab:selected{background:#26333A;color:#F1F5F8;border-bottom-color:#E89A46;}
          QLabel#scheduleTitle{font-size:21px;font-weight:700;} QLabel#scheduleInfo{background:#322819;color:#E8D5A7;border:1px solid #66512A;border-radius:7px;padding:12px;}
          QFrame#scheduleRule{background:#171D21;border:1px solid #343F46;border-radius:8px;} QPushButton#ruleHeader{text-align:left;background:transparent;border:0;font-weight:700;} QPushButton#ruleDelete{color:#FFB7B7;background:#35191B;border-color:#8E3E42;}
          QLineEdit,QComboBox,QPlainTextEdit{background:#0D1114;color:#F1F5F8;border:1px solid #3A444C;border-radius:6px;padding:7px;} QComboBox QAbstractItemView{background:#151D24;color:#F1F5F8;selection-background-color:#2A4B59;}
          QCheckBox{spacing:10px;} QCheckBox::indicator{width:34px;height:18px;border-radius:9px;background:#303A40;border:1px solid #52616B;} QCheckBox::indicator:checked{background:#168AA3;border-color:#23D7FF;}
          QScrollBar:vertical{background:#111518;width:10px;} QScrollBar::handle:vertical{background:#3A474F;border-radius:5px;min-height:28px;} QPushButton#executeSchedule{background:#A86120;border:1px solid #E89A46;font-weight:700;padding:11px;} QPushButton#mockLink{background:transparent;border:0;color:#23D7FF;text-decoration:underline;}
          QLabel#ruleHint,QLabel#versionLabel{color:#93A1AA;}
        """); JarvisDialogStyle.apply(self)
    def _docs(self): show_message(self,"Schedule Trigger help","Define one or more schedule rules. Published workflows run automatically; Execute Step performs a safe node-level test.","information")
    def add_rule(self,rule=None):
        card=RuleCard(len(self.rule_cards),rule or {"interval_type":"minutes","minutes":5}); card.delete_requested.connect(self.delete_rule); self.rule_cards.append(card); self.rules_layout.addWidget(card); self._renumber()
    def delete_rule(self,card):
        if len(self.rule_cards)<=1: show_message(self,"Schedule rule required","A Schedule Trigger must contain at least one rule.","warning"); return
        if not show_confirmation(self,"Delete schedule rule","Delete this trigger interval?","Delete","Cancel",True): return
        self.rule_cards.remove(card); card.deleteLater(); self._renumber()
    def _renumber(self):
        for index,card in enumerate(self.rule_cards): card.index=index; card.toggle.setText(f"▾  Trigger Interval {index+1}")
    def settings(self):
        result=dict(self.node.settings); result.update({"operation":"test","timezone":self.timezone.text().strip() or "local","enabled":self.enabled.isChecked(),"rules":[card.values() for card in self.rule_cards],"always_output_data":self.always_output.isChecked(),"execute_once":self.execute_once.isChecked(),"_retry":self.retry.isChecked(),"on_error":self.on_error.currentData(),"_continue_on_failure":self.on_error.currentData()=="continue","_notes":self.notes.toPlainText(),"display_note_in_flow":self.display_note.isChecked()})
        ScheduleTriggerConnector().validate(result); return result
    def execute_test(self):
        try: self.node.settings=self.settings()
        except ValueError as exc: self.show_data({"status":"failed","error":str(exc)}); return
        self.execute_button.setEnabled(False); self.execute_button.setText("Executing..."); self.test_button.setEnabled(False)
        self.test_requested.emit(self.node,{})
    def set_mock_data(self):
        dialog=MockDataDialog(self.node.settings.get("_mock_data"),self)
        if dialog.exec()==QDialog.DialogCode.Accepted: self.node.settings["_mock_data"]=dialog.value; self.show_data(dialog.value)
    def show_data(self,value):
        self.empty.hide(); self.output.show(); self.output.set_data(value)
    def show_result(self,record):
        result=record.node_results[-1] if record.node_results else {"status":record.status,"errors":record.errors}; self.show_data(result); self.execute_button.setEnabled(True); self.execute_button.setText("▶ Execute Step"); self.test_button.setEnabled(True)
    def save(self):
        try: self.node.settings=self.settings(); self.accept()
        except ValueError as exc: self.show_data({"status":"failed","error":str(exc)})
