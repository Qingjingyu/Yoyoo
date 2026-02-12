from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass
from time import monotonic
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class YYOSRoutingSnapshot:
    enabled: bool
    ok: bool
    stage: str | None = None
    confidence: float | None = None
    risk_level: str | None = None
    decision: str | None = None
    recommended_skills: list[str] | None = None
    error: str | None = None
    duration_ms: int | None = None


class YYOSOrchestrator:
    """
    Optional routing layer backed by the local `yyos` CLI.
    Yoyoo keeps final authority; YYOS only provides orchestration hints.
    """

    def __init__(
        self,
        *,
        enabled: bool,
        cli_bin: str = "yyos",
        timeout_sec: float = 8.0,
    ) -> None:
        self._enabled = enabled
        self._cli_bin = cli_bin
        self._timeout_sec = timeout_sec

    @property
    def enabled(self) -> bool:
        return self._enabled

    def route(self, *, request_text: str, project: str = "default") -> YYOSRoutingSnapshot:
        if not self._enabled:
            return YYOSRoutingSnapshot(enabled=False, ok=False, error="disabled")

        message = " ".join((request_text or "").split()).strip()
        if not message:
            return YYOSRoutingSnapshot(enabled=True, ok=False, error="empty_request")

        cmd = [self._cli_bin, message, "--json"]
        project_name = project.strip()
        if project_name:
            cmd.extend(["--project", project_name])

        start = monotonic()
        try:
            completed = subprocess.run(
                cmd,
                check=False,
                capture_output=True,
                text=True,
                timeout=max(self._timeout_sec, 1.0),
            )
        except (FileNotFoundError, OSError, subprocess.TimeoutExpired) as exc:
            return YYOSRoutingSnapshot(
                enabled=True,
                ok=False,
                error=f"yyos_exec_error:{exc}",
                duration_ms=max(int((monotonic() - start) * 1000), 0),
            )

        duration_ms = max(int((monotonic() - start) * 1000), 0)
        stdout = (completed.stdout or "").strip()
        stderr = (completed.stderr or "").strip()
        if completed.returncode != 0:
            error_text = stderr or stdout or f"nonzero_exit:{completed.returncode}"
            return YYOSRoutingSnapshot(
                enabled=True,
                ok=False,
                error=f"yyos_nonzero_exit:{error_text[:300]}",
                duration_ms=duration_ms,
            )

        try:
            payload: dict[str, Any] = json.loads(stdout)
        except json.JSONDecodeError as exc:
            return YYOSRoutingSnapshot(
                enabled=True,
                ok=False,
                error=f"yyos_invalid_json:{exc}",
                duration_ms=duration_ms,
            )

        stage = self._pick_string(payload, ("routing", "stage"), ("derived", "stage"))
        decision = self._pick_string(payload, ("decision", "decision"))
        risk_level = self._pick_string(payload, ("derived", "risk_level"))
        confidence = self._pick_float(payload, ("routing", "confidence"))
        recommended_skills = self._pick_string_list(
            payload,
            ("derived", "selected_skills"),
            ("routing", "recommended_skills"),
        )
        return YYOSRoutingSnapshot(
            enabled=True,
            ok=True,
            stage=stage,
            confidence=confidence,
            risk_level=risk_level,
            decision=decision,
            recommended_skills=recommended_skills,
            duration_ms=duration_ms,
        )

    def _pick_string(self, data: dict[str, Any], *paths: tuple[str, ...]) -> str | None:
        for path in paths:
            value = self._pick(data, path)
            if isinstance(value, str):
                text = value.strip()
                if text:
                    return text
        return None

    def _pick_float(self, data: dict[str, Any], *paths: tuple[str, ...]) -> float | None:
        for path in paths:
            value = self._pick(data, path)
            if isinstance(value, (int, float)):
                return float(value)
            if isinstance(value, str):
                try:
                    return float(value.strip())
                except ValueError:
                    continue
        return None

    def _pick_string_list(
        self,
        data: dict[str, Any],
        *paths: tuple[str, ...],
    ) -> list[str] | None:
        for path in paths:
            value = self._pick(data, path)
            if not isinstance(value, list):
                continue
            items = [str(item).strip() for item in value if str(item).strip()]
            if items:
                return items
        return None

    def _pick(self, data: dict[str, Any], path: tuple[str, ...]) -> Any:
        current: Any = data
        for key in path:
            if not isinstance(current, dict):
                return None
            current = current.get(key)
        return current
