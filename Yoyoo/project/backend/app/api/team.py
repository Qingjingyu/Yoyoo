from __future__ import annotations

import json
import logging
import os
import socket
import sys
from datetime import UTC, datetime
from threading import Thread
from typing import Any
from urllib import error as urlerror
from urllib import request as urlrequest
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request, status

from app.container import ServiceContainer
from app.intelligence.team_models import TaskEvidence
from app.schemas import (
    TeamCeoChatRequest,
    TeamCeoChatResponse,
    TeamOpsReportRequest,
    TeamOpsReportResponse,
    TeamRuntimeHealthResponse,
    TeamTaskCreateRequest,
    TeamTaskCreateResponse,
    TeamTaskDetailResponse,
    TeamTaskListItem,
    TeamTaskListResponse,
    TeamTaskProgressRequest,
    TeamTaskProgressResponse,
    TeamTaskResultRequest,
    TeamTaskResultResponse,
    TeamTaskRunAsyncResponse,
    TeamTaskRunRequest,
    TeamTaskRunResponse,
    TeamWatchdogRecoverRequest,
    TeamWatchdogRecoverResponse,
    TeamWatchdogScanRequest,
    TeamWatchdogScanResponse,
)

router = APIRouter(prefix="/api/v1/team", tags=["team"])
_LOGGER = logging.getLogger(__name__)
_OPS_QUERY_KEYWORDS = (
    "运维",
    "巡检",
    "健康",
    "告警",
    "runtime",
    "ops",
    "状态",
    "看下系统",
    "系统情况",
)
_OPS_DETAIL_KEYWORDS = (
    "详细运维",
    "运维详细",
    "详细报告",
    "完整报告",
    "完整运维",
    "运维全量",
)


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


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _is_ops_report_query(message: str) -> bool:
    normalized = (message or "").strip().lower()
    if not normalized:
        return False
    return any(token in normalized for token in _OPS_QUERY_KEYWORDS)


def _is_ops_detail_query(message: str) -> bool:
    normalized = (message or "").strip().lower()
    if not normalized:
        return False
    return any(token in normalized for token in _OPS_DETAIL_KEYWORDS)


def _safe_rate_text(value: Any) -> str:
    if isinstance(value, (int, float)):
        return f"{float(value) * 100:.1f}%"
    return "-"


def _resolve_current_model(executor: dict[str, Any]) -> str:
    for key in ("model", "default_model", "preferred_model", "provider_model"):
        value = str(executor.get(key) or "").strip()
        if value:
            return value
    candidates = (
        "YOYOO_MODEL",
        "OPENCLAW_MODEL",
        "MINIMAX_MODEL",
        "ANTHROPIC_MODEL",
        "MODEL",
    )
    for name in candidates:
        value = os.getenv(name, "").strip()
        if value:
            return value
    return "unknown"


def _compose_ops_reply(report: dict[str, Any], *, detailed: bool) -> str:
    summary = str(report.get("summary_text") or "运维报告暂不可用。")
    if not detailed:
        return summary

    memory = report.get("memory")
    if not isinstance(memory, dict):
        memory = {}
    memory_quality = memory.get("memory_quality")
    if not isinstance(memory_quality, dict):
        memory_quality = {}
    persistence = memory.get("persistence")
    if not isinstance(persistence, dict):
        persistence = {}
    server = report.get("server")
    if not isinstance(server, dict):
        server = {}
    router = report.get("router")
    if not isinstance(router, dict):
        router = {}
    daily = report.get("daily")
    if not isinstance(daily, dict):
        daily = {}
    scan = report.get("scan")
    if not isinstance(scan, dict):
        scan = {}
    recover = report.get("recover")
    if not isinstance(recover, dict):
        recover = {}

    lines: list[str] = [summary, "", "详细补充："]
    lines.append(
        "服务器: "
        f"host={server.get('host', '-')} "
        f"backend={server.get('backend_version', '-')} "
        f"pid={server.get('pid', '-')}"
    )
    lines.append(
        "模型: "
        f"current={report.get('model', 'unknown')} "
        f"executor_mode={report.get('executor_mode', 'unknown')}"
    )
    lines.append(
        "记忆概述: "
        f"task_total={memory.get('task_total', '-')} "
        f"strategy_cards={memory_quality.get('strategy_card_total', '-')} "
        f"stale={memory_quality.get('stale_task_count', '-')}"
    )
    lines.append(
        "持久化: "
        f"enabled={persistence.get('enabled', '-')} "
        f"last_save_ok={persistence.get('last_save_ok', '-')} "
        f"recovery_count={persistence.get('recovery_count', '-')}"
    )
    lines.append(
        "巡检明细: "
        f"nudged={scan.get('nudged', '-')} "
        f"degraded={scan.get('degraded', '-')} "
        f"changed={scan.get('changed', '-')}"
    )
    if recover:
        lines.append(
            "恢复明细: "
            f"resumed={recover.get('resumed', '-')} "
            f"completed={recover.get('completed', '-')} "
            f"failed={recover.get('failed', '-')}"
        )
    lines.append(
        "24h执行: "
        f"success_rate={_safe_rate_text(daily.get('task_success_rate'))} "
        f"failed_total={daily.get('task_failed_total', '-')} "
        f"bindings={router.get('bindings_total', '-')}"
    )
    return "\n".join(lines)


