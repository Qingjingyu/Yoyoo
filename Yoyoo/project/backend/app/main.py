import logging
import os
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.api.dingtalk import router as dingtalk_router
from app.api.team import router as team_router
from app.container import build_container
from app.intelligence.failure_attribution import analyze_failures
from app.intelligence.models import Channel, ChatScope
from app.schemas import (
    ChatRequest,
    ChatResponse,
    TaskFeedbackRequest,
    TaskFeedbackResponse,
)
from app.services.ingress_service import DeterministicIngressService, IngressEnvelope
from app.startup_self_check import run_startup_self_check

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger(__name__)
_ingress_service = DeterministicIngressService()


class TaskHeartbeatRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class TaskCloseRequest(BaseModel):
    status: str = Field(default="completed", min_length=3, max_length=32)
    reason: str | None = Field(default=None, max_length=300)
    summary: str | None = Field(default=None, max_length=2000)

@asynccontextmanager
async def lifespan(_app: FastAPI):  # type: ignore[no-untyped-def]
    _app.state.startup_self_check = run_startup_self_check(logger=logger)
    _app.state.started_at = datetime.now(UTC).isoformat()
    yield


app = FastAPI(title="Yoyoo Backend", version="0.1.0", lifespan=lifespan)
app.state.container = build_container()


@app.middleware("http")
async def attach_trace_id(request: Request, call_next):  # type: ignore[no-untyped-def]
    trace_id = request.headers.get("x-trace-id") or str(uuid4())
    request.state.trace_id = trace_id
    response = await call_next(request)
    response.headers["x-trace-id"] = trace_id
    return response


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok", "service": "yoyoo-backend"}


@app.get("/api/v1/runtime/identity")
def runtime_identity() -> dict[str, object]:
    executor = app.state.container.executor_adapter
    openclaw_enabled = getattr(getattr(executor, "_openclaw_adapter", None), "enabled", False)
    nano_enabled = getattr(executor, "_nano_provider", None) is not None
    return {
        "assistant_identity": "Yoyoo",
        "brain_service": "yoyoo-backend",
        "execution_adapter": "ExecutorAdapter",
        "execution_providers": {
            "claw": bool(openclaw_enabled),
            "nano": bool(nano_enabled),
        },
        "positioning": "Yoyoo负责对话/记忆/规划，执行由适配层调用外部执行器。",
    }


@app.get("/api/v1/ops/health")
def ops_health() -> dict[str, object]:
    startup = getattr(app.state, "startup_self_check", None)
    startup_payload = (
        {
            "legacy_port_18000_detected": startup.legacy_port_18000_detected,
            "dingtalk_forwarder_count": startup.dingtalk_forwarder_count,
            "yyos_enabled": startup.yyos_enabled,
            "yyos_available": startup.yyos_available,
            "memory_sidecar_enabled": startup.memory_sidecar_enabled,
            "memory_sidecar_available": startup.memory_sidecar_available,
            "issues": startup.issues,
        }
        if startup is not None
        else {
            "legacy_port_18000_detected": False,
            "dingtalk_forwarder_count": 0,
            "yyos_enabled": False,
            "yyos_available": False,
            "memory_sidecar_enabled": False,
            "memory_sidecar_available": False,
            "issues": ["startup_self_check_not_available"],
        }
    )
    memory_service = app.state.container.memory_service
    memory_snapshot = memory_service.ops_health_snapshot()
    trend_snapshot = _build_ops_trend(memory_service=memory_service)
    failures_snapshot = _build_failure_snapshot(memory_service=memory_service)
    alerts = _build_ops_alerts(
        startup_snapshot=startup_payload,
        memory_snapshot=memory_snapshot,
    )
    degraded = bool(startup_payload["issues"]) or not bool(
        memory_snapshot["persistence"]["last_save_ok"]
    )
    if alerts:
        degraded = True
    return {
        "status": "degraded" if degraded else "ok",
        "service": "yoyoo-backend",
        "timestamp": datetime.now(UTC).isoformat(),
        "started_at": getattr(app.state, "started_at", None),
        "startup_self_check": startup_payload,
        "memory": memory_snapshot,
        "trend": trend_snapshot,
        "failures": failures_snapshot,
        "alerts": alerts,
        "alert_count": len(alerts),
        "alert_status": _derive_alert_status(alerts),
    }


