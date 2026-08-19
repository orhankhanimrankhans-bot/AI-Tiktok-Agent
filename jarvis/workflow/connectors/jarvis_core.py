"""Adapter around the already-running Jarvis backend."""
from __future__ import annotations
from .base import BaseConnector

class JarvisCoreConnector(BaseConnector):
    def __init__(self, process=None): self.process=process
    def operations(self): return ("ask",)
    def execute(self, operation, config, input_data, context):
        if operation != "ask": raise ValueError(f"Unsupported Jarvis operation: {operation}")
        if self.process is None: raise RuntimeError("Jarvis backend is not connected.")
        prompt=str(config.get("prompt") or input_data.get("prompt") or "").strip()
        if not prompt: raise ValueError("Ask Jarvis requires a prompt.")
        return {**input_data,"text":self.process(prompt),"prompt":prompt}
