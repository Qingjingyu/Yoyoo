from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, HTTPException, Request, status

from app.container import ServiceContainer
from app.intelligence.team_models import TaskEvidence
from app.schemas import (
    TeamTaskCreateRequest,
    TeamTaskCreateResponse,
    TeamTaskDetailResponse,
    TeamTaskProgressRequest,
    TeamTaskProgressResponse,
    TeamTaskResultRequest,
    TeamTaskResultResponse,
)

router = APIRouter(prefix="/api/v1/team", tags=["team"])


def _get_container(request: Request) -> ServiceContainer:
    return request.app.state.container


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
    return TeamTaskCreateResponse(
        ok=True,
        task_id=card.task_id,
        status=card.status,
        owner_role=card.owner_role,
        reply=f"CEO 已派单给 CTO（{card.owner_role}），task_id={card.task_id}。后续进度将由 CEO 汇报。",
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
    return TeamTaskDetailResponse(
        task_id=card.task_id,
        title=card.title,
        objective=card.objective,
        owner_role=card.owner_role,
        status=card.status,
        created_at=card.created_at.isoformat(),
        updated_at=card.updated_at.isoformat(),
        timeline=container.ceo_dispatcher.get_task_timeline(task_id=task_id),
    )
