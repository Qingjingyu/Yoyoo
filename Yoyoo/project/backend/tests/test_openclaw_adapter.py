import json
import subprocess
from pathlib import Path
from urllib.error import URLError

from app.services.openclaw_adapter import OpenClawAdapter


class _FakeHTTPResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload).encode("utf-8")

    def __enter__(self) -> "_FakeHTTPResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        _ = (exc_type, exc, tb)
        return False


def test_openclaw_adapter_returns_not_configured_when_disabled() -> None:
    adapter = OpenClawAdapter(bridge_url=None)

    result = adapter.generate_reply(
        user_id="u_1",
        conversation_id="c_1",
        message="hello",
        route_model="minimax/MiniMax-M2.1",
        channel="api",
    )

    assert result.ok is False
    assert result.error == "bridge_not_configured"


def test_openclaw_adapter_posts_route_model(monkeypatch) -> None:
    captured: dict[str, object] = {}

    def _fake_urlopen(request, timeout: float):  # type: ignore[no-untyped-def]
        captured["timeout"] = timeout
        captured["url"] = request.full_url
        captured["payload"] = json.loads(request.data.decode("utf-8"))
        return _FakeHTTPResponse({"ok": True, "reply": "bridge-ok"})

    monkeypatch.setattr("app.services.openclaw_adapter.urlopen", _fake_urlopen)
    adapter = OpenClawAdapter(
        bridge_url="http://127.0.0.1:18080/bridge/chat",
        bridge_token="test-token",
    )

    result = adapter.generate_reply(
        user_id="u_2",
        conversation_id="c_2",
        message="请执行",
        route_model="openai/gpt-5.2-codex",
        channel="dingtalk",
    )

    assert result.ok is True
    assert result.reply == "bridge-ok"
    assert captured["url"] == "http://127.0.0.1:18080/bridge/chat"
    assert captured["timeout"] == 12.0
    assert captured["payload"] == {
        "user_id": "u_2",
        "conversation_id": "c_2",
        "message": "请执行",
        "route_model": "openai/gpt-5.2-codex",
        "channel": "dingtalk",
    }


def test_openclaw_adapter_ssh_mode_extracts_reply(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _Completed:
        returncode = 0
        stdout = '{"status":"ok","result":{"payloads":[{"text":"ssh-ok"}]}}'
        stderr = ""

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return _Completed()

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        ssh_host="115.191.36.128",
        ssh_user="root",
        ssh_key_path="/tmp/miyaodui.pem",
        ssh_port=22,
    )

    result = adapter.generate_reply(
        user_id="u_3",
        conversation_id="c_3",
        message="执行一个命令",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is True
    assert result.reply == "ssh-ok"
    assert isinstance(captured["cmd"], list)
    cmd = captured["cmd"]
    assert cmd[0] == "ssh"
    assert cmd[-1].startswith("openclaw agent ")
    assert "--channel last" in cmd[-1]


def test_openclaw_adapter_local_mode_extracts_reply(monkeypatch) -> None:
    captured: dict[str, object] = {}

    class _Completed:
        returncode = 0
        stdout = '{"status":"ok","result":{"payloads":[{"text":"local-ok"}]}}'
        stderr = ""

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return _Completed()

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=True,
        remote_openclaw_bin="openclaw",
    )

    result = adapter.generate_reply(
        user_id="u_4",
        conversation_id="c_4",
        message="执行一个命令",
        route_model="openai/gpt-5.2-codex",
        channel="dingtalk",
    )

    assert result.ok is True
    assert result.reply == "local-ok"
    assert isinstance(captured["cmd"], list)
    cmd = captured["cmd"]
    assert cmd[0] == "openclaw"
    assert "--channel" in cmd
    assert cmd[cmd.index("--channel") + 1] == "last"


