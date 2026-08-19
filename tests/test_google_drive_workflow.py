from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from jarvis.workflow.connectors.google_drive import GoogleDriveConnector
from jarvis.workflow.credentials.store import GoogleDriveCredential
from jarvis.workflow.executor import WorkflowExecutor
from jarvis.workflow.expressions import resolve_value
from jarvis.workflow.models import WorkflowConnection, WorkflowDefinition, WorkflowNodeData
from jarvis.workflow.scheduler import schedule_slot
from jarvis.workflow.storage import ExecutionStore


class Response:
    def __init__(self, payload=b"", status=200): self.payload=payload; self.status=status
    def read(self, size=-1):
        if not self.payload: return b""
        if size < 0: result,self.payload=self.payload,b""; return result
        result,self.payload=self.payload[:size],self.payload[size:]; return result
    def __enter__(self): return self
    def __exit__(self,*args): return False
    def close(self): pass


class Manager:
    def load_google_drive(self, credential_id): return GoogleDriveCredential(credential_id,"drive-secret")
    def load_facebook(self, credential_id): raise AssertionError("Facebook must not run")


class FakeDrive:
    deleted=[]
    def __init__(self, credential): self.credential=credential
    def execute(self, operation, config, input_data, context):
        if operation == "search": return {**input_data,"files":[{"id":"one","name":"a.mp4"},{"id":"two","name":"b.mp4"}]}
        if operation == "download": return {**input_data,"file_id":"one","local_path":"C:/work/a.mp4"}
        if operation == "delete": self.deleted.append(config["file_id"]); return {**input_data,"deleted":True}
        raise AssertionError(operation)


class GoogleDriveWorkflowTests(unittest.TestCase):
    def test_search_uses_real_drive_query_and_sanitized_shape(self):
        requests=[]
        def opener(request,timeout):
            requests.append(request)
            return Response(json.dumps({"files":[{"id":"abc","name":"video.mp4","mimeType":"video/mp4"}]}).encode())
        connector=GoogleDriveConnector(GoogleDriveCredential("main","secret"),opener=opener)
        result=connector.search(folder_id="folder",query="video",file_type="video/mp4",maximum_results=1)
        self.assertEqual(result["files"][0]["mime_type"],"video/mp4")
        self.assertIn("pageSize=1",requests[0].full_url)
        self.assertNotIn("secret",json.dumps(result))

    def test_safe_expression_supports_list_indexes(self):
        self.assertEqual(resolve_value("{{$json.files[0].id}}",{"files":[{"id":"abc"}]}),"abc")

    def test_limit_and_failure_record_downstream_as_skipped(self):
        nodes=[
            WorkflowNodeData("t","schedule_trigger","Schedule Trigger",settings={"enabled":True}),
            WorkflowNodeData("s","text_data","Search Files and Folders",settings={"fields":{"files":[{"id":"a"},{"id":"b"}]}}),
            WorkflowNodeData("l","limit","Limit",settings={"maximum_items":1}),
            WorkflowNodeData("f","facebook","Facebook Graph API",settings={"operation":"get_page_info","page_id":"42"}),
            WorkflowNodeData("d","google_drive_delete","Delete File",settings={"operation":"delete","credential_id":"google_drive_default","file_id":"a"}),
        ]
        workflow=WorkflowDefinition(nodes=nodes,connections=[WorkflowConnection(nodes[i].id,nodes[i+1].id) for i in range(4)])
        with tempfile.TemporaryDirectory() as directory:
            record=WorkflowExecutor(credential_manager=Manager(),store=ExecutionStore(Path(directory))).run(workflow)
        self.assertEqual([item["status"] for item in record.node_results],["success","success","success","failed","skipped"])
        self.assertEqual(record.node_results[2]["output"]["files"],[{"id":"a"}])
        self.assertEqual(FakeDrive.deleted,[])

    def test_schedule_daily_slot(self):
        node=WorkflowNodeData("t","schedule_trigger","Schedule Trigger",settings={"interval":"daily","time":"09:00","enabled":True})
        self.assertEqual(schedule_slot(node,datetime(2026,8,17,9,0,tzinfo=timezone.utc)),"day:2026-08-17")
        self.assertIsNone(schedule_slot(node,datetime(2026,8,17,9,1,tzinfo=timezone.utc)))


if __name__ == "__main__": unittest.main()
