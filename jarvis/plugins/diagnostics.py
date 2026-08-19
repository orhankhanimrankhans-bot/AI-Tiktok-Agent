"""Built-in read-only system diagnostics plugin."""

from __future__ import annotations

from .base import BasePlugin, PluginValidation


class DiagnosticsPlugin(BasePlugin):
    name = "diagnostics"
    description = "Safe configuration and service diagnostics"

    def validate(self) -> PluginValidation:
        return PluginValidation(bool(self.context.get("config_report")), "Configuration report is unavailable.")

    def start(self) -> None:
        self.last_report = self.context["config_report"].safe_summary()
