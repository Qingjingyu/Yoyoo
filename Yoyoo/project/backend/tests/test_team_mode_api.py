import os
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.container import build_container
from app.main import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def _isolate_memory_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    memory_file = tmp_path / "memory_team.json"
    monkeypatch.setenv("YOYOO_MEMORY_FILE", str(memory_file))
    app.state.container = build_container()
    yield
    if memory_file.exists():
        os.remove(memory_file)


def test_team_mode_api_create_submit_and_query() -> None:
    create_resp = client.post(
        "/api/v1/team/tasks",
        json={
            "user_id": "u_team",
            "message": "请部署后端服务并验收",
            "channel": "api",
            "project_key": "proj_team",
        },
    )
    create_body = create_resp.json()

    assert create_resp.status_code == 200
    assert create_body["ok"] is True
    assert create_body["task_id"].startswith("task_")
    assert create_body["owner_role"] == "CTO"
    assert create_body["resolved_agent_id"] == "ceo"
    assert create_body["memory_scope"] == "agent:ceo"
    assert create_body["cto_lane"] is not None
    assert create_body["execution_mode"] in {"subagent", "employee_instance"}
    assert isinstance(create_body["eta_minutes"], int)
    assert create_body["eta_minutes"] > 0
    assert "已接单" in create_body["reply"]

    task_id = create_body["task_id"]
    progress_resp = client.post(
        f"/api/v1/team/tasks/{task_id}/progress",
        json={
            "role": create_body["owner_role"],
            "stage": "executing",
            "detail": "CTO 正在执行部署步骤",
            "evidence": [{"source": "log", "content": "step-1 start"}],
        },
    )
    progress_body = progress_resp.json()

    assert progress_resp.status_code == 200
    assert progress_body["ok"] is True
    assert progress_body["status"] == "running"
    assert "CEO 阶段汇报" in progress_body["reply"]

    result_resp = client.post(
        f"/api/v1/team/tasks/{task_id}/result",
        json={
            "role": create_body["owner_role"],
            "reply": "执行完成",
            "evidence": [{"source": "log", "content": "service healthy"}],
        },
    )
    result_body = result_resp.json()

    assert result_resp.status_code == 200
    assert result_body["ok"] is True
    assert result_body["status"] == "done"

    query_resp = client.get(f"/api/v1/team/tasks/{task_id}")
    query_body = query_resp.json()

    assert query_resp.status_code == 200
    assert query_body["task_id"] == task_id
    assert query_body["status"] == "done"
    assert query_body["agent_id"] == "ceo"
    assert query_body["memory_scope"] == "agent:ceo"
    assert query_body["cto_lane"] is not None
    assert query_body["execution_mode"] in {"subagent", "employee_instance"}
    assert isinstance(query_body["eta_minutes"], int)
    assert isinstance(query_body["timeline"], list)
    assert any(item.get("event") == "dispatched" for item in query_body["timeline"])
    assert any(item.get("event") == "progress" for item in query_body["timeline"])


def test_team_mode_api_result_without_evidence_goes_review() -> None:
    create_resp = client.post(
        "/api/v1/team/tasks",
        json={
            "user_id": "u_team2",
            "message": "请修复接口并汇报",
            "channel": "api",
            "project_key": "proj_team2",
        },
    )
    task_id = create_resp.json()["task_id"]
    role = create_resp.json()["owner_role"]

    result_resp = client.post(
        f"/api/v1/team/tasks/{task_id}/result",
        json={
            "role": role,
            "reply": "已经修复",
            "evidence": [],
        },
    )

    assert result_resp.status_code == 200
    body = result_resp.json()
    assert body["status"] == "review"
    assert body["corrected"] is True
    assert body["rework_count"] == 1
    assert "missing_evidence" in body["issues"]
    assert "auto_rework_once" in body["issues"]

    detail_resp = client.get(f"/api/v1/team/tasks/{task_id}")
    detail_body = detail_resp.json()
    assert detail_resp.status_code == 200
    assert detail_body["rework_count"] == 1


