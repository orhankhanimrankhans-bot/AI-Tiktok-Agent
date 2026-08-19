"""Extensible registry for Jarvis agents."""

from __future__ import annotations

from app.agents.base_agent import BaseAgent


class AgentRegistry:
    def __init__(self) -> None:
        self._agents: dict[str, BaseAgent] = {}

    def register(self, agent: BaseAgent) -> BaseAgent:
        if agent.profile.id in self._agents:
            raise ValueError(f"Agent already registered: {agent.profile.id}")
        self._agents[agent.profile.id] = agent
        return agent

    def get(self, agent_id: str) -> BaseAgent:
        try:
            return self._agents[agent_id]
        except KeyError as error:
            raise KeyError(f"Unknown agent: {agent_id}") from error

    def profiles(self) -> list[dict]:
        return [agent.profile.to_dict() for agent in self._agents.values()]

