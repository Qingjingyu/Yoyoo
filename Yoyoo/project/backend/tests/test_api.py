import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import build_container
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolate_memory_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    memory_file = tmp_path / "memory.json"
    monkeypatch.setenv("YOYOO_MEMORY_FILE", str(memory_file))
    app.state.container = build_container()
    yield
    if memory_file.exists():
        os.remove(memory_file)


def test_healthz() -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "yoyoo-backend"}


def test_runtime_identity() -> None:
    response = client.get("/api/v1/runtime/identity")
    body = response.json()

    assert response.status_code == 200
    assert body["assistant_identity"] == "Yoyoo"
    assert body["execution_adapter"] == "ExecutorAdapter"
    assert "execution_providers" in body
    assert "claw" in body["execution_providers"]


def test_ops_health_endpoint() -> None:
    response = client.get("/api/v1/ops/health")
    body = response.json()

    assert response.status_code == 200
    assert body["service"] == "yoyoo-backend"
    assert body["status"] in {"ok", "degraded"}
    assert "startup_self_check" in body
    assert "memory_sidecar_enabled" in body["startup_self_check"]
    assert "memory_sidecar_available" in body["startup_self_check"]
    assert "memory" in body
    assert "task_total" in body["memory"]
    assert "task_intake_total" in body["memory"]
    assert "duplicate_dropped_total" in body["memory"]
    assert "dedupe_hit_rate" in body["memory"]
    assert "persistence" in body["memory"]
    assert "feedback_binding" in body["memory"]
    assert "memory_quality" in body["memory"]
    assert "retrieval_hit_rate" in body["memory"]["memory_quality"]
    assert "alerts" in body
    assert "alert_status" in body
    assert "trend" in body
    assert "last_24h" in body["trend"]
    assert "last_7d" in body["trend"]
    assert "task_success_rate_delta" in body["trend"]
    assert "failures" in body
    assert "baseline_7d_failed_task_total" in body["failures"]