def _build_ops_report(
    *,
    request: Request,
    container: ServiceContainer,
    scan_now: bool,
    recover_now: bool,
    stale_progress_sec: int,
    stale_degrade_sec: int,
    max_scan: int,
    min_repeat_sec: int,
) -> dict[str, Any]:
    watch_state = getattr(request.app.state, "watchdog_state", {}) or {}
    scan_result: dict[str, Any] | None = None
    recover_result: dict[str, Any] | None = None

    if scan_now:
        try:
            scan_result = container.ceo_dispatcher.watchdog_scan(
                stale_progress_sec=stale_progress_sec,
                stale_degrade_sec=stale_degrade_sec,
                max_scan=max_scan,
                min_repeat_sec=min_repeat_sec,
            )
        except Exception as exc:  # pragma: no cover
            scan_result = {"ok": False, "error": str(exc)}

    if recover_now:
        try:
            recover_result = container.ceo_dispatcher.recover_stale_tasks(
                max_scan=min(max_scan, 200),
                stale_seconds=max(stale_progress_sec, 120),
                max_attempts=2,
            )
        except Exception as exc:  # pragma: no cover
            recover_result = {"ok": False, "error": str(exc)}

    memory_health = container.memory_service.ops_health_snapshot()
    daily = container.memory_service.daily_execution_snapshot(window_hours=24.0)
    executor = container.ceo_dispatcher.executor_diagnostics()
    router = container.agent_router.diagnostics()
    backend_version = str(getattr(request.app, "version", "unknown"))
    server = {
        "host": socket.gethostname(),
        "backend_version": backend_version,
        "pid": os.getpid(),
        "python": sys.version.split(" ")[0],
    }
    model = _resolve_current_model(executor)

    summary_lines: list[str] = []
    summary_lines.append("Yoyoo 运维概览")
    summary_lines.append(
        "服务器: "
        f"host={server['host']} "
        f"backend={server['backend_version']} "
        f"pid={server['pid']}"
    )
    summary_lines.append(
        "watchdog: "
        f"ok={watch_state.get('last_ok')} "
        f"run_total={watch_state.get('run_total')} "
        f"last_run={watch_state.get('last_run_at') or '-'}"
    )
    if isinstance(scan_result, dict):
        summary_lines.append(
            "本次巡检: "
            f"nudged={scan_result.get('nudged', '-')} "
            f"degraded={scan_result.get('degraded', '-')} "
            f"changed={scan_result.get('changed', '-')}"
        )
    summary_lines.append(
        "任务池: "
        f"total={memory_health.get('task_total', '-')} "
        f"in_progress={memory_health.get('task_in_progress', '-')} "
        f"failed={memory_health.get('task_failed', '-')}"
    )
    summary_lines.append(
        "24h质量: "
        f"success_rate={_safe_rate_text(daily.get('task_success_rate'))} "
        f"strategy_hit_rate={_safe_rate_text(daily.get('strategy_hit_rate'))}"
    )
    memory_quality = memory_health.get("memory_quality")
    if not isinstance(memory_quality, dict):
        memory_quality = {}
    summary_lines.append(
        "记忆: "
        f"task_total={memory_health.get('task_total', '-')} "
        f"strategy_cards={memory_quality.get('strategy_card_total', '-')} "
        f"stale={memory_quality.get('stale_task_count', '-')}"
    )
    summary_lines.append(f"模型: current={model}")
    summary_lines.append(
        "执行器: "
        f"configured={executor.get('configured', True)} "
        f"mode={executor.get('mode') or executor.get('reason') or 'unknown'}"
    )
    summary_lines.append(
        "路由: "
        f"default_agent={router.get('default_agent_id', '-')} "
        f"bindings={router.get('bindings_total', '-')}"
    )
    summary = "\n".join(summary_lines)

    return {
        "summary_text": summary,
        "watchdog": watch_state if isinstance(watch_state, dict) else {"raw": watch_state},
        "scan": scan_result,
        "recover": recover_result,
        "memory": memory_health,
        "daily": daily,
        "executor": executor,
        "executor_mode": str(executor.get("mode") or executor.get("reason") or "unknown"),
        "model": model,
        "server": server,
        "router": router,
    }


