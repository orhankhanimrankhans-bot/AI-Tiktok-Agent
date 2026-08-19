from __future__ import annotations

import os
import logging
import subprocess
import webbrowser
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from .config import PROJECT_ROOT
from .memory import memory
from observability import get_logger, log_event


logger = get_logger("desktop.tools")


# ============================================================
# Tool result
# ============================================================

@dataclass
class ToolResult:
    success: bool
    tool: str
    message: str
    data: Optional[Dict[str, Any]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ============================================================
# Application aliases
# ============================================================

APPLICATIONS: Dict[str, list[str]] = {
    "notepad": ["notepad.exe"],

    "calculator": ["calc.exe"],

    "explorer": ["explorer.exe"],

    "vscode": ["code"],
    "vs code": ["code"],
    "visual studio code": ["code"],

    "chrome": ["chrome.exe"],
    "google chrome": ["chrome.exe"],

    "edge": ["msedge.exe"],
    "microsoft edge": ["msedge.exe"],

    "powershell": ["powershell.exe"],

    "cmd": ["cmd.exe"],

    "whatsapp": ["whatsapp:"],
    "واٹس ایپ": ["whatsapp:"],
}


# ============================================================
# Safe Windows tools
# ============================================================

class WindowsTools:
    """
    Safe first version of Jarvis Windows tools.

    Important:
    - No arbitrary shell execution.
    - No eval().
    - No exec().
    - No shell=True.
    - No administrator elevation.
    """

    # --------------------------------------------------------
    # Open application
    # --------------------------------------------------------

    def open_application(self, application: str) -> ToolResult:

        requested = application.strip()
        normalized = requested.lower()

        command = APPLICATIONS.get(normalized)

        if command is None:
            result = ToolResult(
                success=False,
                tool="open_application",
                message=f"Application '{requested}' is not registered.",
            )

            memory.record_action(
                action="open_application",
                target=requested,
                status="failed",
            )

            return result

        try:
            target = command[0]

            # URI application such as WhatsApp
            if target.endswith(":"):
                os.startfile(target)

            else:
                subprocess.Popen(
                    command,
                    shell=False,
                )

            memory.record_action(
                action="open_application",
                target=requested,
                status="success",
            )

            return ToolResult(
                success=True,
                tool="open_application",
                message=f"{requested} launch requested successfully.",
                data={
                    "application": requested,
                },
            )

        except Exception as exc:

            memory.record_action(
                action="open_application",
                target=requested,
                status="failed",
            )

            return ToolResult(
                success=False,
                tool="open_application",
                message=f"Could not open {requested}: {exc}",
            )

    # --------------------------------------------------------
    # Open folder or file
    # --------------------------------------------------------

    def open_path(self, path: str) -> ToolResult:

        try:
            requested_path = Path(path).expanduser()

            if not requested_path.is_absolute():
                requested_path = PROJECT_ROOT / requested_path

            resolved = requested_path.resolve()

            if not resolved.exists():
                return ToolResult(
                    success=False,
                    tool="open_path",
                    message=f"Path does not exist: {resolved}",
                )

            os.startfile(str(resolved))

            memory.record_action(
                action="open_path",
                target=str(resolved),
                status="success",
            )

            return ToolResult(
                success=True,
                tool="open_path",
                message=f"Opened {resolved.name}.",
                data={
                    "path": str(resolved),
                },
            )

        except Exception as exc:

            memory.record_action(
                action="open_path",
                target=path,
                status="failed",
            )

            return ToolResult(
                success=False,
                tool="open_path",
                message=f"Could not open path: {exc}",
            )

    # --------------------------------------------------------
    # Open project in VS Code
    # --------------------------------------------------------

    def open_project_in_vscode(
        self,
        path: str | None = None,
    ) -> ToolResult:

        project = (
            Path(path).expanduser().resolve()
            if path
            else PROJECT_ROOT
        )

        if not project.exists():
            return ToolResult(
                success=False,
                tool="open_project_in_vscode",
                message=f"Project path does not exist: {project}",
            )

        try:
            subprocess.Popen(
                [
                    "code",
                    str(project),
                ],
                shell=False,
            )

            memory.record_action(
                action="open_project_in_vscode",
                target=str(project),
                status="success",
            )

            return ToolResult(
                success=True,
                tool="open_project_in_vscode",
                message="Project opened in VS Code.",
                data={
                    "path": str(project),
                },
            )

        except Exception as exc:

            return ToolResult(
                success=False,
                tool="open_project_in_vscode",
                message=f"Could not open VS Code: {exc}",
            )

    # --------------------------------------------------------
    # Open website
    # --------------------------------------------------------

    def open_website(self, url: str) -> ToolResult:

        cleaned = url.strip()

        if not cleaned.startswith(
            ("https://", "http://")
        ):
            cleaned = "https://" + cleaned

        try:
            opened = webbrowser.open(cleaned)

            if not opened:
                return ToolResult(
                    success=False,
                    tool="open_website",
                    message="Browser did not confirm the URL was opened.",
                )

            memory.record_action(
                action="open_website",
                target=cleaned,
                status="success",
            )

            return ToolResult(
                success=True,
                tool="open_website",
                message=f"Opened {cleaned}",
                data={
                    "url": cleaned,
                },
            )

        except Exception as exc:

            return ToolResult(
                success=False,
                tool="open_website",
                message=f"Could not open website: {exc}",
            )

    # --------------------------------------------------------
    # List project files
    # --------------------------------------------------------

    def list_project_files(
        self,
        limit: int = 100,
    ) -> ToolResult:

        try:
            files = []

            for item in PROJECT_ROOT.iterdir():
                files.append(
                    {
                        "name": item.name,
                        "type": (
                            "folder"
                            if item.is_dir()
                            else "file"
                        ),
                    }
                )

                if len(files) >= limit:
                    break

            return ToolResult(
                success=True,
                tool="list_project_files",
                message=f"Found {len(files)} project items.",
                data={
                    "items": files,
                },
            )

        except Exception as exc:

            return ToolResult(
                success=False,
                tool="list_project_files",
                message=f"Could not list project files: {exc}",
            )


# ============================================================
# Tool Registry
# ============================================================

class ToolRegistry:
    """
    Central registry.

    Jarvis is allowed to call only explicitly registered tools.
    """

    def __init__(self) -> None:

        self.windows = WindowsTools()

        self._tools: Dict[str, Callable[..., ToolResult]] = {
            "open_application":
                self.windows.open_application,

            "open_path":
                self.windows.open_path,

            "open_project_in_vscode":
                self.windows.open_project_in_vscode,

            "open_website":
                self.windows.open_website,

            "list_project_files":
                self.windows.list_project_files,
        }

    def names(self) -> list[str]:
        return sorted(self._tools.keys())

    def has_tool(self, name: str) -> bool:
        return name in self._tools

    def execute(
        self,
        name: str,
        **kwargs: Any,
    ) -> ToolResult:

        tool = self._tools.get(name)
        log_event(logger, logging.INFO, "execution.started", "Desktop tool selected", intent=name, module_selection="jarvis.tools", tool=name)

        if tool is None:
            log_event(logger, logging.WARNING, "execution.failed", "Unknown desktop tool rejected", tool=name, success=False)
            return ToolResult(
                success=False,
                tool=name,
                message=f"Unknown or unauthorized tool: {name}",
            )

        try:
            result = tool(**kwargs)
            log_event(logger, logging.INFO if result.success else logging.WARNING, "execution.completed", "Desktop tool execution completed", tool=name, success=result.success)
            return result

        except TypeError as exc:
            logger.warning("Desktop tool arguments rejected", extra={"event": "execution.failed", "tool": name, "error_type": type(exc).__name__})
            return ToolResult(
                success=False,
                tool=name,
                message=f"Invalid tool arguments: {exc}",
            )

        except Exception as exc:
            logger.exception("Desktop tool failed gracefully", extra={"event": "execution.failed", "tool": name})
            return ToolResult(
                success=False,
                tool=name,
                message=f"Tool failed: {exc}",
            )


# Shared registry
tools = ToolRegistry()
