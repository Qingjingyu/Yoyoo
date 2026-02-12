from __future__ import annotations

import subprocess

from app.intelligence.yyos_orchestrator import YYOSOrchestrator


class _Completed:
    def __init__(self, *, returncode: int, stdout: str = "", stderr: str = "") -> None:
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_yyos_orchestrator_parses_routing_snapshot(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    payload = (
        '{"routing":{"stage":"plan","confidence":0.92},'
        '"derived":{"risk_level":"medium","selected_skills":["writing-plans"]},'
        '"decision":{"decision":"route_command"}}'
    )

    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        assert cmd[0] == "yyos"
        assert "--json" in cmd
        return _Completed(returncode=0, stdout=payload)

    monkeypatch.setattr("app.intelligence.yyos_orchestrator.subprocess.run", _fake_run)
    orchestrator = YYOSOrchestrator(enabled=True)

    result = orchestrator.route(request_text="请规划发布流程", project="proj_alpha")

    assert result.enabled is True
    assert result.ok is True
    assert result.stage == "plan"
    assert result.confidence == 0.92
    assert result.risk_level == "medium"
    assert result.decision == "route_command"
    assert result.recommended_skills == ["writing-plans"]


def test_yyos_orchestrator_handles_timeout(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def _fake_run(cmd, **kwargs):  # type: ignore[no-untyped-def]
        raise subprocess.TimeoutExpired(cmd=cmd, timeout=kwargs.get("timeout", 0))

    monkeypatch.setattr("app.intelligence.yyos_orchestrator.subprocess.run", _fake_run)
    orchestrator = YYOSOrchestrator(enabled=True, timeout_sec=1.0)

    result = orchestrator.route(request_text="请执行", project="proj_beta")

    assert result.enabled is True
    assert result.ok is False
    assert result.error is not None
    assert "yyos_exec_error" in result.error
