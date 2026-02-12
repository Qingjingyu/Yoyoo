from __future__ import annotations

import json
import os
import re
from datetime import UTC, datetime
from typing import Any

from fastapi import FastAPI, Header, HTTPException, status
from pydantic import BaseModel, Field

app = FastAPI(title="Yoyoo Memory Sidecar", version="0.1.0")

_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_\u4e00-\u9fff]{2,}")
_CACHE_MTIME: float | None = None
_CACHE_PAYLOAD: dict[str, Any] | None = None


class RetrieveRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    user_id: str = Field(min_length=1, max_length=128)
    conversation_id: str = Field(min_length=1, max_length=256)
    limit: int = Field(default=5, ge=1, le=20)


class RetrieveResponse(BaseModel):
    ok: bool
    items: list[dict[str, Any]]
    sufficient: bool
    error: str | None = None


@app.get("/healthz")
def healthz() -> dict[str, object]:
    return {
        "status": "ok",
        "service": "yoyoo-memory-sidecar",
        "memory_file": _memory_file(),
    }


@app.post("/api/v1/retrieve", response_model=RetrieveResponse)
def retrieve(
    req: RetrieveRequest,
    authorization: str | None = Header(default=None),
) -> RetrieveResponse:
    _verify_token(authorization=authorization)
    payload = _load_memory_payload()
    if payload is None:
        return RetrieveResponse(ok=False, items=[], sufficient=False, error="memory_not_available")
    items = _search_items(payload=payload, req=req)
    return RetrieveResponse(
        ok=True,
        items=items,
        sufficient=len(items) >= min(max(req.limit, 1), 2),
    )


def _verify_token(*, authorization: str | None) -> None:
    expected = _sidecar_token()
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


def _memory_file() -> str:
    return (
        os.getenv("YOYOO_MEMORY_FILE", "./data/yoyoo_memory.json").strip()
        or "./data/yoyoo_memory.json"
    )


def _sidecar_token() -> str | None:
    value = os.getenv("YOYOO_MEMORY_SIDECAR_TOKEN", "").strip()
    return value or None


def _load_memory_payload() -> dict[str, Any] | None:
    global _CACHE_MTIME
    global _CACHE_PAYLOAD
    path = _memory_file()
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None

    if _CACHE_PAYLOAD is not None and _CACHE_MTIME is not None and mtime == _CACHE_MTIME:
        return _CACHE_PAYLOAD

    try:
        with open(path, encoding="utf-8") as fh:
            payload = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    _CACHE_MTIME = mtime
    _CACHE_PAYLOAD = payload
    return payload


def _tokenize(text: str) -> set[str]:
    return {item.lower() for item in _TOKEN_PATTERN.findall(text)}


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        parsed = datetime.fromisoformat(ts)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)


def _recency_factor(ts: datetime | None) -> float:
    if ts is None:
        return 0.0
    now = datetime.now(UTC)
    age_hours = max((now - ts).total_seconds() / 3600.0, 0.0)
    if age_hours <= 24.0:
        return 0.35
    if age_hours <= 72.0:
        return 0.2
    if age_hours <= 168.0:
        return 0.08
    return 0.0


def _search_items(*, payload: dict[str, Any], req: RetrieveRequest) -> list[dict[str, Any]]:
    query_tokens = _tokenize(req.query)
    if not query_tokens:
        query_tokens = _tokenize(f"{req.query} task")

    scored: list[tuple[float, dict[str, Any]]] = []
    tasks = payload.get("tasks")
    if isinstance(tasks, dict):
        for task_id, raw in tasks.items():
            if not isinstance(raw, dict):
                continue
            request_text = str(raw.get("request_text") or "").strip()
            executor_reply = str(raw.get("executor_reply") or "").strip()
            haystack = f"{request_text}\n{executor_reply}".strip()
            if not haystack:
                continue
            tokens = _tokenize(haystack)
            overlap = len(tokens & query_tokens)
            if overlap <= 0 and str(raw.get("user_id") or "") != req.user_id:
                continue
            updated_at = _parse_iso(str(raw.get("updated_at") or ""))
            score = (
                overlap * 0.22
                + _recency_factor(updated_at)
                + (0.25 if str(raw.get("conversation_id") or "") == req.conversation_id else 0.0)
                + (0.18 if str(raw.get("user_id") or "") == req.user_id else 0.0)
            )
            if str(raw.get("status") or "") in {"completed", "completed_with_warnings"}:
                score += 0.08
            text = f"[{raw.get('status') or 'unknown'}] {request_text}"
            if executor_reply:
                text = f"{text} -> {executor_reply[:180]}"
            scored.append(
                (
                    score,
                    {
                        "source": "task",
                        "intent": "task_request",
                        "text": text[:260],
                        "score": round(max(score, 0.01), 4),
                        "task_id": str(task_id),
                    },
                )
            )

    events = payload.get("events")
    if isinstance(events, dict):
        conv_events = events.get(req.conversation_id)
        if isinstance(conv_events, list):
            for raw in conv_events[-20:]:
                if not isinstance(raw, dict):
                    continue
                text = str(raw.get("text") or "").strip()
                if not text:
                    continue
                tokens = _tokenize(text)
                overlap = len(tokens & query_tokens)
                if overlap <= 0 and str(raw.get("user_id") or "") != req.user_id:
                    continue
                ts = _parse_iso(str(raw.get("timestamp") or ""))
                score = (
                    overlap * 0.2
                    + _recency_factor(ts)
                    + (0.15 if str(raw.get("user_id") or "") == req.user_id else 0.0)
                )
                scored.append(
                    (
                        score,
                        {
                            "source": "event",
                            "intent": str(raw.get("intent") or "unknown"),
                            "text": text[:220],
                            "score": round(max(score, 0.01), 4),
                        },
                    )
                )

    scored.sort(key=lambda item: item[0], reverse=True)
    dedup: list[dict[str, Any]] = []
    seen: set[str] = set()
    for _, item in scored:
        key = str(item.get("text") or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        dedup.append(item)
        if len(dedup) >= req.limit:
            break
    return dedup