def test_team_mode_api_rejects_non_cto_submit() -> None:
    create_resp = client.post(
        "/api/v1/team/tasks",
        json={
            "user_id": "u_team3",
            "message": "请执行一次发布并汇报",
            "channel": "api",
            "project_key": "proj_team3",
        },
    )
    task_id = create_resp.json()["task_id"]

    progress_resp = client.post(
        f"/api/v1/team/tasks/{task_id}/progress",
        json={
            "role": "OPS",
            "stage": "executing",
            "detail": "非 CTO 回报",
            "evidence": [],
        },
    )
    result_resp = client.post(
        f"/api/v1/team/tasks/{task_id}/result",
        json={
            "role": "QA",
            "reply": "非 CTO 提交",
            "evidence": [{"source": "log", "content": "n/a"}],
        },
    )

    assert progress_resp.status_code == 200
    assert progress_resp.json()["ok"] is False
    assert progress_resp.json()["status"] == "failed"

    assert result_resp.status_code == 200
    assert result_resp.json()["ok"] is False
    assert result_resp.json()["status"] == "failed"
    assert "invalid_executor_role" in result_resp.json()["issues"]


def test_team_mode_api_watchdog_scan() -> None:
    create_resp = client.post(
        "/api/v1/team/tasks",
        json={
            "user_id": "u_watchdog",
            "message": "请执行部署并持续汇报",
            "channel": "api",
            "project_key": "proj_watchdog",
        },
    )
    task_id = create_resp.json()["task_id"]
    record = app.state.container.memory_service.get_task_record(task_id=task_id)
    assert record is not None

    now = datetime.now(UTC)
    record.updated_at = now - timedelta(seconds=130)
    record.last_heartbeat_at = now - timedelta(seconds=130)

    watchdog_resp = client.post(
        "/api/v1/team/watchdog/scan",
        json={
            "stale_progress_sec": 90,
            "stale_degrade_sec": 300,
            "max_scan": 100,
            "min_repeat_sec": 30,
        },
    )
    watchdog_body = watchdog_resp.json()
    assert watchdog_resp.status_code == 200
    assert watchdog_body["ok"] is True
    assert watchdog_body["nudged"] >= 1

    detail_resp = client.get(f"/api/v1/team/tasks/{task_id}")
    detail_body = detail_resp.json()
    assert any(item.get("event") == "nudge" for item in detail_body["timeline"])


def test_team_mode_api_list_tasks_for_user() -> None:
    for idx in range(2):
        client.post(
            "/api/v1/team/tasks",
            json={
                "user_id": "u_list",
                "message": f"请执行列表测试任务-{idx}",
                "channel": "web",
                "project_key": "proj_list",
            },
        )
    client.post(
        "/api/v1/team/tasks",
        json={
            "user_id": "u_other",
            "message": "这条不应出现在 u_list 列表中",
            "channel": "web",
            "project_key": "proj_other",
        },
    )

    list_resp = client.get("/api/v1/team/tasks", params={"user_id": "u_list", "channel": "web"})
    body = list_resp.json()

    assert list_resp.status_code == 200
    assert body["ok"] is True
    assert body["user_id"] == "u_list"
    assert body["total"] >= 2
    assert all(item["task_id"].startswith("task_") for item in body["items"])
    assert all(item["owner_role"] == "CTO" for item in body["items"])
    assert all(item["agent_id"] == "ceo" for item in body["items"])
    assert all("rework_count" in item for item in body["items"])


def test_team_mode_api_runtime_health_endpoint() -> None:
    resp = client.get("/api/v1/team/runtime/health")
    body = resp.json()

    assert resp.status_code == 200
    assert body["ok"] is True
    assert "backend_version" in body
    assert isinstance(body.get("watchdog"), dict)
    assert isinstance(body.get("executor"), dict)
    assert isinstance(body.get("memory"), dict)
    assert isinstance(body.get("router"), dict)
    assert "timestamp" in body


