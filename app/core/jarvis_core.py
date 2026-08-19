"""Jarvis supervisor: plans work, enforces dependencies, and requires publish approval."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import re
from pathlib import Path
from typing import Any

from app.agents.pipeline_agents import (
    FinalQualityAgent, ModuleAgent, PipelineStateAgent, PublisherAgent, ScriptAgent,
    ScriptQualityAgent, TopicAgent, VisualAgent, VoiceAgent,
)
from app.agents.registry import AgentRegistry
from app.core.event_bus import Event, EventBus
from app.core.models import AgentProfile, Objective, PermissionLevel, Priority, Task, TaskStatus, ToolDefinition
from app.core.permission_manager import AutonomyMode, PermissionManager
from app.core.task_manager import TaskManager
from app.core.settings import SettingsStore
from app.skills.registry import Skill, SkillRegistry
from app.tools.file_tools import FileSandbox
from app.tools.registry import ToolRegistry
from app.tools.system_tools import get_system_info
from app.tools.windows_tools import open_application
from app.whatsapp.agent import WhatsAppAgent
from app.orchestrator import run_jarvis_objective


class JarvisCore:
    """Local-first task supervisor. Publishing is always an explicit approval step."""

    def __init__(self, database: Path, max_concurrent_agents: int = 3, safe_mode: bool = False) -> None:
        self.events = EventBus()
        self.tasks = TaskManager(database, self.events)
        self.settings = SettingsStore(self.tasks)
        self.registry = AgentRegistry()
        self.skills = SkillRegistry()
        self.permissions = PermissionManager(AutonomyMode.ASSISTED, safe_mode=safe_mode)
        self.tools = ToolRegistry(self.tasks, self.events, self.permissions)
        self.files = FileSandbox([Path(__file__).resolve().parents[2]])
        self.whatsapp = WhatsAppAgent(Path(__file__).resolve().parents[2], dry_run=safe_mode or None)
        self.max_concurrent_agents = max(1, max_concurrent_agents)
        self.paused = False
        self._register_agents()
        self._register_skills()
        self._register_tools()

    def initialize(self) -> None:
        self.tasks.initialize()
        self.settings.soul()
        self.events.publish(Event("SYSTEM_STARTED", {"component": "JarvisCore"}))

    def _register_agents(self) -> None:
        definitions = [
            ("topic", "Trend Scout", "Selects distinct topics", TopicAgent, ["generate_topic"]),
            ("script", "Script Agent", "Writes short-form narration", ScriptAgent, ["write_script"]),
            ("script_qc", "Script Quality", "Scores narration quality", ScriptQualityAgent, ["evaluate_script"]),
            ("visual", "Visual Director", "Creates scene plans", VisualAgent, ["create_visual_plan"]),
            ("voice", "Voice Agent", "Creates and validates narration", VoiceAgent, ["generate_voice"]),
            ("state", "State Manager", "Saves recoverable checkpoints", PipelineStateAgent, ["save_pipeline"]),
            ("video", "Video Agent", "Runs local FFmpeg production stages", ModuleAgent, ["render_video", "burn_captions", "build_package"]),
            ("final_qc", "Final QC", "Verifies rendered MP4", FinalQualityAgent, ["validate_video"]),
            ("publisher", "Publisher Agent", "Uses the existing TikTok publishing integration after approval", PublisherAgent, ["upload_tiktok"]),
        ]
        for agent_id, name, description, cls, tools in definitions:
            profile = AgentProfile(agent_id, name, name, description, tools, tools)
            self.registry.register(cls(profile, self.tasks, self.events))

    def _register_skills(self) -> None:
        for name, agent in (("generate_topic", "topic"), ("write_script", "script"),
                            ("evaluate_script", "script_qc"), ("create_visual_plan", "visual"),
                            ("generate_voice", "voice"), ("save_pipeline", "state"),
                            ("render_video", "video"), ("burn_captions", "video"),
                            ("build_package", "video"), ("validate_video", "final_qc")):
            self.skills.register(Skill(name, name.replace("_", " "), (agent,)))
        self.skills.register(Skill(
            "upload_tiktok", "Publish an approved video through the existing TikTok publisher",
            ("publisher",), timeout_seconds=600,
        ))

    def _register_tools(self) -> None:
        object_schema = lambda properties, required=(): {
            "type": "object", "properties": properties,
            "required": list(required), "additionalProperties": False,
        }
        self.tools.register(ToolDefinition(
            "get_system_info", "Inspect basic local system status", object_schema({}),
            PermissionLevel.READ_ONLY, category="SYSTEM",
        ), get_system_info)
        self.tools.register(ToolDefinition(
            "list_directory", "List an allowed directory",
            object_schema({"path": {"type": "string"}}, ("path",)),
            PermissionLevel.READ_ONLY, category="FILES",
        ), self.files.list_directory)
        self.tools.register(ToolDefinition(
            "read_text_file", "Read a UTF-8 text file under an allowed root",
            object_schema({"path": {"type": "string"}, "max_characters": {"type": "integer"}}, ("path",)),
            PermissionLevel.READ_ONLY, category="FILES",
        ), self.files.read_text_file)
        self.tools.register(ToolDefinition(
            "search_files", "Find files by name under an allowed root",
            object_schema({"path": {"type": "string"}, "pattern": {"type": "string"}}, ("path", "pattern")),
            PermissionLevel.READ_ONLY, category="FILES",
        ), self.files.search_files)
        self.tools.register(ToolDefinition(
            "create_folder", "Create one folder under an allowed root",
            object_schema({"path": {"type": "string"}}, ("path",)),
            PermissionLevel.SAFE_ACTION, category="FILES",
        ), self.files.create_folder)
        self.tools.register(ToolDefinition(
            "open_application", "Open one application from the configured Windows allowlist",
            object_schema({"application": {"type": "string"}}, ("application",)),
            PermissionLevel.SAFE_ACTION, category="WINDOWS",
        ), open_application)
        self.tools.register(ToolDefinition(
            "create_tiktok_video",
            "Create a local TikTok video package from a topic; publishing is never automatic",
            object_schema({
                "topic": {"type": "string"},
                "raw_demo_mode": {"type": "boolean"},
            }, ("topic",)),
            PermissionLevel.SAFE_ACTION,
            category="TIKTOK",
        ), self.create_tiktok_video)

    @staticmethod
    def extract_tiktok_topic(command: str) -> str | None:
        """Extract a topic from natural Jarvis TikTok creation commands."""
        if not command:
            return None

        text = str(command).strip()

        patterns = (
            r"(?i)^\s*(?:jarvis[\s,:-]*)?(?:please\s+)?"
            r"(?:create|make|generate|produce|build)\s+(?:a\s+)?"
            r"tiktok(?:\s+video)?\s+(?:about|on)\s+(.+?)\s*$",

            r"(?i)^\s*(?:jarvis[\s,:-]*)?(?:please\s+)?"
            r"(?:create|make|generate|produce|build)\s+(?:a\s+)?"
            r"video\s+for\s+tiktok\s+(?:about|on)\s+(.+?)\s*$",
        )

        for pattern in patterns:
            match = re.match(pattern, text)

            if not match:
                continue

            topic = match.group(1).strip().strip("\"'").strip()

            # Voice transcripts often leave sentence punctuation attached to
            # the topic. Remove it before filenames/captions are generated.
            topic = re.sub(r"[\s\.,!?;:]+$", "", topic).strip()

            if topic:
                return topic

        return None

    def create_tiktok_video(
        self,
        topic: str,
        raw_demo_mode: bool = False,
    ) -> dict[str, Any]:
        """Run the proven local TikTok pipeline without automatic publishing."""
        topic = str(topic or "").strip()

        if not topic:
            raise ValueError("A TikTok topic is required.")

        if self.paused:
            raise RuntimeError("Jarvis is paused.")

        self.events.publish(Event(
            "TIKTOK_PIPELINE_REQUESTED",
            {
                "topic": topic,
                "raw_demo_mode": bool(raw_demo_mode),
                "auto_publish": False,
            },
        ))

        try:
            result = run_jarvis_objective(
                topic,
                auto_publish=False,
                raw_demo_mode=bool(raw_demo_mode),
            )
        except Exception as error:
            self.events.publish(Event(
                "TIKTOK_PIPELINE_FAILED",
                {
                    "topic": topic,
                    "error": str(error),
                },
            ))
            raise

        self.events.publish(Event(
            "TIKTOK_PACKAGE_CREATED",
            {
                "topic": topic,
                "auto_publish": False,
            },
        ))

        return result

    def handle_tiktok_command(
        self,
        command: str,
        raw_demo_mode: bool = False,
    ) -> dict[str, Any] | None:
        """Handle commands such as 'Jarvis, create a TikTok about solar panels'."""
        topic = self.extract_tiktok_topic(command)

        if topic is None:
            return None

        return self.create_tiktok_video(
            topic=topic,
            raw_demo_mode=raw_demo_mode,
        )

    def create_video_objective(self, topic: str = "", approval_required: bool = True) -> Objective:
        objective = self.tasks.create_objective(Objective(
            title=f"Create TikTok video{': ' + topic if topic else ''}",
            description="Create a vertical video and hold publishing for human approval.",
            priority=Priority.HIGH, approval_required=approval_required, input_data={"topic": topic},
        ))
        def task(title: str, agent: str, action: str, dependencies: list[str] | None = None, **kwargs: Any) -> Task:
            return Task(title=title, agent_id=agent, action=action, objective_id=objective.id,
                        dependencies=dependencies or [], **kwargs)
        topic_task = task("Select topic", "topic", "generate_topic", input_data={"topic": topic})
        script_task = task("Generate script", "script", "write_script", [topic_task.id])
        script_qc = task("Review script quality", "script_qc", "evaluate_script", [script_task.id])
        visual = task("Create visual plan", "visual", "create_visual_plan", [script_task.id, script_qc.id])
        voice = task("Generate and verify voice", "voice", "generate_voice", [script_task.id, script_qc.id])
        state = task("Save production checkpoint", "state", "save_pipeline", [topic_task.id, script_task.id, visual.id, voice.id])
        render = task("Render vertical video", "video", "render_video", [state.id], max_retries=0)
        captions = task("Burn captions", "video", "burn_captions", [render.id], max_retries=0)
        package = task("Build publishing package", "video", "build_package", [captions.id])
        qc = task("Validate final video", "final_qc", "validate_video", [package.id])
        approval = task("Approve TikTok publishing", "publisher", "publish", [qc.id], status=TaskStatus.WAITING_APPROVAL)
        self.tasks.add_tasks([topic_task, script_task, script_qc, visual, voice, state, render, captions, package, qc, approval])
        return objective

    def run_ready_tasks(self, objective_id: str) -> list[dict[str, Any]]:
        if self.paused:
            return []
        results: list[dict[str, Any]] = []
        while ready := self.tasks.ready_tasks(objective_id):
            with ThreadPoolExecutor(max_workers=self.max_concurrent_agents) as executor:
                futures = {executor.submit(self.registry.get(item.agent_id).execute, item): item for item in ready}
                for future in as_completed(futures):
                    item = futures[future]
                    try:
                        results.append({"task_id": item.id, "result": future.result()})
                    except Exception as error:
                        results.append({"task_id": item.id, "error": str(error)})
            if any("error" in result for result in results[-len(ready):]):
                break
        return results

    def pause(self) -> None:
        self.paused = True
        self.events.publish(Event("SYSTEM_STOPPED", {"reason": "paused"}))

    def resume(self) -> None:
        self.paused = False
        self.events.publish(Event("SYSTEM_STARTED", {"reason": "resumed"}))

    def emergency_stop(self) -> None:
        self.paused = True
        self.permissions.emergency_stop()
        self.events.publish(Event("EMERGENCY_STOP", {"reason": "user_requested"}))

    def reactivate(self) -> None:
        self.permissions.reactivate()
        self.paused = False
        self.events.publish(Event("SYSTEM_REACTIVATED", {"reason": "explicit_user_action"}))

    def approve_publish(self, task_id: str) -> Task:
        task = self.tasks.get_task(task_id)
        if not task or task.agent_id != "publisher" or task.status != TaskStatus.WAITING_APPROVAL:
            raise ValueError("No waiting publish approval exists for this task.")
        task.status = TaskStatus.PENDING
        self.tasks.update_task(task, "PUBLISH_REQUESTED")
        self.events.publish(Event("PUBLISH_REQUESTED", {"approved": True}, task.objective_id, task.id, task.agent_id))
        return task