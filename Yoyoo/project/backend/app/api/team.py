from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.container import ServiceContainer
from app.intelligence.team_models import TaskEvidence
from app.schemas import (
    TeamTaskCreateRequest,
    TeamTaskCreateResponse,
    TeamTaskDetailResponse,
    TeamTaskListItem,
    TeamTaskListResponse,
    TeamTaskProgressRequest,
    TeamTaskProgressResponse,
    TeamTaskResultRequest,
    TeamTaskResultResponse,
    TeamTaskRunRequest,
    TeamTaskRunResponse,
    TeamWatchdogRecoverRequest,
    TeamWatchdogRecoverResponse,
    TeamWatchdogScanRequest,
    TeamWatchdogScanResponse,
)

router = APIRouter(prefix="/api/v1/team", tags=["team"])


def _get_container(request: Request) -> ServiceContainer:
    return request.app.state.container


def _fallback_title(request_text: str) -> str:
    text = (request_text or "").strip()
    if not text:
        return "未命名任务"
    return text[:32] + ("..." if len(text) > 32 else "")


def _safe_rework_count(value: object) -> int | None:
    if value is None:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return max(parsed, 0)


@router.post("/tasks", response_model=TeamTaskCreateResponse)
def create_task(req: TeamTaskCreateRequest, request: Request) -> TeamTaskCreateResponse:
    container = _get_container(request)
    trace_id = getattr(request.state, "trace_id", str(uuid4()))
    route = container.agent_router.resolve(
        explicit_agent_id=req.agent_id,
        channel=req.channel,
        project_key=req.project_key,
        peer_kind=req.peer_kind,
        peer_id=req.peer_id,
    )
    conversation_id = req.conversation_id or f"api:{route.agent_id}:{req.user_id}"
    card = container.ceo_dispatcher.create_task(
        user_id=req.user_id,
        conversation_id=conversation_id,
        channel=req.channel,
        project_key=req.project_key,
        agent_id=route.agent_id,
        memory_scope=route.memory_scope,
        request_text=req.message,
        trace_id=trace_id,
    )
    record = container.memory_service.get_task_record(task_id=card.task_id)
    meta = container.memory_service.get_team_task_meta(task_id=card.task_id) or {}
    return TeamTaskCreateResponse(
        ok=True,
        task_id=card.task_id,
        status=card.status,
        owner_role=card.owner_role,
        resolved_agent_id=(record.agent_id if record else route.agent_id),
        memory_scope=(record.memory_scope if record else route.memory_scope),
        routing_reason=route.reason,
        cto_lane=str(meta.get("cto_lane") or "ENG"),
        execution_mode=str(meta.get("execution_mode") or "subagent"),
        eta_minutes=card.eta_minutes,
        reply=(
            f"CEO 已接单并派发 CTO（{card.owner_role}），task_id={card.task_id}。"
            f"预计 {card.eta_minutes or 20} 分钟给阶段结果，90 秒内首个进度回报。"
        ),
    )


@router.post("/tasks/{task_id}/progress", response_model=TeamTaskProgressResponse)
def submit_progress(
    task_id: str,
    req: TeamTaskProgressRequest,
    request: Request,
) -> TeamTaskProgressResponse:
    container = _get_container(request)
    result = container.ceo_dispatcher.report_progress(
        task_id=task_id,
        role=req.role,
        stage=req.stage,
        detail=req.detail,
        evidence=[TaskEvidence(source=item.source, content=item.content) for item in req.evidence],
    )
    return TeamTaskProgressResponse(
        ok=result.ok,
        task_id=result.task_id,
        status=result.status,
        reply=result.reply,
        next_step=result.next_step,
    )


@router.post("/tasks/{task_id}/result", response_model=TeamTaskResultResponse)
def submit_result(
    task_id: str,
    req: TeamTaskResultRequest,
    request: Request,
) -> TeamTaskResultResponse:
    container = _get_container(request)
    result = container.ceo_dispatcher.accept_result(
        task_id=task_id,
        role=req.role,
        reply=req.reply,
        error=req.error,
        evidence=[TaskEvidence(source=item.source, content=item.content) for item in req.evidence],
    )
    meta = container.memory_service.get_team_task_meta(task_id=task_id) or {}
    return TeamTaskResultResponse(
        ok=result.ok,
        task_id=result.task_id,
        status=result.status,
        corrected=result.corrected,
        rework_count=_safe_rework_count(meta.get("rework_count")),
        issues=result.issues,
        reply=result.reply,
        next_step=result.next_step,
    )