@app.get("/api/v1/ops/alerts")
def ops_alerts() -> dict[str, object]:
    health = ops_health()
    return {
        "status": health["status"],
        "service": health["service"],
        "timestamp": health["timestamp"],
        "alerts": health.get("alerts", []),
        "alert_count": health.get("alert_count", 0),
        "alert_status": health.get("alert_status", "ok"),
    }


@app.get("/api/v1/ops/failures")
def ops_failures(
    window_hours: float = 24.0,
    limit: int = 300,
    baseline_window_hours: float = 168.0,
) -> dict[str, object]:
    memory_service = app.state.container.memory_service
    capped_limit = max(1, min(limit, 2000))
    effective_window_hours = max(window_hours, 1.0)
    effective_baseline_hours = max(float(baseline_window_hours), effective_window_hours)
    tasks = memory_service.recent_all_tasks(limit=capped_limit)
    failures = analyze_failures(tasks=tasks, window_hours=effective_window_hours)
    baseline = analyze_failures(tasks=tasks, window_hours=effective_baseline_hours)
    return {
        "status": "ok",
        "service": "yoyoo-backend",
        "timestamp": datetime.now(UTC).isoformat(),
        "limit": capped_limit,
        "window_hours": effective_window_hours,
        "baseline_window_hours": effective_baseline_hours,
        "recent_focus": effective_window_hours <= 24.0,
        "failures": failures,
        "baseline": {
            "window_hours": baseline["window_hours"],
            "failed_task_total": baseline["failed_task_total"],
            "bucket_total": baseline["bucket_total"],
        },
    }


def _derive_alert_status(alerts: list[dict[str, object]]) -> str:
    if not alerts:
        return "ok"
    has_critical = any(item.get("severity") == "critical" for item in alerts)
    if has_critical:
        return "critical"
    return "warning"


