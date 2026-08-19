"""Reusable curved connection graphics item."""
from PySide6.QtCore import QPointF
from PySide6.QtGui import QColor,QPainterPath,QPen
from PySide6.QtWidgets import QGraphicsPathItem
class WorkflowConnectionItem(QGraphicsPathItem):
    COLORS={"idle":"#5F9EAC","running":"#E5BD45","success":"#43D58A","failed":"#F06464"}
    def __init__(self,source=None,target=None,parent=None): super().__init__(parent); self.source=source; self.target=target; self.status="idle"; self.setZValue(-1); self.update_path()
    def set_status(self,status): self.status=status; self.setPen(QPen(QColor(self.COLORS.get(status,self.COLORS["idle"])),2.2))
    def update_path(self):
        if self.source is None or self.target is None: return
        start=self.source.output_point(); end=self.target.input_point(); distance=max(65.0,abs(end.x()-start.x())*.45); path=QPainterPath(start); path.cubicTo(start+QPointF(distance,0),end-QPointF(distance,0),end); self.setPath(path); self.set_status(self.status)