def test_openclaw_adapter_local_mode_extracts_top_level_payloads(monkeypatch) -> None:
    class _Completed:
        returncode = 0
        stdout = '{"payloads":[{"text":"top-level-ok"}]}'
        stderr = ""

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        _ = (cmd, kwargs)
        return _Completed()

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=True,
        remote_openclaw_bin="openclaw",
    )

    result = adapter.generate_reply(
        user_id="u_5",
        conversation_id="c_5",
        message="执行一个命令",
        route_model="openai/gpt-5.2-codex",
        channel="dingtalk",
    )

    assert result.ok is True
    assert result.reply == "top-level-ok"


def test_openclaw_adapter_uses_trace_session_strategy_when_enabled(monkeypatch) -> None:
    captured_session_ids: list[str] = []

    class _Completed:
        def __init__(self, *, returncode: int, stdout: str, stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        if cmd[0] == "openclaw" and "--version" in cmd:
            return _Completed(returncode=0, stdout="openclaw 0.1.0")
        if cmd[0] == "openclaw":
            captured_session_ids.append(cmd[cmd.index("--session-id") + 1])
            return _Completed(
                returncode=0,
                stdout='{"status":"ok","result":{"payloads":[{"text":"trace-mode-ok"}]}}',
            )
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=True,
        remote_openclaw_bin="openclaw",
        session_strategy="trace",
    )

    result = adapter.generate_reply(
        user_id="u_trace",
        conversation_id="c_trace",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
        trace_id="abcdef12-3456-7890-abcd-ef1234567890",
    )

    assert result.ok is True
    assert result.reply == "trace-mode-ok"
    assert len(captured_session_ids) == 1
    assert captured_session_ids[0] == "c_trace-tabcdef1234"
    assert len(captured_session_ids[0]) <= 128