def _build_ops_alerts(
    *,
    startup_snapshot: dict[str, Any],
    memory_snapshot: dict[str, Any],
) -> list[dict[str, object]]:
    alerts: list[dict[str, object]] = []
    startup_issues = startup_snapshot.get("issues")
    if isinstance(startup_issues, list) and startup_issues:
        alerts.append(
            {
                "severity": "warning",
                "code": "startup_issue_detected",
                "message": "启动自检发现异常项",
                "value": startup_issues,
            }
        )

    persistence = memory_snapshot.get("persistence")
    if isinstance(persistence, dict):
        if not bool(persistence.get("last_save_ok", True)):
            alerts.append(
                {
                    "severity": "critical",
                    "code": "memory_last_save_failed",
                    "message": "memory 最近一次落盘失败",
                    "value": persistence.get("last_save_error"),
                }
            )
        recovery_count = _safe_int(
            persistence.get("recovery_count"),
            default=0,
        )
        recovery_warn = _safe_int(
            os.getenv("YOYOO_ALERT_RECOVERY_COUNT_WARN"),
            default=3,
        )
        if recovery_count >= recovery_warn:
            alerts.append(
                {
                    "severity": "warning",
                    "code": "memory_recovery_count_high",
                    "message": "memory 自动恢复次数偏高",
                    "value": recovery_count,
                    "threshold": recovery_warn,
                }
            )

    feedback_binding = memory_snapshot.get("feedback_binding")
    if isinstance(feedback_binding, dict):
        attempts = _safe_int(feedback_binding.get("attempt_total"), default=0)
        success_rate = _safe_float(feedback_binding.get("success_rate"), default=1.0)
        not_found = _safe_int(feedback_binding.get("not_found_total"), default=0)
        not_found_rate = (not_found / attempts) if attempts > 0 else 0.0

        min_attempts = _safe_int(
            os.getenv("YOYOO_ALERT_FEEDBACK_MIN_ATTEMPTS"),
            default=20,
        )
        min_success_rate = _safe_float(
            os.getenv("YOYOO_ALERT_FEEDBACK_MIN_SUCCESS_RATE"),
            default=0.90,
        )
        max_not_found_rate = _safe_float(
            os.getenv("YOYOO_ALERT_FEEDBACK_MAX_NOT_FOUND_RATE"),
            default=0.20,
        )
        if attempts >= min_attempts and success_rate < min_success_rate:
            alerts.append(
                {
                    "severity": "warning",
                    "code": "feedback_binding_success_rate_low",
                    "message": "反馈绑定成功率低于阈值",
                    "value": round(success_rate, 4),
                    "threshold": min_success_rate,
                    "attempts": attempts,
                }
            )
        if attempts >= min_attempts and not_found_rate > max_not_found_rate:
            alerts.append(
                {
                    "severity": "warning",
                    "code": "feedback_binding_not_found_rate_high",
                    "message": "反馈绑定未命中率高于阈值",
                    "value": round(not_found_rate, 4),
                    "threshold": max_not_found_rate,
                    "attempts": attempts,
                }
            )
    memory_quality = memory_snapshot.get("memory_quality")
    if isinstance(memory_quality, dict):
        retrieval_total = _safe_int(memory_quality.get("retrieval_total"), default=0)
        retrieval_hit_rate = _safe_float(memory_quality.get("retrieval_hit_rate"), default=1.0)
        min_retrieval_queries = _safe_int(
            os.getenv("YOYOO_ALERT_MEMORY_MIN_RETRIEVAL_QUERIES"),
            default=20,
        )
        min_hit_rate = _safe_float(
            os.getenv("YOYOO_ALERT_MEMORY_MIN_HIT_RATE"),
            default=0.2,
        )
        if retrieval_total >= min_retrieval_queries and retrieval_hit_rate < min_hit_rate:
            alerts.append(
                {
                    "severity": "warning",
                    "code": "memory_retrieval_hit_rate_low",
                    "message": "记忆检索命中率低于阈值",
                    "value": round(retrieval_hit_rate, 4),
                    "threshold": min_hit_rate,
                    "retrieval_total": retrieval_total,
                }
            )

        conflict_rate = _safe_float(memory_quality.get("feedback_conflict_rate"), default=0.0)
        max_conflict_rate = _safe_float(
            os.getenv("YOYOO_ALERT_MEMORY_MAX_CONFLICT_RATE"),
            default=0.35,
        )
        if conflict_rate > max_conflict_rate:
            alerts.append(
                {
                    "severity": "warning",
                    "code": "memory_feedback_conflict_rate_high",
                    "message": "记忆反馈冲突率高于阈值",
                    "value": round(conflict_rate, 4),
                    "threshold": max_conflict_rate,
                }
            )

        stale_task_rate = _safe_float(memory_quality.get("stale_task_rate"), default=0.0)
        max_stale_task_rate = _safe_float(
            os.getenv("YOYOO_ALERT_MEMORY_MAX_STALE_TASK_RATE"),
            default=0.4,
        )
        if stale_task_rate > max_stale_task_rate:
            alerts.append(
                {
                    "severity": "warning",
                    "code": "memory_stale_task_rate_high",
                    "message": "陈旧任务占比高于阈值",
                    "value": round(stale_task_rate, 4),
                    "threshold": max_stale_task_rate,
                }
            )
        strategy_card_total = _safe_int(memory_quality.get("strategy_card_total"), default=0)
        strategy_low_performance_total = _safe_int(
            memory_quality.get("strategy_low_performance_total"),
            default=0,
        )
        min_strategy_cards = _safe_int(
            os.getenv("YOYOO_ALERT_MEMORY_MIN_STRATEGY_CARDS"),
            default=3,
        )
        max_low_performance_rate = _safe_float(
            os.getenv("YOYOO_ALERT_MEMORY_MAX_LOW_PERFORMANCE_RATE"),
            default=0.4,
        )
        strategy_low_performance_rate = (
            strategy_low_performance_total / strategy_card_total
            if strategy_card_total > 0
            else 0.0
        )
        if (
            strategy_card_total >= min_strategy_cards
            and strategy_low_performance_rate > max_low_performance_rate
        ):
            alerts.append(
                {
                    "severity": "warning",
                    "code": "memory_strategy_low_performance_rate_high",
                    "message": "策略卡低表现占比高于阈值",
                    "value": round(strategy_low_performance_rate, 4),
                    "threshold": max_low_performance_rate,
                    "strategy_card_total": strategy_card_total,
                    "strategy_low_performance_total": strategy_low_performance_total,
                }
            )
    return alerts


