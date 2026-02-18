from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_AGENT_ID_PATTERN = re.compile(r"[^a-z0-9_\-]")


def _normalize_agent_id(value: str | None) -> str:
    raw = (value or "").strip().lower()
    if not raw:
        return "ceo"
    normalized = _AGENT_ID_PATTERN.sub("_", raw).strip("_")
    return normalized or "ceo"


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip().lower()


@dataclass(frozen=True)
class AgentBinding:
    agent_id: str
    channel: str = ""
    project_key: str = ""
    peer_kind: str = ""
    peer_id: str = ""


@dataclass(frozen=True)
class AgentRoute:
    agent_id: str
    memory_scope: str
    reason: str
    matched: bool


class AgentRouter:
    """Resolve agent route in single-gateway multi-agent mode."""

    def __init__(self, *, default_agent_id: str = "ceo", bindings: list[AgentBinding] | None = None) -> None:
        self._default_agent_id = _normalize_agent_id(default_agent_id)
        self._bindings = list(bindings or [])

    @property
    def default_agent_id(self) -> str:
        return self._default_agent_id

    def diagnostics(self) -> dict[str, Any]:
        return {
            "default_agent_id": self._default_agent_id,
            "bindings_total": len(self._bindings),
            "bindings": [
                {
                    "agent_id": item.agent_id,
                    "channel": item.channel,
                    "project_key": item.project_key,
                    "peer_kind": item.peer_kind,
                    "peer_id": item.peer_id,
                }
                for item in self._bindings
            ],
        }

    def resolve(
        self,
        *,
        explicit_agent_id: str | None = None,
        channel: str | None = None,
        project_key: str | None = None,
        peer_kind: str | None = None,
        peer_id: str | None = None,
    ) -> AgentRoute:
        normalized_explicit = _normalize_agent_id(explicit_agent_id)
        if explicit_agent_id and normalized_explicit:
            return AgentRoute(
                agent_id=normalized_explicit,
                memory_scope=f"agent:{normalized_explicit}",
                reason="explicit_agent_id",
                matched=True,
            )

        n_channel = _normalize_text(channel)
        n_project = _normalize_text(project_key)
        n_peer_kind = _normalize_text(peer_kind)
        n_peer_id = _normalize_text(peer_id)

        for idx, item in enumerate(self._bindings):
            if item.channel and item.channel != n_channel:
                continue
            if item.project_key and item.project_key != n_project:
                continue
            if item.peer_kind and item.peer_kind != n_peer_kind:
                continue
            if item.peer_id and item.peer_id != n_peer_id:
                continue
            return AgentRoute(
                agent_id=item.agent_id,
                memory_scope=f"agent:{item.agent_id}",
                reason=f"binding[{idx}]",
                matched=True,
            )

        fallback = self._default_agent_id
        return AgentRoute(
            agent_id=fallback,
            memory_scope=f"agent:{fallback}",
            reason="default_agent",
            matched=False,
        )

    @classmethod
    def from_env(cls) -> AgentRouter:
        default_agent_id = os.getenv("YOYOO_DEFAULT_AGENT_ID", "ceo")
        file_path = os.getenv("YOYOO_AGENT_BINDINGS_FILE", "").strip()
        json_text = os.getenv("YOYOO_AGENT_BINDINGS_JSON", "").strip()
        payload: Any = []

        if file_path:
            try:
                content = Path(file_path).read_text(encoding="utf-8")
                payload = json.loads(content)
            except (OSError, json.JSONDecodeError):
                payload = []
        elif json_text:
            try:
                payload = json.loads(json_text)
            except json.JSONDecodeError:
                payload = []

        if isinstance(payload, dict):
            payload = payload.get("bindings", [])
        if not isinstance(payload, list):
            payload = []

        bindings: list[AgentBinding] = []
        for item in payload:
            if not isinstance(item, dict):
                continue
            agent_id = _normalize_agent_id(item.get("agentId") or item.get("agent_id"))
            match = item.get("match")
            if not isinstance(match, dict):
                match = {}
            peer = match.get("peer")
            if not isinstance(peer, dict):
                peer = {}
            bindings.append(
                AgentBinding(
                    agent_id=agent_id,
                    channel=_normalize_text(match.get("channel")),
                    project_key=_normalize_text(match.get("projectKey") or match.get("project_key")),
                    peer_kind=_normalize_text(peer.get("kind")),
                    peer_id=_normalize_text(peer.get("id")),
                )
            )
        return cls(default_agent_id=default_agent_id, bindings=bindings)
