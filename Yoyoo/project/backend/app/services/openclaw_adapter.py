from __future__ import annotations

import json
import logging
import os
import shlex
import subprocess
from dataclasses import dataclass
from time import monotonic
from typing import Any
from urllib.error import URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

_DEFAULT_RETRY_POLICY_RULES: dict[str, dict[str, Any]] = {
    "local:timeout": {"run_recovery_probe": True, "allow_ssh_fallback": True},
    "local:local_unhealthy": {"run_recovery_probe": True, "allow_ssh_fallback": True},
    "local:permission": {"run_recovery_probe": True, "allow_ssh_fallback": True},
    "local:session_locked": {"allow_ssh_fallback": True},
    "ssh:session_locked": {"ssh_retries": 1},
    "ssh:timeout": {"ssh_retries": 1},
    "ssh:network": {"ssh_retries": 1},
}


@dataclass
class OpenClawAdapterResult:
    ok: bool
    reply: str | None = None
    error: str | None = None


@dataclass
class RetryAction:
    run_recovery_probe: bool = False
    allow_ssh_fallback: bool | None = None
    ssh_retries: int = 0


class OpenClawAdapter:
    """
    Bridge adapter for delegating requests to OpenClaw.
    Expects an HTTP bridge endpoint that accepts JSON and returns:
    {"ok": true, "reply": "..."}.
    """

    def __init__(
        self,
        *,
        bridge_url: str | None,
        bridge_token: str | None = None,
        bridge_retries: int = 0,
        timeout_sec: float = 12.0,
        exec_timeout_sec: float = 45.0,
        local_exec_enabled: bool = False,
        fallback_to_ssh_on_local_failure: bool = True,
        local_healthcheck_ttl_sec: float = 60.0,
        retry_policy_file: str | None = None,
        retry_policy_reload_sec: float = 5.0,
        ssh_host: str | None = None,
        ssh_user: str = "root",
        ssh_key_path: str | None = None,
        ssh_port: int = 22,
        remote_openclaw_bin: str = "openclaw",
        circuit_breaker_failure_threshold: int = 5,
        circuit_breaker_open_sec: float = 30.0,
        session_strategy: str = "conversation",
        session_lock_retries: int = 1,
    ) -> None:
        self._bridge_url = bridge_url
        self._bridge_token = bridge_token
        self._bridge_retries = max(int(bridge_retries), 0)
        self._timeout_sec = timeout_sec
        self._exec_timeout_sec = exec_timeout_sec
        self._local_exec_enabled = local_exec_enabled
        self._fallback_to_ssh_on_local_failure = fallback_to_ssh_on_local_failure
        self._local_healthcheck_ttl_sec = local_healthcheck_ttl_sec
        self._retry_policy_file = retry_policy_file
        self._retry_policy_reload_sec = retry_policy_reload_sec
        self._ssh_host = ssh_host
        self._ssh_user = ssh_user
        self._ssh_key_path = ssh_key_path
        self._ssh_port = ssh_port
        self._remote_openclaw_bin = remote_openclaw_bin
        normalized_session_strategy = (session_strategy or "conversation").strip().lower()
        self._session_strategy = (
            normalized_session_strategy
            if normalized_session_strategy in {"conversation", "trace"}
            else "conversation"
        )
        self._session_lock_retries = max(int(session_lock_retries), 0)
        self._circuit_breaker_failure_threshold = max(int(circuit_breaker_failure_threshold), 0)
        self._circuit_breaker_open_sec = max(float(circuit_breaker_open_sec), 0.0)
        self._circuit_breaker_consecutive_failures = 0
        self._circuit_breaker_open_until: float = 0.0
        self._local_health_last_checked: float = 0.0
        self._local_health_last_ok: bool = False
        self._retry_policy_rules: dict[str, dict[str, Any]] = dict(_DEFAULT_RETRY_POLICY_RULES)
        self._retry_policy_last_checked: float = 0.0
        self._retry_policy_file_mtime: float | None = None

    @property
    def enabled(self) -> bool:
        return (
            bool(self._bridge_url)
            or self._local_exec_enabled
            or bool(self._ssh_host and self._ssh_key_path)
        )

    def generate_reply(
        self,
        *,
        user_id: str,
        conversation_id: str,
        message: str,
        route_model: str,
        channel: str,
        trace_id: str | None = None,
    ) -> OpenClawAdapterResult:
        self._load_retry_policy_if_needed()
        if self._is_circuit_breaker_open():
            remaining = max(self._circuit_breaker_open_until - monotonic(), 0.0)
            return OpenClawAdapterResult(
                ok=False,
                error=f"circuit_open:{remaining:.2f}s",
            )
        logger.info(
            "openclaw_call trace_id=%s conversation_id=%s route_model=%s channel=%s",
            trace_id,
            conversation_id,
            route_model,
            channel,
        )
        errors: list[str] = []
        ssh_available = bool(self._ssh_host and self._ssh_key_path)

        if self._bridge_url:
            http_result = self._generate_via_http(
                user_id=user_id,
                conversation_id=conversation_id,
                message=message,
                route_model=route_model,
                channel=channel,
                trace_id=trace_id,
            )
            retry_idx = 0
            while (
                not http_result.ok
                and retry_idx < self._bridge_retries
                and self._is_retryable_bridge_error(http_result.error)
            ):
                retry_idx += 1
                logger.warning(
                    "openclaw_http_retry trace_id=%s attempt=%s error=%s",
                    trace_id,
                    retry_idx,
                    (http_result.error or "")[:200],
                )
                http_result = self._generate_via_http(
                    user_id=user_id,
                    conversation_id=conversation_id,
                    message=message,
                    route_model=route_model,
                    channel=channel,
                    trace_id=trace_id,
                )
            if http_result.ok:
                self._record_circuit_breaker_success()
                return http_result
            errors.append(f"http:{http_result.error}")

        if self._local_exec_enabled:
            if not self._is_local_exec_healthy():
                local_result = OpenClawAdapterResult(ok=False, error="local_unhealthy")
            else:
                local_result = self._generate_via_local(
                    conversation_id=conversation_id,
                    message=message,
                    channel=channel,
                    trace_id=trace_id,
                )
            if local_result.ok:
                self._record_circuit_breaker_success()
                return local_result
            errors.append(f"local:{local_result.error}")
            local_category = self._classify_error(scope="local", error=local_result.error)
            local_action = self._resolve_retry_action(scope="local", category=local_category)
            if local_action.run_recovery_probe:
                recovery = self._run_recovery_probe()
                errors.append(f"recovery:{recovery}")
            if local_action.allow_ssh_fallback is False:
                ssh_available = False
            if not self._fallback_to_ssh_on_local_failure:
                ssh_available = False

        if ssh_available:
            ssh_result = self._generate_via_ssh(
                conversation_id=conversation_id,
                message=message,
                channel=channel,
                trace_id=trace_id,
            )
            if ssh_result.ok:
                self._record_circuit_breaker_success()
                return ssh_result
            errors.append(f"ssh:{ssh_result.error}")
            ssh_category = self._classify_error(scope="ssh", error=ssh_result.error)
            ssh_action = self._resolve_retry_action(scope="ssh", category=ssh_category)
            for retry_idx in range(max(ssh_action.ssh_retries, 0)):
                retry = self._generate_via_ssh(
                    conversation_id=conversation_id,
                    message=message,
                    channel=channel,
                    trace_id=trace_id,
                )
                if retry.ok:
                    logger.info(
                        "openclaw_ssh_retry_succeeded trace_id=%s retry=%s",
                        trace_id,
                        retry_idx + 1,
                    )
                    self._record_circuit_breaker_success()
                    return retry
                errors.append(f"ssh_retry{retry_idx + 1}:{retry.error}")

        if errors:
            merged_error = "; ".join(errors)
            self._record_circuit_breaker_failure(error=merged_error)
            return OpenClawAdapterResult(ok=False, error=merged_error)
        self._record_circuit_breaker_failure(error="bridge_not_configured")
        return OpenClawAdapterResult(ok=False, error="bridge_not_configured")

    def _is_circuit_breaker_open(self) -> bool:
        if self._circuit_breaker_failure_threshold <= 0 or self._circuit_breaker_open_sec <= 0:
            return False
        now = monotonic()
        if now < self._circuit_breaker_open_until:
            return True
        if self._circuit_breaker_open_until > 0:
            self._circuit_breaker_open_until = 0.0
        return False

    def _record_circuit_breaker_success(self) -> None:
        if self._circuit_breaker_failure_threshold <= 0:
            return
        self._circuit_breaker_consecutive_failures = 0
        self._circuit_breaker_open_until = 0.0

    def _record_circuit_breaker_failure(self, *, error: str) -> None:
        if self._circuit_breaker_failure_threshold <= 0 or self._circuit_breaker_open_sec <= 0:
            return
        self._circuit_breaker_consecutive_failures += 1
        if self._circuit_breaker_consecutive_failures < self._circuit_breaker_failure_threshold:
            return
        self._circuit_breaker_open_until = monotonic() + self._circuit_breaker_open_sec
        logger.warning(
            "openclaw_circuit_breaker_open threshold=%s open_sec=%s error=%s",
            self._circuit_breaker_failure_threshold,
            self._circuit_breaker_open_sec,
            error[:220],
        )

    def _generate_via_http(
        self,
        *,
        user_id: str,
        conversation_id: str,
        message: str,
        route_model: str,
        channel: str,
        trace_id: str | None,
    ) -> OpenClawAdapterResult:
        payload = {
            "user_id": user_id,
            "conversation_id": conversation_id,
            "message": message,
            "route_model": route_model,
            "channel": channel,
        }
        if trace_id:
            payload["trace_id"] = trace_id
        headers = {"Content-Type": "application/json"}
        if self._bridge_token:
            headers["Authorization"] = f"Bearer {self._bridge_token}"

        request = Request(
            self._bridge_url,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_sec) as response:
                data: dict[str, Any] = json.loads(response.read().decode("utf-8"))
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            return OpenClawAdapterResult(ok=False, error=str(exc))

        ok = bool(data.get("ok"))
        reply = data.get("reply")
        if ok and isinstance(reply, str) and reply.strip():
            return OpenClawAdapterResult(ok=True, reply=reply.strip())
        return OpenClawAdapterResult(ok=False, error="bridge_invalid_response")

    def _generate_via_ssh(
        self,
        *,
        conversation_id: str,
        message: str,
        channel: str,
        trace_id: str | None,
    ) -> OpenClawAdapterResult:
        assert self._ssh_host is not None
        assert self._ssh_key_path is not None
        session_id = self._build_session_id(
            conversation_id=conversation_id,
            trace_id=trace_id,
        )
        remote_channel = self._normalize_channel(channel)
        result = self._run_ssh_agent_once(
            session_id=session_id,
            channel=remote_channel,
            message=message,
        )
        retry_session_id = session_id
        for _ in range(self._session_lock_retries):
            if result.ok or not self._is_session_locked_error(result.error):
                break
            next_session_id = self._build_retry_session_id(retry_session_id)
            logger.warning(
                "openclaw_ssh_session_locked retry_with_new_session old=%s new=%s",
                retry_session_id,
                next_session_id,
            )
            retry_session_id = next_session_id
            result = self._run_ssh_agent_once(
                session_id=retry_session_id,
                channel=remote_channel,
                message=message,
            )
        return result

    def _run_ssh_agent_once(
        self,
        *,
        session_id: str,
        channel: str,
        message: str,
    ) -> OpenClawAdapterResult:
        remote_cmd_parts = [
            self._remote_openclaw_bin,
            "agent",
            "--session-id",
            session_id,
            "--channel",
            channel,
            "--message",
            message,
            "--json",
            "--timeout",
            str(max(int(self._exec_timeout_sec), 30)),
        ]
        remote_command = " ".join(shlex.quote(part) for part in remote_cmd_parts)
        command = [
            "ssh",
            "-i",
            self._ssh_key_path,
            "-o",
            "UserKnownHostsFile=/dev/null",
            "-o",
            "StrictHostKeyChecking=no",
            "-o",
            "IdentitiesOnly=yes",
            "-p",
            str(self._ssh_port),
            f"{self._ssh_user}@{self._ssh_host}",
            remote_command,
        ]
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=max(self._exec_timeout_sec + 10.0, 30.0),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return OpenClawAdapterResult(ok=False, error=f"ssh_exec_error:{exc}")

        output = (completed.stdout or "").strip()
        if not output:
            output = (completed.stderr or "").strip()
        data = self._extract_json_payload(output)
        if data is None:
            if completed.returncode != 0:
                stderr = (completed.stderr or completed.stdout or "").strip()
                return OpenClawAdapterResult(
                    ok=False,
                    error=f"ssh_nonzero_exit:{completed.returncode}:{stderr[:220]}",
                )
            return OpenClawAdapterResult(ok=False, error="ssh_invalid_json_response")

        reply = self._extract_reply_text(data)
        if reply:
            return OpenClawAdapterResult(ok=True, reply=reply)
        error = self._extract_error_message(data) or "ssh_empty_reply"
        return OpenClawAdapterResult(ok=False, error=error)

    def _generate_via_local(
        self,
        *,
        conversation_id: str,
        message: str,
        channel: str,
        trace_id: str | None,
    ) -> OpenClawAdapterResult:
        session_id = self._build_session_id(
            conversation_id=conversation_id,
            trace_id=trace_id,
        )
        local_channel = self._normalize_channel(channel)
        result = self._run_local_agent_once(
            session_id=session_id,
            channel=local_channel,
            message=message,
        )
        retry_session_id = session_id
        for _ in range(self._session_lock_retries):
            if result.ok or not self._is_session_locked_error(result.error):
                break
            next_session_id = self._build_retry_session_id(retry_session_id)
            logger.warning(
                "openclaw_local_session_locked retry_with_new_session old=%s new=%s",
                retry_session_id,
                next_session_id,
            )
            retry_session_id = next_session_id
            result = self._run_local_agent_once(
                session_id=retry_session_id,
                channel=local_channel,
                message=message,
            )
        return result

    def _run_local_agent_once(
        self,
        *,
        session_id: str,
        channel: str,
        message: str,
    ) -> OpenClawAdapterResult:
        command = [
            self._remote_openclaw_bin,
            "agent",
            "--session-id",
            session_id,
            "--channel",
            channel,
            "--message",
            message,
            "--json",
            "--timeout",
            str(max(int(self._exec_timeout_sec), 30)),
        ]
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=max(self._exec_timeout_sec + 10.0, 30.0),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return OpenClawAdapterResult(ok=False, error=f"local_exec_error:{exc}")

        output = (completed.stdout or "").strip()
        if not output:
            output = (completed.stderr or "").strip()
        data = self._extract_json_payload(output)
        if data is None:
            if completed.returncode != 0:
                stderr = (completed.stderr or completed.stdout or "").strip()
                return OpenClawAdapterResult(
                    ok=False,
                    error=f"local_nonzero_exit:{completed.returncode}:{stderr[:220]}",
                )
            return OpenClawAdapterResult(ok=False, error="local_invalid_json_response")

        reply = self._extract_reply_text(data)
        if reply:
            return OpenClawAdapterResult(ok=True, reply=reply)
        error = self._extract_error_message(data) or "local_empty_reply"
        return OpenClawAdapterResult(ok=False, error=error)

    def _is_local_exec_healthy(self) -> bool:
        now = monotonic()
        if now - self._local_health_last_checked < self._local_healthcheck_ttl_sec:
            return self._local_health_last_ok

        command = [self._remote_openclaw_bin, "--version"]
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=min(max(self._exec_timeout_sec, 6.0), 12.0),
            )
            ok = completed.returncode == 0
        except (OSError, subprocess.TimeoutExpired):
            ok = False
        self._local_health_last_checked = now
        self._local_health_last_ok = ok
        if not ok:
            logger.warning("openclaw_local_healthcheck_failed bin=%s", self._remote_openclaw_bin)
        return ok

    def _run_recovery_probe(self) -> str:
        command = [self._remote_openclaw_bin, "gateway", "health", "--json"]
        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                timeout=min(max(self._exec_timeout_sec, 8.0), 15.0),
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            return f"probe_exec_error:{exc}"
        if completed.returncode != 0:
            stderr = (completed.stderr or completed.stdout or "").strip()
            return f"probe_nonzero_exit:{completed.returncode}:{stderr[:180]}"
        output = (completed.stdout or "").strip()
        if not output:
            return "probe_empty_output"
        data = self._extract_json_payload(output)
        if data is None:
            return "probe_invalid_json"
        status = data.get("status")
        if isinstance(status, str) and status.strip():
            return f"probe_status:{status.strip()}"
        return "probe_ok"

    def _is_timeout_error(self, error: str | None) -> bool:
        if not error:
            return False
        normalized = error.lower()
        return "timeout" in normalized or "timed out" in normalized

    def _is_session_locked_error(self, error: str | None) -> bool:
        if not error:
            return False
        normalized = error.lower()
        return (
            "session file locked" in normalized
            or "session_locked" in normalized
            or ".jsonl.lock" in normalized
        )

    def _is_retryable_bridge_error(self, error: str | None) -> bool:
        if not error:
            return False
        normalized = error.lower()
        if self._is_timeout_error(normalized):
            return True
        if any(token in normalized for token in ("connect", "refused", "unreachable", "network")):
            return True
        if "temporary failure" in normalized:
            return True
        return False

    def _classify_error(self, *, scope: str, error: str | None) -> str:
        if not error:
            return "unknown"
        normalized = error.lower()
        if scope == "local" and "local_unhealthy" in normalized:
            return "local_unhealthy"
        if "timeout" in normalized or "timed out" in normalized:
            return "timeout"
        if any(
            token in normalized
            for token in ("unauthorized", "forbidden", "token", "401", "403")
        ):
            return "auth"
        if any(token in normalized for token in ("permission denied", "operation not permitted")):
            return "permission"
        if any(
            token in normalized
            for token in ("command not found", "no such file", "dependency")
        ):
            return "dependency"
        if any(token in normalized for token in ("connect", "refused", "unreachable", "network")):
            return "network"
        if self._is_session_locked_error(normalized):
            return "session_locked"
        if any(token in normalized for token in ("invalid_json_response", "invalid_response")):
            return "invalid_response"
        return "unknown"

    def _resolve_retry_action(self, *, scope: str, category: str) -> RetryAction:
        candidates = (
            f"{scope}:{category}",
            f"{scope}:*",
            f"*:{category}",
            "*:*",
        )
        for key in candidates:
            raw = self._retry_policy_rules.get(key)
            if raw is None:
                continue
            return RetryAction(
                run_recovery_probe=bool(raw.get("run_recovery_probe", False)),
                allow_ssh_fallback=(
                    bool(raw["allow_ssh_fallback"])
                    if "allow_ssh_fallback" in raw
                    else None
                ),
                ssh_retries=max(int(raw.get("ssh_retries", 0)), 0),
            )
        return RetryAction()

    def _load_retry_policy_if_needed(self) -> None:
        if not self._retry_policy_file:
            return
        force_reload = self._retry_policy_reload_sec <= 0
        now = monotonic()
        if not force_reload and now - self._retry_policy_last_checked < max(
            self._retry_policy_reload_sec,
            0.0,
        ):
            return
        self._retry_policy_last_checked = now
        try:
            mtime = os.path.getmtime(self._retry_policy_file)
        except OSError:
            return
        if (
            not force_reload
            and self._retry_policy_file_mtime is not None
            and mtime == self._retry_policy_file_mtime
        ):
            return
        try:
            with open(self._retry_policy_file, encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, json.JSONDecodeError):
            logger.warning("retry_policy_load_failed path=%s", self._retry_policy_file)
            return

        rules_obj = payload.get("rules") if isinstance(payload, dict) else None
        if not isinstance(rules_obj, dict):
            logger.warning("retry_policy_invalid_rules path=%s", self._retry_policy_file)
            return

        merged: dict[str, dict[str, Any]] = dict(_DEFAULT_RETRY_POLICY_RULES)
        for key, value in rules_obj.items():
            if not isinstance(key, str) or not isinstance(value, dict):
                continue
            item: dict[str, Any] = {}
            if "run_recovery_probe" in value:
                item["run_recovery_probe"] = bool(value["run_recovery_probe"])
            if "allow_ssh_fallback" in value:
                item["allow_ssh_fallback"] = bool(value["allow_ssh_fallback"])
            if "ssh_retries" in value:
                try:
                    item["ssh_retries"] = max(int(value["ssh_retries"]), 0)
                except (TypeError, ValueError):
                    continue
            merged[key] = item
        self._retry_policy_rules = merged
        self._retry_policy_file_mtime = mtime
        logger.info(
            "retry_policy_reloaded path=%s rules=%s",
            self._retry_policy_file,
            len(self._retry_policy_rules),
        )

    def _normalize_channel(self, channel: str) -> str:
        channel = (channel or "").strip().lower()
        # Current OpenClaw stable releases may not recognize "dingtalk".
        # Map execution calls to "last" to keep channel compatibility.
        if channel in {"dingtalk", "api"}:
            return "last"
        allowed = {
            "last",
            "telegram",
            "whatsapp",
            "discord",
            "googlechat",
            "slack",
            "signal",
            "imessage",
            "feishu",
            "nostr",
            "msteams",
            "mattermost",
            "nextcloud-talk",
            "matrix",
            "bluebubbles",
            "line",
            "zalo",
            "zalouser",
            "tlon",
        }
        if channel in allowed:
            return channel
        return "last"

    def _build_session_id(self, *, conversation_id: str, trace_id: str | None) -> str:
        base = conversation_id.replace("\n", " ").strip()[:128] or "yoyoo-session"
        if self._session_strategy != "trace":
            return base
        trace = (trace_id or "").replace("-", "").strip().lower()
        if not trace:
            return base
        suffix = f"-t{trace[:10]}"
        max_prefix = max(1, 128 - len(suffix))
        return f"{base[:max_prefix]}{suffix}"

    def _build_retry_session_id(self, session_id: str) -> str:
        suffix = f"-r{int(monotonic() * 1000) % 1_000_000:06d}"
        max_prefix = max(1, 128 - len(suffix))
        return f"{session_id[:max_prefix]}{suffix}"

    def _extract_json_payload(self, text: str) -> dict[str, Any] | None:
        if not text:
            return None
        try:
            payload = json.loads(text)
            return payload if isinstance(payload, dict) else None
        except json.JSONDecodeError:
            pass

        start = text.find("{")
        end = text.rfind("}")
        if start < 0 or end <= start:
            return None
        try:
            payload = json.loads(text[start : end + 1])
            return payload if isinstance(payload, dict) else None
        except json.JSONDecodeError:
            return None

    def _extract_reply_text(self, data: dict[str, Any]) -> str | None:
        result = data.get("result")
        if isinstance(result, dict):
            text = self._extract_text_from_payloads(result.get("payloads"))
            if text:
                return text
        text = self._extract_text_from_payloads(data.get("payloads"))
        if text:
            return text
        reply = data.get("reply")
        if isinstance(reply, str) and reply.strip():
            return reply.strip()
        return None

    def _extract_text_from_payloads(self, payloads: Any) -> str | None:
        if not isinstance(payloads, list):
            return None
        for item in payloads:
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                return text.strip()
        return None

    def _extract_error_message(self, data: dict[str, Any]) -> str | None:
        error = data.get("error")
        if isinstance(error, str) and error.strip():
            return error.strip()
        summary = data.get("summary")
        if isinstance(summary, str) and summary.strip() and summary.strip().lower() != "completed":
            return summary.strip()
        return None
