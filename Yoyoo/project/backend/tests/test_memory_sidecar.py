from __future__ import annotations

import json
from urllib.error import URLError

from app.services.memory_sidecar import MemorySidecarClient


class _FakeHTTPResponse:
    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def read(self) -> bytes:
        return json.dumps(self._payload, ensure_ascii=False).encode("utf-8")

    def __enter__(self) -> _FakeHTTPResponse:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:
        _ = (exc_type, exc, tb)
        return False


def test_memory_sidecar_client_disabled() -> None:
    client = MemorySidecarClient(enabled=False, base_url="http://127.0.0.1:8800")

    result = client.retrieve(
        query="部署任务",
        user_id="u_1",
        conversation_id="c_1",
        limit=5,
    )

    assert result.ok is False
    assert result.items == []
    assert result.error == "disabled"


def test_memory_sidecar_client_parses_items(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def _fake_urlopen(request, timeout: float):  # type: ignore[no-untyped-def]
        _ = (request, timeout)
        return _FakeHTTPResponse(
            {
                "ok": True,
                "sufficient": True,
                "items": [
                    {"text": "历史偏好：先只读后写", "score": 0.88, "source": "memu"},
                    {"text": "回滚命令：git revert <commit>", "score": 0.73, "source": "memu"},
                ],
            }
        )

    monkeypatch.setattr("app.services.memory_sidecar.urlopen", _fake_urlopen)
    client = MemorySidecarClient(
        enabled=True,
        base_url="http://127.0.0.1:8800",
        timeout_sec=1.0,
    )

    result = client.retrieve(
        query="部署任务",
        user_id="u_2",
        conversation_id="c_2",
        limit=5,
    )

    assert result.ok is True
    assert result.sufficient is True
    assert len(result.items) == 2
    assert result.items[0]["source"] == "memu"


def test_memory_sidecar_client_handles_network_error(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    def _fake_urlopen(request, timeout: float):  # type: ignore[no-untyped-def]
        _ = (request, timeout)
        raise URLError("sidecar unavailable")

    monkeypatch.setattr("app.services.memory_sidecar.urlopen", _fake_urlopen)
    client = MemorySidecarClient(
        enabled=True,
        base_url="http://127.0.0.1:8800",
        timeout_sec=1.0,
    )

    result = client.retrieve(
        query="部署任务",
        user_id="u_3",
        conversation_id="c_3",
        limit=5,
    )

    assert result.ok is False
    assert result.items == []
    assert result.error is not None
    assert "sidecar_error" in result.error
