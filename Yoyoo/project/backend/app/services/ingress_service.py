from __future__ import annotations

from dataclasses import dataclass

from app.intelligence.models import Channel, ChatScope, DialogueContext


@dataclass(frozen=True)
class IngressEnvelope:
    user_id: str
    conversation_id: str
    channel: Channel
    scope: ChatScope
    trace_id: str
    text: str
    task_id_hint: str | None = None
    is_mentioned: bool = False
    trusted: bool = False


class DeterministicIngressService:
    """Single normalization point for all inbound messages before brain handling."""

    def normalize_text(self, *, text: str, task_id_hint: str | None = None) -> str:
        base = text.strip()
        if not task_id_hint:
            return base
        normalized_task = task_id_hint.strip().lower()
        if not normalized_task:
            return base
        if normalized_task in base.lower():
            return base
        return f"{base}\n{normalized_task}".strip()

    def build_context(self, envelope: IngressEnvelope) -> DialogueContext:
        return DialogueContext(
            user_id=envelope.user_id,
            conversation_id=envelope.conversation_id,
            channel=envelope.channel,
            scope=envelope.scope,
            trace_id=envelope.trace_id,
            is_mentioned=envelope.is_mentioned,
            trusted=envelope.trusted,
        )
