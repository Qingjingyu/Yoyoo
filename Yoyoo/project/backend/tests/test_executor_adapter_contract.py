from app.services.executor_adapter import ExecutorAdapter


class _FakeOpenClawAdapter:
    def __init__(self, *, ok: bool, reply: str | None = None, error: str | None = None) -> None:
        self._ok = ok
        self._reply = reply
        self._error = error

    def generate_reply(
        self,
        *,
        user_id: str,
        conversation_id: str,
        message: str,
        route_model: str,
        channel: str,
        trace_id: str | None = None,
    ):
        _ = (user_id, conversation_id, message, route_model, channel, trace_id)

        class _Result:
            ok = self._ok
            reply = self._reply
            error = self._error

        return _Result()


def test_executor_adapter_returns_unified_contract_with_claw() -> None:
    adapter = ExecutorAdapter(
        openclaw_adapter=_FakeOpenClawAdapter(ok=True, reply="claw done"),  # type: ignore[arg-type]
    )

    result = adapter.execute(
        user_id="u_1",
        conversation_id="c_1",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is True
    assert result.provider == "claw"
    assert result.reply == "claw done"
    assert isinstance(result.evidence, list)


def test_executor_adapter_fallbacks_to_nano_when_claw_fails() -> None:
    def _fake_nano(**kwargs):  # type: ignore[no-untyped-def]
        _ = kwargs
        return {"ok": True, "reply": "nano done", "evidence": [{"type": "nano_log"}]}

    adapter = ExecutorAdapter(
        openclaw_adapter=_FakeOpenClawAdapter(ok=False, error="bridge down"),  # type: ignore[arg-type]
        nano_provider=_fake_nano,
    )

    result = adapter.execute(
        user_id="u_2",
        conversation_id="c_2",
        message="执行任务",
        route_model="openai/gpt-5.2-codex",
        channel="api",
    )

    assert result.ok is True
    assert result.provider == "nano"
    assert result.reply == "nano done"
