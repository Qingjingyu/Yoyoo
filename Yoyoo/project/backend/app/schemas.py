from typing import Literal

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=4000)


class ChatResponse(BaseModel):
    reply: str
    model: str
    trace_id: str
    intent: str | None = None
    safety_blocked: bool = False
    route_model: str | None = None
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


class DingtalkEventResponse(BaseModel):
    ok: bool
    trace_id: str | None = None
    event_id: str | None = None
    session_key: str | None = None
    reply: str | None = None
    ignored: bool = False
    reason: str | None = None
    route_model: str | None = None
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


class TaskFeedbackRequest(BaseModel):
    feedback: Literal["good", "bad"]
    note: str | None = Field(default=None, max_length=500)


class TaskFeedbackResponse(BaseModel):
    ok: bool
    task_id: str
    human_feedback: str
    feedback_note: str | None = None
    feedback_updated_at: str


class TeamTaskCreateRequest(BaseModel):
    user_id: str = Field(min_length=1, max_length=64)
    message: str = Field(min_length=1, max_length=4000)
    conversation_id: str | None = Field(default=None, max_length=128)
    channel: str = Field(default="api", min_length=2, max_length=32)
    project_key: str = Field(default="general", min_length=2, max_length=64)


class TeamTaskCreateResponse(BaseModel):
    ok: bool
    task_id: str
    status: str
    owner_role: str
    cto_lane: str | None = None
    execution_mode: str | None = None
    eta_minutes: int | None = None
    reply: str


class TeamEvidenceItem(BaseModel):
    source: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=2000)


class TeamTaskResultRequest(BaseModel):
    role: str = Field(min_length=2, max_length=32)
    reply: str | None = Field(default=None, max_length=4000)
    error: str | None = Field(default=None, max_length=2000)
    evidence: list[TeamEvidenceItem] = Field(default_factory=list)


class TeamTaskResultResponse(BaseModel):
    ok: bool
    task_id: str
    status: str
    issues: list[str] = Field(default_factory=list)
    reply: str
    next_step: str | None = None


class TeamTaskProgressRequest(BaseModel):
    role: str = Field(min_length=2, max_length=32)
    stage: str = Field(default="executing", min_length=2, max_length=32)
    detail: str = Field(min_length=1, max_length=2000)
    evidence: list[TeamEvidenceItem] = Field(default_factory=list)


class TeamTaskProgressResponse(BaseModel):
    ok: bool
    task_id: str
    status: str
    reply: str
    next_step: str | None = None


class TeamTaskDetailResponse(BaseModel):
    task_id: str
    title: str
    objective: str
    owner_role: str
    status: str
    cto_lane: str | None = None
    execution_mode: str | None = None
    eta_minutes: int | None = None
    created_at: str
    updated_at: str
    timeline: list[dict[str, object]] = Field(default_factory=list)


class TeamTaskListItem(BaseModel):
    task_id: str
    title: str
    objective: str
    owner_role: str
    status: str
    cto_lane: str | None = None
    execution_mode: str | None = None
    eta_minutes: int | None = None
    created_at: str
    updated_at: str


class TeamTaskListResponse(BaseModel):
    ok: bool
    user_id: str
    total: int
    items: list[TeamTaskListItem] = Field(default_factory=list)


class TeamWatchdogScanRequest(BaseModel):
    stale_progress_sec: int = Field(default=90, ge=30, le=3600)
    stale_degrade_sec: int = Field(default=300, ge=60, le=7200)
    max_scan: int = Field(default=200, ge=1, le=5000)
    min_repeat_sec: int = Field(default=120, ge=30, le=3600)


class TeamWatchdogScanResponse(BaseModel):
    ok: bool
    scanned: int
    nudged: int
    degraded: int
    changed: bool
    task_ids: list[str] = Field(default_factory=list)
    stale_progress_sec: int
    stale_degrade_sec: int
