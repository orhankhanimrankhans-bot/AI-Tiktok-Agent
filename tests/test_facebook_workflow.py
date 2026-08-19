"""Security and execution coverage for the real Facebook workflow adapter."""

from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

from jarvis.workflow.credentials.store import CredentialError, CredentialManager, FacebookCredential
from jarvis.workflow.executor import WorkflowExecutor
from jarvis.workflow.expressions import resolve_value
from jarvis.workflow.connectors.facebook import FacebookAPIError, FacebookConnector
from jarvis.workflow.models import WorkflowConnection, WorkflowDefinition, WorkflowNodeData
from jarvis.workflow.storage import ExecutionStore, WorkflowStore


class FakeResponse:
    def __init__(self, payload): self.payload = json.dumps(payload).encode()
    def read(self): return self.payload
    def __enter__(self): return self
    def __exit__(self, *_args): return False


class FacebookConnectorTests(unittest.TestCase):
    def test_missing_credential_is_truthful(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(CredentialError) as caught:
                CredentialManager().load_facebook("facebook_default")
        self.assertIn("not configured", str(caught.exception))

    def test_list_pages_keeps_page_token_out_of_output(self):
        captured = []
        def opener(request, timeout):
            captured.append((request, timeout))
            return FakeResponse({"data": [{"id": "42", "name": "Jarvis Page", "access_token": "page-secret", "tasks": ["CREATE_CONTENT"]}]})
        connector = FacebookConnector(FacebookCredential("facebook_default", "user-secret", "v25.0"), opener=opener)
        pages = connector.list_pages()
        self.assertEqual(pages, [{"id": "42", "name": "Jarvis Page", "tasks": ["CREATE_CONTENT"]}])
        self.assertNotIn("page-secret", json.dumps(pages))
        self.assertIn("access_token=user-secret", captured[0][0].full_url)

    def test_permission_error_reports_permission_without_token(self):
        token = "extremely-secret-token"
        def opener(_request, timeout):
            body = json.dumps({"error": {"message": f"Token {token} lacks permission", "code": 200}}).encode()
            raise urllib.error.HTTPError("https://graph.facebook.com", 403, "Forbidden", {}, io.BytesIO(body))
        connector = FacebookConnector(FacebookCredential("facebook_default", token, "v25.0", "42"), opener=opener)
        with self.assertRaises(FacebookAPIError) as caught:
            connector.create_page_post("42", "hello")
        self.assertIn("Permission required: pages_manage_posts", str(caught.exception))
        self.assertNotIn(token, str(caught.exception))

    def test_page_post_calls_real_feed_endpoint(self):
        captured = []
        def opener(request, timeout): captured.append(request); return FakeResponse({"id": "42_99"})
        credential = FacebookCredential("facebook_default", "page-token", "v25.0", "42")
        result = FacebookConnector(credential, opener=opener).create_page_post("42", "Real message")
        self.assertEqual(result["id"], "42_99")
        self.assertTrue(captured[0].full_url.endswith("/v25.0/42/feed"))
        self.assertIn(b"message=Real+message", captured[0].data)


class FakeCredentialManager:
    def load_facebook(self, credential_id):
        self.loaded = credential_id
        return FacebookCredential(credential_id, "secret-token", "v25.0", "42")


class FakeConnector:
    calls = []
    def __init__(self, credential): self.credential = credential
    def upload_page_video(self, page_id, video_path, description="", **kwargs):
        self.calls.append((page_id, video_path, description)); return {"id": "video-123"}


class WorkflowExecutionTests(unittest.TestCase):
    def test_expression_resolver_handles_structured_input(self):
        data = {"video_path": "C:/output/final/example.mp4", "caption": "Hello", "nested": {"id": 7}}
        self.assertEqual(resolve_value("{{$json.video_path}}", data), data["video_path"])
        self.assertEqual(resolve_value("Caption: {{$json.caption}}", data), "Caption: Hello")
        self.assertEqual(resolve_value("{{$json.nested.id}}", data), 7)

    def test_dependency_execution_passes_video_to_facebook_and_persists_record(self):
        FakeConnector.calls.clear()
        trigger = WorkflowNodeData("a", "triggers", "Manual Trigger")
        facebook = WorkflowNodeData("b", "facebook", "Facebook Page Video", settings={
            "credential_id": "facebook_default", "operation": "upload_page_video", "page_id": "42",
            "video_path": "{{$json.video_path}}", "description": "{{$json.caption}}",
        })
        workflow = WorkflowDefinition(name="Facebook Video", nodes=[facebook, trigger], connections=[WorkflowConnection("a", "b")])
        with tempfile.TemporaryDirectory() as temp_dir:
            store = ExecutionStore(Path(temp_dir)); manager = FakeCredentialManager()
            executor = WorkflowExecutor(manager, FakeConnector, store)
            record = executor.run(workflow, {"video_path": "C:/output/final/example.mp4", "caption": "Published by Jarvis"})
            self.assertEqual(record.status, "success")
            self.assertEqual([item["node_id"] for item in record.node_results], ["a", "b"])
            self.assertEqual(FakeConnector.calls, [("42", "C:/output/final/example.mp4", "Published by Jarvis")])
            saved = store.list()[0]
            self.assertEqual(saved["execution_id"], record.execution_id)
            self.assertNotIn("secret-token", json.dumps(saved))

    def test_workflow_json_stores_credential_id_not_token(self):
        node = WorkflowNodeData("fb", "facebook", "Facebook", settings={"credential_id": "facebook_default", "operation": "get_page_info", "page_id": "42"})
        workflow = WorkflowDefinition(nodes=[node])
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "workflow.json"; WorkflowStore.save(workflow, path); text = path.read_text(encoding="utf-8")
        self.assertIn("credential_id", text); self.assertNotIn("access_token", text)


if __name__ == "__main__": unittest.main()
