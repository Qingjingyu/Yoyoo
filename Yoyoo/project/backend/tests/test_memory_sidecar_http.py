from __future__ import annotations

import json

from fastapi.testclient import TestClient

from app.services import memory_sidecar_http


def _write_memory_file(path: str) -> None:
    payload = {
        "tasks": {
            "task_recent": {
                "conversation_id": "conv_a",
                "user_id": "u_a",
                "status": "completed",
                "request_text": "请检查后端服务健康状态",
                "executor_reply": "健康检查通过，服务正常",
                "updated_at": "2026-02-07T12:00:00+00:00",
            },
            "task_other": {
                "conversation_id": "conv_b",
                "user_id": "u_b",
                "status": "failed",
                "request_text": "部署数据库",
                "executor_reply": "连接超时",
                "updated_at": "2026-02-03T12:00:00+00:00",
            },
        },
        "events": {
            "conv_a": [
                {
                    "timestamp": "2026-02-07T12:01:00+00:00",
                    "user_id": "u_a",
                    "direction": "incoming",
                    "text": "帮我看下后端服务",
                    "intent": "task_request",
                }
            ]
        },
    }
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(payload, fh, ensure_ascii=False)


def test_memory_sidecar_http_health_and_retrieve(tmp_path, monkeypatch) -> None:
    storage = tmp_path / "memory.json"
    _write_memory_file(str(storage))
    monkeypatch.setenv("YOYOO_MEMORY_FILE", str(storage))
    monkeypatch.delenv("YOYOO_MEMORY_SIDECAR_TOKEN", raising=False)
    memory_sidecar_http._CACHE_MTIME = None
    memory_sidecar_http._CACHE_PAYLOAD = None

    client = TestClient(memory_sidecar_http.app)
    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"

    response = client.post(
        "/api/v1/retrieve",
        json={
            "query": "检查后端服务健康",
            "user_id": "u_a",
            "conversation_id": "conv_a",
            "limit": 3,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["sufficient"] is True
    assert len(body["items"]) >= 1
    first = body["items"][0]
    assert first["source"] in {"task", "event"}
    assert "后端" in first["text"]


def test_memory_sidecar_http_token_auth(tmp_path, monkeypatch) -> None:
    storage = tmp_path / "memory.json"
    _write_memory_file(str(storage))
    monkeypatch.setenv("YOYOO_MEMORY_FILE", str(storage))
    monkeypatch.setenv("YOYOO_MEMORY_SIDECAR_TOKEN", "token-abc")
    memory_sidecar_http._CACHE_MTIME = None
    memory_sidecar_http._CACHE_PAYLOAD = None
    client = TestClient(memory_sidecar_http.app)

    missing = client.post(
        "/api/v1/retrieve",
        json={
            "query": "检查后端服务健康",
            "user_id": "u_a",
            "conversation_id": "conv_a",
            "limit": 1,
        },
    )
    assert missing.status_code == 401

    ok = client.post(
        "/api/v1/retrieve",
        headers={"Authorization": "Bearer token-abc"},
        json={
            "query": "检查后端服务健康",
            "user_id": "u_a",
            "conversation_id": "conv_a",
            "limit": 1,
        },
    )
    assert ok.status_code == 200
    assert ok.json()["ok"] is True
