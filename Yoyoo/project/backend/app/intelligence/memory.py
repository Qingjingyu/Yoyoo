from __future__ import annotations

import json
import logging
import math
import os
import re
import shutil
import tempfile
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4


@dataclass
class MemoryEvent:
    timestamp: datetime
    user_id: str
    direction: str
    text: str
    intent: str
    trace_id: str | None = None


@dataclass
class TaskRecord:
    task_id: str
    conversation_id: str
    user_id: str
    channel: str
    project_key: str
    trace_id: str
    request_text: str
    route_model: str
    plan_steps: list[str]
    verification_checks: list[str]
    rollback_template: list[str]
    agent_id: str = "ceo"
    memory_scope: str = "agent:ceo"
    status: str = "planned"
    executor_reply: str | None = None
    executor_error: str | None = None
    evidence: list[str] = field(default_factory=list)
    evidence_structured: list[dict[str, Any]] = field(default_factory=list)
    execution_duration_ms: int | None = None
    quality_score: float | None = None
    quality_issues: list[str] = field(default_factory=list)
    correction_applied: bool = False
    strategy_cards_used: list[str] = field(default_factory=list)
    strategy_metrics_applied: bool = False
    human_feedback: str | None = None
    human_feedback_weight: float | None = None
    feedback_note: str | None = None
    feedback_updated_at: datetime | None = None
    feedback_history: list[dict[str, Any]] = field(default_factory=list)
    started_at: datetime | None = None
    last_heartbeat_at: datetime | None = None
    last_retry_at: datetime | None = None
    execution_attempts: int = 0
    max_attempts: int = 1
    resume_count: int = 0
    closed_at: datetime | None = None
    close_reason: str | None = None
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class ConversationSummary:
    conversation_id: str
    user_id: str
    last_intent: str = "unknown"
    key_points: list[str] = field(default_factory=list)
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class StrategyCard:
    card_id: str
    scope: str
    tag: str
    title: str
    summary: str
    trigger_tags: list[str]
    recommended_steps: list[str]
    cautions: list[str]
    evidence_requirements: list[str]
    confidence: float
    source: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass
class UserProfile:
    user_id: str
    preferred_name: str | None = None
    facts: dict[str, str] = field(default_factory=dict)
    fact_history: dict[str, list[dict[str, str | None]]] = field(default_factory=dict)


_NAME_PATTERN = re.compile(r"(?:我叫|我是)\s*([A-Za-z0-9_\u4e00-\u9fff]{1,16})")
_INVALID_NAMES = {"你", "主人", "建造者", "管理员", "yoyoo", "Yoyoo"}
_TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_\u4e00-\u9fff]{2,}")
_MEMORY_BACKUP_KEEP = 3
logger = logging.getLogger(__name__)


