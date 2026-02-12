from __future__ import annotations

import subprocess

from fastapi.testclient import TestClient

from app.services.openclaw_http_bridge import app

client = TestClient(app)


def test_bridge_healthz(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENCLAW_REMOTE_OPENCLAW_BIN", "openclaw")
    response = client.get("/healthz")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["service"] == "openclaw-http-bridge"
    assert body["bin"] == "openclaw"


def test_bridge_requires_token_when_configured(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENCLAW_BRIDGE_TOKEN", "token_abc")
    response = client.post(
        "/bridge/chat",
        json={
            "user_id": "u_1",
            "conversation_id": "c_1",
            "message": "hello",
            "channel": "dingtalk",
        },
    )

    assert response.status_code == 401


def test_bridge_success_response(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENCLAW_BRIDGE_TOKEN", "token_ok")
    captured: dict[str, object] = {}

    def _fake_run(*args, **kwargs):  # type: ignore[no-untyped-def]
        captured["command"] = args[0]
        _ = kwargs
        return subprocess.CompletedProcess(
            args=args[0],
            returncode=0,
            stdout='{"ok":true,"reply":"bridge-ok"}',
            stderr="",
        )

    monkeypatch.setattr("app.services.openclaw_http_bridge.subprocess.run", _fake_run)
    response = client.post(
        "/bridge/chat",
        headers={"authorization": "Bearer token_ok"},
        json={
            "user_id": "u_2",
            "conversation_id": "api:u_2",
            "message": "do task",
            "channel": "dingtalk",
            "trace_id": "trace_bridge_001",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "reply": "bridge-ok", "error": None}
    command = captured["command"]
    assert isinstance(command, list)
    assert "agent" in command
    assert "--session-id" in command
    assert command[command.index("--channel") + 1] == "last"


def test_bridge_retries_with_new_session_when_locked(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENCLAW_BRIDGE_TOKEN", "token_ok")
    captured_commands: list[list[str]] = []

    def _fake_run(*args, **kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        command = list(args[0])
        captured_commands.append(command)
        if len(captured_commands) == 1:
            return subprocess.CompletedProcess(
                args=command,
                returncode=1,
                stdout='{"error":"session file locked: /tmp/sessions/c_lock.jsonl.lock"}',
                stderr="",
            )
        return subprocess.CompletedProcess(
            args=command,
            returncode=0,
            stdout='{"result":{"payloads":[{"text":"bridge-session-retry-ok"}]}}',
            stderr="",
        )

    monkeypatch.setattr("app.services.openclaw_http_bridge.subprocess.run", _fake_run)
    response = client.post(
        "/bridge/chat",
        headers={"authorization": "Bearer token_ok"},
        json={
            "user_id": "u_lock",
            "conversation_id": "c_lock",
            "message": "do task",
            "channel": "dingtalk",
            "trace_id": "trace_bridge_002",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "reply": "bridge-session-retry-ok", "error": None}
    assert len(captured_commands) == 2
    assert captured_commands[0][captured_commands[0].index("--session-id") + 1] == "c_lock"
    assert captured_commands[1][captured_commands[1].index("--session-id") + 1].startswith(
        "c_lock-r"
    )


def test_bridge_trace_session_strategy(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENCLAW_BRIDGE_TOKEN", "token_ok")
    monkeypatch.setenv("OPENCLAW_BRIDGE_SESSION_STRATEGY", "trace")
    captured_commands: list[list[str]] = []

    def _fake_run(*args, **kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        command = list(args[0])
        captured_commands.append(command)
        return subprocess.CompletedProcess(
            args=command,
            returncode=0,
            stdout='{"ok":true,"reply":"bridge-ok"}',
            stderr="",
        )

    monkeypatch.setattr("app.services.openclaw_http_bridge.subprocess.run", _fake_run)
    response = client.post(
        "/bridge/chat",
        headers={"authorization": "Bearer token_ok"},
        json={
            "user_id": "u_trace",
            "conversation_id": "api:u_trace",
            "message": "do task",
            "channel": "api",
            "trace_id": "abcdef12-3456-7890-abcd-ef1234567890",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "reply": "bridge-ok", "error": None}
    assert len(captured_commands) == 1
    session_id = captured_commands[0][captured_commands[0].index("--session-id") + 1]
    assert session_id == "api:u_trace-tabcdef1234"


def test_bridge_session_lock_retries_configurable(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENCLAW_BRIDGE_TOKEN", "token_ok")
    monkeypatch.setenv("OPENCLAW_BRIDGE_SESSION_LOCK_RETRIES", "2")
    captured_commands: list[list[str]] = []

    def _fake_run(*args, **kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        command = list(args[0])
        captured_commands.append(command)
        if len(captured_commands) < 3:
            return subprocess.CompletedProcess(
                args=command,
                returncode=1,
                stdout='{"error":"session file locked: /tmp/sessions/c_lock_retry.jsonl.lock"}',
                stderr="",
            )
        return subprocess.CompletedProcess(
            args=command,
            returncode=0,
            stdout='{"result":{"payloads":[{"text":"bridge-session-retry-config-ok"}]}}',
            stderr="",
        )

    monkeypatch.setattr("app.services.openclaw_http_bridge.subprocess.run", _fake_run)
    response = client.post(
        "/bridge/chat",
        headers={"authorization": "Bearer token_ok"},
        json={
            "user_id": "u_lock_retry",
            "conversation_id": "c_lock_retry",
            "message": "do task",
            "channel": "dingtalk",
            "trace_id": "trace_bridge_009",
        },
    )

    assert response.status_code == 200
    assert response.json() == {"ok": True, "reply": "bridge-session-retry-config-ok", "error": None}
    assert len(captured_commands) == 3
