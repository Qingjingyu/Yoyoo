from __future__ import annotations

import re

from app.intelligence.models import BrainDecision, ChatScope, DialogueContext

_RISK_PATTERNS = (
    re.compile(r"\brm\s+-rf\b", re.IGNORECASE),
    re.compile(r"\bmkfs\b", re.IGNORECASE),
    re.compile(r"\bshutdown\b", re.IGNORECASE),
    re.compile(r"\breboot\b", re.IGNORECASE),
    re.compile(r"\bkill\s+-9\b", re.IGNORECASE),
    re.compile(r"\bapt\s+install\b", re.IGNORECASE),
    re.compile(r"\bsnap\s+install\b", re.IGNORECASE),
    re.compile(r"curl.+\|\s*bash", re.IGNORECASE),
)


class PolicyGuard:
    def __init__(self, wake_keywords: list[str] | None = None) -> None:
        self._wake_keywords = [k.lower() for k in (wake_keywords or ["yoyoo", "悠悠", "优优"])]

    def evaluate(self, *, context: DialogueContext, text: str, intent: str) -> BrainDecision:
        normalized = text.strip().lower()

        if context.scope == ChatScope.GROUP:
            triggered = context.is_mentioned or any(k in normalized for k in self._wake_keywords)
            if not triggered:
                return BrainDecision(
                    intent=intent,
                    should_reply=False,
                    reason="group_message_without_mention",
                )

        if (not context.trusted) and any(pattern.search(normalized) for pattern in _RISK_PATTERNS):
            return BrainDecision(
                intent=intent,
                should_reply=True,
                safety_blocked=True,
                reason="unsafe_instruction_blocked",
            )

        return BrainDecision(intent=intent, should_reply=True)

