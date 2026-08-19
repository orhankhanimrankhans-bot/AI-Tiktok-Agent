"""Data models shared by workflow storage, execution, and UI layers."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from uuid import uuid4

def utc_now() -> str: return datetime.now(timezone.utc).isoformat()


@dataclass
class WorkflowNodeData:
    id: str
    type: str
    title: str
    subtitle: str = ""
    x: float = 0.0
    y: float = 0.0
    settings: dict = field(default_factory=dict)
    status: str = "idle"
    credential_id: str | None = None


@dataclass
class WorkflowConnection:
    source: str
    target: str
    id: str = field(default_factory=lambda: f"connection_{uuid4().hex[:10]}")
    status: str = "idle"


@dataclass
class WorkflowDefinition:
    id: str = field(default_factory=lambda: f"workflow_{uuid4().hex[:10]}")
    name: str = "My Workflow"
    nodes: list[WorkflowNodeData] = field(default_factory=list)
    connections: list[WorkflowConnection] = field(default_factory=list)
    status: str = "draft"
    created_at: str = field(default_factory=utc_now)
    updated_at: str = field(default_factory=utc_now)
    continue_on_failure: bool = False

    def add_node(self, node_type: str, title: str, subtitle: str, x: float, y: float) -> WorkflowNodeData:
        node = WorkflowNodeData(f"node_{uuid4().hex[:8]}", node_type, title, subtitle, x, y)
        self.nodes.append(node)
        if len(self.nodes) > 1:
            self.connections.append(WorkflowConnection(self.nodes[-2].id, node.id))
        return node

    def remove_node(self, node_id: str) -> None:
        self.nodes = [node for node in self.nodes if node.id != node_id]
        self.connections = [item for item in self.connections if item.source != node_id and item.target != node_id]

    def remove_connection(self, connection_id: str) -> None:
        self.connections = [item for item in self.connections if item.id != connection_id]

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict) -> "WorkflowDefinition":
        return cls(
            id=str(payload.get("id") or f"workflow_{uuid4().hex[:10]}"),
            name=str(payload.get("name") or "My Workflow"),
            nodes=[WorkflowNodeData(**item) for item in payload.get("nodes", [])],
            connections=[WorkflowConnection(**item) for item in payload.get("connections", [])],
            status=str(payload.get("status") or "draft"),
            created_at=str(payload.get("created_at") or utc_now()),
            updated_at=str(payload.get("updated_at") or utc_now()),
            continue_on_failure=bool(payload.get("continue_on_failure", False)),
        )


@dataclass
class NodeExecutionResult:
    node_id: str
    title: str
    status: str
    input: dict = field(default_factory=dict)
    output: dict = field(default_factory=dict)
    error: str = ""


@dataclass
class WorkflowExecutionRecord:
    execution_id: str
    workflow_id: str
    workflow_name: str
    started_at: str
    finished_at: str = ""
    status: str = "running"
    node_results: list[dict] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    duration_seconds: float = 0.0

@dataclass
class ExecutionContext:
    execution_id: str
    workflow_id: str
    started_at: str
    current_node: str = ""
    node_outputs: dict[str, dict] = field(default_factory=dict)
    variables: dict = field(default_factory=dict)
    errors: list[str] = field(default_factory=list)
