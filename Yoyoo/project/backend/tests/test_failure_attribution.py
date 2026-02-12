from __future__ import annotations

from datetime import UTC, datetime

from app.intelligence.failure_attribution import analyze_failures, categorize_failure
from app.intelligence.memory import TaskRecord


def _make_failed_task(task_id: str, *, error: str, status: str = "failed") -> TaskRecord:
    now = datetime.now(UTC)
    return TaskRecord(
        task_id=task_id,
        conversation_id="conv_fail",
        user_id="u_fail",
        channel="api",
        project_key="general",
        trace_id="trace_fail",
        request_text="执行部署任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["step"],
        verification_checks=["check"],
        rollback_template=["rollback"],
        status=status,
        executor_error=error,
        updated_at=now,
        created_at=now,
    )


def test_categorize_failure_timeout() -> None:
    category = categorize_failure(status="failed", error="ssh timeout while connecting")
    assert category == "timeout"


def test_analyze_failures_buckets() -> None:
    tasks = [
        _make_failed_task("task_1", error="ssh timeout while connecting"),
        _make_failed_task("task_2", error="connection refused from bridge"),
        _make_failed_task("task_3", error="401 unauthorized token"),
    ]

    result = analyze_failures(tasks=tasks, window_hours=24.0)

    assert result["failed_task_total"] == 3
    assert result["bucket_total"] >= 3
    categories = [item["category"] for item in result["buckets"]]
    assert "timeout" in categories
    assert "network" in categories
    assert "auth" in categories
