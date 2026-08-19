from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.core.jarvis_core import JarvisCore
from app.core.command_router import CommandRouter
from app.core.models import (
    Approval,
    ApprovalStatus,
    PermissionLevel,
    TaskStatus,
    ToolCall,
    ToolResult,
)


class JarvisCoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = TemporaryDirectory()
        self.core = JarvisCore(Path(self.temporary_directory.name) / "agent.db")
        self.core.initialize()

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_agent_and_skill_registration(self) -> None:
        self.assertGreaterEqual(len(self.core.registry.profiles()), 9)
        self.assertIn("upload_tiktok", {skill["name"] for skill in self.core.skills.list()})

    def test_objective_creates_dependency_graph(self) -> None:
        objective = self.core.create_video_objective("Why the sky is blue")
        tasks = self.core.tasks.list_tasks(objective.id)
        self.assertEqual(len(tasks), 11)
        self.assertEqual([task.title for task in self.core.tasks.ready_tasks(objective.id)], ["Select topic"])
        self.assertEqual(
            next(task for task in tasks if task.agent_id == "publisher").status,
            TaskStatus.WAITING_APPROVAL,
        )

    def test_publish_requires_explicit_approval(self) -> None:
        objective = self.core.create_video_objective("Test topic")
        publish = next(task for task in self.core.tasks.list_tasks(objective.id) if task.agent_id == "publisher")
        self.core.approve_publish(publish.id)
        self.assertEqual(self.core.tasks.get_task(publish.id).status, TaskStatus.PENDING)

    def test_events_and_checkpoint_persist(self) -> None:
        objective = self.core.create_video_objective("Memory test")
        self.core.tasks.checkpoint(objective.id, "topic_selected", {"topic": "Memory test"})
        self.assertTrue(self.core.tasks.recent_events())

    def test_command_router_creates_safe_objective(self) -> None:
        result = CommandRouter(self.core).route("Create a TikTok video about black holes")
        self.assertEqual(result.action, "create_video")
        self.assertTrue(result.data["objective_id"])

    def test_soul_settings_persist(self) -> None:
        self.core.settings.update_soul({"quality_threshold": 90, "autonomy_level": "ASSISTED"})
        self.assertEqual(self.core.settings.soul()["quality_threshold"], 90)

    def test_emergency_stop_command_requires_explicit_reactivation(self) -> None:
        router = CommandRouter(self.core)
        self.assertEqual(router.route("Jarvis emergency stop").action, "emergency_stop")
        self.assertTrue(self.core.permissions.emergency_stopped)
        router.route("/jarvis reactivate")
        self.assertFalse(self.core.permissions.emergency_stopped)

    def test_open_whatsapp_routes_locally(self) -> None:
        result = CommandRouter(self.core).route("please open my WhatsApp")
        self.assertEqual(result.action, "whatsapp")
        self.assertTrue(result.data["success"])

    def test_tool_execution_is_audited(self) -> None:
        call = ToolCall(tool="get_system_info", arguments={})
        self.core.tasks.record_tool_call(call)
        result = ToolResult(tool=call.tool, call_id=call.id, success=True, message="System inspected.")
        self.core.tasks.record_tool_result(call, result)
        events = self.core.tasks.recent_events()
        self.assertIn("TOOL_COMPLETED", {event["type"] for event in events})

    def test_approval_has_single_resolution(self) -> None:
        call = ToolCall(tool="terminate_process", arguments={"pid": 12345})
        self.core.tasks.record_tool_call(call)
        approval = self.core.tasks.create_approval(Approval(
            tool_call_id=call.id,
            permission_level=PermissionLevel.CONFIRM_REQUIRED,
            summary="Terminate process 12345",
            consequences="Unsaved work may be lost.",
        ))
        resolved = self.core.tasks.resolve_approval(approval.id, approved=False)
        self.assertEqual(resolved.status, ApprovalStatus.DENIED)
        with self.assertRaises(ValueError):
            self.core.tasks.resolve_approval(approval.id, approved=True)


if __name__ == "__main__":
    unittest.main()
