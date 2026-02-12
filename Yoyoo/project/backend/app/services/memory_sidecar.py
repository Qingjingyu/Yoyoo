from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib.error import URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class MemorySidecarResult:
    ok: bool
    items: list[dict[str, Any]]
    sufficient: bool | None = None
    error: str | None = None


class MemorySidecarClient:
    """Optional HTTP client for external memory retrieval sidecar (e.g. memU)."""

    def __init__(
        self,
        *,
        enabled: bool,
        base_url: str | None = None,
        token: str | None = None,
        timeout_sec: float = 3.0,
        retrieve_path: str = "/api/v1/retrieve",
    ) -> None:
        self._enabled = enabled
        self._base_url = (base_url or "").strip()
        self._token = (token or "").strip() or None
        self._timeout_sec = max(float(timeout_sec), 0.5)
        normalized_path = (retrieve_path or "").strip() or "/api/v1/retrieve"
        if not normalized_path.startswith("/"):
            normalized_path = f"/{normalized_path}"
        self._retrieve_path = normalized_path

    @property
    def enabled(self) -> bool:
        return self._enabled and bool(self._base_url)

    def retrieve(
        self,
        *,
        query: str,
        user_id: str,
        conversation_id: str,
        limit: int = 5,
    ) -> MemorySidecarResult:
        if not self.enabled:
            return MemorySidecarResult(ok=False, items=[], error="disabled")

        payload = {
            "query": query,
            "user_id": user_id,
            "conversation_id": conversation_id,
            "limit": max(int(limit), 1),
        }
        headers = {"Content-Type": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"

        request = Request(
            urljoin(self._base_url.rstrip("/") + "/", self._retrieve_path.lstrip("/")),
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_sec) as response:
                body = response.read().decode("utf-8")
                data: Any = json.loads(body)
        except (URLError, TimeoutError, json.JSONDecodeError) as exc:
            return MemorySidecarResult(ok=False, items=[], error=f"sidecar_error:{exc}")

        if not isinstance(data, dict):
            return MemorySidecarResult(ok=False, items=[], error="sidecar_invalid_response")
        ok = bool(data.get("ok", True))
        raw_items = data.get("items")
        if not isinstance(raw_items, list):
            return MemorySidecarResult(ok=False, items=[], error="sidecar_invalid_items")

        items: list[dict[str, Any]] = []
        for item in raw_items:
            if not isinstance(item, dict):
                continue
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            score = item.get("score")
            normalized_score: float | None = None
            if isinstance(score, (int, float)):
                normalized_score = float(score)
            items.append(
                {
                    "source": str(item.get("source") or "sidecar"),
                    "text": text,
                    "intent": str(item.get("intent") or "sidecar_memory"),
                    "score": normalized_score if normalized_score is not None else 0.51,
                }
            )
        sufficient_raw = data.get("sufficient")
        sufficient = bool(sufficient_raw) if isinstance(sufficient_raw, bool) else None
        if not ok:
            return MemorySidecarResult(
                ok=False,
                items=items,
                sufficient=sufficient,
                error=str(data.get("error") or "sidecar_not_ok"),
            )
        return MemorySidecarResult(ok=True, items=items, sufficient=sufficient)
