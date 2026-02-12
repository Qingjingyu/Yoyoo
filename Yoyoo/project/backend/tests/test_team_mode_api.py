import os
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
    assert create_body["owner_role"] in {"OPS", "ENG", "QA", "MEM", "INNO", "CH"}

    task_id = create_body["task_id"]
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
    assert result_resp.json()["status"] == "review"
    assert "missing_evidence" in result_resp.json()["issues"]
