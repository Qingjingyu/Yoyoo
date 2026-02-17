from __future__ import annotations

from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

TEAM_TASK_STATUSES = {"pending", "running", "review", "done", "failed"}


class RoleProfile(BaseModel):
    role_id: str = Field(min_length=2, max_length=32)
    display_name: str = Field(min_length=1, max_length=64)
    duties: list[str] = Field(default_factory=list)
    engine: str | None = Field(default=None, max_length=32)
    active: bool = True


class TaskEvidence(BaseModel):
    source: str = Field(min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=2000)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))


class TaskCard(BaseModel):
    task_id: str = Field(min_length=10, max_length=64)
    title: str = Field(min_length=1, max_length=120)
    objective: str = Field(min_length=1, max_length=2000)
    owner_role: str = Field(min_length=2, max_length=32)
    status: str = "pending"
    checkpoints: list[str] = Field(default_factory=list)
    evidence: list[TaskEvidence] = Field(default_factory=list)
    risk: str | None = Field(default=None, max_length=500)
    next_step: str | None = Field(default=None, max_length=500)
    eta_minutes: int | None = Field(default=None, ge=1, le=1440)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    @field_validator("status")
    @classmethod
    def _validate_status(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in TEAM_TASK_STATUSES:
            raise ValueError(f"unsupported task status: {value}")
        return normalized


class AcceptanceResult(BaseModel):
    ok: bool
    task_id: str
    status: Literal["review", "done", "failed"]
    score: float | None = None
    issues: list[str] = Field(default_factory=list)
    corrected: bool = False
    reply: str = Field(min_length=1)
    next_step: str | None = None


class TaskProgressResult(BaseModel):
    ok: bool
    task_id: str
    status: Literal["running", "review", "done", "failed"]
    reply: str = Field(min_length=1)
    next_step: str | None = None
