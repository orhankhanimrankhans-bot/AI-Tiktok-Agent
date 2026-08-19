"""Fault-isolated plugin lifecycle management."""

from __future__ import annotations

import logging
from dataclasses import asdict, dataclass
from threading import RLock
from typing import Iterable

from observability import get_logger, log_event
from .base import BasePlugin


logger = get_logger("plugins")


@dataclass
class PluginState:
    name: str
    enabled: bool = True
    phase: str = "registered"
    error: str = ""


class PluginManager:
    def __init__(self, *, enabled: Iterable[str] | None = None, disabled: Iterable[str] = (), context: dict | None = None) -> None:
        self.enabled = {item.casefold() for item in enabled or ()}
        self.disabled = {item.casefold() for item in disabled}
        self.context = dict(context or {})
        self._plugins: dict[str, BasePlugin] = {}
        self._states: dict[str, PluginState] = {}
        self._lock = RLock()
        self._lifecycle_locks: dict[str, RLock] = {}

    def register(self, plugin: BasePlugin) -> bool:
        name = plugin.name.casefold()
        if name in self.disabled or (self.enabled and name not in self.enabled):
            self._states[name] = PluginState(name, enabled=False, phase="disabled")
            log_event(logger, logging.INFO, "plugin.disabled", "Plugin disabled by configuration", plugin=name)
            return False
        with self._lock:
            self._plugins[name] = plugin
            self._states[name] = PluginState(name)
            self._lifecycle_locks[name] = RLock()
        return True

    def start_plugin(self, name: str) -> bool:
        key = name.casefold()
        plugin = self._plugins.get(key)
        if plugin is None:
            return False
        with self._lifecycle_locks[key]:
            with self._lock:
                state = self._states[key]
                if state.phase == "running":
                    return True
            try:
                with self._lock: state.phase = "initializing"
                plugin.initialize(dict(self.context))
                with self._lock: state.phase = "validating"
                validation = plugin.validate()
                if not validation.valid:
                    with self._lock:
                        state.phase = "failed"
                        state.error = validation.message or "Validation failed"
                    log_event(logger, logging.WARNING, "plugin.validation_failed", "Plugin validation failed", plugin=key, success=False)
                    return False
                with self._lock: state.phase = "starting"
                plugin.start()
                with self._lock:
                    state.phase = "running"
                    state.error = ""
                log_event(logger, logging.INFO, "plugin.started", "Plugin started", plugin=key, success=True)
                return True
            except Exception as error:
                with self._lock:
                    state.phase = "failed"
                    state.error = type(error).__name__
                logger.exception("Plugin lifecycle failed gracefully", extra={"event": "plugin.failed", "plugin": key})
                return False

    def stop_plugin(self, name: str) -> bool:
        key = name.casefold()
        plugin = self._plugins.get(key)
        if plugin is None:
            return False
        with self._lifecycle_locks[key]:
            with self._lock:
                if self._states[key].phase in {"stopped", "shutdown"}:
                    return True
            try:
                plugin.stop()
                with self._lock: self._states[key].phase = "stopped"
                log_event(logger, logging.INFO, "plugin.stopped", "Plugin stopped", plugin=key, success=True)
                return True
            except Exception as error:
                with self._lock:
                    self._states[key].phase = "failed"
                    self._states[key].error = type(error).__name__
                logger.exception("Plugin stop failed gracefully", extra={"event": "plugin.stop_failed", "plugin": key})
                return False

    def start_all(self) -> dict[str, bool]:
        return {name: self.start_plugin(name) for name in self._plugins}

    def stop_all(self) -> dict[str, bool]:
        return {name: self.stop_plugin(name) for name in reversed(tuple(self._plugins))}

    def shutdown_all(self) -> None:
        for name, plugin in reversed(tuple(self._plugins.items())):
            try:
                if self._states[name].phase == "running":
                    plugin.stop()
                plugin.shutdown()
                self._states[name].phase = "shutdown"
            except Exception as error:
                self._states[name].phase = "failed"
                self._states[name].error = type(error).__name__
                logger.exception("Plugin shutdown failed gracefully", extra={"event": "plugin.shutdown_failed", "plugin": name})

    def snapshot(self) -> dict[str, dict]:
        with self._lock:
            return {name: asdict(state) for name, state in self._states.items()}
