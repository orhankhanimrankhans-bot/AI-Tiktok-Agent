"""Professional right-side workflow integration browser."""
from __future__ import annotations
from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QCursor
from PySide6.QtWidgets import QFrame,QHBoxLayout,QLabel,QLineEdit,QListWidget,QListWidgetItem,QPushButton,QVBoxLayout,QWidget
from .connector_registry import ConnectorRegistry
from .providers import ProviderIconRegistry

class NodeSearchResult(QWidget):
    def __init__(self,descriptor,parent=None):
        super().__init__(parent); self.setCursor(QCursor(Qt.CursorShape.PointingHandCursor)); self.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
        row=QHBoxLayout(self); row.setContentsMargins(10,8,10,8); row.setSpacing(12)
        icon=QLabel(); icon.setFixedSize(42,42); icon.setPixmap(ProviderIconRegistry.icon(descriptor.provider,descriptor.id).pixmap(40,40)); row.addWidget(icon)
        text=QVBoxLayout(); text.setSpacing(2); name=QLabel(descriptor.name); name.setObjectName("resultName"); text.addWidget(name)
        description=QLabel(descriptor.description); description.setWordWrap(True); description.setObjectName("resultDescription"); text.addWidget(description); row.addLayout(text,1)
        badge=QLabel(descriptor.kind.upper()); badge.setObjectName("resultBadge"); row.addWidget(badge,0,Qt.AlignmentFlag.AlignTop)

class NodePickerPanel(QFrame):
    node_selected=Signal(object); closed=Signal()
    def __init__(self,registry:ConnectorRegistry,parent=None):
        super().__init__(parent); self.registry=registry; self.kind=None; self.setObjectName("nodePickerPanel"); self.setFixedWidth(410)
        layout=QVBoxLayout(self); layout.setContentsMargins(18,18,18,14); layout.setSpacing(12)
        header=QLabel("Add a workflow step"); header.setObjectName("pickerTitle"); layout.addWidget(header)
        self.heading=QLabel(); self.heading.setWordWrap(True); self.heading.setObjectName("pickerHint"); layout.addWidget(self.heading)
        self.search=QLineEdit(); self.search.setPlaceholderText("Search nodes..."); self.search.setClearButtonEnabled(True); self.search.textChanged.connect(self.refresh); layout.addWidget(self.search)
        self.results=QListWidget(); self.results.setSpacing(2); self.results.itemClicked.connect(self._choose); layout.addWidget(self.results,1)
        close=QPushButton("Close"); close.clicked.connect(self.closed.emit); layout.addWidget(close)
        self.setStyleSheet("""
          QFrame#nodePickerPanel{background:#171B1E;border:1px solid #3A4249;border-radius:10px;}
          QLabel#pickerTitle{font-size:19px;font-weight:700;color:#F3F5F7;} QLabel#pickerHint{color:#9AA3AB;}
          QLineEdit{background:#101417;color:#F3F5F7;border:1px solid #46515A;border-radius:8px;padding:11px;font-size:13px;}
          QLineEdit:focus{border-color:#23D7FF;} QListWidget{background:#111518;color:#DCE4E8;border:1px solid #30363B;border-radius:8px;outline:0;}
          QListWidget::item{border-bottom:1px solid #252B2F;} QListWidget::item:hover{background:#20282D;} QListWidget::item:selected{background:#173C48;border-left:3px solid #23D7FF;}
          QLabel#resultName{font-size:13px;font-weight:700;color:#F3F5F7;} QLabel#resultDescription{font-size:10px;color:#A8B0B6;}
          QLabel#resultBadge{font-size:8px;font-weight:700;color:#7EDCF2;background:#1B3037;border:1px solid #285466;border-radius:4px;padding:2px 4px;}
        """)
    def open_for(self,first_node:bool):
        self.kind="trigger" if first_node else None
        self.heading.setText("What triggers this workflow?\nA trigger is a step that starts your workflow" if first_node else "What happens next?\nChoose an action, integration, or Jarvis tool")
        self.search.clear(); self.refresh(); self.show(); self.search.setFocus()
    def refresh(self):
        items=self.registry.search(self.search.text())
        if self.kind=="trigger": items=sorted(items,key=lambda d:d.kind!="trigger")
        self.results.clear()
        for descriptor in items:
            item=QListWidgetItem(); item.setData(Qt.ItemDataRole.UserRole,descriptor.id)
            widget=NodeSearchResult(descriptor); item.setSizeHint(widget.sizeHint()); self.results.addItem(item); self.results.setItemWidget(item,widget)
            if not descriptor.implemented: item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEnabled)
    def _choose(self,item):
        descriptor=self.registry.descriptor(item.data(Qt.ItemDataRole.UserRole))
        if descriptor and descriptor.implemented: self.node_selected.emit(descriptor)
