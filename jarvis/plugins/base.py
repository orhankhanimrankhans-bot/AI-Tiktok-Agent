"""Common lifecycle contract for isolated Jarvis plugins."""

from __future__ import annotations

from abc import ABC
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class PluginValidation:
    valid: bool = True
    message: str = ""


class BasePlugin(ABC):
    name = "base"
    description = "Base plugin"

    def initialize(self, context: dict[str, Any]) -> None:
        self.context = context

    def validate(self) -> PluginValidation:
        return PluginValidation()

    def start(self) -> None:
        pass

    def stop(self) -> None:
        pass

    def shutdown(self) -> None:
        pass