@router.post("/tasks/{task_id}/run", response_model=TeamTaskRunResponse)
def run_task(
    task_id: str,
    req: TeamTaskRunRequest,
    request: Request,
) -> TeamTaskRunResponse:
    container = _get_container(request)
    result = container.ceo_dispatcher.execute_task(
        task_id=task_id,
        max_attempts=req.max_attempts,
        resume=req.resume,
    )
    return TeamTaskRunResponse(**result)


@router.get("/tasks/{task_id}", response_model=TeamTaskDetailResponse)
def get_task(task_id: str, request: Request) -> TeamTaskDetailResponse:
    container = _get_container(request)
    try:
        card = container.ceo_dispatcher.get_task(task_id)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"task not found: {task_id}",
        ) from exc
    record = container.memory_service.get_task_record(task_id=task_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"task not found: {task_id}",
        )
    meta = container.memory_service.get_team_task_meta(task_id=task_id) or {}
    return TeamTaskDetailResponse(
        task_id=card.task_id,
        title=card.title,
        objective=card.objective,
        owner_role=card.owner_role,
        agent_id=record.agent_id,
        memory_scope=record.memory_scope,
        status=card.status,
        cto_lane=str(meta.get("cto_lane") or "ENG"),
        execution_mode=str(meta.get("execution_mode") or "subagent"),
        eta_minutes=card.eta_minutes,
        rework_count=_safe_rework_count(meta.get("rework_count")),
        created_at=card.created_at.isoformat(),
        updated_at=card.updated_at.isoformat(),
        timeline=container.ceo_dispatcher.get_task_timeline(task_id=task_id),
    )


@router.get("/tasks", response_model=TeamTaskListResponse)
def list_tasks(
    request: Request,
    user_id: str = Query(min_length=1, max_length=64),
    channel: str | None = Query(default=None, min_length=2, max_length=32),
    agent_id: str | None = Query(default=None, min_length=2, max_length=32),
    limit: int = Query(default=30, ge=1, le=200),
) -> TeamTaskListResponse:
    container = _get_container(request)
    records = container.memory_service.recent_tasks_for_user(
        user_id=user_id,
        channel=channel,
        agent_id=agent_id,
        limit=limit,
    )
    items: list[TeamTaskListItem] = []
    for record in records:
        meta = container.memory_service.get_team_task_meta(task_id=record.task_id) or {}
        items.append(
            TeamTaskListItem(
                task_id=record.task_id,
                title=str(meta.get("title") or _fallback_title(record.request_text)),
                objective=str(meta.get("objective") or record.request_text),
                owner_role=str(meta.get("owner_role") or "CTO"),
                agent_id=record.agent_id,
                memory_scope=record.memory_scope,
                status=str(meta.get("status") or record.status or "planned"),
                cto_lane=str(meta.get("cto_lane") or "ENG"),
                execution_mode=str(meta.get("execution_mode") or "subagent"),
                eta_minutes=meta.get("eta_minutes"),
                rework_count=_safe_rework_count(meta.get("rework_count")),
                created_at=record.created_at.isoformat(),
                updated_at=record.updated_at.isoformat(),
            )
        )
    return TeamTaskListResponse(
        ok=True,
        user_id=user_id,
        total=len(items),
        items=items,
    )


@router.post("/watchdog/scan", response_model=TeamWatchdogScanResponse)
def scan_watchdog(req: TeamWatchdogScanRequest, request: Request) -> TeamWatchdogScanResponse:
    container = _get_container(request)
    result = container.ceo_dispatcher.watchdog_scan(
        stale_progress_sec=req.stale_progress_sec,
        stale_degrade_sec=req.stale_degrade_sec,
        max_scan=req.max_scan,
        min_repeat_sec=req.min_repeat_sec,
    )
    return TeamWatchdogScanResponse(**result)


@router.post("/watchdog/recover", response_model=TeamWatchdogRecoverResponse)
def recover_watchdog(
    req: TeamWatchdogRecoverRequest,
    request: Request,
) -> TeamWatchdogRecoverResponse:
    container = _get_container(request)
    result = container.ceo_dispatcher.recover_stale_tasks(
        max_scan=req.max_scan,
        stale_seconds=req.stale_seconds,
        max_attempts=req.max_attempts,
    )
    return TeamWatchdogRecoverResponse(**result)
