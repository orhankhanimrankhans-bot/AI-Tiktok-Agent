"""Workflow graph validation and dependency ordering."""

from __future__ import annotations

from .models import WorkflowDefinition, WorkflowNodeData


class WorkflowEngine:
    @staticmethod
    def validate(workflow: WorkflowDefinition) -> list[str]:
        errors=[]; ids=[node.id for node in workflow.nodes]
        if not workflow.nodes: errors.append("Workflow has no nodes.")
        if len(ids)!=len(set(ids)): errors.append("Workflow contains duplicate node IDs.")
        known=set(ids)
        for connection in workflow.connections:
            if connection.source not in known or connection.target not in known: errors.append(f"Connection {connection.id} references a missing node.")
            if connection.source==connection.target: errors.append(f"Connection {connection.id} connects a node to itself.")
        triggers=[node for node in workflow.nodes if node.type.endswith("trigger") or "trigger" in node.title.casefold()]
        if workflow.nodes and not triggers: errors.append("Workflow requires a trigger node.")
        if len(ids)==len(set(ids)) and not any("missing node" in error for error in errors):
            try: WorkflowEngine.dependency_order(workflow)
            except ValueError as exc: errors.append(str(exc))
        return errors

    @staticmethod
    def dependency_order(workflow: WorkflowDefinition) -> list[WorkflowNodeData]:
        by_id = {node.id: node for node in workflow.nodes}
        incoming = {node.id: 0 for node in workflow.nodes}
        outgoing = {node.id: [] for node in workflow.nodes}
        for connection in workflow.connections:
            if connection.source in outgoing and connection.target in incoming:
                outgoing[connection.source].append(connection.target)
                incoming[connection.target] += 1
        queue = [node.id for node in workflow.nodes if incoming[node.id] == 0]
        ordered = []
        while queue:
            node_id = queue.pop(0)
            ordered.append(by_id[node_id])
            for target in outgoing[node_id]:
                incoming[target] -= 1
                if incoming[target] == 0:
                    queue.append(target)
        if len(ordered) != len(workflow.nodes):
            raise ValueError("Workflow contains a dependency cycle.")
        return ordered
