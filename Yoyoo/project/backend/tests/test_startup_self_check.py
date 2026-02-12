import logging

from app.startup_self_check import analyze_startup_snapshot, run_startup_self_check


def test_analyze_startup_snapshot_detects_legacy_port_and_duplicate_forwarder() -> None:
    ps_output = """
root 100 1 0 ? 00:00:01 uvicorn app.main:app --host 0.0.0.0 --port 8000
root 101 1 0 ? 00:00:01 uvicorn app.main:app --host 127.0.0.1 --port 18000
root 102 1 0 ? 00:00:01 node scripts/dingtalk_stream_forwarder.cjs
root 103 1 0 ? 00:00:01 node scripts/dingtalk_stream_forwarder.cjs
""".strip()
    listen_output = "LISTEN 0 2048 127.0.0.1:18000 0.0.0.0:*"

    result = analyze_startup_snapshot(ps_output=ps_output, listen_output=listen_output)

    assert result.legacy_port_18000_detected is True
    assert result.dingtalk_forwarder_count == 2
    assert "legacy_port_18000_detected" in result.issues
    assert "duplicate_dingtalk_forwarder" in result.issues


def test_analyze_startup_snapshot_ok() -> None:
    ps_output = """
root 100 1 0 ? 00:00:01 uvicorn app.main:app --host 0.0.0.0 --port 8000
root 102 1 0 ? 00:00:01 node scripts/dingtalk_stream_forwarder.cjs
""".strip()
    listen_output = "LISTEN 0 2048 0.0.0.0:8000 0.0.0.0:*"

    result = analyze_startup_snapshot(ps_output=ps_output, listen_output=listen_output)

    assert result.legacy_port_18000_detected is False
    assert result.dingtalk_forwarder_count == 1
    assert result.issues == []
    assert result.memory_sidecar_enabled is False


def test_analyze_startup_snapshot_detects_missing_yyos() -> None:
    result = analyze_startup_snapshot(
        ps_output="root 100 1 0 ? 00:00:01 uvicorn app.main:app --host 0.0.0.0 --port 8000",
        listen_output="LISTEN 0 2048 0.0.0.0:8000 0.0.0.0:*",
        yyos_enabled=True,
        yyos_available=False,
    )

    assert result.yyos_enabled is True
    assert result.yyos_available is False
    assert "yyos_cli_not_found" in result.issues


def test_analyze_startup_snapshot_detects_missing_memory_sidecar() -> None:
    result = analyze_startup_snapshot(
        ps_output="root 100 1 0 ? 00:00:01 uvicorn app.main:app --host 0.0.0.0 --port 8000",
        listen_output="LISTEN 0 2048 0.0.0.0:8000 0.0.0.0:*",
        memory_sidecar_enabled=True,
        memory_sidecar_available=False,
    )

    assert result.memory_sidecar_enabled is True
    assert result.memory_sidecar_available is False
    assert "memory_sidecar_unavailable" in result.issues


def test_run_startup_self_check_logs_warnings(monkeypatch, caplog) -> None:  # type: ignore[no-untyped-def]
    caplog.set_level(logging.INFO)
    from app import startup_self_check as module

    monkeypatch.setattr(
        module,
        "_run_command",
        lambda cmd: (
            "root 101 1 0 ? 00:00:01 uvicorn app.main:app --host 127.0.0.1 --port 18000\n"
            "root 102 1 0 ? 00:00:01 node scripts/dingtalk_stream_forwarder.cjs\n"
            "root 103 1 0 ? 00:00:01 node scripts/dingtalk_stream_forwarder.cjs\n"
            if cmd == ["ps", "-ef"]
            else "LISTEN 0 2048 127.0.0.1:18000 0.0.0.0:*"
        ),
    )
    monkeypatch.setattr(module.shutil, "which", lambda _: "yes")
    monkeypatch.setenv("YOYOO_MEMORY_SIDECAR_ENABLED", "1")

    result = run_startup_self_check(logger=logging.getLogger("startup-test"))

    assert result.legacy_port_18000_detected is True
    assert result.dingtalk_forwarder_count == 2
    assert result.memory_sidecar_enabled is True
    assert result.memory_sidecar_available is False
    assert any("anomaly=legacy_port_18000" in item.message for item in caplog.records)
    assert any("anomaly=duplicate_dingtalk_forwarder" in item.message for item in caplog.records)
    assert any("anomaly=memory_sidecar_unavailable" in item.message for item in caplog.records)
