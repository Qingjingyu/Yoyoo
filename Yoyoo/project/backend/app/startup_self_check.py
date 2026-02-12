from __future__ import annotations

import logging
import os
import shutil
import subprocess
from dataclasses import dataclass


@dataclass(frozen=True)
class StartupSelfCheckResult:
    legacy_port_18000_detected: bool
    dingtalk_forwarder_count: int
    issues: list[str]
    yyos_enabled: bool = False
    yyos_available: bool = False
    memory_sidecar_enabled: bool = False
    memory_sidecar_available: bool = False


def run_startup_self_check(logger: logging.Logger) -> StartupSelfCheckResult:
    ps_output = _run_command(["ps", "-ef"])
    listen_output = _collect_listen_output()
    yyos_enabled = _parse_bool_env("YOYOO_YYOS_ENABLED", default=True)
    yyos_available = bool(shutil.which(os.getenv("YOYOO_YYOS_BIN", "yyos")))
    memory_sidecar_enabled = _parse_bool_env("YOYOO_MEMORY_SIDECAR_ENABLED", default=False)
    memory_sidecar_available = ":8787" in listen_output if memory_sidecar_enabled else False
    result = analyze_startup_snapshot(
        ps_output=ps_output,
        listen_output=listen_output,
        yyos_enabled=yyos_enabled,
        yyos_available=yyos_available,
        memory_sidecar_enabled=memory_sidecar_enabled,
        memory_sidecar_available=memory_sidecar_available,
    )

    if result.legacy_port_18000_detected:
        logger.warning(
            "startup_self_check anomaly=legacy_port_18000 "
            "detail=detected_old_uvicorn_or_listening_port_18000"
        )
    if result.dingtalk_forwarder_count > 1:
        logger.warning(
            "startup_self_check anomaly=duplicate_dingtalk_forwarder count=%s",
            result.dingtalk_forwarder_count,
        )
    if result.yyos_enabled and not result.yyos_available:
        logger.warning(
            "startup_self_check anomaly=yyos_cli_not_found detail=check_yoyo_yyos_bin_or_path"
        )
    if result.memory_sidecar_enabled and not result.memory_sidecar_available:
        logger.warning(
            "startup_self_check anomaly=memory_sidecar_unavailable "
            "detail=check_127.0.0.1:8787_or_service"
        )
    if not result.issues:
        logger.info("startup_self_check ok forwarder_count=%s", result.dingtalk_forwarder_count)
    return result


def analyze_startup_snapshot(
    *,
    ps_output: str,
    listen_output: str,
    yyos_enabled: bool = False,
    yyos_available: bool = True,
    memory_sidecar_enabled: bool = False,
    memory_sidecar_available: bool = True,
) -> StartupSelfCheckResult:
    issues: list[str] = []
    lines = [line.strip() for line in ps_output.splitlines() if line.strip()]

    forwarder_count = sum("dingtalk_stream_forwarder.cjs" in line for line in lines)

    legacy_port_in_process = any(
        "uvicorn" in line and "app.main:app" in line and "--port 18000" in line for line in lines
    )
    legacy_port_in_listen = ":18000" in listen_output
    legacy_port_detected = legacy_port_in_process or legacy_port_in_listen

    if legacy_port_detected:
        issues.append("legacy_port_18000_detected")
    if forwarder_count > 1:
        issues.append("duplicate_dingtalk_forwarder")
    if yyos_enabled and not yyos_available:
        issues.append("yyos_cli_not_found")
    if memory_sidecar_enabled and not memory_sidecar_available:
        issues.append("memory_sidecar_unavailable")

    return StartupSelfCheckResult(
        legacy_port_18000_detected=legacy_port_detected,
        dingtalk_forwarder_count=forwarder_count,
        issues=issues,
        yyos_enabled=yyos_enabled,
        yyos_available=yyos_available,
        memory_sidecar_enabled=memory_sidecar_enabled,
        memory_sidecar_available=memory_sidecar_available,
    )


def _collect_listen_output() -> str:
    if shutil.which("ss"):
        return _run_command(["ss", "-lntp"])
    if shutil.which("lsof"):
        return _run_command(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"])
    return ""


def _run_command(cmd: list[str]) -> str:
    try:
        result = subprocess.run(
            cmd,
            check=False,
            capture_output=True,
            text=True,
        )
    except (FileNotFoundError, OSError):
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout


def _parse_bool_env(name: str, *, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    return default
