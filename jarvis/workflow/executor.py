"""Execute workflow nodes through backend adapters and persist real results."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable
from uuid import uuid4

from observability import redact_sensitive

from .connectors.facebook import FacebookConnector
from .connectors.google_drive import GoogleDriveConnector
from .connectors.schedule_trigger import ScheduleTriggerConnector
from .connector_registry import ConnectorRegistry, build_default_registry
from .credentials.store import CredentialManager
from .engine import WorkflowEngine
from .expressions import resolve_structure
from .models import ExecutionContext, NodeExecutionResult, WorkflowDefinition, WorkflowExecutionRecord, WorkflowNodeData
from .storage import ExecutionStore


class WorkflowExecutor:
    def __init__(
        self,
        credential_manager: CredentialManager | None = None,
        connector_factory: Callable = FacebookConnector,
        store: ExecutionStore | None = None,
        logger: Callable[[str], None] | None = None,
        engine: WorkflowEngine | None = None,
        registry: ConnectorRegistry | None = None,
        jarvis_process=None,
        status_callback: Callable[[str,str],None] | None = None,
    ) -> None:
        self.credentials = credential_manager or CredentialManager()
        self.connector_factory = connector_factory
        self.store = store or ExecutionStore(
            Path(__file__).resolve().parents[2] / "data" / "workflow_executions"
        )
        self.logger = logger or (lambda _message: None)
        self.engine = engine or WorkflowEngine()
        self.registry = registry or build_default_registry(jarvis_process, Path(__file__).resolve().parents[2])
        self.status_callback = status_callback or (lambda _node_id,_status: None)

    def execute_node(self, node: WorkflowNodeData, input_data: dict, context: dict) -> dict:
        node_outputs = context.node_outputs if isinstance(context, ExecutionContext) else context.get("node_outputs", {})
        settings = resolve_structure(node.settings, input_data, node_outputs)
        node_type=node.type.casefold()
        if node_type=="schedule_trigger" or node.title.casefold()=="schedule trigger":
            operation="scheduled" if input_data.get("_schedule_payload") else "test"
            config={**settings,**({"_schedule_payload":input_data["_schedule_payload"]} if input_data.get("_schedule_payload") else {})}
            output=ScheduleTriggerConnector().execute(operation,config,input_data,context); output.pop("_schedule_payload",None); return output
        if node_type=="manual_trigger" or node.title.casefold()=="manual trigger":
            return {**input_data,"trigger":"manual","manual_run":True,"started_at":context.started_at if isinstance(context,ExecutionContext) else datetime.now(timezone.utc).isoformat()}
        if node_type == "text_data":
            return {**input_data,"text":settings.get("text","") , **(settings.get("fields") or {})}
        if node_type == "json_data":
            value=settings.get("value",{})
            if not isinstance(value,dict): raise ValueError("JSON node value must be an object.")
            return {**input_data,**value}
        if node_type == "limit":
            maximum = max(0, int(settings.get("maximum_items", 1)))
            if isinstance(input_data.get("files"), list):
                return {**input_data, "files": input_data["files"][:maximum], "count": min(len(input_data["files"]), maximum)}
            if isinstance(input_data.get("items"), list):
                return {**input_data, "items": input_data["items"][:maximum], "count": min(len(input_data["items"]), maximum)}
            raise ValueError("Limit requires a 'files' or 'items' list from the previous node.")
        if node_type in {"google_drive_search", "google_drive_download", "google_drive_delete"}:
            credential_id = str(settings.get("credential_id") or "google_drive_default")
            connector = GoogleDriveConnector(self.credentials.load_google_drive(credential_id))
            connector.timeout=float(settings.get("_timeout") or connector.timeout)
            operation = str(settings.get("operation") or "")
            if node_type == "google_drive_delete" and settings.get("delete_only_if_previous_succeeded", True):
                previous_success = bool(input_data.get("facebook", {}).get("success"))
                if not previous_success:
                    raise RuntimeError("Delete File skipped: the previous Facebook step did not report success.")
            return connector.execute(operation, settings, input_data, context)
        is_facebook = node.type.casefold() in {"facebook", "social"} and (
            node.title.casefold().startswith("facebook")
            or settings.get("connector") == "facebook"
        )
        if not is_facebook:
            descriptor=self.registry.descriptor(node.type)
            if descriptor is None: raise RuntimeError(f"No connector registered for node type '{node.type}'.")
            if not descriptor.implemented: raise RuntimeError(f"{descriptor.name} is Coming soon and cannot execute.")
            connector=self.registry.create(node.type)
            operation=str(settings.get("operation") or descriptor.defaults.get("operation") or "")
            return connector.execute(operation,settings,input_data,context)

        credential_id = str(settings.get("credential_id") or "facebook_default")
        operation = str(settings.get("operation") or "").strip()
        allowed = {
            "test_connection", "list_pages", "get_page_info", "create_page_post",
            "upload_page_video", "check_video_status", "custom_graph_request",
        }
        if operation not in allowed:
            raise ValueError(
                f"Unsupported Facebook operation: {operation or 'not configured'}"
            )
        connector = self.connector_factory(
            self.credentials.load_facebook(credential_id)
        )
        if hasattr(connector,"timeout"): connector.timeout=float(settings.get("_timeout") or connector.timeout)
        page_id = str(
            settings.get("page_id") or connector.credential.default_page_id
        )
        if operation in {
            "get_page_info", "create_page_post", "upload_page_video"
        } and not page_id:
            raise ValueError("Facebook page_id is required.")

        if operation == "test_connection":
            result = connector.test_connection()
        elif operation == "list_pages":
            result = {"pages": connector.list_pages()}
        elif operation == "get_page_info":
            result = connector.get_page_info(page_id)
        elif operation == "create_page_post":
            result = connector.create_page_post(
                page_id,
                str(settings.get("message") or input_data.get("caption") or ""),
            )
        elif operation == "upload_page_video":
            result = connector.upload_page_video(
                page_id,
                str(settings.get("video_path") or input_data.get("video_path") or ""),
                str(settings.get("description") or input_data.get("caption") or ""),
            )
        elif operation == "check_video_status":
            result = connector.check_video_status(
                str(
                    settings.get("publish_id")
                    or input_data.get("publish_id")
                    or input_data.get("id")
                    or ""
                )
            )
        else:
            result = connector.execute("custom_graph_request", settings, input_data, context).get("facebook", {})
        return {
            **input_data,
            "facebook": {"success": True, **result} if isinstance(result, dict) else {"success": True, "result": result},
            "success": True,
            **(
                {"publish_id": result.get("id")}
                if isinstance(result, dict) and result.get("id")
                else {}
            ),
        }

    def run(
        self, workflow: WorkflowDefinition, initial_input: dict | None = None
    ) -> WorkflowExecutionRecord:
        started = datetime.now(timezone.utc)
        record = WorkflowExecutionRecord(
            uuid4().hex, workflow.id, workflow.name, started.isoformat()
        )
        self.store.save(record)
        data = dict(initial_input or {})
        context=ExecutionContext(record.execution_id,workflow.id,record.started_at,variables=dict(initial_input or {}))
        try:
            validation=self.engine.validate(workflow)
            if validation: raise ValueError("; ".join(validation))
            ordered_nodes = self.engine.dependency_order(workflow)
            for index, node in enumerate(ordered_nodes):
                if node.settings.get("_disabled",False):
                    node.status="skipped"; self.status_callback(node.id,"skipped")
                    item=NodeExecutionResult(node.id,node.title,"skipped",redact_sensitive(dict(data)),error="Node is disabled.")
                    record.node_results.append(asdict(item)); self.logger(f"{node.title} skipped because it is disabled."); continue
                node.status = "running"
                self.status_callback(node.id,"running")
                context.current_node=node.id
                self.logger(f"{node.title} started.")
                try:
                    input_snapshot = dict(data)
                    attempts=2 if node.settings.get("_retry",False) else 1
                    for attempt in range(attempts):
                        try:
                            data = self.execute_node(node,data,context); break
                        except Exception:
                            if attempt+1>=attempts: raise
                            self.logger(f"{node.title} retrying after failure.")
                    node.status = "success"
                    self.status_callback(node.id,"success")
                    item = NodeExecutionResult(node.id, node.title, "success", redact_sensitive(input_snapshot), redact_sensitive(data))
                    self.logger(f"{node.title} completed.")
                    context.node_outputs[node.title]=dict(data)
                    context.node_outputs[node.id]=dict(data)
                except Exception as exc:
                    node.status = "failed"
                    self.status_callback(node.id,"failed")
                    message = str(redact_sensitive(str(exc)))
                    item = NodeExecutionResult(node.id, node.title, "failed", redact_sensitive(input_snapshot), error=message)
                    record.node_results.append(asdict(item))
                    record.errors.append(message)
                    context.errors.append(message)
                    record.status = "failed"
                    self.logger(f"{node.title} failed: {message}")
                    if node.settings.get("_continue_on_failure",False):
                        self.logger(f"{node.title} is configured to continue after failure.")
                        continue
                    for skipped in ordered_nodes[index + 1:]:
                        skipped.status = "skipped"
                        self.status_callback(skipped.id,"skipped")
                        record.node_results.append(asdict(NodeExecutionResult(skipped.id, skipped.title, "skipped", error="Not executed because an upstream node failed.")))
                        self.logger(f"{skipped.title} skipped.")
                    break
                record.node_results.append(asdict(item))
            else:
                record.status = "success"
        except Exception as exc:
            message = str(redact_sensitive(str(exc)))
            record.errors.append(message)
            record.status = "failed"
            self.logger(f"Workflow failed: {message}")
        record.finished_at = datetime.now(timezone.utc).isoformat()
        record.duration_seconds=max(0.0,(datetime.fromisoformat(record.finished_at)-started).total_seconds())
        self.store.save(record)
        return record