def _execute_task_async_worker(
    *,
    container: ServiceContainer,
    task_id: str,
    max_attempts: int,
    resume: bool,
) -> None:
    try:
        container.ceo_dispatcher.execute_task(
            task_id=task_id,
            max_attempts=max_attempts,
            resume=resume,
        )
    except Exception:  # pragma: no cover
        _LOGGER.exception("run-async worker failed: task_id=%s", task_id)


def _post_json(
    *,
    url: str,
    payload: dict[str, Any],
    headers: dict[str, str] | None = None,
    timeout_sec: int = 10,
) -> tuple[bool, dict[str, Any] | None, str | None]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urlrequest.Request(url=url, data=data, method="POST")
    req.add_header("Content-Type", "application/json; charset=utf-8")
    for key, value in (headers or {}).items():
        req.add_header(key, value)
    try:
        with urlrequest.urlopen(req, timeout=timeout_sec) as resp:  # noqa: S310
            body = resp.read().decode("utf-8", errors="replace")
            parsed: dict[str, Any] | None
            try:
                loaded = json.loads(body) if body else {}
                parsed = loaded if isinstance(loaded, dict) else {"value": loaded}
            except json.JSONDecodeError:
                parsed = {"raw": body}
            return True, parsed, None
    except urlerror.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return False, None, f"http_{exc.code}:{detail[:300]}"
    except Exception as exc:  # pragma: no cover
        return False, None, str(exc)


def _push_ops_summary(summary: str) -> tuple[bool, str | None, str | None]:
    channel = os.getenv("YOYOO_GUARD_ALERT_CHANNEL", "feishu").strip().lower() or "feishu"
    webhook = os.getenv("YOYOO_GUARD_ALERT_WEBHOOK", "").strip()
    app_id = os.getenv("YOYOO_GUARD_ALERT_FEISHU_APP_ID", "").strip()
    app_secret = os.getenv("YOYOO_GUARD_ALERT_FEISHU_APP_SECRET", "").strip()
    open_id = os.getenv("YOYOO_GUARD_ALERT_FEISHU_OPEN_ID", "").strip()

    if channel == "feishu" and app_id and app_secret and open_id:
        ok, auth_data, auth_error = _post_json(
            url="https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
            payload={"app_id": app_id, "app_secret": app_secret},
        )
        if not ok:
            return False, "feishu-direct", f"token_failed:{auth_error}"
        token = str((auth_data or {}).get("tenant_access_token") or "").strip()
        if not token:
            return False, "feishu-direct", "token_missing"
        content = json.dumps({"text": summary}, ensure_ascii=False)
        ok, msg_data, msg_error = _post_json(
            url="https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id",
            payload={"receive_id": open_id, "msg_type": "text", "content": content},
            headers={"Authorization": f"Bearer {token}"},
        )
        if not ok:
            return False, "feishu-direct", f"send_failed:{msg_error}"
        code = (msg_data or {}).get("code")
        if code not in {0, "0", None}:
            return False, "feishu-direct", f"send_code_{code}"
        return True, "feishu-direct", None

    if webhook:
        if channel == "dingtalk":
            payload = {"msgtype": "text", "text": {"content": summary}}
        else:
            payload = {"msg_type": "text", "content": {"text": summary}}
        ok, _, err = _post_json(url=webhook, payload=payload)
        if not ok:
            return False, channel, f"webhook_failed:{err}"
        return True, channel, None

    return False, None, "alert_target_not_configured"


