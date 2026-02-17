from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ExecutorResult:
    ok: bool
    reply: str
    provider: str = "mock"
    error: str | None = None
    evidence: list[dict[str, Any]] | None = None


class ExecutorAdapter:
    """Execution adapter placeholder for Yoyoo 1.0 backend tests."""

    def execute(
        self,
        *,
        task_id: str | None = None,
        instruction: str | None = None,
        user_id: str | None = None,
        conversation_id: str | None = None,
        message: str | None = None,
        route_model: str | None = None,
        channel: str | None = None,
        trace_id: str | None = None,
        preferred_provider: str | None = None,
    ) -> ExecutorResult:
        del task_id, user_id, conversation_id, route_model, channel, trace_id
        task_text = (instruction or message or "").strip()
        if not task_text:
            task_text = "empty_instruction"
        return ExecutorResult(
            ok=True,
            reply=f"mock execution completed: {task_text[:80]}",
            provider=preferred_provider or "mock",
            evidence=[{"source": "executor_adapter", "content": "mock"}],
        )