def _build_ops_trend(*, memory_service: Any) -> dict[str, Any]:
    last_24h = memory_service.daily_execution_snapshot(window_hours=24.0)
    last_7d = memory_service.daily_execution_snapshot(window_hours=24.0 * 7.0)
    return {
        "window_hours": {"short": 24.0, "baseline": 168.0},
        "last_24h": last_24h,
        "last_7d": last_7d,
        "task_success_rate_delta": _metric_delta(
            last_24h.get("task_success_rate"),
            last_7d.get("task_success_rate"),
        ),
        "strategy_hit_rate_delta": _metric_delta(
            last_24h.get("strategy_hit_rate"),
            last_7d.get("strategy_hit_rate"),
        ),
        "feedback_binding_success_rate_delta": _metric_delta(
            last_24h.get("feedback_binding_success_rate"),
            last_7d.get("feedback_binding_success_rate"),
        ),
    }


def _build_failure_snapshot(*, memory_service: Any) -> dict[str, Any]:
    tasks = memory_service.recent_all_tasks(limit=300)
    recent = analyze_failures(tasks=tasks, window_hours=24.0)
    baseline = analyze_failures(tasks=tasks, window_hours=168.0)
    return {
        **recent,
        "baseline_7d_window_hours": baseline["window_hours"],
        "baseline_7d_failed_task_total": baseline["failed_task_total"],
        "baseline_7d_bucket_total": baseline["bucket_total"],
    }


def _metric_delta(current: Any, baseline: Any) -> float | None:
    if not isinstance(current, (int, float)):
        return None
    if not isinstance(baseline, (int, float)):
        return None
    return round(float(current) - float(baseline), 4)