def test_team_mode_api_ceo_chat_endpoint() -> None:
    resp = client.post(
        "/api/v1/team/chat/ceo",
        json={
            "user_id": "u_ceo_chat",
            "message": "你好，你有什么能力？",
            "channel": "web",
            "project_key": "proj_ui",
        },
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["ok"] is True
    assert isinstance(body["reply"], str) and body["reply"]
    assert body["task_intent"] is False
    assert body["require_confirmation"] is False
    assert body["resolved_agent_id"] == "ceo"
    assert body["memory_scope"] == "agent:ceo"


def test_team_mode_api_ceo_chat_detects_task_intent() -> None:
    resp = client.post(
        "/api/v1/team/chat/ceo",
        json={
            "user_id": "u_ceo_task",
            "message": "请帮我开发一个内部任务看板系统，并安排执行",
            "channel": "web",
            "project_key": "proj_ui",
        },
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["ok"] is True
    assert body["task_intent"] is True
    assert body["require_confirmation"] is True
    assert body["suggested_executor"] == "CTO"
    assert isinstance(body["eta_minutes"], int)


def test_team_mode_api_ceo_chat_ops_report_query(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOYOO_OPS_CHAT_PUSH_DEFAULT", "0")
    resp = client.post(
        "/api/v1/team/chat/ceo",
        json={
            "user_id": "u_ops_chat",
            "message": "帮我看下运维情况",
            "channel": "web",
            "project_key": "proj_ops",
        },
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["ok"] is True
    assert body["task_intent"] is False
    assert body["require_confirmation"] is False
    assert "Yoyoo 运维概览" in body["reply"]
    assert "服务器:" in body["reply"]
    assert "模型:" in body["reply"]


def test_team_mode_api_ceo_chat_ops_report_detail_query(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("YOYOO_OPS_CHAT_PUSH_DEFAULT", "0")
    resp = client.post(
        "/api/v1/team/chat/ceo",
        json={
            "user_id": "u_ops_chat_detail",
            "message": "查看运维详细报告",
            "channel": "web",
            "project_key": "proj_ops",
        },
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["ok"] is True
    assert "Yoyoo 运维概览" in body["reply"]
    assert "详细补充：" in body["reply"]
    assert "记忆概述:" in body["reply"]
    assert "服务器:" in body["reply"]
    assert "模型:" in body["reply"]


def test_team_mode_api_ops_report_endpoint_without_push(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("YOYOO_GUARD_ALERT_WEBHOOK", raising=False)
    monkeypatch.delenv("YOYOO_GUARD_ALERT_FEISHU_APP_ID", raising=False)
    monkeypatch.delenv("YOYOO_GUARD_ALERT_FEISHU_APP_SECRET", raising=False)
    monkeypatch.delenv("YOYOO_GUARD_ALERT_FEISHU_OPEN_ID", raising=False)

    resp = client.post(
        "/api/v1/team/ops/report",
        json={
            "push_feishu": False,
            "scan_now": True,
            "recover_now": False,
        },
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["ok"] is True
    assert body["pushed"] is False
    assert "summary" in body and "Yoyoo 运维概览" in body["summary"]
    assert isinstance(body.get("report"), dict)
    assert "watchdog" in body["report"]
    assert "memory" in body["report"]
    assert "server" in body["report"]
    assert "model" in body["report"]


def test_team_mode_api_route_by_binding_and_filter_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "YOYOO_AGENT_BINDINGS_JSON",
        '[{"agentId":"writer","match":{"channel":"feishu","peer":{"kind":"group","id":"oc_writer"}}}]',
    )
    app.state.container = build_container()

    create_resp = client.post(
        "/api/v1/team/tasks",
        json={
            "user_id": "u_writer",
            "message": "请产出一篇运营文案",
            "channel": "feishu",
            "project_key": "proj_writer",
            "peer_kind": "group",
            "peer_id": "oc_writer",
        },
    )
    create_body = create_resp.json()
    assert create_resp.status_code == 200
    assert create_body["resolved_agent_id"] == "writer"
    assert create_body["memory_scope"] == "agent:writer"

    list_resp = client.get(
        "/api/v1/team/tasks",
        params={"user_id": "u_writer", "channel": "feishu", "agent_id": "writer"},
    )
    list_body = list_resp.json()
    assert list_resp.status_code == 200
    assert list_body["total"] >= 1
    assert all(item["agent_id"] == "writer" for item in list_body["items"])

    monkeypatch.delenv("YOYOO_AGENT_BINDINGS_JSON", raising=False)
    app.state.container = build_container()


def test_team_mode_api_run_task_and_recover() -> None:
    create_resp = client.post(
        "/api/v1/team/tasks",
        json={
            "user_id": "u_run",
            "message": "请执行一次任务并回传结果",
            "channel": "api",
            "project_key": "proj_run",
        },
    )
    task_id = create_resp.json()["task_id"]

    run_resp = client.post(
        f"/api/v1/team/tasks/{task_id}/run",
        json={"max_attempts": 2, "resume": True},
    )
    run_body = run_resp.json()
    assert run_resp.status_code == 200
    assert run_body["task_id"] == task_id
    assert run_body["status"] in {"done", "review", "failed"}
    assert run_body["attempts_used"] >= 1

    record = app.state.container.memory_service.get_task_record(task_id=task_id)
    assert record is not None
    record.updated_at = datetime.now(UTC) - timedelta(seconds=300)
    record.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=300)
    record.status = "running"

    recover_resp = client.post(
        "/api/v1/team/watchdog/recover",
        json={"max_scan": 50, "stale_seconds": 120, "max_attempts": 2},
    )
    recover_body = recover_resp.json()
    assert recover_resp.status_code == 200
    assert recover_body["ok"] is True
    assert "details" in recover_body
