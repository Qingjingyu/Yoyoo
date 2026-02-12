from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.services.openclaw_adapter import OpenClawAdapter


@dataclass
class ExecutorResult:
    ok: bool
    provider: str
    reply: str | None = None
    error: str | None = None
    evidence: list[dict[str, Any]] | None = None


class ExecutorAdapter:
    """Unifies execution providers (claw/nano/...) with one response contract."""

    def __init__(
        self,
        *,
        openclaw_adapter: OpenClawAdapter | None = None,
        nano_provider: Callable[..., Any] | None = None,
    ) -> None:
        self._openclaw_adapter = openclaw_adapter
        self._nano_provider = nano_provider

    def execute(
        self,
        *,
        user_id: str,
        conversation_id: str,
        message: str,
        route_model: str,
        channel: str,
        trace_id: str | None = None,
        preferred_provider: str = "claw",
    ) -> ExecutorResult:
        ordered = self._provider_order(preferred_provider)
        errors: list[str] = []

        for provider in ordered:
            result = self._invoke_provider(
                provider=provider,
                user_id=user_id,
                conversation_id=conversation_id,
                message=message,
                route_model=route_model,
                channel=channel,
                trace_id=trace_id,
            )
            if result is None:
                continue
            if result.ok:
                return result
            errors.append(f"{provider}:{result.error or 'unknown_error'}")

        return ExecutorResult(
            ok=False,
            provider=ordered[0],
            error="; ".join(errors) if errors else "executor_not_configured",
            evidence=[{"type": "executor_error", "providers": ordered, "errors": errors}],
        )

    def _provider_order(self, preferred_provider: str) -> list[str]:
        preferred = (preferred_provider or "claw").strip().lower()
        ordered = [preferred]
        for name in ("claw", "nano"):
            if name not in ordered:
                ordered.append(name)
        return ordered

    def _invoke_provider(
        self,
        *,
        provider: str,
        user_id: str,
        conversation_id: str,
        message: str,
        route_model: str,
        channel: str,
        trace_id: str | None,
    ) -> ExecutorResult | None:
        if provider == "claw":
            if self._openclaw_adapter is None:
                return None
            raw = self._openclaw_adapter.generate_reply(
                user_id=user_id,
                conversation_id=conversation_id,
                message=message,
                route_model=route_model,
                channel=channel,
                trace_id=trace_id,
            )
            return ExecutorResult(
                ok=bool(raw.ok),
                provider="claw",
                reply=raw.reply,
                error=raw.error,
                evidence=[{"type": "executor", "provider": "claw"}],
            )

        if provider == "nano":
            if self._nano_provider is None:
                return None
            raw = self._nano_provider(
                user_id=user_id,
                conversation_id=conversation_id,
                message=message,
                route_model=route_model,
                channel=channel,
                trace_id=trace_id,
            )
            if isinstance(raw, ExecutorResult):
                return raw
            if isinstance(raw, dict):
                return ExecutorResult(
                    ok=bool(raw.get("ok")),
                    provider="nano",
                    reply=str(raw.get("reply")) if raw.get("reply") is not None else None,
                    error=str(raw.get("error")) if raw.get("error") is not None else None,
                    evidence=(
                        list(raw.get("evidence"))
                        if isinstance(raw.get("evidence"), list)
                        else [{"type": "executor", "provider": "nano"}]
                    ),
                )
            return ExecutorResult(
                ok=False,
                provider="nano",
                error="nano_invalid_response",
                evidence=[{"type": "executor_error", "provider": "nano"}],
            )

        return None
