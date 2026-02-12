from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum


class Channel(StrEnum):
    API = "api"
    DINGTALK = "dingtalk"


class ChatScope(StrEnum):
    PRIVATE = "private"
    GROUP = "group"


@dataclass
class DialogueContext:
    user_id: str
    conversation_id: str
    channel: Channel
    scope: ChatScope
    trace_id: str = ""
    is_mentioned: bool = False
    trusted: bool = False


@dataclass
class BrainDecision:
    intent: str
    should_reply: bool
    safety_blocked: bool = False
    reason: str | None = None
    route_model: str = "minimax/MiniMax-M2.1"
    plan_steps: list[str] | None = None
    verification_checks: list[str] | None = None
    rollback_template: list[str] | None = None
    task_id: str | None = None
    strategy_cards: list[str] | None = None
    strategy_id: str | None = None
    execution_quality_score: float | None = None
    execution_quality_issues: list[str] | None = None
    execution_corrected: bool = False
    execution_duration_ms: int | None = None
    evidence_structured: list[dict[str, object]] | None = None
    yyos_stage: str | None = None
    yyos_confidence: float | None = None
    yyos_risk_level: str | None = None
    yyos_decision: str | None = None
    yyos_recommended_skills: list[str] | None = None


@dataclass
class BrainResult:
    reply: str
    decision: BrainDecision
