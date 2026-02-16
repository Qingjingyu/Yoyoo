from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ExecutorResult:
    ok: bool
    reply: str
    error: str | None = None
    evidence: list[dict[str, Any]] | None = None


class ExecutorAdapter:
    """Execution adapter placeholder for Yoyoo 1.0 backend tests."""

    def execute(self, *, task_id: str, instruction: str) -> ExecutorResult:
        del task_id, instruction
        return ExecutorResult(ok=True, reply="mock execution completed", evidence=[])