class MemoryService:
    """Persistent memory with layered data: profile facts, timelines, summaries, and tasks."""

    def __init__(
        self,
        max_events_per_conversation: int = 30,
        storage_path: str | None = None,
    ) -> None:
        self._max_events_per_conversation = max_events_per_conversation
        self._events: dict[str, deque[MemoryEvent]] = defaultdict(
            lambda: deque(maxlen=max_events_per_conversation)
        )
        self._daily_notes: dict[str, deque[MemoryEvent]] = defaultdict(lambda: deque(maxlen=500))
        self._profiles: dict[str, UserProfile] = {}
        self._summaries: dict[str, ConversationSummary] = {}
        self._tasks: dict[str, TaskRecord] = {}
        self._conversation_tasks: dict[str, deque[str]] = defaultdict(lambda: deque(maxlen=200))
        self._learning_stats_scoped: dict[str, dict[str, dict[str, Any]]] = {}
        self._strategy_cards: dict[str, StrategyCard] = {}
        self._scope_strategy_cards: dict[str, deque[str]] = defaultdict(lambda: deque(maxlen=200))
        self._strategy_card_runtime_metrics: dict[str, dict[str, Any]] = {}
        self._external_message_task_map: dict[str, dict[str, Any]] = {}
        self._processed_ingress_map: dict[str, dict[str, Any]] = {}
        self._ingress_dedupe_metrics: dict[str, Any] = {
            "attempt_total": 0,
            "dropped_total": 0,
        }
        self._feedback_binding_metrics: dict[str, Any] = {
            "attempt_total": 0,
            "success_total": 0,
            "not_found_total": 0,
            "short_retry_total": 0,
            "override_total": 0,
            "source_counts": {},
        }
        self._memory_pipeline_metrics: dict[str, Any] = {
            "retrieval_total": 0,
            "retrieval_hit_total": 0,
            "retrieval_raw_items_total": 0,
            "retrieval_deduped_items_total": 0,
            "dedup_reduction_items_total": 0,
            "sidecar_request_total": 0,
            "sidecar_success_total": 0,
            "sidecar_item_total": 0,
            "sufficiency_total": 0,
            "sufficiency_pass_total": 0,
        }
        self._federated_memory_namespaces: dict[str, deque[dict[str, Any]]] = defaultdict(
            lambda: deque(maxlen=500)
        )
        self._team_task_meta: dict[str, dict[str, Any]] = {}
        self._task_leases: dict[str, dict[str, Any]] = {}
        self._storage_path = storage_path
        self._last_load_source = "memory_not_configured"
        self._recovery_count = 0
        self._last_save_ok = True
        self._last_save_error: str | None = None
        if self._storage_path:
            self._last_load_source = "empty"
            self._load_from_disk()

    def get_or_create_profile(self, user_id: str) -> UserProfile:
        profile = self._profiles.get(user_id)
        if profile is None:
            profile = UserProfile(user_id=user_id)
            self._profiles[user_id] = profile
        return profile

    def upsert_atomic_fact(self, *, user_id: str, key: str, value: str) -> None:
        profile = self.get_or_create_profile(user_id=user_id)
        now = datetime.now(UTC).isoformat()
        history = profile.fact_history.setdefault(key, [])

        active_idx: int | None = None
        for idx, item in enumerate(history):
            if item.get("status") == "active":
                active_idx = idx
                break

        if active_idx is not None and history[active_idx].get("value") == value:
            return

        new_id = f"{key}-{len(history) + 1}"
        if active_idx is not None:
            history[active_idx]["status"] = "superseded"
            history[active_idx]["superseded_by"] = new_id
        history.append(
            {
                "id": new_id,
                "value": value,
                "status": "active",
                "superseded_by": None,
                "timestamp": now,
            }
        )
        profile.facts[key] = value
        self._save_to_disk()

    def learn_from_user_text(self, user_id: str, text: str) -> str | None:
        match = _NAME_PATTERN.search(text)
        if match is None:
            return None
        candidate = match.group(1).strip()
        if not candidate or candidate in _INVALID_NAMES:
            return None
        profile = self.get_or_create_profile(user_id=user_id)
        profile.preferred_name = candidate
        self.upsert_atomic_fact(user_id=user_id, key="preferred_name", value=candidate)
        self.upsert_atomic_fact(user_id=user_id, key="name_source", value="self-introduction")
        return candidate

    def append_event(
        self,
        *,
        conversation_id: str,
        user_id: str,
        direction: str,
        text: str,
        intent: str,
        trace_id: str | None = None,
    ) -> None:
        event = MemoryEvent(
            timestamp=datetime.now(UTC),
            user_id=user_id,
            direction=direction,
            text=text,
            intent=intent,
            trace_id=trace_id,
        )
        self._events[conversation_id].append(event)
        self._append_daily_note(event)
        self._update_summary(conversation_id=conversation_id, user_id=user_id, event=event)
        self._save_to_disk()

    def recent_events(self, conversation_id: str, limit: int = 6) -> list[MemoryEvent]:
        events = self._events.get(conversation_id)
        if not events:
            return []
        return list(events)[-limit:]

    def create_task_record(
        self,
        *,
        conversation_id: str,
        user_id: str,
        channel: str = "api",
        project_key: str = "general",
        agent_id: str = "ceo",
        memory_scope: str | None = None,
        trace_id: str,
        request_text: str,
        route_model: str,
        plan_steps: list[str],
        verification_checks: list[str],
        rollback_template: list[str],
    ) -> TaskRecord:
        now = datetime.now(UTC)
        task_id = f"task_{now.strftime('%Y%m%d%H%M%S')}_{uuid4().hex[:8]}"
        normalized_agent_id = self._normalize_agent_id(agent_id)
        normalized_memory_scope = (memory_scope or "").strip() or f"agent:{normalized_agent_id}"
        record = TaskRecord(
            task_id=task_id,
            conversation_id=conversation_id,
            user_id=user_id,
            channel=channel,
            project_key=project_key,
            agent_id=normalized_agent_id,
            memory_scope=normalized_memory_scope,
            trace_id=trace_id,
            request_text=request_text,
            route_model=route_model,
            plan_steps=list(plan_steps),
            verification_checks=list(verification_checks),
            rollback_template=list(rollback_template),
            started_at=now,
            created_at=now,
            updated_at=now,
        )
        self._tasks[task_id] = record
        self._conversation_tasks[conversation_id].append(task_id)
        self._save_to_disk()
        return record

    def update_task_record(
        self,
        *,
        task_id: str,
        status: str,
        executor_reply: str | None = None,
        executor_error: str | None = None,
        evidence: list[str] | None = None,
        evidence_structured: list[dict[str, Any]] | None = None,
        execution_duration_ms: int | None = None,
        quality_score: float | None = None,
        quality_issues: list[str] | None = None,
        correction_applied: bool | None = None,
        strategy_cards_used: list[str] | None = None,
        execution_attempts: int | None = None,
        max_attempts: int | None = None,
        resume_count: int | None = None,
    ) -> TaskRecord | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        normalized_status = (status or "").strip().lower() or "planned"
        now = datetime.now(UTC)
        record.status = normalized_status
        record.executor_reply = executor_reply
        record.executor_error = executor_error
        if evidence:
            record.evidence.extend(evidence)
        if evidence_structured:
            record.evidence_structured.extend(self._normalize_structured_evidence(evidence_structured))
        if execution_duration_ms is not None:
            record.execution_duration_ms = max(int(execution_duration_ms), 0)
        record.quality_score = quality_score
        if quality_issues is not None:
            record.quality_issues = list(quality_issues)
        if correction_applied is not None:
            record.correction_applied = correction_applied
        if strategy_cards_used is not None:
            record.strategy_cards_used = list(strategy_cards_used)
        if execution_attempts is not None:
            record.execution_attempts = max(int(execution_attempts), 0)
        if max_attempts is not None:
            record.max_attempts = max(int(max_attempts), 1)
        if resume_count is not None:
            record.resume_count = max(int(resume_count), 0)
        if normalized_status in {"running", "in_progress"} and record.started_at is None:
            record.started_at = now
        if normalized_status in {"completed", "completed_with_warnings", "failed", "timeout", "cancelled"}:
            record.closed_at = now
        else:
            record.closed_at = None
            record.close_reason = None
        record.updated_at = now
        self._update_learning_from_task(record)
        self._update_strategy_runtime_from_task(record=record)
        self._save_to_disk()
        return record

    def find_resumable_task(
        self,
        *,
        conversation_id: str,
        user_id: str,
        channel: str,
        max_age_hours: float = 24.0,
    ) -> TaskRecord | None:
        if not conversation_id or not user_id:
            return None
        now = datetime.now(UTC)
        candidates = self.recent_tasks(conversation_id=conversation_id, limit=30)
        for item in reversed(candidates):
            if item.user_id != user_id:
                continue
            if channel and item.channel != channel:
                continue
            status = (item.status or "").strip().lower()
            if status not in {"planned", "running", "in_progress", "failed", "timeout"}:
                continue
            age_hours = max((now - item.updated_at).total_seconds() / 3600.0, 0.0)
            if age_hours > max(max_age_hours, 1.0):
                continue
            return item
        return None

    def mark_task_running(
        self,
        *,
        task_id: str,
        max_attempts: int,
        resumed: bool = False,
        resume_reason: str | None = None,
    ) -> TaskRecord | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        now = datetime.now(UTC)
        record.status = "running"
        record.max_attempts = max(int(max_attempts), 1)
        if record.started_at is None:
            record.started_at = now
        record.closed_at = None
        record.close_reason = None
        if resumed:
            record.resume_count = max(record.resume_count, 0) + 1
            record.evidence_structured.append(
                {
                    "type": "task_resumed",
                    "source": "yoyoo",
                    "value": (resume_reason or "manual_resume").strip()[:500] or "manual_resume",
                    "timestamp": now.isoformat(),
                }
            )
        record.updated_at = now
        self._save_to_disk()
        return record

    def record_task_attempt(
        self,
        *,
        task_id: str,
        attempt_no: int,
        reason: str | None = None,
    ) -> TaskRecord | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        now = datetime.now(UTC)
        normalized_attempt = max(int(attempt_no), 1)
        record.execution_attempts = max(record.execution_attempts, normalized_attempt)
        record.last_heartbeat_at = now
        if normalized_attempt > 1:
            record.last_retry_at = now
        record.evidence_structured.append(
            {
                "type": "task_attempt",
                "source": "yoyoo",
                "attempt_no": normalized_attempt,
                "reason": (reason or "").strip()[:200] or None,
                "timestamp": now.isoformat(),
            }
        )
        record.updated_at = now
        self._save_to_disk()
        return record

    def bind_external_message_task(
        self,
        *,
        platform: str,
        conversation_id: str,
        message_id: str,
        task_id: str,
    ) -> None:
        if not platform or not conversation_id or not message_id or not task_id:
            return
        key = self._external_message_task_key(
            platform=platform,
            conversation_id=conversation_id,
            message_id=message_id,
        )
        self._external_message_task_map[key] = {
            "task_id": task_id,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        self._save_to_disk()

    def resolve_external_message_task(
        self,
        *,
        platform: str,
        conversation_id: str,
        message_id: str,
        max_age_hours: float = 168.0,
    ) -> str | None:
        if not platform or not conversation_id or not message_id:
            return None
        key = self._external_message_task_key(
            platform=platform,
            conversation_id=conversation_id,
            message_id=message_id,
        )
        item = self._external_message_task_map.get(key)
        if not isinstance(item, dict):
            return None
        task_id = str(item.get("task_id") or "").strip()
        if not task_id:
            return None
        updated_at = self._parse_optional_datetime(item.get("updated_at"))
        if updated_at is not None:
            age_hours = max((datetime.now(UTC) - updated_at).total_seconds() / 3600.0, 0.0)
            if age_hours > max_age_hours:
                return None
        if task_id not in self._tasks:
            return None
        return task_id

    def register_processed_ingress(
        self,
        *,
        platform: str,
        conversation_id: str,
        message_id: str,
        trace_id: str | None = None,
        max_age_hours: float = 168.0,
    ) -> bool:
        if not platform or not conversation_id or not message_id:
            return True
        now = datetime.now(UTC)
        bounded_hours = max(float(max_age_hours), 1.0)
        self._prune_processed_ingress(now=now, max_age_hours=bounded_hours)
        key = self._processed_ingress_key(
            platform=platform,
            conversation_id=conversation_id,
            message_id=message_id,
        )
        self._ingress_dedupe_metrics["attempt_total"] = (
            self._safe_int(self._ingress_dedupe_metrics.get("attempt_total"), default=0) + 1
        )
        existing = self._processed_ingress_map.get(key)
        if isinstance(existing, dict):
            updated_at = self._parse_optional_datetime(existing.get("updated_at"))
            if updated_at is not None:
                age_hours = max((now - updated_at).total_seconds() / 3600.0, 0.0)
                if age_hours <= bounded_hours:
                    self._ingress_dedupe_metrics["dropped_total"] = (
                        self._safe_int(
                            self._ingress_dedupe_metrics.get("dropped_total"),
                            default=0,
                        )
                        + 1
                    )
                    self._save_to_disk()
                    return False
        self._processed_ingress_map[key] = {
            "updated_at": now.isoformat(),
            "trace_id": trace_id or "",
        }
        self._save_to_disk()
        return True

    def record_feedback_binding_attempt(self, *, source: str, success: bool) -> None:
        metrics = self._feedback_binding_metrics
        metrics["attempt_total"] = self._safe_int(metrics.get("attempt_total"), default=0) + 1
        if success:
            metrics["success_total"] = self._safe_int(metrics.get("success_total"), default=0) + 1
        else:
            metrics["not_found_total"] = (
                self._safe_int(metrics.get("not_found_total"), default=0) + 1
            )
        normalized_source = (source or "unknown").strip() or "unknown"
        source_counts = metrics.get("source_counts")
        if not isinstance(source_counts, dict):
            source_counts = {}
            metrics["source_counts"] = source_counts
        source_counts[normalized_source] = (
            self._safe_int(source_counts.get(normalized_source), default=0) + 1
        )
        if normalized_source.endswith("_short_retry"):
            metrics["short_retry_total"] = (
                self._safe_int(metrics.get("short_retry_total"), default=0) + 1
            )
        self._save_to_disk()

    def record_memory_pipeline_metrics(
        self,
        *,
        retrieved_count: int,
        deduped_count: int,
        sidecar_used: bool = False,
        sidecar_success: bool | None = None,
        sidecar_item_count: int = 0,
        sufficiency_passed: bool | None = None,
    ) -> None:
        retrieved = max(self._safe_int(retrieved_count, default=0), 0)
        deduped = max(self._safe_int(deduped_count, default=0), 0)
        deduped = min(deduped, retrieved)
        metrics = self._memory_pipeline_metrics
        metrics["retrieval_total"] = self._safe_int(metrics.get("retrieval_total"), default=0) + 1
        if deduped > 0:
            metrics["retrieval_hit_total"] = (
                self._safe_int(metrics.get("retrieval_hit_total"), default=0) + 1
            )
        metrics["retrieval_raw_items_total"] = (
            self._safe_int(metrics.get("retrieval_raw_items_total"), default=0) + retrieved
        )
        metrics["retrieval_deduped_items_total"] = (
            self._safe_int(metrics.get("retrieval_deduped_items_total"), default=0) + deduped
        )
        metrics["dedup_reduction_items_total"] = (
            self._safe_int(metrics.get("dedup_reduction_items_total"), default=0)
            + max(retrieved - deduped, 0)
        )
        if sidecar_used:
            metrics["sidecar_request_total"] = (
                self._safe_int(metrics.get("sidecar_request_total"), default=0) + 1
            )
            if sidecar_success is True:
                metrics["sidecar_success_total"] = (
                    self._safe_int(metrics.get("sidecar_success_total"), default=0) + 1
                )
            metrics["sidecar_item_total"] = (
                self._safe_int(metrics.get("sidecar_item_total"), default=0)
                + max(self._safe_int(sidecar_item_count, default=0), 0)
            )
        if sufficiency_passed is not None:
            metrics["sufficiency_total"] = (
                self._safe_int(metrics.get("sufficiency_total"), default=0) + 1
            )
            if sufficiency_passed:
                metrics["sufficiency_pass_total"] = (
                    self._safe_int(metrics.get("sufficiency_pass_total"), default=0) + 1
                )
        self._save_to_disk()

    def apply_task_feedback(
        self,
        *,
        task_id: str,
        feedback: str,
        note: str | None = None,
    ) -> TaskRecord | None:
        normalized_feedback = feedback.strip().lower()
        if normalized_feedback not in {"good", "bad"}:
            raise ValueError("feedback must be either 'good' or 'bad'")

        record = self._tasks.get(task_id)
        if record is None:
            return None

        previous_feedback = (record.human_feedback or "").strip().lower() or None
        now = datetime.now(UTC)
        new_weight = self._feedback_weight_for_task(record=record, now=now)
        normalized_note: str | None = None
        if note is not None:
            stripped_note = note.strip()
            normalized_note = stripped_note[:500] if stripped_note else None
        is_feedback_override = (
            previous_feedback in {"good", "bad"} and previous_feedback != normalized_feedback
        )
        if previous_feedback != normalized_feedback:
            previous_weight = (
                float(record.human_feedback_weight)
                if isinstance(record.human_feedback_weight, (int, float))
                else 0.0
            )
            tags = self._infer_task_tags(record.request_text)
            scope_chain = self._build_scope_chain(
                user_id=record.user_id,
                channel=record.channel,
                project_key=record.project_key,
            )
            for scope in scope_chain:
                scope_map = self._learning_stats_scoped.setdefault(scope, {})
                for tag in tags:
                    item = scope_map.setdefault(
                        tag,
                        {
                            "success": 0,
                            "failed": 0,
                            "timeout": 0,
                            "feedback_good": 0.0,
                            "feedback_bad": 0.0,
                            "last_error": None,
                            "last_updated": now.isoformat(),
                        },
                    )
                    if previous_feedback in {"good", "bad"} and previous_weight > 0:
                        self._apply_feedback_signal(
                            stats=item,
                            feedback=previous_feedback,
                            weight=-previous_weight,
                        )
                    self._apply_feedback_signal(
                        stats=item,
                        feedback=normalized_feedback,
                        weight=new_weight,
                    )
                    item["last_updated"] = now.isoformat()
                    self._upsert_strategy_card_from_learning(scope=scope, tag=tag, stats=item)
            self._update_strategy_runtime_feedback(
                record=record,
                previous_feedback=previous_feedback,
                previous_weight=previous_weight,
                new_feedback=normalized_feedback,
                new_weight=new_weight,
                now=now,
            )

        record.human_feedback = normalized_feedback
        record.human_feedback_weight = new_weight
        if note is not None:
            record.feedback_note = normalized_note
        record.feedback_updated_at = now
        if is_feedback_override:
            self._feedback_binding_metrics["override_total"] = (
                self._safe_int(self._feedback_binding_metrics.get("override_total"), default=0) + 1
            )
        record.feedback_history.append(
            {
                "feedback": normalized_feedback,
                "weight": new_weight,
                "note": normalized_note,
                "updated_at": now.isoformat(),
                "overrode_previous": is_feedback_override,
            }
        )
        if len(record.feedback_history) > 20:
            record.feedback_history = record.feedback_history[-20:]
        record.updated_at = now
        self._save_to_disk()
        return record

    def recent_tasks(self, conversation_id: str, limit: int = 5) -> list[TaskRecord]:
        task_ids = self._conversation_tasks.get(conversation_id)
        if not task_ids:
            return []
        records = [self._tasks[item] for item in task_ids if item in self._tasks]
        return records[-limit:]

    def get_task_record(self, *, task_id: str) -> TaskRecord | None:
        return self._tasks.get(task_id)

    def acquire_task_lease(
        self,
        *,
        task_id: str,
        holder: str,
        ttl_sec: int = 120,
    ) -> dict[str, Any]:
        now = datetime.now(UTC)
        bounded_ttl = max(int(ttl_sec), 30)
        expires_at = now + timedelta(seconds=bounded_ttl)
        normalized_holder = (holder or "").strip() or "yoyoo"
        current = self._task_leases.get(task_id)
        if isinstance(current, dict):
            current_holder = str(current.get("holder") or "").strip() or "unknown"
            current_expires_at = self._parse_optional_datetime(current.get("expires_at"))
            if (
                current_holder
                and current_holder != normalized_holder
                and current_expires_at is not None
                and current_expires_at > now
            ):
                return {
                    "acquired": False,
                    "task_id": task_id,
                    "holder": current_holder,
                    "expires_at": current_expires_at.isoformat(),
                    "reason": "lease_held_by_other",
                }

        self._task_leases[task_id] = {
            "task_id": task_id,
            "holder": normalized_holder,
            "acquired_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "updated_at": now.isoformat(),
        }
        self._save_to_disk()
        return {
            "acquired": True,
            "task_id": task_id,
            "holder": normalized_holder,
            "expires_at": expires_at.isoformat(),
        }

    def refresh_task_lease(
        self,
        *,
        task_id: str,
        holder: str,
        ttl_sec: int = 120,
    ) -> bool:
        current = self._task_leases.get(task_id)
        if not isinstance(current, dict):
            return False
        normalized_holder = (holder or "").strip() or "yoyoo"
        current_holder = str(current.get("holder") or "").strip() or "unknown"
        if current_holder != normalized_holder:
            return False
        now = datetime.now(UTC)
        expires_at = now + timedelta(seconds=max(int(ttl_sec), 30))
        current["expires_at"] = expires_at.isoformat()
        current["updated_at"] = now.isoformat()
        self._save_to_disk()
        return True

    def release_task_lease(
        self,
        *,
        task_id: str,
        holder: str | None = None,
        force: bool = False,
    ) -> bool:
        current = self._task_leases.get(task_id)
        if not isinstance(current, dict):
            return False
        if not force:
            expected_holder = (holder or "").strip()
            current_holder = str(current.get("holder") or "").strip()
            if expected_holder and expected_holder != current_holder:
                return False
        del self._task_leases[task_id]
        self._save_to_disk()
        return True

    def list_task_leases(self, *, include_expired: bool = False) -> list[dict[str, Any]]:
        now = datetime.now(UTC)
        leases: list[dict[str, Any]] = []
        changed = False
        for task_id, raw in list(self._task_leases.items()):
            if not isinstance(raw, dict):
                del self._task_leases[task_id]
                changed = True
                continue
            expires_at = self._parse_optional_datetime(raw.get("expires_at"))
            is_expired = expires_at is None or expires_at <= now
            if is_expired and not include_expired:
                del self._task_leases[task_id]
                changed = True
                continue
            leases.append(
                {
                    "task_id": task_id,
                    "holder": str(raw.get("holder") or ""),
                    "acquired_at": str(raw.get("acquired_at") or ""),
                    "updated_at": str(raw.get("updated_at") or ""),
                    "expires_at": expires_at.isoformat() if expires_at is not None else None,
                    "expired": is_expired,
                }
            )
        if changed:
            self._save_to_disk()
        return leases

    def get_task_lease(self, *, task_id: str) -> dict[str, Any] | None:
        leases = self.list_task_leases(include_expired=True)
        for item in leases:
            if str(item.get("task_id") or "").strip() == task_id:
                return dict(item)
        return None

    def append_task_timeline_event(
        self,
        *,
        task_id: str,
        event_type: str,
        actor: str,
        detail: str,
        role: str | None = None,
        stage: str | None = None,
        source: str = "yoyoo",
        evidence: list[dict[str, Any]] | None = None,
    ) -> TaskRecord | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        now = datetime.now(UTC)
        payload: dict[str, Any] = {
            "type": "timeline",
            "event_type": event_type.strip().lower() or "update",
            "actor": actor.strip() or "Yoyoo",
            "detail": detail.strip()[:2000],
            "source": source.strip() or "yoyoo",
            "timestamp": now.isoformat(),
        }
        if role:
            payload["role"] = role.strip().upper()
        if stage:
            payload["stage"] = stage.strip().lower()
        if evidence:
            payload["evidence"] = [
                {
                    "source": str(item.get("source") or "").strip(),
                    "content": str(item.get("content") or "").strip(),
                }
                for item in evidence
                if str(item.get("source") or "").strip()
                and str(item.get("content") or "").strip()
            ]
        record.evidence_structured.append(payload)
        record.updated_at = now
        self._save_to_disk()
        return record

    def read_task_timeline(self, *, task_id: str, limit: int = 50) -> list[dict[str, Any]]:
        record = self._tasks.get(task_id)
        if record is None:
            return []
        events: list[dict[str, Any]] = [
            {
                "timestamp": record.created_at.isoformat(),
                "actor": "CEO",
                "event": "task_created",
                "detail": "已创建任务并进入协作流程。",
                "role": "CEO",
                "stage": "created",
            }
        ]
        for item in record.evidence_structured:
            if not isinstance(item, dict):
                continue
            item_type = str(item.get("type") or "").strip().lower()
            if item_type == "timeline":
                events.append(
                    {
                        "timestamp": str(item.get("timestamp") or record.updated_at.isoformat()),
                        "actor": str(item.get("actor") or "Yoyoo"),
                        "event": str(item.get("event_type") or "update"),
                        "detail": str(item.get("detail") or ""),
                        "role": str(item.get("role") or ""),
                        "stage": str(item.get("stage") or ""),
                        "source": str(item.get("source") or ""),
                        "evidence": item.get("evidence") or [],
                    }
                )
            elif item_type == "heartbeat":
                events.append(
                    {
                        "timestamp": str(item.get("timestamp") or record.updated_at.isoformat()),
                        "actor": "CTO",
                        "event": "heartbeat",
                        "detail": str(item.get("value") or ""),
                        "role": "CTO",
                        "stage": "running",
                        "source": str(item.get("source") or "yoyoo"),
                        "evidence": [],
                    }
                )
        events.sort(key=lambda x: str(x.get("timestamp") or ""))
        return events[-max(1, limit) :]

    def touch_task_heartbeat(self, *, task_id: str, note: str | None = None) -> TaskRecord | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        now = datetime.now(UTC)
        record.last_heartbeat_at = now
        record.updated_at = now
        normalized_note = (note or "").strip()
        if normalized_note:
            record.evidence_structured.append(
                {
                    "type": "heartbeat",
                    "value": normalized_note[:500],
                    "source": "yoyoo",
                    "timestamp": now.isoformat(),
                }
            )
        self._save_to_disk()
        return record

    def close_task_record(
        self,
        *,
        task_id: str,
        status: str,
        reason: str | None = None,
        summary: str | None = None,
    ) -> TaskRecord | None:
        record = self._tasks.get(task_id)
        if record is None:
            return None
        normalized_status = (status or "").strip().lower()
        if normalized_status not in {
            "completed",
            "completed_with_warnings",
            "failed",
            "timeout",
            "cancelled",
        }:
            raise ValueError(f"unsupported close status: {status}")
        now = datetime.now(UTC)
        record.status = normalized_status
        record.closed_at = now
        record.close_reason = (reason or "").strip() or None
        normalized_summary = (summary or "").strip() or None
        if normalized_summary:
            record.executor_reply = normalized_summary[:2000]
        record.updated_at = now
        record.evidence_structured.append(
            {
                "type": "task_closed",
                "status": normalized_status,
                "reason": record.close_reason,
                "source": "yoyoo",
                "timestamp": now.isoformat(),
            }
        )
        self._save_to_disk()
        return record

    def upsert_team_task_meta(
        self,
        *,
        task_id: str,
        owner_role: str,
        title: str,
        objective: str,
        status: str,
        eta_minutes: int | None = None,
        risk: str | None = None,
        next_step: str | None = None,
        cto_lane: str | None = None,
        execution_mode: str | None = None,
        extra_fields: dict[str, Any] | None = None,
    ) -> None:
        now = datetime.now(UTC).isoformat()
        current = self._team_task_meta.get(task_id, {})
        normalized_eta = eta_minutes if eta_minutes is not None else current.get("eta_minutes")
        payload = {
            "task_id": task_id,
            "owner_role": owner_role.strip().upper() or "CTO",
            "title": title.strip(),
            "objective": objective.strip(),
            "status": status.strip().lower(),
            "eta_minutes": normalized_eta,
            "risk": risk,
            "next_step": next_step,
            "cto_lane": (cto_lane or current.get("cto_lane") or "ENG"),
            "execution_mode": (execution_mode or current.get("execution_mode") or "subagent"),
            "created_at": current.get("created_at", now),
            "updated_at": now,
        }
        for key, value in current.items():
            if key not in payload:
                payload[key] = value
        if isinstance(extra_fields, dict):
            for key, value in extra_fields.items():
                if not isinstance(key, str):
                    continue
                normalized_key = key.strip()
                if not normalized_key:
                    continue
                payload[normalized_key] = value
        self._team_task_meta[task_id] = payload
        self._save_to_disk()

    def get_team_task_meta(self, *, task_id: str) -> dict[str, Any] | None:
        value = self._team_task_meta.get(task_id)
        if not isinstance(value, dict):
            return None
        return dict(value)

    def append_namespace_memory(
        self,
        *,
        namespace: str,
        payload: dict[str, Any],
    ) -> None:
        key = (namespace or "").strip()
        if not key:
            return
        item = {
            "timestamp": datetime.now(UTC).isoformat(),
            **payload,
        }
        self._federated_memory_namespaces[key].append(item)
        self._save_to_disk()

    def read_namespace_memory(self, *, namespace: str, limit: int = 20) -> list[dict[str, Any]]:
        key = (namespace or "").strip()
        if not key:
            return []
        queue = self._federated_memory_namespaces.get(key)
        if not queue:
            return []
        return list(queue)[-max(1, limit) :]

    def sync_department_to_ceo(self, *, role: str, patch: dict[str, Any]) -> dict[str, Any]:
        role_key = (role or "ENG").strip().upper() or "ENG"
        department_namespace = f"memory.dept.{role_key.lower()}"
        ceo_namespace = "memory.ceo"
        conflict_namespace = "memory.ceo_conflicts"
        patch_task_id = str(patch.get("task_id") or "").strip()

        self.append_namespace_memory(namespace=department_namespace, payload=dict(patch))

        ceo_records = self.read_namespace_memory(namespace=ceo_namespace, limit=200)
        conflict_found = False
        if patch_task_id:
            for existing in reversed(ceo_records):
                if str(existing.get("task_id") or "").strip() != patch_task_id:
                    continue
                existing_summary = str(existing.get("summary") or "").strip()
                incoming_summary = str(patch.get("summary") or "").strip()
                if existing_summary and incoming_summary and existing_summary != incoming_summary:
                    conflict_found = True
                    self.append_namespace_memory(
                        namespace=conflict_namespace,
                        payload={
                            "task_id": patch_task_id,
                            "role": role_key,
                            "existing_summary": existing_summary,
                            "incoming_summary": incoming_summary,
                            "resolution": "ceo_authority",
                        },
                    )
                break

        if not conflict_found:
            self.append_namespace_memory(
                namespace=ceo_namespace,
                payload={
                    **dict(patch),
                    "role": role_key,
                    "synced_from": department_namespace,
                },
            )

        return {
            "ok": True,
            "role": role_key,
            "task_id": patch_task_id or None,
            "conflict": conflict_found,
            "ceo_namespace": ceo_namespace,
            "department_namespace": department_namespace,
        }

    def recent_tasks_for_user(
        self,
        *,
        user_id: str,
        channel: str | None = None,
        agent_id: str | None = None,
        limit: int = 20,
    ) -> list[TaskRecord]:
        if not user_id:
            return []
        matched = [item for item in self._tasks.values() if item.user_id == user_id]
        if channel:
            matched = [item for item in matched if item.channel == channel]
        if agent_id:
            normalized_agent_id = self._normalize_agent_id(agent_id)
            matched = [item for item in matched if self._normalize_agent_id(item.agent_id) == normalized_agent_id]
        matched.sort(key=lambda x: x.updated_at)
        return matched[-max(1, limit):]

    def recent_tasks_for_channel(self, *, channel: str, limit: int = 30) -> list[TaskRecord]:
        if not channel:
            return []
        matched = [item for item in self._tasks.values() if item.channel == channel]
        matched.sort(key=lambda x: x.updated_at)
        return matched[-max(1, limit):]

    def recent_all_tasks(self, *, limit: int = 200) -> list[TaskRecord]:
        records = sorted(self._tasks.values(), key=lambda item: item.updated_at)
        return records[-max(1, limit) :]

    def ops_health_snapshot(self) -> dict[str, Any]:
        now = datetime.now(UTC)
        completed = 0
        failed = 0
        in_progress = 0
        planned = 0
        feedback_pending = 0
        quality_low = 0
        cancelled = 0
        recent_24h = 0
        feedback_task_total = 0
        feedback_conflict_total = 0
        stale_task_count = 0

        for item in self._tasks.values():
            status = (item.status or "").strip().lower()
            if status == "completed":
                completed += 1
            elif status in {"failed", "timeout"}:
                failed += 1
            elif status == "cancelled":
                cancelled += 1
            elif status == "planned":
                planned += 1
            else:
                in_progress += 1

            if status in {"completed", "failed", "timeout"} and not item.human_feedback:
                feedback_pending += 1
            if item.quality_score is not None and item.quality_score < 0.67:
                quality_low += 1
            age_hours = max((now - item.updated_at).total_seconds() / 3600.0, 0.0)
            if age_hours <= 24.0:
                recent_24h += 1
            feedback_labels: set[str] = set()
            for history_item in item.feedback_history:
                if not isinstance(history_item, dict):
                    continue
                label = str(history_item.get("feedback") or "").strip().lower()
                if label in {"good", "bad"}:
                    feedback_labels.add(label)
            if item.human_feedback in {"good", "bad"}:
                feedback_labels.add(item.human_feedback)
            if feedback_labels:
                feedback_task_total += 1
                if "good" in feedback_labels and "bad" in feedback_labels:
                    feedback_conflict_total += 1
            if status in {"planned", "running", "in_progress"} and age_hours > 24.0:
                stale_task_count += 1

        attempt_total = self._safe_int(
            self._feedback_binding_metrics.get("attempt_total"),
            default=0,
        )
        success_total = self._safe_int(
            self._feedback_binding_metrics.get("success_total"),
            default=0,
        )
        short_retry_total = self._safe_int(
            self._feedback_binding_metrics.get("short_retry_total"),
            default=0,
        )
        override_total = self._safe_int(
            self._feedback_binding_metrics.get("override_total"),
            default=0,
        )
        source_counts = self._feedback_binding_metrics.get("source_counts")
        if not isinstance(source_counts, dict):
            source_counts = {}
        retrieval_total = self._safe_int(
            self._memory_pipeline_metrics.get("retrieval_total"),
            default=0,
        )
        retrieval_hit_total = self._safe_int(
            self._memory_pipeline_metrics.get("retrieval_hit_total"),
            default=0,
        )
        retrieval_raw_items_total = self._safe_int(
            self._memory_pipeline_metrics.get("retrieval_raw_items_total"),
            default=0,
        )
        retrieval_deduped_items_total = self._safe_int(
            self._memory_pipeline_metrics.get("retrieval_deduped_items_total"),
            default=0,
        )
        dedup_reduction_items_total = self._safe_int(
            self._memory_pipeline_metrics.get("dedup_reduction_items_total"),
            default=0,
        )
        sidecar_request_total = self._safe_int(
            self._memory_pipeline_metrics.get("sidecar_request_total"),
            default=0,
        )
        sidecar_success_total = self._safe_int(
            self._memory_pipeline_metrics.get("sidecar_success_total"),
            default=0,
        )
        sidecar_item_total = self._safe_int(
            self._memory_pipeline_metrics.get("sidecar_item_total"),
            default=0,
        )
        sufficiency_total = self._safe_int(
            self._memory_pipeline_metrics.get("sufficiency_total"),
            default=0,
        )
        sufficiency_pass_total = self._safe_int(
            self._memory_pipeline_metrics.get("sufficiency_pass_total"),
            default=0,
        )
        strategy_scores: list[float] = []
        runtime_tracked_total = 0
        runtime_active_total = 0
        for card_id in self._strategy_cards:
            metrics = self._strategy_card_runtime_metrics.get(card_id)
            if not isinstance(metrics, dict):
                continue
            runtime_tracked_total += 1
            if self._strategy_signal_total(metrics=metrics) > 0:
                runtime_active_total += 1
            strategy_scores.append(self._strategy_performance_score(card_id=card_id))
        ingress_attempt_total = self._safe_int(
            self._ingress_dedupe_metrics.get("attempt_total"),
            default=0,
        )
        ingress_dropped_total = self._safe_int(
            self._ingress_dedupe_metrics.get("dropped_total"),
            default=0,
        )
        active_leases = self.list_task_leases(include_expired=False)
        all_leases = self.list_task_leases(include_expired=True)
        expired_lease_total = sum(1 for item in all_leases if bool(item.get("expired")))
        dedupe_hit_rate = (
            round(ingress_dropped_total / ingress_attempt_total, 4)
            if ingress_attempt_total > 0
            else None
        )
        return {
            "task_total": len(self._tasks),
            "task_intake_total": len(self._tasks),
            "task_recent_24h": recent_24h,
            "task_completed": completed,
            "task_failed": failed,
            "task_cancelled": cancelled,
            "task_in_progress": in_progress,
            "task_planned": planned,
            "task_active_leases": len(active_leases),
            "task_expired_leases": expired_lease_total,
            "feedback_pending": feedback_pending,
            "quality_low_count": quality_low,
            "external_message_task_map_size": len(self._external_message_task_map),
            "processed_ingress_map_size": len(self._processed_ingress_map),
            "duplicate_dropped_total": ingress_dropped_total,
            "dedupe_hit_rate": dedupe_hit_rate,
            "ingress_dedupe": {
                "attempt_total": ingress_attempt_total,
                "dropped_total": ingress_dropped_total,
                "drop_rate": dedupe_hit_rate,
            },
            "feedback_binding": {
                "attempt_total": attempt_total,
                "success_total": success_total,
                "not_found_total": self._safe_int(
                    self._feedback_binding_metrics.get("not_found_total"),
                    default=0,
                ),
                "short_retry_total": short_retry_total,
                "success_rate": (
                    round(success_total / attempt_total, 4) if attempt_total > 0 else None
                ),
                "short_retry_rate": (
                    round(short_retry_total / attempt_total, 4) if attempt_total > 0 else None
                ),
                "override_total": override_total,
                "source_counts": {
                    str(k): self._safe_int(v, default=0) for k, v in source_counts.items()
                },
            },
            "memory_quality": {
                "retrieval_total": retrieval_total,
                "retrieval_hit_total": retrieval_hit_total,
                "retrieval_hit_rate": (
                    round(retrieval_hit_total / retrieval_total, 4)
                    if retrieval_total > 0
                    else None
                ),
                "retrieval_raw_items_total": retrieval_raw_items_total,
                "retrieval_deduped_items_total": retrieval_deduped_items_total,
                "dedup_reduction_items_total": dedup_reduction_items_total,
                "dedup_reduction_rate": (
                    round(dedup_reduction_items_total / retrieval_raw_items_total, 4)
                    if retrieval_raw_items_total > 0
                    else None
                ),
                "sidecar_request_total": sidecar_request_total,
                "sidecar_success_total": sidecar_success_total,
                "sidecar_success_rate": (
                    round(sidecar_success_total / sidecar_request_total, 4)
                    if sidecar_request_total > 0
                    else None
                ),
                "sidecar_item_total": sidecar_item_total,
                "sufficiency_total": sufficiency_total,
                "sufficiency_pass_total": sufficiency_pass_total,
                "sufficiency_pass_rate": (
                    round(sufficiency_pass_total / sufficiency_total, 4)
                    if sufficiency_total > 0
                    else None
                ),
                "feedback_task_total": feedback_task_total,
                "feedback_conflict_total": feedback_conflict_total,
                "feedback_conflict_rate": (
                    round(feedback_conflict_total / feedback_task_total, 4)
                    if feedback_task_total > 0
                    else None
                ),
                "stale_task_count": stale_task_count,
                "stale_task_rate": (
                    round(stale_task_count / len(self._tasks), 4) if self._tasks else None
                ),
                "strategy_card_total": len(self._strategy_cards),
                "strategy_runtime_tracked_total": runtime_tracked_total,
                "strategy_runtime_active_total": runtime_active_total,
                "strategy_runtime_active_rate": (
                    round(runtime_active_total / len(self._strategy_cards), 4)
                    if self._strategy_cards
                    else None
                ),
                "strategy_avg_performance_score": (
                    round(sum(strategy_scores) / len(strategy_scores), 4)
                    if strategy_scores
                    else None
                ),
                "strategy_low_performance_total": sum(1 for item in strategy_scores if item < -0.2),
            },
            "persistence": self.persistence_diagnostics(),
        }

    def daily_execution_snapshot(self, *, window_hours: float = 24.0) -> dict[str, Any]:
        now = datetime.now(UTC)
        bounded_window_hours = max(float(window_hours), 1.0)
        success_statuses = {"completed", "completed_with_warnings"}
        failed_statuses = {"failed", "timeout"}
        terminal_statuses = success_statuses | failed_statuses

        window_tasks = [
            item
            for item in self._tasks.values()
            if max((now - item.updated_at).total_seconds() / 3600.0, 0.0) <= bounded_window_hours
        ]
        terminal_tasks = [
            item
            for item in window_tasks
            if (item.status or "").strip().lower() in terminal_statuses
        ]
        success_total = sum(
            1
            for item in terminal_tasks
            if (item.status or "").strip().lower() in success_statuses
        )
        failed_total = sum(
            1
            for item in terminal_tasks
            if (item.status or "").strip().lower() in failed_statuses
        )
        strategy_used_total = sum(
            1 for item in window_tasks if any(card.strip() for card in item.strategy_cards_used)
        )
        memory_quality = self.ops_health_snapshot().get("memory_quality", {})
        if not isinstance(memory_quality, dict):
            memory_quality = {}

        feedback_binding = self._feedback_binding_metrics
        attempts = self._safe_int(feedback_binding.get("attempt_total"), default=0)
        success = self._safe_int(feedback_binding.get("success_total"), default=0)
        not_found = self._safe_int(feedback_binding.get("not_found_total"), default=0)

        return {
            "window_hours": bounded_window_hours,
            "task_total": len(window_tasks),
            "task_terminal_total": len(terminal_tasks),
            "task_success_total": success_total,
            "task_failed_total": failed_total,
            "task_success_rate": (
                round(success_total / len(terminal_tasks), 4) if terminal_tasks else None
            ),
            "strategy_hit_total": strategy_used_total,
            "strategy_hit_rate": (
                round(strategy_used_total / len(window_tasks), 4) if window_tasks else None
            ),
            "strategy_card_total": self._safe_int(
                memory_quality.get("strategy_card_total"),
                default=len(self._strategy_cards),
            ),
            "strategy_low_performance_total": self._safe_int(
                memory_quality.get("strategy_low_performance_total"),
                default=0,
            ),
            "strategy_low_performance_rate": (
                round(
                    self._safe_int(memory_quality.get("strategy_low_performance_total"), default=0)
                    / self._safe_int(memory_quality.get("strategy_card_total"), default=1),
                    4,
                )
                if self._safe_int(memory_quality.get("strategy_card_total"), default=0) > 0
                else None
            ),
            "feedback_binding_attempt_total": attempts,
            "feedback_binding_success_total": success,
            "feedback_binding_not_found_total": not_found,
            "feedback_binding_success_rate": (
                round(success / attempts, 4) if attempts > 0 else None
            ),
        }

    def rebalance_strategy_cards(
        self,
        *,
        demote_threshold: float = -0.2,
        promote_threshold: float = 0.35,
        min_signal_total: float = 1.0,
    ) -> dict[str, Any]:
        scopes_reordered = 0
        cards_demoted = 0
        cards_promoted = 0
        now = datetime.now(UTC)

        for _scope, queue in self._scope_strategy_cards.items():
            card_ids = [card_id for card_id in queue if card_id in self._strategy_cards]
            if not card_ids:
                continue
            ranked_ids = sorted(
                card_ids,
                key=lambda card_id: self._strategy_rank_score(card_id=card_id),
                reverse=True,
            )
            if ranked_ids != card_ids:
                queue.clear()
                queue.extend(ranked_ids)
                scopes_reordered += 1

            for card_id in ranked_ids:
                card = self._strategy_cards.get(card_id)
                if card is None:
                    continue
                runtime_metrics = self._strategy_card_runtime_metrics.get(card_id)
                signal_total = (
                    self._strategy_signal_total(metrics=runtime_metrics)
                    if isinstance(runtime_metrics, dict)
                    else 0.0
                )
                if signal_total < min_signal_total:
                    continue
                performance = self._strategy_performance_score(card_id=card_id)
                if performance <= demote_threshold:
                    next_conf = max(0.35, round(card.confidence - 0.04, 4))
                    if next_conf < card.confidence:
                        card.confidence = next_conf
                        card.updated_at = now
                        cards_demoted += 1
                elif performance >= promote_threshold:
                    next_conf = min(0.98, round(card.confidence + 0.02, 4))
                    if next_conf > card.confidence:
                        card.confidence = next_conf
                        card.updated_at = now
                        cards_promoted += 1

        changed = scopes_reordered > 0 or cards_demoted > 0 or cards_promoted > 0
        if changed:
            self._save_to_disk()
        return {
            "changed": changed,
            "scopes_reordered": scopes_reordered,
            "cards_demoted": cards_demoted,
            "cards_promoted": cards_promoted,
        }

    def persistence_diagnostics(self) -> dict[str, Any]:
        if not self._storage_path:
            return {
                "enabled": False,
                "storage_path": None,
                "last_load_source": self._last_load_source,
                "last_save_ok": self._last_save_ok,
                "last_save_error": self._last_save_error,
                "backup_files": [],
                "recovery_count": self._recovery_count,
            }
        backups = [path for path in self._backup_paths() if os.path.exists(path)]
        return {
            "enabled": True,
            "storage_path": self._storage_path,
            "last_load_source": self._last_load_source,
            "last_save_ok": self._last_save_ok,
            "last_save_error": self._last_save_error,
            "backup_files": backups,
            "recovery_count": self._recovery_count,
        }

    def find_tasks_by_trace(self, trace_id: str, limit: int = 10) -> list[TaskRecord]:
        if not trace_id:
            return []
        matches = [item for item in self._tasks.values() if item.trace_id == trace_id]
        matches.sort(key=lambda x: x.updated_at)
        return matches[-limit:]

    def find_events_by_trace(self, trace_id: str, limit: int = 20) -> list[MemoryEvent]:
        if not trace_id:
            return []
        result: list[MemoryEvent] = []
        for queue in self._events.values():
            for event in queue:
                if event.trace_id == trace_id:
                    result.append(event)
        return result[-limit:]

    def recent_daily_notes(self, date_key: str, limit: int = 20) -> list[MemoryEvent]:
        notes = self._daily_notes.get(date_key)
        if not notes:
            return []
        return list(notes)[-limit:]

    def build_context_pack(
        self,
        *,
        conversation_id: str,
        user_id: str,
        channel: str = "api",
        project_key: str | None = None,
        query: str | None = None,
        intent: str | None = None,
    ) -> dict[str, Any]:
        profile = self.get_or_create_profile(user_id=user_id)
        summary = self._summaries.get(conversation_id)
        tasks = self.recent_tasks(conversation_id=conversation_id, limit=3)
        today_key = datetime.now(UTC).date().isoformat()
        today_notes = self._daily_notes.get(today_key)
        normalized_project_key = project_key or self.infer_project_key(
            query=query or "",
            conversation_id=conversation_id,
        )
        relevant_memories = self.retrieve_relevant_memories(
            conversation_id=conversation_id,
            user_id=user_id,
            query=query or "",
            intent=intent or "unknown",
            limit=5,
        )
        learning_hints = self.build_learning_hints(
            user_id=user_id,
            channel=channel,
            project_key=normalized_project_key,
            query=query or "",
            intent=intent or "unknown",
            limit=3,
        )
        strategy_cards = self.build_strategy_cards(
            user_id=user_id,
            channel=channel,
            project_key=normalized_project_key,
            query=query or "",
            intent=intent or "unknown",
            limit=3,
        )
        return {
            "preferred_name": profile.preferred_name,
            "facts": dict(profile.facts),
            "summary_points": list(summary.key_points) if summary else [],
            "last_intent": summary.last_intent if summary else "unknown",
            "today_note_count": len(today_notes) if today_notes else 0,
            "relevant_memories": relevant_memories,
            "learning_hints": learning_hints,
            "strategy_cards": [
                {
                    "card_id": card.card_id,
                    "title": card.title,
                    "summary": card.summary,
                    "recommended_steps": list(card.recommended_steps),
                    "cautions": list(card.cautions),
                    "evidence_requirements": list(card.evidence_requirements),
                    "confidence": round(card.confidence, 4),
                    "tag": card.tag,
                    "scope": card.scope,
                    "performance_score": self._strategy_performance_score(card_id=card.card_id),
                    "runtime_metrics": self._strategy_runtime_metrics_view(card_id=card.card_id),
                }
                for card in strategy_cards
            ],
            "project_key": normalized_project_key,
            "recent_tasks": [
                {
                    "task_id": task.task_id,
                    "status": task.status,
                    "route_model": task.route_model,
                    "updated_at": task.updated_at.isoformat(),
                }
                for task in tasks
            ],
        }

    def build_learning_hints(
        self,
        *,
        user_id: str,
        channel: str,
        project_key: str,
        query: str,
        intent: str,
        limit: int = 3,
    ) -> list[str]:
        scope_chain = self._build_scope_chain(
            user_id=user_id,
            channel=channel,
            project_key=project_key,
        )
        scoped_only = set(scope_chain[:3])

        cards = self.build_strategy_cards(
            user_id=user_id,
            channel=channel,
            project_key=project_key,
            query=query,
            intent=intent,
            limit=limit,
        )
        cards = [
            card
            for card in cards
            if card.scope in scoped_only and card.source != "builtin_strategy_v1"
        ]
        if cards:
            hints: list[str] = []
            for card in cards:
                if card.summary and card.summary not in hints:
                    hints.append(card.summary)
                for caution in card.cautions:
                    if caution not in hints:
                        hints.append(caution)
                if len(hints) >= max(1, limit):
                    break
            if hints:
                return hints[: max(1, limit)]

        query_tags = set(self._infer_task_tags(query))
        if intent == "task_request":
            query_tags.add("task_request")

        candidates: list[tuple[float, str]] = []
        query_scopes = scope_chain[:3]
        scope_weight = {
            query_scopes[0]: 0.45,
            query_scopes[1]: 0.3,
            query_scopes[2]: 0.2,
        }
        for scope in query_scopes:
            stats_map = self._learning_stats_scoped.get(scope, {})
            for tag, stats in stats_map.items():
                success, failed, timeout = self._effective_outcomes(stats=stats)
                total = success + failed
                if total <= 0:
                    continue
                fail_ratio = failed / total
                overlap = 1.0 if tag in query_tags else 0.0
                score = (
                    overlap * 1.4
                    + fail_ratio
                    + min(total / 10.0, 0.4)
                    + scope_weight.get(scope, 0.0)
                )
                if overlap <= 0 and total < 2:
                    continue
                if timeout >= 1 and (overlap > 0 or fail_ratio >= 0.5):
                    candidates.append(
                        (
                            score + 0.2,
                            f"[{tag}] 最近有超时，先做健康检查并拆小任务，再执行变更。",
                        )
                    )
                if fail_ratio >= 0.6 and failed >= 2:
                    candidates.append(
                        (
                            score + 0.15,
                            f"[{tag}] 失败率偏高，建议先只读探测（状态/配置/权限）再执行。",
                        )
                    )
                if success >= 2 and fail_ratio <= 0.4:
                    candidates.append(
                        (
                            score,
                            f"[{tag}] 近期成功率较高，可优先复用上一条稳定执行路径。",
                        )
                    )

        candidates.sort(key=lambda item: item[0], reverse=True)
        hints: list[str] = []
        for _, text in candidates:
            if text in hints:
                continue
            hints.append(text)
            if len(hints) >= max(1, limit):
                break
        return hints

    def build_strategy_cards(
        self,
        *,
        user_id: str,
        channel: str,
        project_key: str,
        query: str,
        intent: str,
        limit: int = 3,
    ) -> list[StrategyCard]:
        query_tags = set(self._infer_task_tags(query))
        if intent == "task_request":
            query_tags.add("task_request")

        scope_chain = self._build_scope_chain(
            user_id=user_id,
            channel=channel,
            project_key=project_key,
        )
        scoped_chain = scope_chain
        scope_weight = {
            scoped_chain[0]: 0.45,
            scoped_chain[1]: 0.3,
            scoped_chain[2]: 0.2,
            scoped_chain[3]: 0.12,
        }
        candidates: list[tuple[float, StrategyCard]] = []
        fallback_candidates: list[tuple[float, StrategyCard]] = []
        seen_card_ids: set[str] = set()
        for scope in scoped_chain:
            card_ids = list(self._scope_strategy_cards.get(scope, []))
            for card_id in card_ids:
                card = self._strategy_cards.get(card_id)
                if card is None:
                    continue
                if card_id in seen_card_ids:
                    continue
                seen_card_ids.add(card_id)
                overlap = len(query_tags & set(card.trigger_tags))
                freshness = self._strategy_freshness_factor(card=card)
                rank_score = self._strategy_rank_score(card_id=card.card_id)
                score = (
                    card.confidence
                    + overlap * 0.3
                    + scope_weight.get(scope, 0.0)
                    + self._strategy_performance_score(card_id=card.card_id) * 0.35
                    + (freshness - 0.5) * 0.25
                )
                fallback_score = rank_score + scope_weight.get(scope, 0.0) * 0.5
                fallback_candidates.append((fallback_score, card))
                if overlap <= 0 and card.confidence < 0.7:
                    continue
                candidates.append((score, card))

        candidates.sort(key=lambda item: item[0], reverse=True)
        if candidates:
            return [card for _, card in candidates[: max(1, limit)]]

        # Fallback: when overlap is low, still reuse top-ranked cards to avoid cold replies.
        fallback_candidates.sort(key=lambda item: item[0], reverse=True)
        selected: list[StrategyCard] = []
        seen: set[str] = set()
        for _, card in fallback_candidates:
            if card.card_id in seen:
                continue
            seen.add(card.card_id)
            selected.append(card)
            if len(selected) >= max(1, limit):
                break
        if selected:
            return selected

        # Built-in fallback for task requests keeps planning stable
        # in cold-start scopes.
        if intent == "task_request":
            primary_tag = next(iter(query_tags), "task_request")
            return [
                StrategyCard(
                    card_id="card_builtin_task_request_v1",
                    scope="global|global|general",
                    tag=primary_tag,
                    title="[builtin] 标准执行策略",
                    summary="先只读后写，分步执行，每一步都要有证据与回滚点。",
                    trigger_tags=[primary_tag, "task_request"],
                    recommended_steps=[
                        "先做环境与权限只读检查，确认目标状态。",
                        "按最小改动分步执行，每步执行后立即验证。",
                        "失败时按预设回滚模板恢复并汇报证据。",
                    ],
                    cautions=[
                        "不要在未验证前执行破坏性写操作。",
                        "避免一次性提交大范围变更。",
                    ],
                    evidence_requirements=[
                        "关键命令输出",
                        "健康检查结果",
                        "回滚命令与结果",
                    ],
                    confidence=0.62,
                    source="builtin_strategy_v1",
                )
            ]
        return selected

    def retrieve_relevant_memories(
        self,
        *,
        conversation_id: str,
        user_id: str,
        query: str,
        intent: str,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        tokens = self._tokenize(query)
        now = datetime.now(UTC)
        candidates: list[dict[str, Any]] = []

        summary = self._summaries.get(conversation_id)
        if summary:
            for point in summary.key_points:
                score = 0.45 + self._text_overlap_score(text=point, query_tokens=tokens)
                candidates.append(
                    {
                        "source": "summary",
                        "text": point,
                        "intent": summary.last_intent,
                        "score": score,
                    }
                )

        for task in self.recent_tasks(conversation_id=conversation_id, limit=12):
            recency = self._recency_score(now=now, ts=task.updated_at, half_life_hours=48.0)
            score = (
                0.35
                + self._text_overlap_score(text=task.request_text, query_tokens=tokens)
                + recency * 0.25
                + (0.12 if task.status == "completed" else 0.0)
            )
            task_text = f"[{task.status}] {task.request_text}"
            if task.executor_reply:
                task_text = f"{task_text} -> {task.executor_reply}"
            candidates.append(
                {
                    "source": "task",
                    "text": task_text[:180],
                    "intent": "task_request",
                    "score": score,
                }
            )

        for event in self.recent_events(conversation_id=conversation_id, limit=18):
            if event.user_id != user_id and user_id:
                continue
            recency = self._recency_score(now=now, ts=event.timestamp, half_life_hours=24.0)
            score = (
                self._text_overlap_score(text=event.text, query_tokens=tokens)
                + recency * 0.3
                + (0.12 if event.intent == intent else 0.0)
                + (0.05 if event.direction == "incoming" else 0.0)
            )
            candidates.append(
                {
                    "source": "event",
                    "text": event.text[:160],
                    "intent": event.intent,
                    "score": score,
                }
            )

        candidates.sort(key=lambda item: float(item["score"]), reverse=True)
        selected = candidates[: max(1, limit)]
        for item in selected:
            item["score"] = round(float(item["score"]), 4)
        return selected

    def _append_daily_note(self, event: MemoryEvent) -> None:
        date_key = event.timestamp.date().isoformat()
        self._daily_notes[date_key].append(event)

    def _update_summary(self, *, conversation_id: str, user_id: str, event: MemoryEvent) -> None:
        summary = self._summaries.get(conversation_id)
        if summary is None:
            summary = ConversationSummary(conversation_id=conversation_id, user_id=user_id)
            self._summaries[conversation_id] = summary
        summary.user_id = user_id
        summary.last_intent = event.intent or "unknown"
        summary.updated_at = datetime.now(UTC)
        if event.direction != "incoming":
            return

        key_point = self._extract_key_point(text=event.text, intent=event.intent)
        if key_point is None:
            return
        if key_point in summary.key_points:
            return
        summary.key_points.append(key_point)
        if len(summary.key_points) > 8:
            summary.key_points = summary.key_points[-8:]

    def _extract_key_point(self, *, text: str, intent: str) -> str | None:
        compact = " ".join(text.split()).strip()
        if not compact:
            return None
        if len(compact) > 120:
            compact = compact[:117] + "..."
        if intent in {"task_request", "status", "capability", "set_name"}:
            return compact
        if compact.startswith(("以后", "请用", "记住", "不要")):
            return compact
        return None

    def _tokenize(self, text: str) -> set[str]:
        return {token.lower() for token in _TOKEN_PATTERN.findall(text)}

    def _text_overlap_score(self, *, text: str, query_tokens: set[str]) -> float:
        if not query_tokens:
            return 0.0
        text_tokens = self._tokenize(text)
        if not text_tokens:
            return 0.0
        overlap = len(query_tokens & text_tokens)
        if overlap <= 0:
            return 0.0
        return overlap / math.sqrt(len(query_tokens) * len(text_tokens))

    def _recency_score(self, *, now: datetime, ts: datetime, half_life_hours: float) -> float:
        age_hours = max((now - ts).total_seconds() / 3600.0, 0.0)
        if half_life_hours <= 0:
            return 0.0
        return math.exp(-age_hours / half_life_hours)

    def _infer_task_tags(self, text: str) -> list[str]:
        normalized = text.lower()
        tags: list[str] = []
        rule_map = {
            "deploy": ("部署", "上线", "发布", "deploy", "release"),
            "test": ("测试", "pytest", "test", "lint"),
            "browser": ("浏览器", "chrome", "cdp", "playwright", "browser"),
            "dingtalk": ("钉钉", "dingtalk"),
            "openclaw": ("openclaw", "claw"),
            "ssh": ("ssh", "远程"),
            "frontend": ("前端", "ui", "页面", "frontend"),
            "backend": ("后端", "api", "backend", "服务"),
            "memory": ("记忆", "memory"),
        }
        for tag, keywords in rule_map.items():
            if any(token.lower() in normalized for token in keywords):
                tags.append(tag)
        if not tags:
            tags.append("general")
        return tags

    def infer_project_key(self, *, query: str, conversation_id: str) -> str:
        normalized = query.strip().lower()
        explicit = re.search(r"(?:项目|project)[:：\s-]*([a-z0-9._/-]{2,48})", normalized)
        if explicit:
            return self._normalize_project_key(explicit.group(1))
        path_like = re.search(r"([a-z0-9._-]+/[a-z0-9._-]+)", normalized)
        if path_like:
            return self._normalize_project_key(path_like.group(1))
        if conversation_id:
            return self._normalize_project_key(f"conv_{conversation_id}")
        return "general"

    def _update_learning_from_task(self, record: TaskRecord) -> None:
        tags = self._infer_task_tags(record.request_text)
        scope_chain = self._build_scope_chain(
            user_id=record.user_id,
            channel=record.channel,
            project_key=record.project_key,
        )
        for scope in scope_chain:
            scope_map = self._learning_stats_scoped.setdefault(scope, {})
            for tag in tags:
                item = scope_map.setdefault(
                    tag,
                    {
                        "success": 0,
                        "failed": 0,
                        "timeout": 0,
                        "feedback_good": 0.0,
                        "feedback_bad": 0.0,
                        "last_error": None,
                        "last_updated": datetime.now(UTC).isoformat(),
                    },
                )
                if record.status == "completed":
                    item["success"] = int(item.get("success", 0)) + 1
                elif record.status == "failed":
                    item["failed"] = int(item.get("failed", 0)) + 1
                    if record.executor_error:
                        item["last_error"] = record.executor_error
                        if "timeout" in record.executor_error.lower():
                            item["timeout"] = int(item.get("timeout", 0)) + 1
                item["last_updated"] = datetime.now(UTC).isoformat()
                self._upsert_strategy_card_from_learning(scope=scope, tag=tag, stats=item)

    def _apply_feedback_signal(
        self,
        *,
        stats: dict[str, Any],
        feedback: str,
        weight: float,
    ) -> None:
        if feedback == "good":
            current = float(stats.get("feedback_good", 0.0))
            stats["feedback_good"] = max(0.0, current + weight)
            return
        if feedback == "bad":
            current = float(stats.get("feedback_bad", 0.0))
            stats["feedback_bad"] = max(0.0, current + weight)
            return

    def _effective_outcomes(self, *, stats: dict[str, Any]) -> tuple[float, float, float]:
        success = self._safe_float(stats.get("success"), default=0.0) + self._safe_float(
            stats.get("feedback_good"),
            default=0.0,
        )
        failed = self._safe_float(stats.get("failed"), default=0.0) + self._safe_float(
            stats.get("feedback_bad"),
            default=0.0,
        )
        timeout = self._safe_float(stats.get("timeout"), default=0.0)
        return success, failed, timeout

    def _is_terminal_status(self, status: str) -> bool:
        return status.strip().lower() in {"completed", "failed", "timeout"}

    def _strategy_runtime_stats(self, *, card_id: str) -> dict[str, Any]:
        metrics = self._strategy_card_runtime_metrics.setdefault(
            card_id,
            {
                "success_total": 0.0,
                "failed_total": 0.0,
                "timeout_total": 0.0,
                "feedback_good": 0.0,
                "feedback_bad": 0.0,
                "last_task_id": None,
                "last_updated": datetime.now(UTC).isoformat(),
            },
        )
        metrics["success_total"] = self._safe_float(metrics.get("success_total"), default=0.0)
        metrics["failed_total"] = self._safe_float(metrics.get("failed_total"), default=0.0)
        metrics["timeout_total"] = self._safe_float(metrics.get("timeout_total"), default=0.0)
        metrics["feedback_good"] = self._safe_float(metrics.get("feedback_good"), default=0.0)
        metrics["feedback_bad"] = self._safe_float(metrics.get("feedback_bad"), default=0.0)
        metrics["last_task_id"] = (
            str(metrics.get("last_task_id")) if metrics.get("last_task_id") is not None else None
        )
        metrics["last_updated"] = str(metrics.get("last_updated") or datetime.now(UTC).isoformat())
        return metrics

    def _update_strategy_runtime_from_task(self, *, record: TaskRecord) -> None:
        if not self._is_terminal_status(record.status):
            return
        if record.strategy_metrics_applied:
            return
        card_ids = {item.strip() for item in record.strategy_cards_used if item and item.strip()}
        if not card_ids:
            return
        status = record.status.strip().lower()
        now_iso = datetime.now(UTC).isoformat()
        applied = False
        for card_id in card_ids:
            metrics = self._strategy_runtime_stats(card_id=card_id)
            if status == "completed":
                metrics["success_total"] = float(metrics.get("success_total", 0.0)) + 1.0
            elif status == "failed":
                metrics["failed_total"] = float(metrics.get("failed_total", 0.0)) + 1.0
                if record.executor_error and "timeout" in record.executor_error.lower():
                    metrics["timeout_total"] = float(metrics.get("timeout_total", 0.0)) + 1.0
            elif status == "timeout":
                metrics["failed_total"] = float(metrics.get("failed_total", 0.0)) + 1.0
                metrics["timeout_total"] = float(metrics.get("timeout_total", 0.0)) + 1.0
            metrics["last_task_id"] = record.task_id
            metrics["last_updated"] = now_iso
            applied = True
        if applied:
            record.strategy_metrics_applied = True

    def _update_strategy_runtime_feedback(
        self,
        *,
        record: TaskRecord,
        previous_feedback: str | None,
        previous_weight: float,
        new_feedback: str,
        new_weight: float,
        now: datetime,
    ) -> None:
        card_ids = {item.strip() for item in record.strategy_cards_used if item and item.strip()}
        if not card_ids:
            return
        for card_id in card_ids:
            metrics = self._strategy_runtime_stats(card_id=card_id)
            if previous_feedback in {"good", "bad"} and previous_weight > 0:
                self._apply_feedback_signal(
                    stats=metrics,
                    feedback=previous_feedback,
                    weight=-previous_weight,
                )
            self._apply_feedback_signal(
                stats=metrics,
                feedback=new_feedback,
                weight=new_weight,
            )
            metrics["last_task_id"] = record.task_id
            metrics["last_updated"] = now.isoformat()

    def _strategy_signal_total(self, *, metrics: dict[str, Any]) -> float:
        return (
            self._safe_float(metrics.get("success_total"), default=0.0)
            + self._safe_float(metrics.get("failed_total"), default=0.0)
            + self._safe_float(metrics.get("timeout_total"), default=0.0)
            + self._safe_float(metrics.get("feedback_good"), default=0.0)
            + self._safe_float(metrics.get("feedback_bad"), default=0.0)
        )

    def _strategy_freshness_factor(self, *, card: StrategyCard) -> float:
        reference_ts = card.updated_at
        metrics = self._strategy_card_runtime_metrics.get(card.card_id)
        if isinstance(metrics, dict):
            runtime_ts = self._parse_optional_datetime(metrics.get("last_updated"))
            if runtime_ts is not None and runtime_ts > reference_ts:
                reference_ts = runtime_ts
        age_hours = max((datetime.now(UTC) - reference_ts).total_seconds() / 3600.0, 0.0)
        half_life_hours = 24.0 * 14.0
        return math.exp(-age_hours / half_life_hours)

    def _strategy_rank_score(self, *, card_id: str) -> float:
        card = self._strategy_cards.get(card_id)
        if card is None:
            return 0.0
        freshness = self._strategy_freshness_factor(card=card)
        performance = self._strategy_performance_score(card_id=card_id)
        return card.confidence + performance * 0.6 + (freshness - 0.5) * 0.2

    def _rebuild_strategy_scope_order(self) -> None:
        for _scope, queue in self._scope_strategy_cards.items():
            unique_ids: list[str] = []
            seen: set[str] = set()
            for card_id in list(queue):
                if card_id in seen or card_id not in self._strategy_cards:
                    continue
                seen.add(card_id)
                unique_ids.append(card_id)
            if not unique_ids:
                queue.clear()
                continue
            ranked_ids = sorted(
                unique_ids,
                key=lambda card_id: self._strategy_rank_score(card_id=card_id),
                reverse=True,
            )
            queue.clear()
            queue.extend(ranked_ids)

    def _strategy_performance_score(self, *, card_id: str) -> float:
        metrics = self._strategy_card_runtime_metrics.get(card_id)
        if not isinstance(metrics, dict):
            return 0.0
        positive = self._safe_float(metrics.get("success_total"), default=0.0) + self._safe_float(
            metrics.get("feedback_good"),
            default=0.0,
        )
        negative = (
            self._safe_float(metrics.get("failed_total"), default=0.0)
            + self._safe_float(metrics.get("feedback_bad"), default=0.0)
            + self._safe_float(metrics.get("timeout_total"), default=0.0) * 0.6
        )
        total = positive + negative
        if total <= 0:
            return 0.0
        raw = (positive - negative) / total
        stability = min(total / 6.0, 1.0)
        score = raw * stability
        return round(max(-1.0, min(score, 1.0)), 4)

    def _strategy_runtime_metrics_view(self, *, card_id: str) -> dict[str, Any]:
        metrics = self._strategy_card_runtime_metrics.get(card_id)
        if not isinstance(metrics, dict):
            return {
                "success_total": 0.0,
                "failed_total": 0.0,
                "timeout_total": 0.0,
                "feedback_good": 0.0,
                "feedback_bad": 0.0,
                "signal_total": 0.0,
                "last_task_id": None,
                "last_updated": None,
            }
        normalized = self._strategy_runtime_stats(card_id=card_id)
        signal_total = self._strategy_signal_total(metrics=normalized)
        return {
            "success_total": round(
                self._safe_float(normalized.get("success_total"), default=0.0),
                4,
            ),
            "failed_total": round(
                self._safe_float(normalized.get("failed_total"), default=0.0),
                4,
            ),
            "timeout_total": round(
                self._safe_float(normalized.get("timeout_total"), default=0.0),
                4,
            ),
            "feedback_good": round(
                self._safe_float(normalized.get("feedback_good"), default=0.0),
                4,
            ),
            "feedback_bad": round(
                self._safe_float(normalized.get("feedback_bad"), default=0.0),
                4,
            ),
            "signal_total": round(signal_total, 4),
            "last_task_id": normalized.get("last_task_id"),
            "last_updated": normalized.get("last_updated"),
        }

    def _feedback_weight_for_task(self, *, record: TaskRecord, now: datetime) -> float:
        age_hours = max((now - record.updated_at).total_seconds() / 3600.0, 0.0)
        decay = math.exp(-age_hours / (24.0 * 14.0))
        base_weight = 0.6 + 1.4 * decay
        return round(max(0.3, min(base_weight, 2.0)), 4)

    def _build_scope_chain(
        self,
        *,
        user_id: str,
        channel: str,
        project_key: str,
    ) -> tuple[str, str, str, str]:
        user = self._normalize_scope_value(user_id) or "global"
        chan = self._normalize_scope_value(channel) or "global"
        project = self._normalize_project_key(project_key)
        return (
            f"{user}|{chan}|{project}",
            f"{user}|{chan}|general",
            f"{user}|global|general",
            "global|global|general",
        )

    def _normalize_scope_value(self, value: str) -> str:
        return re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())[:64]

    def _normalize_agent_id(self, value: str) -> str:
        normalized = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip().lower())
        normalized = normalized.strip("_")
        return normalized[:32] or "ceo"

    def _normalize_project_key(self, value: str) -> str:
        normalized = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip().lower())
        normalized = normalized.strip("_")
        return normalized[:80] or "general"

    def _upsert_strategy_card_from_learning(
        self,
        *,
        scope: str,
        tag: str,
        stats: dict[str, Any],
    ) -> None:
        success, failed, timeout = self._effective_outcomes(stats=stats)
        total = success + failed
        if total <= 0:
            return
        fail_ratio = failed / total
        confidence = min(0.45 + total * 0.08, 0.95)
        now = datetime.now(UTC)

        card_kind: str | None = "stable_path"
        title = f"[{tag}] 稳定路径复用"
        summary = f"[{tag}] 近期成功率较高，可优先复用上一条稳定执行路径。"
        recommended_steps = ["优先复用最近一次稳定参数与路径，只做最小变更。"]
        cautions = ["执行前确认目标环境状态与变更范围。"]
        evidence = ["保留执行命令与关键输出", "记录健康检查结果"]

        if timeout > 0:
            card_kind = "timeout_recovery"
            title = f"[{tag}] 超时恢复策略"
            summary = f"[{tag}] 最近有超时，先做健康检查并拆小任务，再执行变更。"
            recommended_steps = [
                "先做执行器健康检查（版本/进程/通道），异常时先切换通道再继续。",
                "将任务拆分为可快速验证的小步骤，逐步推进。",
            ]
            cautions = ["避免一次性提交大变更导致长时间阻塞。"]
            evidence = ["保留超时报错原文", "保留恢复探测结果"]
            confidence = min(confidence + 0.05, 0.98)
        elif fail_ratio >= 0.6 and failed >= 2:
            card_kind = "read_only_guard"
            title = f"[{tag}] 先读后写防护"
            summary = f"[{tag}] 失败率偏高，建议先只读探测（状态/配置/权限）再执行。"
            recommended_steps = [
                "先做只读探测（状态/配置/权限），确认后再执行写操作。",
                "写操作后立即执行验证与回滚可行性检查。",
            ]
            cautions = ["未完成只读探测前不要执行破坏性写操作。"]
            evidence = ["保留只读探测输出", "保留回滚命令与结果"]
            confidence = min(confidence + 0.03, 0.96)
        elif success < 2:
            card_kind = None

        self._prune_learning_strategy_cards(scope=scope, tag=tag, keep_kind=card_kind)
        if card_kind is None:
            return

        card_id = f"card_{scope}_{tag}_{card_kind}"
        card_id = re.sub(r"[^a-zA-Z0-9._-]+", "_", card_id)[:160]
        existing = self._strategy_cards.get(card_id)
        created_at = existing.created_at if existing else now
        card = StrategyCard(
            card_id=card_id,
            scope=scope,
            tag=tag,
            title=title,
            summary=summary,
            trigger_tags=[tag, "task_request"],
            recommended_steps=recommended_steps,
            cautions=cautions,
            evidence_requirements=evidence,
            confidence=confidence,
            source="learning_loop_v2",
            created_at=created_at,
            updated_at=now,
        )
        self._strategy_cards[card_id] = card
        queue = self._scope_strategy_cards[scope]
        if card_id in queue:
            queue.remove(card_id)
        queue.append(card_id)

    def _prune_learning_strategy_cards(
        self,
        *,
        scope: str,
        tag: str,
        keep_kind: str | None,
    ) -> None:
        for card_id, card in list(self._strategy_cards.items()):
            if card.source != "learning_loop_v2":
                continue
            if card.scope != scope or card.tag != tag:
                continue
            if keep_kind is not None and card_id.endswith(f"_{keep_kind}"):
                continue
            del self._strategy_cards[card_id]
            self._strategy_card_runtime_metrics.pop(card_id, None)
            queue = self._scope_strategy_cards.get(scope)
            if queue and card_id in queue:
                queue.remove(card_id)

    def _load_from_disk(self) -> None:
        assert self._storage_path is not None
        payload, source = self._load_payload_for_restore()
        if payload is None:
            if not os.path.exists(self._storage_path):
                self._last_load_source = "empty"
            else:
                self._last_load_source = "unrecoverable"
            return
        self._last_load_source = source

        profiles_data = payload.get("profiles", {})
        for user_id, profile_payload in profiles_data.items():
            self._profiles[user_id] = UserProfile(
                user_id=user_id,
                preferred_name=profile_payload.get("preferred_name"),
                facts=dict(profile_payload.get("facts", {})),
                fact_history=dict(profile_payload.get("fact_history", {})),
            )

        events_data = payload.get("events", {})
        for conversation_id, items in events_data.items():
            queue: deque[MemoryEvent] = deque(maxlen=self._max_events_per_conversation)
            for item in items:
                timestamp_raw = item.get("timestamp")
                try:
                    timestamp = (
                        datetime.fromisoformat(timestamp_raw)
                        if isinstance(timestamp_raw, str)
                        else datetime.now(UTC)
                    )
                except ValueError:
                    timestamp = datetime.now(UTC)
                queue.append(
                    MemoryEvent(
                        timestamp=timestamp,
                        user_id=str(item.get("user_id", "")),
                        direction=str(item.get("direction", "")),
                        text=str(item.get("text", "")),
                        intent=str(item.get("intent", "unknown")),
                        trace_id=(
                            str(item.get("trace_id"))
                            if item.get("trace_id") is not None
                            else None
                        ),
                    )
                )
            self._events[conversation_id] = queue

        daily_notes_data = payload.get("daily_notes", {})
        for date_key, items in daily_notes_data.items():
            queue: deque[MemoryEvent] = deque(maxlen=500)
            for item in items:
                timestamp_raw = item.get("timestamp")
                try:
                    timestamp = (
                        datetime.fromisoformat(timestamp_raw)
                        if isinstance(timestamp_raw, str)
                        else datetime.now(UTC)
                    )
                except ValueError:
                    timestamp = datetime.now(UTC)
                queue.append(
                    MemoryEvent(
                        timestamp=timestamp,
                        user_id=str(item.get("user_id", "")),
                        direction=str(item.get("direction", "")),
                        text=str(item.get("text", "")),
                        intent=str(item.get("intent", "unknown")),
                        trace_id=(
                            str(item.get("trace_id"))
                            if item.get("trace_id") is not None
                            else None
                        ),
                    )
                )
            self._daily_notes[date_key] = queue

        summaries_data = payload.get("summaries", {})
        for conversation_id, item in summaries_data.items():
            updated_raw = item.get("updated_at")
            try:
                updated_at = (
                    datetime.fromisoformat(updated_raw)
                    if isinstance(updated_raw, str)
                    else datetime.now(UTC)
                )
            except ValueError:
                updated_at = datetime.now(UTC)
            self._summaries[conversation_id] = ConversationSummary(
                conversation_id=conversation_id,
                user_id=str(item.get("user_id", "")),
                last_intent=str(item.get("last_intent", "unknown")),
                key_points=list(item.get("key_points", [])),
                updated_at=updated_at,
            )

        tasks_data = payload.get("tasks", {})
        for task_id, item in tasks_data.items():
            created_raw = item.get("created_at")
            updated_raw = item.get("updated_at")
            try:
                created_at = (
                    datetime.fromisoformat(created_raw)
                    if isinstance(created_raw, str)
                    else datetime.now(UTC)
                )
            except ValueError:
                created_at = datetime.now(UTC)
            try:
                updated_at = (
                    datetime.fromisoformat(updated_raw)
                    if isinstance(updated_raw, str)
                    else datetime.now(UTC)
                )
            except ValueError:
                updated_at = datetime.now(UTC)
            normalized_agent_id = self._normalize_agent_id(str(item.get("agent_id", "ceo")))
            normalized_memory_scope = str(item.get("memory_scope", "")).strip() or f"agent:{normalized_agent_id}"
            record = TaskRecord(
                task_id=task_id,
                conversation_id=str(item.get("conversation_id", "")),
                user_id=str(item.get("user_id", "")),
                channel=str(item.get("channel", "api")),
                project_key=str(item.get("project_key", "general")),
                agent_id=normalized_agent_id,
                memory_scope=normalized_memory_scope,
                trace_id=str(item.get("trace_id", "")),
                request_text=str(item.get("request_text", "")),
                route_model=str(item.get("route_model", "minimax/MiniMax-M2.1")),
                plan_steps=list(item.get("plan_steps", [])),
                verification_checks=list(item.get("verification_checks", [])),
                rollback_template=list(item.get("rollback_template", [])),
                status=str(item.get("status", "planned")),
                executor_reply=(
                    str(item.get("executor_reply"))
                    if item.get("executor_reply") is not None
                    else None
                ),
                executor_error=(
                    str(item.get("executor_error"))
                    if item.get("executor_error") is not None
                    else None
                ),
                evidence=list(item.get("evidence", [])),
                evidence_structured=self._normalize_structured_evidence(
                    item.get("evidence_structured")
                ),
                execution_duration_ms=(
                    self._safe_int(item.get("execution_duration_ms"), default=0)
                    if item.get("execution_duration_ms") is not None
                    else None
                ),
                quality_score=(
                    float(item.get("quality_score"))
                    if isinstance(item.get("quality_score"), (int, float))
                    else None
                ),
                quality_issues=list(item.get("quality_issues", [])),
                correction_applied=bool(item.get("correction_applied", False)),
                strategy_cards_used=list(item.get("strategy_cards_used", [])),
                strategy_metrics_applied=bool(item.get("strategy_metrics_applied", False)),
                human_feedback=(
                    str(item.get("human_feedback"))
                    if item.get("human_feedback") is not None
                    else None
                ),
                human_feedback_weight=(
                    float(item.get("human_feedback_weight"))
                    if isinstance(item.get("human_feedback_weight"), (int, float))
                    else None
                ),
                feedback_note=(
                    str(item.get("feedback_note"))
                    if item.get("feedback_note") is not None
                    else None
                ),
                feedback_updated_at=self._parse_optional_datetime(item.get("feedback_updated_at")),
                feedback_history=self._normalize_feedback_history(item.get("feedback_history")),
                started_at=self._parse_optional_datetime(item.get("started_at")),
                last_heartbeat_at=self._parse_optional_datetime(item.get("last_heartbeat_at")),
                last_retry_at=self._parse_optional_datetime(item.get("last_retry_at")),
                execution_attempts=self._safe_int(item.get("execution_attempts"), default=0),
                max_attempts=max(self._safe_int(item.get("max_attempts"), default=1), 1),
                resume_count=self._safe_int(item.get("resume_count"), default=0),
                closed_at=self._parse_optional_datetime(item.get("closed_at")),
                close_reason=(
                    str(item.get("close_reason"))
                    if item.get("close_reason") is not None
                    else None
                ),
                created_at=created_at,
                updated_at=updated_at,
            )
            self._tasks[task_id] = record
            self._conversation_tasks[record.conversation_id].append(task_id)

        learning_data = payload.get("learning", {})
        if isinstance(learning_data, dict):
            is_new_shape = any(
                isinstance(v, dict) and any(isinstance(sub, dict) for sub in v.values())
                for v in learning_data.values()
            )
            if is_new_shape:
                for scope, scope_map in learning_data.items():
                    if not isinstance(scope_map, dict):
                        continue
                    parsed_scope_map: dict[str, dict[str, Any]] = {}
                    for tag, item in scope_map.items():
                        if not isinstance(item, dict):
                            continue
                        parsed_scope_map[str(tag)] = {
                            "success": self._safe_int(item.get("success"), default=0),
                            "failed": self._safe_int(item.get("failed"), default=0),
                            "timeout": self._safe_int(item.get("timeout"), default=0),
                            "feedback_good": self._safe_float(
                                item.get("feedback_good"),
                                default=0.0,
                            ),
                            "feedback_bad": self._safe_float(item.get("feedback_bad"), default=0.0),
                            "last_error": (
                                str(item.get("last_error"))
                                if item.get("last_error") is not None
                                else None
                            ),
                            "last_updated": str(item.get("last_updated", "")),
                        }
                    if parsed_scope_map:
                        self._learning_stats_scoped[str(scope)] = parsed_scope_map
            else:
                legacy_scope = "global|global|general"
                legacy_map: dict[str, dict[str, Any]] = {}
                for tag, item in learning_data.items():
                    if not isinstance(item, dict):
                        continue
                    legacy_map[str(tag)] = {
                        "success": self._safe_int(item.get("success"), default=0),
                        "failed": self._safe_int(item.get("failed"), default=0),
                        "timeout": self._safe_int(item.get("timeout"), default=0),
                        "feedback_good": self._safe_float(item.get("feedback_good"), default=0.0),
                        "feedback_bad": self._safe_float(item.get("feedback_bad"), default=0.0),
                        "last_error": (
                            str(item.get("last_error"))
                            if item.get("last_error") is not None
                            else None
                        ),
                        "last_updated": str(item.get("last_updated", "")),
                    }
                if legacy_map:
                    self._learning_stats_scoped[legacy_scope] = legacy_map

        strategy_cards_data = payload.get("strategy_cards", {})
        if isinstance(strategy_cards_data, dict):
            for card_id, item in strategy_cards_data.items():
                if not isinstance(item, dict):
                    continue
                created_raw = item.get("created_at")
                updated_raw = item.get("updated_at")
                try:
                    created_at = (
                        datetime.fromisoformat(created_raw)
                        if isinstance(created_raw, str)
                        else datetime.now(UTC)
                    )
                except ValueError:
                    created_at = datetime.now(UTC)
                try:
                    updated_at = (
                        datetime.fromisoformat(updated_raw)
                        if isinstance(updated_raw, str)
                        else datetime.now(UTC)
                    )
                except ValueError:
                    updated_at = datetime.now(UTC)
                try:
                    confidence = float(item.get("confidence", 0.5))
                except (TypeError, ValueError):
                    confidence = 0.5
                card = StrategyCard(
                    card_id=str(card_id),
                    scope=str(item.get("scope", "global|global|general")),
                    tag=str(item.get("tag", "general")),
                    title=str(item.get("title", "")),
                    summary=str(item.get("summary", "")),
                    trigger_tags=list(item.get("trigger_tags", [])),
                    recommended_steps=list(item.get("recommended_steps", [])),
                    cautions=list(item.get("cautions", [])),
                    evidence_requirements=list(item.get("evidence_requirements", [])),
                    confidence=confidence,
                    source=str(item.get("source", "memory_load")),
                    created_at=created_at,
                    updated_at=updated_at,
                )
                self._strategy_cards[card.card_id] = card
                queue = self._scope_strategy_cards[card.scope]
                if card.card_id in queue:
                    queue.remove(card.card_id)
                queue.append(card.card_id)

        strategy_runtime_data = payload.get("strategy_card_runtime_metrics", {})
        if isinstance(strategy_runtime_data, dict):
            for raw_card_id, raw_item in strategy_runtime_data.items():
                card_id = str(raw_card_id).strip()
                if not card_id or not isinstance(raw_item, dict):
                    continue
                self._strategy_card_runtime_metrics[card_id] = {
                    "success_total": self._safe_float(raw_item.get("success_total"), default=0.0),
                    "failed_total": self._safe_float(raw_item.get("failed_total"), default=0.0),
                    "timeout_total": self._safe_float(raw_item.get("timeout_total"), default=0.0),
                    "feedback_good": self._safe_float(raw_item.get("feedback_good"), default=0.0),
                    "feedback_bad": self._safe_float(raw_item.get("feedback_bad"), default=0.0),
                    "last_task_id": (
                        str(raw_item.get("last_task_id"))
                        if raw_item.get("last_task_id") is not None
                        else None
                    ),
                    "last_updated": str(raw_item.get("last_updated") or ""),
                }

        external_map_data = payload.get("external_message_task_map", {})
        if isinstance(external_map_data, dict):
            for raw_key, raw_item in external_map_data.items():
                key = str(raw_key).strip()
                if not key:
                    continue
                if not isinstance(raw_item, dict):
                    continue
                task_id = str(raw_item.get("task_id") or "").strip()
                if not task_id:
                    continue
                updated_at = str(raw_item.get("updated_at") or "").strip()
                self._external_message_task_map[key] = {
                    "task_id": task_id,
                    "updated_at": updated_at,
                }

        processed_ingress_data = payload.get("processed_ingress_map", {})
        if isinstance(processed_ingress_data, dict):
            for raw_key, raw_item in processed_ingress_data.items():
                key = str(raw_key).strip()
                if not key or not isinstance(raw_item, dict):
                    continue
                updated_at = str(raw_item.get("updated_at") or "").strip()
                if not updated_at:
                    continue
                self._processed_ingress_map[key] = {
                    "updated_at": updated_at,
                    "trace_id": str(raw_item.get("trace_id") or ""),
                }

        ingress_dedupe_metrics_data = payload.get("ingress_dedupe_metrics", {})
        if isinstance(ingress_dedupe_metrics_data, dict):
            self._ingress_dedupe_metrics = {
                "attempt_total": self._safe_int(
                    ingress_dedupe_metrics_data.get("attempt_total"),
                    default=0,
                ),
                "dropped_total": self._safe_int(
                    ingress_dedupe_metrics_data.get("dropped_total"),
                    default=0,
                ),
            }

        metrics_data = payload.get("feedback_binding_metrics", {})
        if isinstance(metrics_data, dict):
            source_counts_raw = metrics_data.get("source_counts")
            source_counts: dict[str, int] = {}
            if isinstance(source_counts_raw, dict):
                source_counts = {
                    str(k): self._safe_int(v, default=0) for k, v in source_counts_raw.items()
                }
            self._feedback_binding_metrics = {
                "attempt_total": self._safe_int(metrics_data.get("attempt_total"), default=0),
                "success_total": self._safe_int(metrics_data.get("success_total"), default=0),
                "not_found_total": self._safe_int(metrics_data.get("not_found_total"), default=0),
                "short_retry_total": self._safe_int(
                    metrics_data.get("short_retry_total"),
                    default=0,
                ),
                "override_total": self._safe_int(
                    metrics_data.get("override_total"),
                    default=0,
                ),
                "source_counts": source_counts,
            }
        pipeline_metrics_data = payload.get("memory_pipeline_metrics", {})
        if isinstance(pipeline_metrics_data, dict):
            self._memory_pipeline_metrics = {
                "retrieval_total": self._safe_int(
                    pipeline_metrics_data.get("retrieval_total"),
                    default=0,
                ),
                "retrieval_hit_total": self._safe_int(
                    pipeline_metrics_data.get("retrieval_hit_total"),
                    default=0,
                ),
                "retrieval_raw_items_total": self._safe_int(
                    pipeline_metrics_data.get("retrieval_raw_items_total"),
                    default=0,
                ),
                "retrieval_deduped_items_total": self._safe_int(
                    pipeline_metrics_data.get("retrieval_deduped_items_total"),
                    default=0,
                ),
                "dedup_reduction_items_total": self._safe_int(
                    pipeline_metrics_data.get("dedup_reduction_items_total"),
                    default=0,
                ),
                "sidecar_request_total": self._safe_int(
                    pipeline_metrics_data.get("sidecar_request_total"),
                    default=0,
                ),
                "sidecar_success_total": self._safe_int(
                    pipeline_metrics_data.get("sidecar_success_total"),
                    default=0,
                ),
                "sidecar_item_total": self._safe_int(
                    pipeline_metrics_data.get("sidecar_item_total"),
                    default=0,
                ),
                "sufficiency_total": self._safe_int(
                    pipeline_metrics_data.get("sufficiency_total"),
                    default=0,
                ),
                "sufficiency_pass_total": self._safe_int(
                    pipeline_metrics_data.get("sufficiency_pass_total"),
                    default=0,
                ),
            }
        federated_data = payload.get("federated_memory_namespaces", {})
        if isinstance(federated_data, dict):
            for raw_namespace, raw_items in federated_data.items():
                namespace = str(raw_namespace).strip()
                if not namespace:
                    continue
                queue: deque[dict[str, Any]] = deque(maxlen=500)
                if isinstance(raw_items, list):
                    for item in raw_items:
                        if isinstance(item, dict):
                            queue.append({str(k): v for k, v in item.items()})
                self._federated_memory_namespaces[namespace] = queue

        team_task_meta_data = payload.get("team_task_meta", {})
        if isinstance(team_task_meta_data, dict):
            for raw_task_id, raw_item in team_task_meta_data.items():
                task_id = str(raw_task_id).strip()
                if not task_id or not isinstance(raw_item, dict):
                    continue
                parsed_item = {
                    str(key): value for key, value in raw_item.items() if isinstance(key, str)
                }
                parsed_item["task_id"] = task_id
                parsed_item["owner_role"] = str(parsed_item.get("owner_role") or "CTO")
                parsed_item["title"] = str(parsed_item.get("title") or "")
                parsed_item["objective"] = str(parsed_item.get("objective") or "")
                parsed_item["status"] = str(parsed_item.get("status") or "pending")
                parsed_item["cto_lane"] = str(parsed_item.get("cto_lane") or "ENG")
                parsed_item["execution_mode"] = str(
                    parsed_item.get("execution_mode") or "subagent"
                )
                if parsed_item.get("risk") is not None:
                    parsed_item["risk"] = str(parsed_item.get("risk"))
                if parsed_item.get("next_step") is not None:
                    parsed_item["next_step"] = str(parsed_item.get("next_step"))
                parsed_item["created_at"] = str(parsed_item.get("created_at") or "")
                parsed_item["updated_at"] = str(parsed_item.get("updated_at") or "")
                self._team_task_meta[task_id] = parsed_item
        task_leases_data = payload.get("task_leases", {})
        if isinstance(task_leases_data, dict):
            for raw_task_id, raw_item in task_leases_data.items():
                task_id = str(raw_task_id).strip()
                if not task_id or not isinstance(raw_item, dict):
                    continue
                holder = str(raw_item.get("holder") or "").strip()
                if not holder:
                    continue
                acquired_at = str(raw_item.get("acquired_at") or "").strip()
                updated_at = str(raw_item.get("updated_at") or "").strip()
                expires_at = str(raw_item.get("expires_at") or "").strip()
                self._task_leases[task_id] = {
                    "task_id": task_id,
                    "holder": holder,
                    "acquired_at": acquired_at,
                    "updated_at": updated_at,
                    "expires_at": expires_at,
                }
        self._rebuild_strategy_scope_order()

        if source != "primary":
            self._recovery_count += 1
            self._write_payload_atomic(payload=payload, rotate_backups=False)

    def _save_to_disk(self) -> None:
        if not self._storage_path:
            return
        directory = os.path.dirname(self._storage_path)
        if directory:
            os.makedirs(directory, exist_ok=True)

        payload = {
            "profiles": {
                user_id: {
                    "preferred_name": profile.preferred_name,
                    "facts": profile.facts,
                    "fact_history": profile.fact_history,
                }
                for user_id, profile in self._profiles.items()
            },
            "events": {
                conversation_id: [
                    {
                        "timestamp": event.timestamp.isoformat(),
                        "user_id": event.user_id,
                        "direction": event.direction,
                        "text": event.text,
                        "intent": event.intent,
                        "trace_id": event.trace_id,
                    }
                    for event in queue
                ]
                for conversation_id, queue in self._events.items()
            },
            "daily_notes": {
                date_key: [
                    {
                        "timestamp": event.timestamp.isoformat(),
                        "user_id": event.user_id,
                        "direction": event.direction,
                        "text": event.text,
                        "intent": event.intent,
                        "trace_id": event.trace_id,
                    }
                    for event in queue
                ]
                for date_key, queue in self._daily_notes.items()
            },
            "summaries": {
                conversation_id: {
                    "user_id": summary.user_id,
                    "last_intent": summary.last_intent,
                    "key_points": summary.key_points,
                    "updated_at": summary.updated_at.isoformat(),
                }
                for conversation_id, summary in self._summaries.items()
            },
            "tasks": {
                task_id: {
                    "conversation_id": record.conversation_id,
                    "user_id": record.user_id,
                    "channel": record.channel,
                    "project_key": record.project_key,
                    "agent_id": self._normalize_agent_id(record.agent_id),
                    "memory_scope": (record.memory_scope or "").strip()
                    or f"agent:{self._normalize_agent_id(record.agent_id)}",
                    "trace_id": record.trace_id,
                    "request_text": record.request_text,
                    "route_model": record.route_model,
                    "plan_steps": record.plan_steps,
                    "verification_checks": record.verification_checks,
                    "rollback_template": record.rollback_template,
                    "status": record.status,
                    "executor_reply": record.executor_reply,
                    "executor_error": record.executor_error,
                    "evidence": record.evidence,
                    "evidence_structured": record.evidence_structured,
                    "execution_duration_ms": record.execution_duration_ms,
                    "quality_score": record.quality_score,
                    "quality_issues": record.quality_issues,
                    "correction_applied": record.correction_applied,
                    "strategy_cards_used": record.strategy_cards_used,
                    "strategy_metrics_applied": record.strategy_metrics_applied,
                    "human_feedback": record.human_feedback,
                    "human_feedback_weight": record.human_feedback_weight,
                    "feedback_note": record.feedback_note,
                    "feedback_updated_at": (
                        record.feedback_updated_at.isoformat()
                        if record.feedback_updated_at is not None
                        else None
                    ),
                    "feedback_history": record.feedback_history,
                    "started_at": (
                        record.started_at.isoformat() if record.started_at is not None else None
                    ),
                    "last_heartbeat_at": (
                        record.last_heartbeat_at.isoformat()
                        if record.last_heartbeat_at is not None
                        else None
                    ),
                    "last_retry_at": (
                        record.last_retry_at.isoformat() if record.last_retry_at is not None else None
                    ),
                    "execution_attempts": record.execution_attempts,
                    "max_attempts": record.max_attempts,
                    "resume_count": record.resume_count,
                    "closed_at": (
                        record.closed_at.isoformat() if record.closed_at is not None else None
                    ),
                    "close_reason": record.close_reason,
                    "created_at": record.created_at.isoformat(),
                    "updated_at": record.updated_at.isoformat(),
                }
                for task_id, record in self._tasks.items()
            },
            "learning": self._learning_stats_scoped,
            "strategy_cards": {
                card_id: {
                    "scope": card.scope,
                    "tag": card.tag,
                    "title": card.title,
                    "summary": card.summary,
                    "trigger_tags": card.trigger_tags,
                    "recommended_steps": card.recommended_steps,
                    "cautions": card.cautions,
                    "evidence_requirements": card.evidence_requirements,
                    "confidence": card.confidence,
                    "source": card.source,
                    "created_at": card.created_at.isoformat(),
                    "updated_at": card.updated_at.isoformat(),
                }
                for card_id, card in self._strategy_cards.items()
            },
            "strategy_card_runtime_metrics": {
                card_id: {
                    "success_total": self._safe_float(item.get("success_total"), default=0.0),
                    "failed_total": self._safe_float(item.get("failed_total"), default=0.0),
                    "timeout_total": self._safe_float(item.get("timeout_total"), default=0.0),
                    "feedback_good": self._safe_float(item.get("feedback_good"), default=0.0),
                    "feedback_bad": self._safe_float(item.get("feedback_bad"), default=0.0),
                    "last_task_id": (
                        str(item.get("last_task_id"))
                        if item.get("last_task_id") is not None
                        else None
                    ),
                    "last_updated": str(item.get("last_updated") or ""),
                }
                for card_id, item in self._strategy_card_runtime_metrics.items()
                if isinstance(item, dict)
            },
            "external_message_task_map": self._external_message_task_map,
            "processed_ingress_map": self._processed_ingress_map,
            "ingress_dedupe_metrics": self._ingress_dedupe_metrics,
            "feedback_binding_metrics": self._feedback_binding_metrics,
            "memory_pipeline_metrics": self._memory_pipeline_metrics,
            "federated_memory_namespaces": {
                namespace: list(items)
                for namespace, items in self._federated_memory_namespaces.items()
            },
            "team_task_meta": self._team_task_meta,
            "task_leases": self._task_leases,
        }
        self._write_payload_atomic(payload=payload, rotate_backups=True)

    def _normalize_structured_evidence(self, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            normalized_item = {str(k): v for k, v in item.items() if isinstance(k, str)}
            if normalized_item:
                normalized.append(normalized_item)
        return normalized[:50]

    def _normalize_feedback_history(self, value: Any) -> list[dict[str, Any]]:
        if not isinstance(value, list):
            return []
        normalized: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict):
                continue
            feedback = str(item.get("feedback") or "").strip().lower()
            if feedback not in {"good", "bad"}:
                continue
            weight = self._safe_float(item.get("weight"), default=0.0)
            note_value = item.get("note")
            note = str(note_value).strip()[:500] if note_value is not None else None
            if note == "":
                note = None
            updated_at_raw = item.get("updated_at")
            updated_at = (
                str(updated_at_raw).strip()
                if updated_at_raw is not None and str(updated_at_raw).strip()
                else datetime.now(UTC).isoformat()
            )
            normalized.append(
                {
                    "feedback": feedback,
                    "weight": round(weight, 4),
                    "note": note,
                    "updated_at": updated_at,
                    "overrode_previous": bool(item.get("overrode_previous", False)),
                }
            )
        return normalized[-20:]

    def _external_message_task_key(
        self,
        *,
        platform: str,
        conversation_id: str,
        message_id: str,
    ) -> str:
        return (
            f"{platform.strip().lower()}|{conversation_id.strip()}|{message_id.strip()}"
        )

    def _processed_ingress_key(
        self,
        *,
        platform: str,
        conversation_id: str,
        message_id: str,
    ) -> str:
        return (
            f"{platform.strip().lower()}|{conversation_id.strip()}|{message_id.strip()}"
        )

    def _prune_processed_ingress(self, *, now: datetime, max_age_hours: float) -> None:
        stale_keys: list[str] = []
        for key, item in self._processed_ingress_map.items():
            if not isinstance(item, dict):
                stale_keys.append(key)
                continue
            updated_at = self._parse_optional_datetime(item.get("updated_at"))
            if updated_at is None:
                stale_keys.append(key)
                continue
            age_hours = max((now - updated_at).total_seconds() / 3600.0, 0.0)
            if age_hours > max_age_hours:
                stale_keys.append(key)
        for key in stale_keys:
            self._processed_ingress_map.pop(key, None)

    def _load_payload_for_restore(self) -> tuple[dict[str, Any] | None, str]:
        assert self._storage_path is not None
        candidates = [("primary", self._storage_path)] + [
            (f"backup_{index}", path)
            for index, path in enumerate(self._backup_paths(), start=1)
        ]
        for source, path in candidates:
            payload = self._read_json_file(path)
            if payload is None:
                continue
            return payload, source
        return None, "missing"

    def _read_json_file(self, path: str) -> dict[str, Any] | None:
        try:
            with open(path, encoding="utf-8") as fh:
                payload = json.load(fh)
        except (OSError, json.JSONDecodeError):
            return None
        if not isinstance(payload, dict):
            return None
        return payload

    def _backup_paths(self) -> list[str]:
        assert self._storage_path is not None
        return [f"{self._storage_path}.bak{index}" for index in range(1, _MEMORY_BACKUP_KEEP + 1)]

    def _rotate_backups(self) -> None:
        assert self._storage_path is not None
        backup_paths = self._backup_paths()
        for index in range(len(backup_paths) - 1, 0, -1):
            src = backup_paths[index - 1]
            dst = backup_paths[index]
            if os.path.exists(src):
                try:
                    os.replace(src, dst)
                except OSError:
                    continue
        if os.path.exists(self._storage_path):
            try:
                shutil.copy2(self._storage_path, backup_paths[0])
            except OSError:
                logger.warning("memory_backup_rotate_failed path=%s", self._storage_path)

    def _write_payload_atomic(self, *, payload: dict[str, Any], rotate_backups: bool) -> None:
        assert self._storage_path is not None
        directory = os.path.dirname(self._storage_path) or "."
        os.makedirs(directory, exist_ok=True)

        temp_fd, temp_path = tempfile.mkstemp(
            prefix=".yoyoo_memory_",
            suffix=".tmp",
            dir=directory,
            text=True,
        )
        try:
            with os.fdopen(temp_fd, "w", encoding="utf-8") as fh:
                json.dump(payload, fh, ensure_ascii=False, indent=2)
                fh.flush()
                os.fsync(fh.fileno())
            if rotate_backups:
                self._rotate_backups()
            os.replace(temp_path, self._storage_path)
            self._last_save_ok = True
            self._last_save_error = None
        except OSError as exc:
            self._last_save_ok = False
            self._last_save_error = str(exc)
            logger.warning("memory_atomic_write_failed path=%s err=%s", self._storage_path, exc)
        finally:
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    def _safe_int(self, value: Any, *, default: int) -> int:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _safe_float(self, value: Any, *, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def _parse_optional_datetime(self, value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
