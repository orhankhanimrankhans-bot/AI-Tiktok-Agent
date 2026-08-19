"""In-process published-workflow schedule evaluation."""
from __future__ import annotations
from datetime import datetime
from .connectors.schedule_trigger import ScheduleTriggerConnector
from .models import WorkflowDefinition,WorkflowNodeData

def schedule_trigger(workflow: WorkflowDefinition) -> WorkflowNodeData | None:
    return next((node for node in workflow.nodes if node.type=="schedule_trigger"),None)

def schedule_event(node: WorkflowNodeData,now: datetime | None=None):
    if node.settings.get("execute_once") and node.settings.get("_executed_once"): return None
    return ScheduleTriggerConnector().due_event(node.settings,now)

def schedule_slot(node: WorkflowNodeData,now: datetime | None=None) -> str | None:
    """Compatibility API returning the due slot without its payload."""
    event=schedule_event(node,now)
    if not event: return None
    slot=event[0]
    if "rules" not in node.settings:
        kind=str(node.settings.get("interval") or "daily").casefold()
        if kind=="daily": return f"day:{now:%Y-%m-%d}" if now else slot
        if kind=="weekly": return f"week:{now:%G-%V}" if now else slot
        if kind=="hourly": return f"hour:{now:%Y-%m-%d-%H}" if now else slot
    return slot
