from __future__ import annotations

import json
import logging
import os
import subprocess
from time import monotonic
from typing import Any

from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

app = FastAPI(title="OpenClaw HTTP Bridge", version="0.1.0")


class BridgeChatRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=128)
    conversation_id: str = Field(min_length=1, max_length=256)
    message: str = Field(min_length=1, max_length=8000)
    route_model: str | None = None
    channel: str | None = None
    trace_id: str | None = None


class BridgeChatResponse(BaseModel):
    ok: bool
    reply: str | None = None
    error: str | None = None


@app.get("/healthz")
def healthz() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "openclaw-http-bridge",
        "bin": _openclaw_bin(),
    }


@app.post("/bridge/chat", response_model=BridgeChatResponse)
def bridge_chat(
    req: BridgeChatRequest,
    authorization: str | None = Header(default=None),
) -> BridgeChatResponse:
    _verify_token(authorization=authorization)
    result = _run_openclaw_agent(req=req)
    return BridgeChatResponse(**result)


def _verify_token(*, authorization: str | None) -> None:
    expected = _bridge_token()
    if not expected:
        return
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
        )
    provided = authorization.removeprefix("Bearer ").strip()
    if provided != expected:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid bearer token",
        )


def _run_openclaw_agent(*, req: BridgeChatRequest) -> dict[str, Any]:
    channel = _normalize_channel(req.channel or "dingtalk")
    session_id = _build_session_id(
        conversation_id=req.conversation_id,
        trace_id=req.trace_id,
    )
    retries_left = _session_lock_retries()
    current_session_id = session_id
    while True:
        result = _run_openclaw_agent_once(
            req=req,
            channel=channel,
            session_id=current_session_id,
        )
        if result.get("ok"):
            return result
        error = str(result.get("error") or "")
        if retries_left <= 0 or not _is_session_locked_error(error):
            return result
        next_session_id = _build_retry_session_id(current_session_id)
        logger.warning(
            "openclaw_http_bridge_session_locked retry_with_new_session old=%s new=%s",
            current_session_id,
            next_session_id,
        )
        current_session_id = next_session_id
        retries_left -= 1


def _run_openclaw_agent_once(
    *,
    req: BridgeChatRequest,
    channel: str,
    session_id: str,
) -> dict[str, Any]:
    timeout_sec = max(_exec_timeout_sec(), 30)
    command = [
        _openclaw_bin(),
        "agent",
        "--session-id",
        session_id,
        "--channel",
        channel,
        "--message",
        req.message,
        "--json",
        "--timeout",
        str(timeout_sec),
    ]
    logger.info(
        "openclaw_http_bridge_call trace_id=%s conversation_id=%s channel=%s route_model=%s",
        req.trace_id,
        req.conversation_id,
        channel,
        req.route_model,
    )
    try:
        completed = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=max(timeout_sec + 10, 30),
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        return {"ok": False, "error": f"bridge_exec_error:{exc}"}

    output = (completed.stdout or "").strip()
    if not output:
        output = (completed.stderr or "").strip()
    payload = _extract_json_payload(output)
    if payload is None:
        if completed.returncode != 0:
            stderr = (completed.stderr or completed.stdout or "").strip()
            return {
                "ok": False,
                "error": f"bridge_nonzero_exit:{completed.returncode}:{stderr[:220]}",
            }
        return {"ok": False, "error": "bridge_invalid_json_response"}

    reply = _extract_reply_text(payload)
    if reply:
        return {"ok": True, "reply": reply}
    error = _extract_error_message(payload) or "bridge_empty_reply"
    return {"ok": False, "error": error}


def _extract_json_payload(text: str) -> dict[str, Any] | None:
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


def _extract_reply_text(data: dict[str, Any]) -> str | None:
    result = data.get("result")
    if isinstance(result, dict):
        text = _extract_text_from_payloads(result.get("payloads"))
        if text:
            return text
    text = _extract_text_from_payloads(data.get("payloads"))
    if text:
        return text
    reply = data.get("reply")
    if isinstance(reply, str) and reply.strip():
        return reply.strip()
    return None


def _extract_text_from_payloads(payloads: Any) -> str | None:
    if not isinstance(payloads, list):
        return None
    for item in payloads:
        if not isinstance(item, dict):
            continue
        text = item.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    return None


def _extract_error_message(data: dict[str, Any]) -> str | None:
    error = data.get("error")
    if isinstance(error, str) and error.strip():
        return error.strip()
    summary = data.get("summary")
    if isinstance(summary, str) and summary.strip() and summary.strip().lower() != "completed":
        return summary.strip()
    return None


def _normalize_channel(channel: str) -> str:
    channel = (channel or "").strip().lower()
    # Current OpenClaw stable releases may not recognize "dingtalk".
    # Use "last" to keep bridge execution compatible.
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


def _is_session_locked_error(error: str | None) -> bool:
    if not error:
        return False
    normalized = error.lower()
    return (
        "session file locked" in normalized
        or "session_locked" in normalized
        or ".jsonl.lock" in normalized
    )


def _build_session_id(*, conversation_id: str, trace_id: str | None) -> str:
    base = conversation_id.replace("\n", " ").strip()[:128] or "yoyoo-session"
    if _session_strategy() != "trace":
        return base
    trace = (trace_id or "").replace("-", "").strip().lower()
    if not trace:
        return base
    suffix = f"-t{trace[:10]}"
    max_prefix = max(1, 128 - len(suffix))
    return f"{base[:max_prefix]}{suffix}"


def _session_strategy() -> str:
    value = os.getenv("OPENCLAW_BRIDGE_SESSION_STRATEGY", "conversation").strip().lower()
    if value in {"conversation", "trace"}:
        return value
    return "conversation"


def _session_lock_retries() -> int:
    raw = os.getenv("OPENCLAW_BRIDGE_SESSION_LOCK_RETRIES", "1")
    try:
        return max(int(raw), 0)
    except ValueError:
        return 1


def _build_retry_session_id(session_id: str) -> str:
    suffix = f"-r{int(monotonic() * 1000) % 1_000_000:06d}"
    max_prefix = max(1, 128 - len(suffix))
    return f"{session_id[:max_prefix]}{suffix}"


def _openclaw_bin() -> str:
    return os.getenv("OPENCLAW_REMOTE_OPENCLAW_BIN", "openclaw").strip() or "openclaw"


def _bridge_token() -> str | None:
    token = os.getenv("OPENCLAW_BRIDGE_TOKEN", "").strip()
    return token or None


def _exec_timeout_sec() -> int:
    raw = os.getenv("OPENCLAW_EXEC_TIMEOUT_SEC", "45")
    try:
        return int(float(raw))
    except ValueError:
        return 45