def test_openclaw_adapter_fallbacks_to_ssh_when_local_timeout(monkeypatch) -> None:
    calls: list[list[str]] = []

    class _Completed:
        def __init__(self, *, returncode: int, stdout: str, stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        calls.append(list(cmd))
        if cmd[0] == "openclaw" and "--version" in cmd:
            return _Completed(returncode=0, stdout="openclaw 0.1.0")
        if cmd[0] == "openclaw":
            raise subprocess.TimeoutExpired(cmd=cmd, timeout=30)
        if cmd[0] == "ssh":
            return _Completed(
                returncode=0,
                stdout='{"status":"ok","result":{"payloads":[{"text":"ssh-fallback-ok"}]}}',
            )
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=True,
        ssh_host="115.191.36.128",
        ssh_user="root",
        ssh_key_path="/tmp/miyaodui.pem",
        fallback_to_ssh_on_local_failure=True,
    )

    result = adapter.generate_reply(
        user_id="u_6",
        conversation_id="c_6",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is True
    assert result.reply == "ssh-fallback-ok"
    assert any(item[0] == "ssh" for item in calls)


def test_openclaw_adapter_no_ssh_fallback_when_disabled(monkeypatch) -> None:
    calls: list[list[str]] = []

    class _Completed:
        returncode = 0
        stdout = "openclaw 0.1.0"
        stderr = ""

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        calls.append(list(cmd))
        if cmd[0] == "openclaw" and "--version" in cmd:
            return _Completed()
        if cmd[0] == "openclaw":
            raise subprocess.TimeoutExpired(cmd=cmd, timeout=30)
        if cmd[0] == "ssh":
            raise AssertionError("ssh should not be called when fallback disabled")
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=True,
        ssh_host="115.191.36.128",
        ssh_user="root",
        ssh_key_path="/tmp/miyaodui.pem",
        fallback_to_ssh_on_local_failure=False,
    )

    result = adapter.generate_reply(
        user_id="u_7",
        conversation_id="c_7",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is False
    assert result.error is not None
    assert "local:" in result.error
    assert not any(item[0] == "ssh" for item in calls)


def test_openclaw_adapter_retries_ssh_once_after_timeout(monkeypatch) -> None:
    calls: list[list[str]] = []
    ssh_count = 0

    class _Completed:
        def __init__(self, *, returncode: int, stdout: str, stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal ssh_count
        _ = kwargs
        calls.append(list(cmd))
        if cmd[0] == "ssh":
            ssh_count += 1
            if ssh_count == 1:
                raise subprocess.TimeoutExpired(cmd=cmd, timeout=30)
            return _Completed(
                returncode=0,
                stdout='{"status":"ok","result":{"payloads":[{"text":"ssh-retry-ok"}]}}',
            )
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=False,
        ssh_host="115.191.36.128",
        ssh_user="root",
        ssh_key_path="/tmp/miyaodui.pem",
    )

    result = adapter.generate_reply(
        user_id="u_8",
        conversation_id="c_8",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is True
    assert result.reply == "ssh-retry-ok"
    assert ssh_count == 2
    assert sum(1 for item in calls if item[0] == "ssh") == 2


def test_openclaw_adapter_honors_policy_to_disable_ssh_fallback(
    monkeypatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    policy_file = tmp_path / "retry_policy.json"
    policy_file.write_text(
        json.dumps(
            {
                "rules": {
                    "local:timeout": {
                        "run_recovery_probe": False,
                        "allow_ssh_fallback": False,
                    }
                }
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    class _Completed:
        returncode = 0
        stdout = "openclaw 0.1.0"
        stderr = ""

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        calls.append(list(cmd))
        if cmd[0] == "openclaw" and "--version" in cmd:
            return _Completed()
        if cmd[0] == "openclaw":
            raise subprocess.TimeoutExpired(cmd=cmd, timeout=30)
        if cmd[0] == "ssh":
            raise AssertionError("ssh should not be called by policy")
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=True,
        ssh_host="115.191.36.128",
        ssh_user="root",
        ssh_key_path="/tmp/miyaodui.pem",
        retry_policy_file=str(policy_file),
        retry_policy_reload_sec=0,
    )

    result = adapter.generate_reply(
        user_id="u_9",
        conversation_id="c_9",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is False
    assert result.error is not None
    assert "local:" in result.error
    assert not any(item[0] == "ssh" for item in calls)


def test_openclaw_adapter_reload_policy_file_for_ssh_retries(
    monkeypatch, tmp_path: Path
) -> None:
    calls: list[list[str]] = []
    ssh_count = 0
    policy_file = tmp_path / "retry_policy.json"
    policy_file.write_text(
        json.dumps({"rules": {"ssh:timeout": {"ssh_retries": 0}}}),
        encoding="utf-8",
    )

    class _Completed:
        def __init__(self, *, returncode: int, stdout: str, stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal ssh_count
        _ = kwargs
        calls.append(list(cmd))
        if cmd[0] == "ssh":
            ssh_count += 1
            if ssh_count < 3:
                raise subprocess.TimeoutExpired(cmd=cmd, timeout=30)
            return _Completed(
                returncode=0,
                stdout='{"status":"ok","result":{"payloads":[{"text":"ssh-reload-ok"}]}}',
            )
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=False,
        ssh_host="115.191.36.128",
        ssh_user="root",
        ssh_key_path="/tmp/miyaodui.pem",
        retry_policy_file=str(policy_file),
        retry_policy_reload_sec=0,
    )

    first = adapter.generate_reply(
        user_id="u_10",
        conversation_id="c_10",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )
    assert first.ok is False

    policy_file.write_text(
        json.dumps({"rules": {"ssh:timeout": {"ssh_retries": 2}}}),
        encoding="utf-8",
    )
    second = adapter.generate_reply(
        user_id="u_10",
        conversation_id="c_10",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert second.ok is True
    assert second.reply == "ssh-reload-ok"
    assert sum(1 for item in calls if item[0] == "ssh") >= 3


def test_openclaw_adapter_local_retries_with_new_session_when_locked(monkeypatch) -> None:
    session_ids: list[str] = []
    local_call_count = 0

    class _Completed:
        def __init__(self, *, returncode: int, stdout: str, stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal local_call_count
        _ = kwargs
        if cmd[0] == "openclaw" and "--version" in cmd:
            return _Completed(returncode=0, stdout="openclaw 0.1.0")
        if cmd[0] == "openclaw":
            local_call_count += 1
            session_ids.append(cmd[cmd.index("--session-id") + 1])
            if local_call_count == 1:
                return _Completed(
                    returncode=1,
                    stdout='{"error":"session file locked: /tmp/sessions/c_lock.jsonl.lock"}',
                )
            return _Completed(
                returncode=0,
                stdout='{"result":{"payloads":[{"text":"local-session-retry-ok"}]}}',
            )
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=True,
        remote_openclaw_bin="openclaw",
    )

    result = adapter.generate_reply(
        user_id="u_lock",
        conversation_id="c_lock",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="dingtalk",
    )

    assert result.ok is True
    assert result.reply == "local-session-retry-ok"
    assert local_call_count == 2
    assert session_ids[0] == "c_lock"
    assert session_ids[1].startswith("c_lock-r")


def test_openclaw_adapter_ssh_retries_with_new_session_when_locked(monkeypatch) -> None:
    remote_commands: list[str] = []
    ssh_call_count = 0

    class _Completed:
        def __init__(self, *, returncode: int, stdout: str, stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal ssh_call_count
        _ = kwargs
        if cmd[0] != "ssh":
            raise AssertionError(f"unexpected command: {cmd}")
        ssh_call_count += 1
        remote_commands.append(cmd[-1])
        if ssh_call_count == 1:
            return _Completed(
                returncode=1,
                stdout='{"error":"session file locked: /tmp/sessions/c_lock_ssh.jsonl.lock"}',
            )
        return _Completed(
            returncode=0,
            stdout='{"result":{"payloads":[{"text":"ssh-session-retry-ok"}]}}',
        )

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=False,
        ssh_host="115.191.36.128",
        ssh_user="root",
        ssh_key_path="/tmp/miyaodui.pem",
    )

    result = adapter.generate_reply(
        user_id="u_lock_ssh",
        conversation_id="c_lock_ssh",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is True
    assert result.reply == "ssh-session-retry-ok"
    assert ssh_call_count == 2
    assert "--session-id c_lock_ssh " in remote_commands[0]
    assert "--session-id c_lock_ssh-r" in remote_commands[1]


def test_openclaw_adapter_local_session_lock_retries_configurable(monkeypatch) -> None:
    session_ids: list[str] = []
    local_call_count = 0

    class _Completed:
        def __init__(self, *, returncode: int, stdout: str, stderr: str = "") -> None:
            self.returncode = returncode
            self.stdout = stdout
            self.stderr = stderr

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        nonlocal local_call_count
        _ = kwargs
        if cmd[0] == "openclaw" and "--version" in cmd:
            return _Completed(returncode=0, stdout="openclaw 0.1.0")
        if cmd[0] == "openclaw":
            local_call_count += 1
            session_ids.append(cmd[cmd.index("--session-id") + 1])
            if local_call_count < 3:
                return _Completed(
                    returncode=1,
                    stdout='{"error":"session file locked: /tmp/sessions/c_retry.jsonl.lock"}',
                )
            return _Completed(
                returncode=0,
                stdout='{"result":{"payloads":[{"text":"local-session-retry-config-ok"}]}}',
            )
        raise AssertionError(f"unexpected command: {cmd}")

    monkeypatch.setattr("app.services.openclaw_adapter.subprocess.run", _fake_run)
    adapter = OpenClawAdapter(
        bridge_url=None,
        local_exec_enabled=True,
        remote_openclaw_bin="openclaw",
        session_lock_retries=2,
    )

    result = adapter.generate_reply(
        user_id="u_retry",
        conversation_id="c_retry",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="dingtalk",
    )

    assert result.ok is True
    assert result.reply == "local-session-retry-config-ok"
    assert local_call_count == 3
    assert session_ids[0] == "c_retry"
    assert session_ids[1].startswith("c_retry-r")
    assert session_ids[2].startswith("c_retry-r")


def test_openclaw_adapter_circuit_breaker_opens_after_consecutive_failures(monkeypatch) -> None:
    call_count = 0

    def _fake_urlopen(request, timeout: float):  # type: ignore[no-untyped-def]
        nonlocal call_count
        _ = (request, timeout)
        call_count += 1
        raise URLError("bridge down")

    monkeypatch.setattr("app.services.openclaw_adapter.urlopen", _fake_urlopen)
    adapter = OpenClawAdapter(
        bridge_url="http://127.0.0.1:18080/bridge/chat",
        circuit_breaker_failure_threshold=2,
        circuit_breaker_open_sec=60.0,
    )

    first = adapter.generate_reply(
        user_id="u_cb_1",
        conversation_id="c_cb_1",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )
    second = adapter.generate_reply(
        user_id="u_cb_1",
        conversation_id="c_cb_1",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )
    third = adapter.generate_reply(
        user_id="u_cb_1",
        conversation_id="c_cb_1",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert first.ok is False
    assert second.ok is False
    assert "bridge down" in (first.error or "")
    assert "bridge down" in (second.error or "")
    assert third.ok is False
    assert "circuit_open" in (third.error or "")
    assert call_count == 2


def test_openclaw_adapter_bridge_retries_on_retryable_error(monkeypatch) -> None:
    call_count = 0

    def _fake_urlopen(request, timeout: float):  # type: ignore[no-untyped-def]
        nonlocal call_count
        _ = (request, timeout)
        call_count += 1
        if call_count == 1:
            raise URLError("bridge timeout")
        return _FakeHTTPResponse({"ok": True, "reply": "bridge-retry-ok"})

    monkeypatch.setattr("app.services.openclaw_adapter.urlopen", _fake_urlopen)
    adapter = OpenClawAdapter(
        bridge_url="http://127.0.0.1:18080/bridge/chat",
        bridge_retries=1,
    )

    result = adapter.generate_reply(
        user_id="u_http_retry",
        conversation_id="c_http_retry",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is True
    assert result.reply == "bridge-retry-ok"
    assert call_count == 2


def test_openclaw_adapter_circuit_breaker_recovers_after_open_window(monkeypatch) -> None:
    current = {"now": 1000.0}
    call_count = 0

    def _fake_monotonic() -> float:
        return float(current["now"])

    def _fake_urlopen(request, timeout: float):  # type: ignore[no-untyped-def]
        nonlocal call_count
        _ = (request, timeout)
        call_count += 1
        if call_count < 3:
            raise URLError("bridge timeout")
        return _FakeHTTPResponse({"ok": True, "reply": "bridge-recovered"})

    monkeypatch.setattr("app.services.openclaw_adapter.monotonic", _fake_monotonic)
    monkeypatch.setattr("app.services.openclaw_adapter.urlopen", _fake_urlopen)
    adapter = OpenClawAdapter(
        bridge_url="http://127.0.0.1:18080/bridge/chat",
        circuit_breaker_failure_threshold=2,
        circuit_breaker_open_sec=30.0,
    )

    fail_1 = adapter.generate_reply(
        user_id="u_cb_2",
        conversation_id="c_cb_2",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )
    current["now"] = 1001.0
    fail_2 = adapter.generate_reply(
        user_id="u_cb_2",
        conversation_id="c_cb_2",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )
    current["now"] = 1002.0
    blocked = adapter.generate_reply(
        user_id="u_cb_2",
        conversation_id="c_cb_2",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )
    current["now"] = 1035.0
    recovered = adapter.generate_reply(
        user_id="u_cb_2",
        conversation_id="c_cb_2",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert fail_1.ok is False
    assert fail_2.ok is False
    assert blocked.ok is False
    assert "circuit_open" in (blocked.error or "")
    assert recovered.ok is True
    assert recovered.reply == "bridge-recovered"
    assert call_count == 3