def test_ops_alerts_endpoint_with_feedback_threshold(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOYOO_ALERT_FEEDBACK_MIN_ATTEMPTS", "1")
    monkeypatch.setenv("YOYOO_ALERT_FEEDBACK_MIN_SUCCESS_RATE", "0.95")
    monkeypatch.setenv("YOYOO_ALERT_FEEDBACK_MAX_NOT_FOUND_RATE", "0.01")
    app.state.container.memory_service.record_feedback_binding_attempt(
        source="not_found",
        success=False,
    )

    response = client.get("/api/v1/ops/alerts")
    body = response.json()
    codes = [item.get("code") for item in body["alerts"]]

    assert response.status_code == 200
    assert body["alert_count"] >= 1
    assert body["alert_status"] in {"warning", "critical"}
    assert "feedback_binding_success_rate_low" in codes
    assert "feedback_binding_not_found_rate_high" in codes


def test_ops_failures_endpoint_with_classification() -> None:
    memory = app.state.container.memory_service
    timeout_task = memory.create_task_record(
        conversation_id="api:u_ops_failure",
        user_id="u_ops_failure",
        channel="api",
        project_key="proj_ops_failure",
        trace_id="trace_ops_failure_1",
        request_text="执行部署任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=timeout_task.task_id,
        status="failed",
        executor_error="ssh timeout while connecting",
    )
    network_task = memory.create_task_record(
        conversation_id="api:u_ops_failure",
        user_id="u_ops_failure",
        channel="api",
        project_key="proj_ops_failure",
        trace_id="trace_ops_failure_2",
        request_text="执行部署任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=network_task.task_id,
        status="failed",
        executor_error="connection refused from bridge",
    )

    response = client.get("/api/v1/ops/failures?window_hours=24&limit=50")
    body = response.json()
    categories = [item.get("category") for item in body["failures"]["buckets"]]

    assert response.status_code == 200
    assert body["status"] == "ok"
    assert body["failures"]["failed_task_total"] >= 2
    assert "timeout" in categories
    assert "network" in categories


def test_ops_failures_endpoint_defaults_to_recent_window() -> None:
    response = client.get("/api/v1/ops/failures?limit=30")
    body = response.json()

    assert response.status_code == 200
    assert body["window_hours"] == 24.0
    assert body["baseline_window_hours"] == 168.0
    assert body["recent_focus"] is True
    assert "baseline" in body
    assert "failed_task_total" in body["baseline"]


def test_ops_alerts_endpoint_with_memory_quality_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("YOYOO_ALERT_MEMORY_MIN_RETRIEVAL_QUERIES", "1")
    monkeypatch.setenv("YOYOO_ALERT_MEMORY_MIN_HIT_RATE", "0.5")
    app.state.container.memory_service.record_memory_pipeline_metrics(
        retrieved_count=5,
        deduped_count=0,
    )

    response = client.get("/api/v1/ops/alerts")
    body = response.json()
    codes = [item.get("code") for item in body["alerts"]]

    assert response.status_code == 200
    assert "memory_retrieval_hit_rate_low" in codes


def test_ops_alerts_endpoint_with_strategy_performance_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("YOYOO_ALERT_MEMORY_MIN_STRATEGY_CARDS", "1")
    monkeypatch.setenv("YOYOO_ALERT_MEMORY_MAX_LOW_PERFORMANCE_RATE", "0.0")
    memory = app.state.container.memory_service

    seed_1 = memory.create_task_record(
        conversation_id="api:u_alert_strategy",
        user_id="u_alert_strategy",
        channel="api",
        project_key="proj_alert_strategy",
        trace_id="trace_alert_strategy_1",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=seed_1.task_id,
        status="failed",
        executor_error="timeout while executing",
    )
    seed_2 = memory.create_task_record(
        conversation_id="api:u_alert_strategy",
        user_id="u_alert_strategy",
        channel="api",
        project_key="proj_alert_strategy",
        trace_id="trace_alert_strategy_2",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=seed_2.task_id,
        status="failed",
        executor_error="timeout while executing",
    )
    cards = memory.build_strategy_cards(
        user_id="u_alert_strategy",
        channel="api",
        project_key="proj_alert_strategy",
        query="继续部署后端服务",
        intent="task_request",
        limit=1,
    )
    assert cards
    selected = cards[0].card_id
    run = memory.create_task_record(
        conversation_id="api:u_alert_strategy",
        user_id="u_alert_strategy",
        channel="api",
        project_key="proj_alert_strategy",
        trace_id="trace_alert_strategy_3",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=run.task_id,
        status="failed",
        executor_error="timeout while executing",
        strategy_cards_used=[selected],
    )
    memory.apply_task_feedback(task_id=run.task_id, feedback="bad", note="策略表现差")

    response = client.get("/api/v1/ops/alerts")
    body = response.json()
    codes = [item.get("code") for item in body["alerts"]]

    assert response.status_code == 200
    assert "memory_strategy_low_performance_rate_high" in codes


def test_ops_alerts_endpoint_with_feedback_conflict_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("YOYOO_ALERT_MEMORY_MAX_CONFLICT_RATE", "0.0")
    memory = app.state.container.memory_service
    task = memory.create_task_record(
        conversation_id="api:u_alert_conflict",
        user_id="u_alert_conflict",
        channel="api",
        project_key="proj_alert_conflict",
        trace_id="trace_alert_conflict_1",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=task.task_id,
        status="completed",
        executor_reply="done",
    )
    memory.apply_task_feedback(task_id=task.task_id, feedback="good", note="这次很好")
    memory.apply_task_feedback(task_id=task.task_id, feedback="bad", note="修正：这次不好")

    response = client.get("/api/v1/ops/alerts")
    body = response.json()
    codes = [item.get("code") for item in body["alerts"]]

    assert response.status_code == 200
    assert "memory_feedback_conflict_rate_high" in codes


def test_chat() -> None:
    payload = {"user_id": "u_001", "message": "hello"}
    response = client.post("/api/v1/chat", json=payload)

    body = response.json()
    assert response.status_code == 200
    assert "你好" in body["reply"]
    assert body["model"] == "local/mock"
    assert body["intent"] == "greeting"
    assert body["safety_blocked"] is False
    assert body["route_model"] == "minimax/MiniMax-M2.1"
    assert body["plan_steps"] is None
    assert isinstance(body["trace_id"], str)
    assert body["trace_id"]
    assert response.headers["x-trace-id"] == body["trace_id"]


def test_chat_rejects_empty_message() -> None:
    payload = {"user_id": "u_001", "message": ""}
    response = client.post("/api/v1/chat", json=payload)

    assert response.status_code == 422


def test_chat_learns_user_name() -> None:
    response_1 = client.post("/api/v1/chat", json={"user_id": "u_007", "message": "我叫苏白"})
    response_2 = client.post("/api/v1/chat", json={"user_id": "u_007", "message": "你好"})

    assert response_1.status_code == 200
    assert "苏白" in response_1.json()["reply"]
    assert response_2.status_code == 200
    assert "苏白" in response_2.json()["reply"]


def test_chat_blocks_risky_instruction() -> None:
    response = client.post(
        "/api/v1/chat",
        json={"user_id": "u_009", "message": "帮我执行 rm -rf /"},
    )

    body = response.json()
    assert response.status_code == 200
    assert body["safety_blocked"] is True
    assert "高风险" in body["reply"]


def test_chat_task_request_generates_plan() -> None:
    response = client.post(
        "/api/v1/chat",
        json={"user_id": "u_dev", "message": "帮我开发一个可上线的页面并部署"},
    )

    body = response.json()
    assert response.status_code == 200
    assert body["intent"] == "task_request"
    assert body["route_model"] in {"openai/gpt-5.2-codex", "anthropic/claude-opus-4-5"}
    assert isinstance(body["plan_steps"], list)
    assert body["plan_steps"]
    assert isinstance(body["verification_checks"], list)
    assert body["verification_checks"]
    assert isinstance(body["rollback_template"], list)
    assert body["rollback_template"]
    assert isinstance(body["task_id"], str)
    assert body["task_id"]
    assert isinstance(body["strategy_cards"], list)
    assert "strategy_id" in body
    if body["strategy_cards"]:
        assert body["strategy_id"] == body["strategy_cards"][0]
    else:
        assert body["strategy_id"] is None
    assert isinstance(body.get("execution_duration_ms"), int)
    assert body["execution_duration_ms"] >= 0
    assert isinstance(body.get("evidence_structured"), list)
    assert body["evidence_structured"]
    assert (
        isinstance(body["execution_quality_score"], (int, float))
        or body["execution_quality_score"] is None
    )
    assert (
        isinstance(body["execution_quality_issues"], list)
        or body["execution_quality_issues"] is None
    )
    assert isinstance(body["execution_corrected"], bool)
    assert "反馈方式：直接回复这条消息" in body["reply"]


def test_chat_followup_task_message_is_task_request() -> None:
    response = client.post(
        "/api/v1/chat",
        json={"user_id": "u_follow", "message": "继续部署后端服务"},
    )

    body = response.json()
    assert response.status_code == 200
    assert body["intent"] == "task_request"
    assert isinstance(body["task_id"], str)
    assert body["task_id"]


def test_recent_tasks_endpoint() -> None:
    response = client.post(
        "/api/v1/chat",
        json={"user_id": "u_lgr", "message": "帮我执行一个部署任务"},
    )
    body = response.json()
    task_id = body["task_id"]

    tasks_response = client.get("/api/v1/tasks/api:u_lgr")
    tasks_body = tasks_response.json()

    assert tasks_response.status_code == 200
    assert tasks_body["conversation_id"] == "api:u_lgr"
    assert tasks_body["count"] >= 1
    matched = [item for item in tasks_body["tasks"] if item["task_id"] == task_id]
    assert matched
    task_item = matched[0]
    assert "quality_score" in task_item
    assert "quality_issues" in task_item
    assert "correction_applied" in task_item
    assert "strategy_cards_used" in task_item
    assert "evidence" in task_item
    assert "evidence_structured" in task_item
    assert "execution_duration_ms" in task_item
    assert "human_feedback" in task_item
    assert "human_feedback_weight" in task_item
    assert "feedback_note" in task_item
    assert "feedback_updated_at" in task_item
    assert "started_at" in task_item
    assert "last_heartbeat_at" in task_item
    assert "closed_at" in task_item
    assert "close_reason" in task_item


def test_task_lifecycle_heartbeat_and_close() -> None:
    response = client.post(
        "/api/v1/chat",
        json={"user_id": "u_lifecycle", "message": "帮我执行一个部署任务"},
    )
    body = response.json()
    assert response.status_code == 200
    task_id = body["task_id"]
    assert isinstance(task_id, str)

    heartbeat = client.post(
        f"/api/v1/tasks/{task_id}/heartbeat",
        json={"note": "长任务继续执行中"},
    )
    heartbeat_body = heartbeat.json()
    assert heartbeat.status_code == 200
    assert heartbeat_body["ok"] is True
    assert heartbeat_body["task_id"] == task_id
    assert isinstance(heartbeat_body["last_heartbeat_at"], str)

    close = client.post(
        f"/api/v1/tasks/{task_id}/close",
        json={
            "status": "completed",
            "reason": "人工确认完成",
            "summary": "任务执行完成，已验收",
        },
    )
    close_body = close.json()
    assert close.status_code == 200
    assert close_body["ok"] is True
    assert close_body["status"] == "completed"
    assert close_body["close_reason"] == "人工确认完成"
    assert isinstance(close_body["closed_at"], str)

    detail = client.get(f"/api/v1/tasks/id/{task_id}")
    detail_body = detail.json()
    assert detail.status_code == 200
    assert detail_body["ok"] is True
    assert detail_body["task"]["task_id"] == task_id
    assert detail_body["task"]["status"] == "completed"
    assert isinstance(detail_body["task"]["last_heartbeat_at"], str)
    assert isinstance(detail_body["task"]["closed_at"], str)
    assert detail_body["task"]["close_reason"] == "人工确认完成"


def test_trace_lookup_endpoint() -> None:
    response = client.post(
        "/api/v1/chat",
        headers={"x-trace-id": "trace_lookup_001"},
        json={"user_id": "u_trace", "message": "帮我执行一个部署任务"},
    )
    assert response.status_code == 200

    trace_response = client.get("/api/v1/traces/trace_lookup_001")
    trace_body = trace_response.json()

    assert trace_response.status_code == 200
    assert trace_body["trace_id"] == "trace_lookup_001"
    assert trace_body["event_count"] >= 2
    assert trace_body["task_count"] >= 1
    first_task = trace_body["tasks"][0]
    assert "quality_score" in first_task
    assert "quality_issues" in first_task
    assert "correction_applied" in first_task
    assert "strategy_cards_used" in first_task
    assert "evidence" in first_task
    assert "evidence_structured" in first_task
    assert "execution_duration_ms" in first_task
    assert "human_feedback" in first_task
    assert "human_feedback_weight" in first_task
    assert "feedback_note" in first_task
    assert "feedback_updated_at" in first_task
    assert "started_at" in first_task
    assert "last_heartbeat_at" in first_task
    assert "closed_at" in first_task
    assert "close_reason" in first_task


def test_task_feedback_endpoint_updates_task() -> None:
    response = client.post(
        "/api/v1/chat",
        headers={"x-trace-id": "trace_feedback_api_001"},
        json={"user_id": "u_feedback_api", "message": "帮我执行部署任务"},
    )
    assert response.status_code == 200
    task_id = response.json()["task_id"]
    assert isinstance(task_id, str)

    feedback_response = client.post(
        f"/api/v1/tasks/{task_id}/feedback",
        json={"feedback": "good", "note": "这次结果质量不错"},
    )
    feedback_body = feedback_response.json()
    assert feedback_response.status_code == 200
    assert feedback_body["ok"] is True
    assert feedback_body["task_id"] == task_id
    assert feedback_body["human_feedback"] == "good"
    assert feedback_body["feedback_note"] == "这次结果质量不错"
    assert isinstance(feedback_body["feedback_updated_at"], str)

    trace_response = client.get("/api/v1/traces/trace_feedback_api_001")
    trace_body = trace_response.json()
    assert trace_response.status_code == 200
    matched = [item for item in trace_body["tasks"] if item["task_id"] == task_id]
    assert matched
    assert matched[0]["human_feedback"] == "good"
    assert isinstance(matched[0]["human_feedback_weight"], float)
    assert matched[0]["feedback_note"] == "这次结果质量不错"
    assert isinstance(matched[0]["feedback_updated_at"], str)


def test_chat_direct_feedback_updates_recent_task() -> None:
    first = client.post(
        "/api/v1/chat",
        headers={"x-trace-id": "trace_chat_feedback_001"},
        json={"user_id": "u_chat_fb", "message": "请执行一个部署任务并反馈"},
    )
    assert first.status_code == 200
    task_id = first.json()["task_id"]
    assert isinstance(task_id, str)

    second = client.post(
        "/api/v1/chat",
        headers={"x-trace-id": "trace_chat_feedback_002"},
        json={"user_id": "u_chat_fb", "message": "这次做得很好"},
    )
    body = second.json()
    assert second.status_code == 200
    assert body["intent"] == "task_feedback"
    assert body["task_id"] == task_id

    trace = client.get("/api/v1/traces/trace_chat_feedback_001")
    trace_body = trace.json()
    matched = [item for item in trace_body["tasks"] if item["task_id"] == task_id]
    assert matched
    assert matched[0]["human_feedback"] == "good"


def test_chat_feedback_binding_explain_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOYOO_FEEDBACK_BINDING_EXPLAIN", "false")
    app.state.container = build_container()

    first = client.post(
        "/api/v1/chat",
        json={"user_id": "u_chat_fb_switch", "message": "请执行一个部署任务并反馈"},
    )
    assert first.status_code == 200
    task_id = first.json()["task_id"]
    assert isinstance(task_id, str)

    second = client.post(
        "/api/v1/chat",
        json={"user_id": "u_chat_fb_switch", "message": "这次做得很好"},
    )
    body = second.json()

    assert second.status_code == 200
    assert body["intent"] == "task_feedback"
    assert body["task_id"] == task_id
    assert "绑定依据：" not in body["reply"]
