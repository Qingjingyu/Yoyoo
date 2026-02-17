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


@router.post("/tasks", response_model=TeamTaskCreateResponse)
def create_task(req: TeamTaskCreateRequest, request: Request) -> TeamTaskCreateResponse:
    container = _get_container(request)
    trace_id = getattr(request.state, "trace_id", str(uuid4()))
    conversation_id = req.conversation_id or f"api:{req.user_id}"
    card = container.ceo_dispatcher.create_task(
        user_id=req.user_id,
        conversation_id=conversation_id,
        channel=req.channel,
        project_key=req.project_key,
        request_text=req.message,
        trace_id=trace_id,
    )
    meta = container.memory_service.get_team_task_meta(task_id=card.task_id) or {}
    return TeamTaskCreateResponse(
        ok=True,
        task_id=card.task_id,
        status=card.status,
        owner_role=card.owner_role,
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
    return TeamTaskResultResponse(
        ok=result.ok,
        task_id=result.task_id,
        status=result.status,
        issues=result.issues,
        reply=result.reply,
        next_step=result.next_step,
    )


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
    meta = container.memory_service.get_team_task_meta(task_id=task_id) or {}
    return TeamTaskDetailResponse(
        task_id=card.task_id,
        title=card.title,
        objective=card.objective,
        owner_role=card.owner_role,
        status=card.status,
        cto_lane=str(meta.get("cto_lane") or "ENG"),
        execution_mode=str(meta.get("execution_mode") or "subagent"),
        eta_minutes=card.eta_minutes,
        created_at=card.created_at.isoformat(),
        updated_at=card.updated_at.isoformat(),
        timeline=container.ceo_dispatcher.get_task_timeline(task_id=task_id),
    )


@router.get("/tasks", response_model=TeamTaskListResponse)
def list_tasks(
    request: Request,
    user_id: str = Query(min_length=1, max_length=64),
    channel: str | None = Query(default=None, min_length=2, max_length=32),
    limit: int = Query(default=30, ge=1, le=200),
) -> TeamTaskListResponse:
    container = _get_container(request)
    records = container.memory_service.recent_tasks_for_user(
        user_id=user_id,
        channel=channel,
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
                status=str(meta.get("status") or record.status or "planned"),
                cto_lane=str(meta.get("cto_lane") or "ENG"),
                execution_mode=str(meta.get("execution_mode") or "subagent"),
                eta_minutes=meta.get("eta_minutes"),
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