def _safe_int(value: Any, *, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _safe_float(value: Any, *, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


@app.post("/api/v1/chat", response_model=ChatResponse)
def chat(req: ChatRequest, request: Request) -> ChatResponse:
    trace_id = getattr(request.state, "trace_id", str(uuid4()))
    chat_service = app.state.container.chat_service
    logger.info("chat_request trace_id=%s user_id=%s", trace_id, req.user_id)
    envelope = IngressEnvelope(
        user_id=req.user_id,
        conversation_id=f"api:{req.user_id}",
        channel=Channel.API,
        scope=ChatScope.PRIVATE,
        trace_id=trace_id,
        text=req.message,
        trusted=app.state.container.is_trusted_user(req.user_id),
    )
    result = app.state.container.yoyoo_brain.handle_message(
        context=_ingress_service.build_context(envelope),
        text=_ingress_service.normalize_text(
            text=envelope.text,
            task_id_hint=envelope.task_id_hint,
        ),
    )
    return ChatResponse(
        reply=result.reply,
        model=chat_service.model_name,
        trace_id=trace_id,
        intent=result.decision.intent,
        safety_blocked=result.decision.safety_blocked,
        route_model=result.decision.route_model,
        plan_steps=result.decision.plan_steps,
        verification_checks=result.decision.verification_checks,
        rollback_template=result.decision.rollback_template,
        task_id=result.decision.task_id,
        strategy_cards=result.decision.strategy_cards,
        strategy_id=result.decision.strategy_id,
        execution_quality_score=result.decision.execution_quality_score,
        execution_quality_issues=result.decision.execution_quality_issues,
        execution_corrected=result.decision.execution_corrected,
        execution_duration_ms=result.decision.execution_duration_ms,
        evidence_structured=result.decision.evidence_structured,
        yyos_stage=result.decision.yyos_stage,
        yyos_confidence=result.decision.yyos_confidence,
        yyos_risk_level=result.decision.yyos_risk_level,
        yyos_decision=result.decision.yyos_decision,
        yyos_recommended_skills=result.decision.yyos_recommended_skills,
    )


@app.get("/api/v1/tasks/{conversation_id}")
def recent_tasks(conversation_id: str, limit: int = 10) -> dict[str, object]:
    tasks = app.state.container.memory_service.recent_tasks(
        conversation_id=conversation_id,
        limit=max(1, min(limit, 50)),
    )
    return {
        "conversation_id": conversation_id,
        "count": len(tasks),
        "tasks": [
            {
                "task_id": item.task_id,
                "trace_id": item.trace_id,
                "status": item.status,
                "channel": item.channel,
                "project_key": item.project_key,
                "request_text": item.request_text,
                "route_model": item.route_model,
                "created_at": item.created_at.isoformat(),
                "updated_at": item.updated_at.isoformat(),
                "executor_error": item.executor_error,
                "executor_reply": item.executor_reply,
                "evidence": item.evidence,
                "evidence_structured": item.evidence_structured,
                "execution_duration_ms": item.execution_duration_ms,
                "quality_score": item.quality_score,
                "quality_issues": item.quality_issues,
                "correction_applied": item.correction_applied,
                "strategy_cards_used": item.strategy_cards_used,
                "human_feedback": item.human_feedback,
                "human_feedback_weight": item.human_feedback_weight,
                "feedback_note": item.feedback_note,
                "feedback_updated_at": (
                    item.feedback_updated_at.isoformat() if item.feedback_updated_at else None
                ),
                "started_at": item.started_at.isoformat() if item.started_at else None,
                "last_heartbeat_at": (
                    item.last_heartbeat_at.isoformat() if item.last_heartbeat_at else None
                ),
                "closed_at": item.closed_at.isoformat() if item.closed_at else None,
                "close_reason": item.close_reason,
            }
            for item in tasks
        ],
    }


@app.get("/api/v1/tasks/id/{task_id}")
def task_by_id(task_id: str) -> dict[str, object]:
    record = app.state.container.memory_service.get_task_record(task_id=task_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"task not found: {task_id}",
        )
    age_seconds = max((datetime.now(UTC) - record.updated_at).total_seconds(), 0.0)
    return {
        "ok": True,
        "task": {
            "task_id": record.task_id,
            "conversation_id": record.conversation_id,
            "user_id": record.user_id,
            "channel": record.channel,
            "project_key": record.project_key,
            "trace_id": record.trace_id,
            "status": record.status,
            "request_text": record.request_text,
            "route_model": record.route_model,
            "executor_error": record.executor_error,
            "executor_reply": record.executor_reply,
            "created_at": record.created_at.isoformat(),
            "updated_at": record.updated_at.isoformat(),
            "started_at": record.started_at.isoformat() if record.started_at else None,
            "last_heartbeat_at": (
                record.last_heartbeat_at.isoformat() if record.last_heartbeat_at else None
            ),
            "closed_at": record.closed_at.isoformat() if record.closed_at else None,
            "close_reason": record.close_reason,
            "age_seconds": round(age_seconds, 3),
            "evidence": record.evidence,
            "evidence_structured": record.evidence_structured,
            "plan_steps": record.plan_steps,
            "verification_checks": record.verification_checks,
            "rollback_template": record.rollback_template,
        },
    }


@app.get("/api/v1/traces/{trace_id}")
def trace_lookup(trace_id: str, limit: int = 20) -> dict[str, object]:
    capped_limit = max(1, min(limit, 100))
    events = app.state.container.memory_service.find_events_by_trace(
        trace_id=trace_id,
        limit=capped_limit,
    )
    tasks = app.state.container.memory_service.find_tasks_by_trace(
        trace_id=trace_id,
        limit=max(1, min(capped_limit, 20)),
    )
    return {
        "trace_id": trace_id,
        "event_count": len(events),
        "task_count": len(tasks),
        "events": [
            {
                "timestamp": item.timestamp.isoformat(),
                "user_id": item.user_id,
                "direction": item.direction,
                "intent": item.intent,
                "text": item.text,
            }
            for item in events
        ],
        "tasks": [
            {
                "task_id": item.task_id,
                "status": item.status,
                "conversation_id": item.conversation_id,
                "channel": item.channel,
                "project_key": item.project_key,
                "request_text": item.request_text,
                "route_model": item.route_model,
                "updated_at": item.updated_at.isoformat(),
                "executor_error": item.executor_error,
                "executor_reply": item.executor_reply,
                "evidence": item.evidence,
                "evidence_structured": item.evidence_structured,
                "execution_duration_ms": item.execution_duration_ms,
                "quality_score": item.quality_score,
                "quality_issues": item.quality_issues,
                "correction_applied": item.correction_applied,
                "strategy_cards_used": item.strategy_cards_used,
                "human_feedback": item.human_feedback,
                "human_feedback_weight": item.human_feedback_weight,
                "feedback_note": item.feedback_note,
                "feedback_updated_at": (
                    item.feedback_updated_at.isoformat() if item.feedback_updated_at else None
                ),
                "started_at": item.started_at.isoformat() if item.started_at else None,
                "last_heartbeat_at": (
                    item.last_heartbeat_at.isoformat() if item.last_heartbeat_at else None
                ),
                "closed_at": item.closed_at.isoformat() if item.closed_at else None,
                "close_reason": item.close_reason,
            }
            for item in tasks
        ],
    }


@app.post("/api/v1/tasks/{task_id}/feedback", response_model=TaskFeedbackResponse)
def task_feedback(task_id: str, req: TaskFeedbackRequest) -> TaskFeedbackResponse:
    record = app.state.container.memory_service.apply_task_feedback(
        task_id=task_id,
        feedback=req.feedback,
        note=req.note,
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"task not found: {task_id}",
        )
    feedback_updated_at = (
        record.feedback_updated_at.isoformat()
        if record.feedback_updated_at is not None
        else record.updated_at.isoformat()
    )
    return TaskFeedbackResponse(
        ok=True,
        task_id=record.task_id,
        human_feedback=record.human_feedback or req.feedback,
        feedback_note=record.feedback_note,
        feedback_updated_at=feedback_updated_at,
    )


@app.post("/api/v1/tasks/{task_id}/heartbeat")
def task_heartbeat(task_id: str, req: TaskHeartbeatRequest) -> dict[str, object]:
    record = app.state.container.memory_service.touch_task_heartbeat(
        task_id=task_id,
        note=req.note,
    )
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"task not found: {task_id}",
        )
    return {
        "ok": True,
        "task_id": record.task_id,
        "status": record.status,
        "last_heartbeat_at": (
            record.last_heartbeat_at.isoformat() if record.last_heartbeat_at else None
        ),
    }


@app.post("/api/v1/tasks/{task_id}/close")
def task_close(task_id: str, req: TaskCloseRequest) -> dict[str, object]:
    try:
        record = app.state.container.memory_service.close_task_record(
            task_id=task_id,
            status=req.status,
            reason=req.reason,
            summary=req.summary,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"task not found: {task_id}",
        )
    return {
        "ok": True,
        "task_id": record.task_id,
        "status": record.status,
        "closed_at": record.closed_at.isoformat() if record.closed_at else None,
        "close_reason": record.close_reason,
    }


app.include_router(dingtalk_router)
app.include_router(team_router)
