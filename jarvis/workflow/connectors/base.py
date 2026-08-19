"""Common connector contract for executable workflow nodes."""
from __future__ import annotations
from abc import ABC, abstractmethod

class BaseConnector(ABC):
    @abstractmethod
    def operations(self) -> tuple[str, ...]: ...
    def test_connection(self, credential=None, config=None):
        return {"success": True, "provider": type(self).__name__}
    @abstractmethod
    def execute(self, operation: str, config: dict, input_data: dict, context): ...