@router.post("/chat/ceo", response_model=TeamCeoChatResponse)
def ceo_chat(req: TeamCeoChatRequest, request: Request) -> TeamCeoChatResponse:
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
    if _is_ops_report_query(req.message):
        detailed = _is_ops_detail_query(req.message)
        report = _build_ops_report(
            request=request,
            container=container,
            scan_now=True,
            recover_now=False,
            stale_progress_sec=90,
            stale_degrade_sec=300,
            max_scan=200,
            min_repeat_sec=120,
        )
        reply = _compose_ops_reply(report, detailed=detailed)
        pushed = False
        push_error: str | None = None
        if _env_bool("YOYOO_OPS_CHAT_PUSH_DEFAULT", default=True):
            pushed, _, push_error = _push_ops_summary(reply)
            if pushed:
                reply = f"{reply}\n已推送到飞书。"
            elif push_error and push_error != "alert_target_not_configured":
                reply = f"{reply}\n推送失败：{push_error}"
        container.memory_service.append_event(
            conversation_id=conversation_id,
            user_id=req.user_id,
            direction="inbound",
            text=(req.message or "").strip(),
            intent="ops_report",
            trace_id=trace_id,
        )
        container.memory_service.append_event(
            conversation_id=conversation_id,
            user_id=req.user_id,
            direction="outbound",
            text=reply,
            intent="ops_report_reply",
            trace_id=trace_id,
        )
        container.memory_service.sync_department_to_ceo(
            role="OPS",
            patch={
                "task_id": None,
                "summary": reply,
                "event_type": "ops_report",
                "stage": "monitoring_detail" if detailed else "monitoring",
                "pushed": pushed,
                "push_error": push_error,
                "updated_at": datetime.now(UTC).isoformat(),
                "agent_id": route.agent_id,
                "memory_scope": route.memory_scope,
                "channel": req.channel,
                "project_key": req.project_key,
            },
        )
        return TeamCeoChatResponse(
            ok=True,
            reply=reply,
            task_intent=False,
            require_confirmation=False,
            suggested_executor="CTO",
            resolved_agent_id=route.agent_id,
            memory_scope=route.memory_scope,
            routing_reason=route.reason,
        )
    result = container.ceo_dispatcher.ceo_chat(
        user_id=req.user_id,
        conversation_id=conversation_id,
        channel=req.channel,
        project_key=req.project_key,
        agent_id=route.agent_id,
        memory_scope=route.memory_scope,
        request_text=req.message,
        trace_id=trace_id,
    )
    return TeamCeoChatResponse(
        ok=bool(result.get("ok", True)),
        reply=str(result.get("reply") or ""),
        task_intent=bool(result.get("task_intent", False)),
        require_confirmation=bool(result.get("require_confirmation", False)),
        suggested_executor=str(result.get("suggested_executor") or "CTO"),
        cto_lane=(str(result.get("cto_lane")) if result.get("cto_lane") is not None else None),
        execution_mode=(
            str(result.get("execution_mode"))
            if result.get("execution_mode") is not None
            else None
        ),
        eta_minutes=(
            int(result.get("eta_minutes"))
            if result.get("eta_minutes") is not None
            else None
        ),
        resolved_agent_id=route.agent_id,
        memory_scope=route.memory_scope,
        routing_reason=route.reason,
    )


@router.post("/ops/report", response_model=TeamOpsReportResponse)
def ops_report(req: TeamOpsReportRequest, request: Request) -> TeamOpsReportResponse:
    container = _get_container(request)
    report = _build_ops_report(
        request=request,
        container=container,
        scan_now=req.scan_now,
        recover_now=req.recover_now,
        stale_progress_sec=req.stale_progress_sec,
        stale_degrade_sec=req.stale_degrade_sec,
        max_scan=req.max_scan,
        min_repeat_sec=req.min_repeat_sec,
    )
    summary = str(report.get("summary_text") or "运维报告暂不可用。")
    pushed = False
    channel: str | None = None
    push_error: str | None = None
    if req.push_feishu:
        pushed, channel, push_error = _push_ops_summary(summary)
    return TeamOpsReportResponse(
        ok=True,
        summary=summary,
        report=report,
        pushed=pushed,
        push_channel=channel,
        push_error=push_error,
        timestamp=datetime.now(UTC).isoformat(),
    )


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


@router.post("/tasks/{task_id}/run-async", response_model=TeamTaskRunAsyncResponse)
def run_task_async(
    task_id: str,
    req: TeamTaskRunRequest,
    request: Request,
) -> TeamTaskRunAsyncResponse:
    container = _get_container(request)
    record = container.memory_service.get_task_record(task_id=task_id)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"task not found: {task_id}",
        )

    current_status = str(record.status or "planned").lower()
    if current_status in {"done", "review"}:
        return TeamTaskRunAsyncResponse(
            ok=True,
            task_id=task_id,
            accepted=False,
            status=current_status,
            message="任务已结束，无需再次触发执行。",
        )
    worker = Thread(
        target=_execute_task_async_worker,
        kwargs={
            "container": container,
            "task_id": task_id,
            "max_attempts": max(int(req.max_attempts), 1),
            "resume": req.resume,
        },
        daemon=True,
        name=f"yoyoo-run-{task_id[:24]}",
    )
    worker.start()
    return TeamTaskRunAsyncResponse(
        ok=True,
        task_id=task_id,
        accepted=True,
        status="running",
        message="已受理并开始异步执行。",
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


@router.get("/runtime/health", response_model=TeamRuntimeHealthResponse)
def runtime_health(request: Request) -> TeamRuntimeHealthResponse:
    container = _get_container(request)
    watchdog = getattr(request.app.state, "watchdog_state", {}) or {}
    return TeamRuntimeHealthResponse(
        ok=True,
        backend_version=str(getattr(request.app, "version", "unknown")),
        watchdog=watchdog if isinstance(watchdog, dict) else {"raw": watchdog},
        executor=container.ceo_dispatcher.executor_diagnostics(),
        memory=container.memory_service.persistence_diagnostics(),
        router=container.agent_router.diagnostics(),
        timestamp=datetime.now(UTC).isoformat(),
    )
