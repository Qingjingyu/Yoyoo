from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

from app.intelligence.memory import MemoryService
from app.intelligence.team_models import (
    AcceptanceResult,
    TaskCard,
    TaskEvidence,
    TaskProgressResult,
)
from app.services.executor_adapter import ExecutorAdapter

_CEO_OWNER_ROLE = "CTO"
_CTO_LANE_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("OPS", ("部署", "上线", "重启", "服务器", "运维", "ssh", "日志", "docker", "k8s")),
    ("QA", ("测试", "验收", "回归", "质量", "pytest", "lint", "bug")),
    ("MEM", ("记忆", "复盘", "总结", "知识", "策略卡", "memory")),
    ("CH", ("钉钉", "飞书", "微信", "渠道", "群", "回调", "webhook")),
    ("INNO", ("创新", "学习", "调研", "评测", "沙箱", "新项目", "对比")),
]
_AUTO_REWORK_LIMIT = 1
_CEO_SMALLTALK_WORDS = (
    "你好",
    "在吗",
    "嗨",
    "hi",
    "hello",
    "早上好",
    "晚上好",
    "辛苦了",
)
_CEO_CAPABILITY_WORDS = ("你是谁", "你能做什么", "你有什么能力", "介绍一下")
_CEO_TASK_WORDS = (
    "开发",
    "实现",
    "写一个",
    "做一个",
    "生成",
    "分析",
    "部署",
    "排查",
    "修复",
    "优化",
    "上线",
    "执行",
    "创建",
    "制作",
    "搭建",
    "重构",
    "整理",
    "提取",
    "转写",
)
_CEO_REQUEST_PREFIX = ("帮我", "请你", "请帮我", "麻烦你")


class CEODispatcher:
    """CEO orchestrator: assignment, acceptance, and final user-facing decision."""

    def __init__(
        self,
        *,
        memory_service: MemoryService,
        executor_adapter: ExecutorAdapter | None = None,
    ) -> None:
        self._memory = memory_service
        self._executor_adapter = executor_adapter

    def create_task(
        self,
        *,
        user_id: str,
        conversation_id: str,
        channel: str,
        project_key: str,
        agent_id: str = "ceo",
        memory_scope: str | None = None,
        request_text: str,
        trace_id: str,
    ) -> TaskCard:
        owner_role = self.route_role(request_text=request_text)
        cto_lane = self._select_cto_lane(request_text=request_text)
        execution_mode = self._pick_execution_mode(request_text=request_text)
        eta_minutes = self._estimate_eta_minutes(request_text=request_text)
        task = self._memory.create_task_record(
            conversation_id=conversation_id,
            user_id=user_id,
            channel=channel,
            project_key=project_key,
            agent_id=agent_id,
            memory_scope=memory_scope,
            trace_id=trace_id,
            request_text=request_text,
            route_model="yoyoo-ceo/team",
            plan_steps=[f"CEO 分发给 CTO（lane={cto_lane}）执行，CEO 不直接执行任务"],
            verification_checks=["执行结果必须附证据"],
            rollback_template=["回退到上一稳定状态"],
        )
        self._memory.update_task_record(task_id=task.task_id, status="running")
        mode_cn = self._execution_mode_cn(execution_mode)
        dispatch_detail = (
            f"CEO 已派单给 CTO 开始执行（lane={cto_lane}，mode={mode_cn}）。"
            f"预计 {eta_minutes} 分钟给出阶段性结果，90 秒内首个进度回报。"
        )
        self._memory.append_task_timeline_event(
            task_id=task.task_id,
            event_type="dispatched",
            actor="CEO",
            role="CEO",
            stage="assigned",
            detail=dispatch_detail,
            source="ceo_dispatcher",
        )
        self._memory.append_task_timeline_event(
            task_id=task.task_id,
            event_type="execution_mode_selected",
            actor="CTO",
            role="CTO",
            stage="planning",
            detail=self._execution_strategy_detail(
                cto_lane=cto_lane,
                execution_mode=execution_mode,
            ),
            source="ceo_dispatcher",
        )
        self._memory.upsert_team_task_meta(
            task_id=task.task_id,
            owner_role=owner_role,
            title=self._make_title(request_text),
            objective=request_text,
            status="running",
            eta_minutes=eta_minutes,
            cto_lane=cto_lane,
            execution_mode=execution_mode,
            next_step=f"等待 CTO 以{mode_cn}执行并在 90 秒内回报首个进度。",
            extra_fields={
                "agent_id": task.agent_id,
                "memory_scope": task.memory_scope,
            },
        )
        self._memory.sync_department_to_ceo(
            role=_CEO_OWNER_ROLE,
            patch={
                "task_id": task.task_id,
                "summary": dispatch_detail,
                "eta_minutes": eta_minutes,
                "event_type": "dispatched",
                "cto_lane": cto_lane,
                "execution_mode": execution_mode,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
        return self.get_task(task.task_id)

    def watchdog_scan(
        self,
        *,
        stale_progress_sec: int = 90,
        stale_degrade_sec: int = 300,
        max_scan: int = 200,
        min_repeat_sec: int = 120,
    ) -> dict[str, Any]:
        progress_sec = max(int(stale_progress_sec), 30)
        degrade_sec = max(int(stale_degrade_sec), progress_sec + 30)
        scan_limit = max(int(max_scan), 1)
        repeat_sec = max(int(min_repeat_sec), 30)
        now = datetime.now(UTC)
        scanned = 0
        nudged = 0
        degraded = 0
        affected_task_ids: list[str] = []

        for record in self._memory.recent_all_tasks(limit=scan_limit):
            status = (record.status or "").strip().lower()
            if status not in {"running", "in_progress", "planned"}:
                continue
            scanned += 1
            baseline = (
                record.last_heartbeat_at
                or record.updated_at
                or record.started_at
                or record.created_at
            )
            age_sec = max((now - baseline).total_seconds(), 0.0)
            if age_sec >= degrade_sec:
                if self._recent_guard_event_exists(
                    task_id=record.task_id,
                    event_type="degraded",
                    now=now,
                    repeat_sec=repeat_sec,
                ):
                    continue
                detail = (
                    f"CTO 长时间无进度（{int(age_sec)}秒），已自动降级为 failed，"
                    "请 CEO 重新分派或人工接管。"
                )
                self._memory.append_task_timeline_event(
                    task_id=record.task_id,
                    event_type="degraded",
                    actor="YOYOO_GUARD",
                    role="CTO",
                    stage="blocked",
                    detail=detail,
                    source="backend_watchdog",
                )
                self._memory.update_task_record(
                    task_id=record.task_id,
                    status="failed",
                    executor_error="auto_degraded_no_progress",
                )
                team_meta = self._memory.get_team_task_meta(task_id=record.task_id) or {}
                self._memory.upsert_team_task_meta(
                    task_id=record.task_id,
                    owner_role=_CEO_OWNER_ROLE,
                    title=str(team_meta.get("title") or self._make_title(record.request_text)),
                    objective=str(team_meta.get("objective") or record.request_text),
                    status="failed",
                    eta_minutes=self._safe_eta_minutes(team_meta.get("eta_minutes")),
                    risk=str(team_meta.get("risk") or "") or None,
                    next_step="任务已自动降级，请 CEO 重新分派或人工接管。",
                    cto_lane=str(
                        team_meta.get("cto_lane")
                        or self._select_cto_lane(request_text=record.request_text)
                    ),
                    execution_mode=str(
                        team_meta.get("execution_mode")
                        or self._pick_execution_mode(request_text=record.request_text)
                    ),
                )
                self._memory.sync_department_to_ceo(
                    role=_CEO_OWNER_ROLE,
                    patch={
                        "task_id": record.task_id,
                        "summary": detail,
                        "event_type": "degraded",
                        "stage": "blocked",
                        "updated_at": datetime.now(UTC).isoformat(),
                    },
                )
                degraded += 1
                affected_task_ids.append(record.task_id)
                continue

            if age_sec < progress_sec:
                continue
            if self._recent_guard_event_exists(
                task_id=record.task_id,
                event_type="nudge",
                now=now,
                repeat_sec=repeat_sec,
            ):
                continue
            detail = (
                f"CTO 超过 {progress_sec} 秒无进度，已自动催办。"
                "请在 90 秒内回报阶段进度。"
            )
            self._memory.append_task_timeline_event(
                task_id=record.task_id,
                event_type="nudge",
                actor="YOYOO_GUARD",
                role="CTO",
                stage="executing",
                detail=detail,
                source="backend_watchdog",
            )
            team_meta = self._memory.get_team_task_meta(task_id=record.task_id) or {}
            current_status = str(team_meta.get("status") or "").strip().lower()
            next_status = "running" if current_status in {"", "pending"} else current_status
            self._memory.upsert_team_task_meta(
                task_id=record.task_id,
                owner_role=_CEO_OWNER_ROLE,
                title=str(team_meta.get("title") or self._make_title(record.request_text)),
                objective=str(team_meta.get("objective") or record.request_text),
                status=next_status,
                eta_minutes=self._safe_eta_minutes(team_meta.get("eta_minutes")),
                risk=str(team_meta.get("risk") or "") or None,
                next_step="已自动催办 CTO，请尽快回报阶段进度。",
                cto_lane=str(
                    team_meta.get("cto_lane")
                    or self._select_cto_lane(request_text=record.request_text)
                ),
                execution_mode=str(
                    team_meta.get("execution_mode")
                    or self._pick_execution_mode(request_text=record.request_text)
                ),
            )
            self._memory.sync_department_to_ceo(
                role=_CEO_OWNER_ROLE,
                patch={
                    "task_id": record.task_id,
                    "summary": detail,
                    "event_type": "nudge",
                    "stage": "executing",
                    "updated_at": datetime.now(UTC).isoformat(),
                },
            )
            nudged += 1
            affected_task_ids.append(record.task_id)

        return {
            "ok": True,
            "scanned": scanned,
            "nudged": nudged,
            "degraded": degraded,
            "changed": (nudged + degraded) > 0,
            "task_ids": affected_task_ids,
            "stale_progress_sec": progress_sec,
            "stale_degrade_sec": degrade_sec,
        }

    def report_progress(
        self,
        *,
        task_id: str,
        role: str,
        stage: str,
        detail: str,
        evidence: list[TaskEvidence],
    ) -> TaskProgressResult:
        task = self._memory.get_task_record(task_id=task_id)
        if task is None:
            return TaskProgressResult(
                ok=False,
                task_id=task_id,
                status="failed",
                reply=f"任务不存在：{task_id}",
            )

        normalized_role = self._normalize_executor_role(role)
        if normalized_role is None:
            return TaskProgressResult(
                ok=False,
                task_id=task_id,
                status="failed",
                reply="CEO 只接收 CTO 的进度回报；当前角色无效。",
                next_step="请由 CTO（或 CTO-*）重新提交进度。",
            )
        normalized_stage = self._normalize_stage(stage=stage)
        detail_text = (detail or "").strip()
        if not detail_text:
            detail_text = "CTO 已更新进度。"

        evidence_payload = [
            {"source": item.source, "content": item.content}
            for item in evidence
        ]
        self._memory.append_task_timeline_event(
            task_id=task_id,
            event_type="progress",
            actor="CTO",
            role=normalized_role,
            stage=normalized_stage,
            detail=detail_text,
            source="cto_report",
            evidence=evidence_payload,
        )
        self._memory.touch_task_heartbeat(
            task_id=task_id,
            note=f"{normalized_role}:{normalized_stage} {detail_text}",
        )
        self._memory.upsert_team_task_meta(
            task_id=task_id,
            owner_role=_CEO_OWNER_ROLE,
            title=self._make_title(task.request_text),
            objective=task.request_text,
            status="review" if normalized_stage == "review" else "running",
            cto_lane=self._select_cto_lane(request_text=task.request_text),
            next_step=f"CTO 正在{self._stage_cn(normalized_stage)}：{detail_text[:60]}",
        )
        ceo_summary = (
            f"CEO 阶段汇报：CTO（{normalized_role}）进度[{self._stage_cn(normalized_stage)}] "
            f"{detail_text}"
        )
        self._memory.sync_department_to_ceo(
            role=_CEO_OWNER_ROLE,
            patch={
                "task_id": task_id,
                "summary": ceo_summary,
                "event_type": "progress",
                "stage": normalized_stage,
                "evidence": evidence_payload,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
        return TaskProgressResult(
            ok=True,
            task_id=task_id,
            status="review" if normalized_stage == "review" else "running",
            reply=ceo_summary,
            next_step=(
                "当前阻塞，CTO 需先解除阻塞后继续回报。"
                if normalized_stage == "blocked"
                else "继续执行并在关键节点回报。"
            ),
        )

    def accept_result(
        self,
        *,
        task_id: str,
        role: str,
        reply: str | None,
        error: str | None,
        evidence: list[TaskEvidence],
    ) -> AcceptanceResult:
        task = self._memory.get_task_record(task_id=task_id)
        if task is None:
            return AcceptanceResult(
                ok=False,
                task_id=task_id,
                status="failed",
                issues=["task_not_found"],
                reply=f"任务不存在：{task_id}",
            )

        normalized_role = self._normalize_executor_role(role)
        if normalized_role is None:
            return AcceptanceResult(
                ok=False,
                task_id=task_id,
                status="failed",
                issues=["invalid_executor_role"],
                reply="CEO 只接收 CTO 的结果提交；当前角色无效。",
                next_step="请由 CTO（或 CTO-*）提交最终结果。",
            )

        normalized_evidence = [
            {"type": "submission", "source": item.source, "content": item.content}
            for item in evidence
        ]
        evidence_lines = [f"{item.source}: {item.content}" for item in evidence]
        meta = self._memory.get_team_task_meta(task_id=task_id) or {}
        rework_count = self._safe_rework_count(meta.get("rework_count"))

        if error:
            if rework_count < _AUTO_REWORK_LIMIT:
                next_rework_count = rework_count + 1
                detail = (
                    f"CTO 上报执行错误：{error}。"
                    f"CEO 已触发自动返工（{next_rework_count}/{_AUTO_REWORK_LIMIT}）。"
                )
                self._memory.append_task_timeline_event(
                    task_id=task_id,
                    event_type="rework_requested",
                    actor="CEO",
                    role="CEO",
                    stage="review",
                    detail=detail,
                    source="ceo_acceptance",
                    evidence=[{"source": "error", "content": error}],
                )
                self._memory.update_task_record(
                    task_id=task_id,
                    status="running",
                    executor_reply=reply,
                    executor_error=error,
                    evidence=evidence_lines,
                    evidence_structured=normalized_evidence
                    + [{"type": "submission", "source": "error", "content": error}],
                )
                self._memory.upsert_team_task_meta(
                    task_id=task_id,
                    owner_role=_CEO_OWNER_ROLE,
                    title=self._make_title(task.request_text),
                    objective=task.request_text,
                    status="running",
                    cto_lane=self._select_cto_lane(request_text=task.request_text),
                    next_step="已触发自动返工一次：请修复错误并补充证据后重新提交。",
                    extra_fields={
                        "rework_count": next_rework_count,
                        "last_rework_reason": "execution_error",
                    },
                )
                self._memory.sync_department_to_ceo(
                    role=_CEO_OWNER_ROLE,
                    patch={
                        "task_id": task_id,
                        "summary": detail,
                        "event_type": "rework_requested",
                        "stage": "review",
                        "updated_at": datetime.now(UTC).isoformat(),
                    },
                )
                return AcceptanceResult(
                    ok=False,
                    task_id=task_id,
                    status="review",
                    corrected=True,
                    issues=["execution_error", "auto_rework_once"],
                    reply="CEO 已触发自动返工一次：先修复错误，再回传证据。",
                    next_step="修复错误并补充证据后重新提交。",
                )

            self._memory.append_task_timeline_event(
                task_id=task_id,
                event_type="failed",
                actor="CTO",
                role=normalized_role,
                stage="failed",
                detail=f"执行失败：{error}",
                source="cto_submit",
                evidence=[{"source": "error", "content": error}],
            )
            self._memory.update_task_record(
                task_id=task_id,
                status="failed",
                executor_reply=reply,
                executor_error=error,
                evidence=evidence_lines,
                evidence_structured=normalized_evidence,
            )
            self._memory.upsert_team_task_meta(
                task_id=task_id,
                owner_role=_CEO_OWNER_ROLE,
                title=self._make_title(task.request_text),
                objective=task.request_text,
                status="failed",
                cto_lane=self._select_cto_lane(request_text=task.request_text),
                extra_fields={
                    "rework_count": rework_count,
                    "last_rework_reason": "execution_error",
                },
            )
            return AcceptanceResult(
                ok=False,
                task_id=task_id,
                status="failed",
                issues=["execution_error"],
                reply=f"CEO 验收未通过：执行失败。错误：{error}",
                next_step="自动返工次数已用尽，请人工介入排查并重派。",
            )

        if not evidence:
            if rework_count < _AUTO_REWORK_LIMIT:
                next_rework_count = rework_count + 1
                detail = (
                    f"结果缺少证据。CEO 已触发自动返工（{next_rework_count}/{_AUTO_REWORK_LIMIT}），"
                    "要求 CTO 补齐日志/命令输出/截图。"
                )
                self._memory.append_task_timeline_event(
                    task_id=task_id,
                    event_type="rework_requested",
                    actor="CEO",
                    role="CEO",
                    stage="review",
                    detail=detail,
                    source="ceo_acceptance",
                )
                self._memory.update_task_record(
                    task_id=task_id,
                    status="running",
                    executor_reply=reply,
                    evidence_structured=[],
                )
                self._memory.upsert_team_task_meta(
                    task_id=task_id,
                    owner_role=_CEO_OWNER_ROLE,
                    title=self._make_title(task.request_text),
                    objective=task.request_text,
                    status="running",
                    cto_lane=self._select_cto_lane(request_text=task.request_text),
                    next_step="已触发自动返工一次：请补充证据后重新提交。",
                    extra_fields={
                        "rework_count": next_rework_count,
                        "last_rework_reason": "missing_evidence",
                    },
                )
                self._memory.sync_department_to_ceo(
                    role=_CEO_OWNER_ROLE,
                    patch={
                        "task_id": task_id,
                        "summary": detail,
                        "event_type": "rework_requested",
                        "stage": "review",
                        "updated_at": datetime.now(UTC).isoformat(),
                    },
                )
                return AcceptanceResult(
                    ok=False,
                    task_id=task_id,
                    status="review",
                    score=0.55,
                    corrected=True,
                    issues=["missing_evidence", "auto_rework_once"],
                    reply="CEO 暂不验收通过：已触发自动返工一次，请先补证。",
                    next_step="请补充日志、命令输出或截图后再提交。",
                )

            self._memory.append_task_timeline_event(
                task_id=task_id,
                event_type="review_required",
                actor="CEO",
                role="CEO",
                stage="review",
                detail="结果缺少证据，自动返工次数已用尽，等待人工处理。",
                source="ceo_acceptance",
            )
            self._memory.update_task_record(
                task_id=task_id,
                status="completed_with_warnings",
                executor_reply=reply,
                evidence_structured=[],
            )
            self._memory.upsert_team_task_meta(
                task_id=task_id,
                owner_role=_CEO_OWNER_ROLE,
                title=self._make_title(task.request_text),
                objective=task.request_text,
                status="review",
                cto_lane=self._select_cto_lane(request_text=task.request_text),
                extra_fields={
                    "rework_count": rework_count,
                    "last_rework_reason": "missing_evidence",
                },
            )
            return AcceptanceResult(
                ok=False,
                task_id=task_id,
                status="review",
                score=0.55,
                issues=["missing_evidence"],
                reply="CEO 暂不验收通过：结果缺少证据。",
                next_step="自动返工次数已用尽，请人工补充证据后再提交。",
            )

        self._memory.append_task_timeline_event(
            task_id=task_id,
            event_type="completed",
            actor="CEO",
            role="CEO",
            stage="done",
            detail="CEO 验收通过，任务完成。",
            source="ceo_acceptance",
            evidence=[{"source": item.source, "content": item.content} for item in evidence],
        )
        self._memory.update_task_record(
            task_id=task_id,
            status="completed",
            executor_reply=reply,
            evidence=evidence_lines,
            evidence_structured=normalized_evidence,
        )
        self._memory.upsert_team_task_meta(
            task_id=task_id,
            owner_role=_CEO_OWNER_ROLE,
            title=self._make_title(task.request_text),
            objective=task.request_text,
            status="done",
            cto_lane=self._select_cto_lane(request_text=task.request_text),
            extra_fields={
                "rework_count": rework_count,
                "last_rework_reason": None,
            },
        )
        self._memory.sync_department_to_ceo(
            role=_CEO_OWNER_ROLE,
            patch={
                "task_id": task_id,
                "summary": (reply or "").strip() or "执行完成",
                "evidence": normalized_evidence,
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
        return AcceptanceResult(
            ok=True,
            task_id=task_id,
            status="done",
            score=0.92,
            reply="CEO 验收通过，任务已完成并入总记忆。",
            next_step="可继续下一个任务。",
        )

    def _safe_rework_count(self, value: Any) -> int:
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return 0
        return max(parsed, 0)

    def get_task_timeline(self, *, task_id: str, limit: int = 50) -> list[dict[str, Any]]:
        return self._memory.read_task_timeline(task_id=task_id, limit=limit)

    def get_task(self, task_id: str) -> TaskCard:
        record = self._memory.get_task_record(task_id=task_id)
        if record is None:
            raise KeyError(task_id)
        meta = self._memory.get_team_task_meta(task_id=task_id) or {}
        status = str(meta.get("status") or self._to_team_status(record.status))
        return TaskCard(
            task_id=record.task_id,
            title=str(meta.get("title") or self._make_title(record.request_text)),
            objective=str(meta.get("objective") or record.request_text),
            owner_role=str(
                meta.get("owner_role")
                or self.route_role(request_text=record.request_text)
            ),
            status=status,
            checkpoints=["执行结果必须附证据"],
            risk=str(meta.get("risk") or "") or None,
            next_step=str(meta.get("next_step") or "") or None,
            eta_minutes=self._safe_eta_minutes(meta.get("eta_minutes")),
            updated_at=record.updated_at,
            created_at=record.created_at,
        )

    def route_role(self, *, request_text: str) -> str:
        del request_text
        return _CEO_OWNER_ROLE

    def ceo_chat(
        self,
        *,
        request_text: str,
        user_id: str,
        conversation_id: str,
        channel: str,
        project_key: str,
        agent_id: str = "ceo",
        memory_scope: str | None = None,
        trace_id: str | None = None,
    ) -> dict[str, Any]:
        text = (request_text or "").strip()
        normalized = self._normalize_text(text)
        task_intent = self._is_task_intent(normalized)

        lane = self._select_cto_lane(request_text=text)
        mode = self._pick_execution_mode(request_text=text)
        eta = self._estimate_eta_minutes(request_text=text)
        mode_cn = self._execution_mode_cn(mode)
        latest_task = self._latest_task_hint(conversation_id=conversation_id)

        if self._is_capability_query(normalized):
            reply = self._capability_reply(latest_task=latest_task)
        elif self._is_greeting_or_smalltalk(normalized):
            reply = self._greeting_reply(latest_task=latest_task)
        elif task_intent:
            task_title = self._make_title(text)
            reply = (
                f"我已理解你的目标：「{task_title}」。"
                f"我会由 CTO 负责执行（lane={lane}，mode={mode_cn}）。"
                f"预计 {eta} 分钟给阶段结果。若你确认现在开始，请回复“确认执行”。"
            )
        else:
            task_hint = ""
            if latest_task is not None and latest_task.get("task_id"):
                task_hint = (
                    f"你上一个任务 {latest_task['task_id']} 目前{latest_task.get('status_cn', '处理中')}。"
                )
            reply = (
                f"我理解你在问「{self._make_title(text)}」。"
                f"{task_hint}我先帮你把需求收敛清楚，再决定是否进入执行。"
                "你可以补充目标、约束和截止时间。"
            )

        self._memory.append_event(
            conversation_id=conversation_id,
            user_id=user_id,
            direction="inbound",
            text=text,
            intent="task_intent" if task_intent else "chat",
            trace_id=trace_id,
        )
        self._memory.append_event(
            conversation_id=conversation_id,
            user_id=user_id,
            direction="outbound",
            text=reply,
            intent="ceo_reply",
            trace_id=trace_id,
        )
        self._memory.sync_department_to_ceo(
            role=_CEO_OWNER_ROLE,
            patch={
                "task_id": None,
                "summary": reply,
                "event_type": "chat",
                "stage": "discussion",
                "updated_at": datetime.now(UTC).isoformat(),
                "agent_id": agent_id,
                "memory_scope": memory_scope or f"agent:{agent_id}",
                "channel": channel,
                "project_key": project_key,
            },
        )
        return {
            "ok": True,
            "reply": reply,
            "task_intent": task_intent,
            "require_confirmation": bool(task_intent),
            "suggested_executor": _CEO_OWNER_ROLE,
            "cto_lane": lane,
            "execution_mode": mode,
            "eta_minutes": eta,
        }

    def _latest_task_hint(self, *, conversation_id: str) -> dict[str, Any] | None:
        tasks = self._memory.recent_tasks(conversation_id=conversation_id, limit=1)
        if not tasks:
            return None
        item = tasks[-1]
        return {
            "task_id": item.task_id,
            "title": self._make_title(item.request_text),
            "status": item.status,
            "status_cn": self._task_status_cn(item.status),
            "updated_at": item.updated_at.isoformat(),
        }

    def _task_status_cn(self, status: str) -> str:
        mapping = {
            "planned": "待执行",
            "running": "执行中",
            "in_progress": "执行中",
            "review": "验收中",
            "completed": "已完成",
            "completed_with_warnings": "已完成（有提醒）",
            "failed": "失败",
            "timeout": "超时",
            "cancelled": "已取消",
        }
        return mapping.get((status or "").strip().lower(), "处理中")

    def _capability_reply(self, *, latest_task: dict[str, Any] | None) -> str:
        task_hint = ""
        if latest_task is not None and latest_task.get("task_id"):
            task_hint = (
                f"你最近任务 {latest_task['task_id']} 当前{latest_task.get('status_cn', '处理中')}。"
            )
        return (
            "我是 Yoyoo CEO，负责和你对话、澄清目标、派发任务给 CTO、验收结果并持续汇报。"
            f"{task_hint}你可以直接说目标，我会判断是先讨论还是进入执行。"
        )

    def _greeting_reply(self, *, latest_task: dict[str, Any] | None) -> str:
        if latest_task is not None and latest_task.get("task_id"):
            return (
                f"我在。你上个任务「{latest_task.get('title', '')}」"
                f"（{latest_task['task_id']}）当前{latest_task.get('status_cn', '处理中')}。"
                "你要继续推进它，还是开一个新任务？"
            )
        return "我在。你直接告诉我现在最想推进的目标，我来帮你拆解并安排执行。"

    def _select_cto_lane(self, *, request_text: str) -> str:
        message = (request_text or "").lower()
        for lane, keywords in _CTO_LANE_RULES:
            if any(token.lower() in message for token in keywords):
                return lane
        return "ENG"

    def _pick_execution_mode(self, *, request_text: str) -> str:
        message = (request_text or "").lower()
        if len(message) >= 120:
            return "employee_instance"
        if any(
            token in message
            for token in ("架构", "全量", "长期", "多阶段", "多并发", "系统", "企业级", "重构")
        ):
            return "employee_instance"
        return "subagent"

    def _make_title(self, request_text: str) -> str:
        compact = " ".join(request_text.split()).strip()
        if len(compact) <= 36:
            return compact
        return f"{compact[:33]}..."

    def _estimate_eta_minutes(self, *, request_text: str) -> int:
        message = (request_text or "").strip().lower()
        if any(token in message for token in ("部署", "上线", "迁移", "重构", "架构", "全量", "多阶段")):
            return 45
        if any(token in message for token in ("联调", "修复", "优化", "测试", "脚本", "接口")):
            return 20
        if len(message) > 120:
            return 20
        return 8

    def _safe_eta_minutes(self, value: Any) -> int | None:
        if value is None:
            return None
        try:
            parsed = int(value)
        except (TypeError, ValueError):
            return None
        if parsed <= 0:
            return None
        return min(parsed, 1440)

    def _to_team_status(self, status: str) -> str:
        normalized = status.strip().lower()
        mapping = {
            "planned": "pending",
            "running": "running",
            "in_progress": "running",
            "completed": "done",
            "completed_with_warnings": "review",
            "failed": "failed",
            "timeout": "failed",
        }
        return mapping.get(normalized, "pending")

    def _normalize_stage(self, *, stage: str) -> str:
        normalized = (stage or "").strip().lower()
        allowed = {
            "queued",
            "assigned",
            "planning",
            "executing",
            "blocked",
            "review",
            "done",
        }
        if normalized in allowed:
            return normalized
        return "executing"

    def _stage_cn(self, stage: str) -> str:
        mapping = {
            "queued": "排队中",
            "assigned": "已接单",
            "planning": "规划中",
            "executing": "执行中",
            "blocked": "阻塞中",
            "review": "验收中",
            "done": "已完成",
        }
        return mapping.get(stage, "执行中")

    def _execution_mode_cn(self, mode: str) -> str:
        mapping = {
            "subagent": "子代理",
            "employee_instance": "独立员工实例",
        }
        return mapping.get(mode, "子代理")

    def _execution_strategy_detail(self, *, cto_lane: str, execution_mode: str) -> str:
        mode_cn = self._execution_mode_cn(execution_mode)
        return f"CTO 执行策略已确定：lane={cto_lane}，mode={mode_cn}。"

    def _normalize_text(self, text: str) -> str:
        return re.sub(r"\s+", " ", (text or "").strip().lower())

    def _is_capability_query(self, normalized: str) -> bool:
        return any(token in normalized for token in _CEO_CAPABILITY_WORDS)

    def _is_greeting_or_smalltalk(self, normalized: str) -> bool:
        if not normalized:
            return True
        if len(normalized) <= 8 and any(token in normalized for token in _CEO_SMALLTALK_WORDS):
            return True
        return self._is_capability_query(normalized)

    def _is_task_intent(self, normalized: str) -> bool:
        if not normalized or self._is_greeting_or_smalltalk(normalized):
            return False
        explicit = normalized.startswith("任务 ") or "任务：" in normalized
        has_action = any(token in normalized for token in _CEO_TASK_WORDS)
        has_prefix = any(token in normalized for token in _CEO_REQUEST_PREFIX)
        if explicit and len(normalized) >= 6:
            return True
        if has_action and has_prefix:
            return True
        if has_action and len(normalized) >= 10:
            return True
        return False

    def _recent_guard_event_exists(
        self,
        *,
        task_id: str,
        event_type: str,
        now: datetime,
        repeat_sec: int,
    ) -> bool:
        record = self._memory.get_task_record(task_id=task_id)
        if record is None:
            return False
        target = (event_type or "").strip().lower()
        for item in reversed(record.evidence_structured):
            if not isinstance(item, dict):
                continue
            if str(item.get("type") or "").strip().lower() != "timeline":
                continue
            if str(item.get("event_type") or "").strip().lower() != target:
                continue
            timestamp = self._parse_iso_datetime(item.get("timestamp"))
            if timestamp is None:
                continue
            return (now - timestamp).total_seconds() < max(repeat_sec, 1)
        return False

    def _parse_iso_datetime(self, value: Any) -> datetime | None:
        if not isinstance(value, str):
            return None
        text = value.strip()
        if not text:
            return None
        try:
            if text.endswith("Z"):
                text = f"{text[:-1]}+00:00"
            parsed = datetime.fromisoformat(text)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=UTC)
            return parsed.astimezone(UTC)
        except ValueError:
            return None

    def _normalize_executor_role(self, role: str) -> str | None:
        normalized = (role or "").strip().upper()
        if not normalized:
            return _CEO_OWNER_ROLE
        if normalized == _CEO_OWNER_ROLE or normalized.startswith(f"{_CEO_OWNER_ROLE}-"):
            return normalized
        return None

    def execute_task(
        self,
        *,
        task_id: str,
        max_attempts: int = 2,
        resume: bool = True,
    ) -> dict[str, Any]:
        record = self._memory.get_task_record(task_id=task_id)
        if record is None:
            return {
                "ok": False,
                "task_id": task_id,
                "status": "failed",
                "attempts_used": 0,
                "max_attempts": max(int(max_attempts), 1),
                "resumed": False,
                "provider": None,
                "corrected": False,
                "issues": ["task_not_found"],
                "reply": f"任务不存在：{task_id}",
                "next_step": "请先创建任务后再执行。",
            }

        bounded_attempts = max(int(max_attempts), 1)
        current_attempts = max(int(record.execution_attempts or 0), 0)
        resumed = bool(resume and current_attempts > 0)
        lease_holder = f"ceo-dispatcher:{task_id}"
        lease = self._memory.acquire_task_lease(
            task_id=task_id,
            holder=lease_holder,
            ttl_sec=180,
        )
        if not bool(lease.get("acquired")):
            holder = str(lease.get("holder") or "unknown")
            expires_at = str(lease.get("expires_at") or "")
            return {
                "ok": False,
                "task_id": task_id,
                "status": "running",
                "attempts_used": current_attempts,
                "max_attempts": bounded_attempts,
                "resumed": resumed,
                "provider": None,
                "corrected": False,
                "issues": ["task_locked"],
                "reply": f"任务正在执行中（holder={holder}）。",
                "next_step": f"请等待执行租约过期后再重试。expires_at={expires_at}",
            }
        self._memory.mark_task_running(
            task_id=task_id,
            max_attempts=bounded_attempts,
            resumed=resumed,
            resume_reason="watchdog_resume" if resumed else "manual_run",
        )

        provider = "mock"
        final_reply = ""
        final_status = "running"
        final_issues: list[str] = []
        final_corrected = False
        final_next_step: str | None = None

        try:
            for attempt_no in range(current_attempts + 1, bounded_attempts + 1):
                self._memory.refresh_task_lease(
                    task_id=task_id,
                    holder=lease_holder,
                    ttl_sec=180,
                )
                self._memory.record_task_attempt(
                    task_id=task_id,
                    attempt_no=attempt_no,
                    reason="auto_retry" if attempt_no > 1 else "initial_run",
                )
                self._memory.append_task_timeline_event(
                    task_id=task_id,
                    event_type="execution_attempt",
                    actor="CTO",
                    role="CTO",
                    stage="executing",
                    detail=f"开始第 {attempt_no}/{bounded_attempts} 次执行尝试。",
                    source="ceo_dispatcher",
                )
                adapter_result = self.execute_via_provider(
                    user_id=record.user_id,
                    conversation_id=record.conversation_id,
                    channel=record.channel,
                    route_model=record.route_model,
                    message=record.request_text,
                    trace_id=record.trace_id,
                    preferred_provider="openclaw",
                )
                provider = str(adapter_result.get("provider") or provider)
                reply = str(adapter_result.get("reply") or "").strip()
                error = str(adapter_result.get("error") or "").strip() or None
                evidence = self._coerce_evidence(adapter_result.get("evidence"))
                if not evidence and reply:
                    evidence = [TaskEvidence(source="executor_reply", content=reply[:800])]

                acceptance = self.accept_result(
                    task_id=task_id,
                    role="CTO",
                    reply=reply or None,
                    error=error,
                    evidence=evidence,
                )
                final_status = acceptance.status
                final_reply = acceptance.reply
                final_issues = list(acceptance.issues)
                final_corrected = bool(acceptance.corrected)
                final_next_step = acceptance.next_step

                if acceptance.ok:
                    break
                if attempt_no >= bounded_attempts:
                    break
                if not acceptance.corrected and acceptance.status == "failed":
                    break

            latest = self._memory.get_task_record(task_id=task_id)
            attempts_used = max(int(latest.execution_attempts if latest else 0), current_attempts)
            return {
                "ok": final_status == "done",
                "task_id": task_id,
                "status": final_status,
                "attempts_used": attempts_used,
                "max_attempts": bounded_attempts,
                "resumed": resumed,
                "provider": provider,
                "corrected": final_corrected,
                "issues": final_issues,
                "reply": final_reply or "执行完成。",
                "next_step": final_next_step,
            }
        finally:
            self._memory.release_task_lease(
                task_id=task_id,
                holder=lease_holder,
            )

    def recover_stale_tasks(
        self,
        *,
        max_scan: int = 50,
        stale_seconds: int = 120,
        max_attempts: int = 2,
    ) -> dict[str, Any]:
        now = datetime.now(UTC)
        scan_limit = max(int(max_scan), 1)
        stale_sec = max(int(stale_seconds), 30)
        statuses = {"planned", "running", "in_progress", "failed", "timeout"}

        scanned = 0
        resumed = 0
        completed = 0
        failed = 0
        skipped = 0
        details: list[dict[str, Any]] = []

        for record in self._memory.recent_all_tasks(limit=scan_limit):
            status = (record.status or "").strip().lower()
            if status not in statuses:
                continue
            scanned += 1
            lease = self._memory.get_task_lease(task_id=record.task_id)
            if isinstance(lease, dict) and not bool(lease.get("expired", False)):
                skipped += 1
                continue
            heartbeat = record.last_heartbeat_at or record.updated_at or record.created_at
            idle_seconds = max((now - heartbeat).total_seconds(), 0.0)
            if status in {"running", "in_progress"} and idle_seconds < stale_sec:
                skipped += 1
                continue
            if max(int(record.execution_attempts or 0), 0) >= max(int(max_attempts), 1):
                skipped += 1
                continue
            run_result = self.execute_task(
                task_id=record.task_id,
                max_attempts=max_attempts,
                resume=True,
            )
            resumed += 1
            if run_result.get("status") == "done":
                completed += 1
            elif run_result.get("status") == "failed":
                failed += 1
            details.append(
                {
                    "task_id": record.task_id,
                    "previous_status": status,
                    "idle_seconds": int(idle_seconds),
                    "result_status": run_result.get("status"),
                    "attempts_used": run_result.get("attempts_used"),
                    "reply": run_result.get("reply"),
                }
            )

        return {
            "ok": True,
            "scanned": scanned,
            "resumed": resumed,
            "completed": completed,
            "failed": failed,
            "skipped": skipped,
            "changed": resumed > 0,
            "details": details,
        }

    def _coerce_evidence(self, raw: Any) -> list[TaskEvidence]:
        if not isinstance(raw, list):
            return []
        evidence: list[TaskEvidence] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            source = str(item.get("source") or "").strip()
            content = str(item.get("content") or "").strip()
            if not source or not content:
                continue
            evidence.append(TaskEvidence(source=source[:64], content=content[:2000]))
        return evidence

    def execute_via_provider(
        self,
        *,
        user_id: str,
        conversation_id: str,
        channel: str,
        route_model: str,
        message: str,
        trace_id: str | None = None,
        preferred_provider: str = "claw",
    ) -> dict[str, Any]:
        if self._executor_adapter is None:
            return {
                "ok": False,
                "provider": preferred_provider,
                "error": "executor_adapter_not_configured",
                "evidence": [{"type": "executor_error", "reason": "adapter_missing"}],
            }
        result = self._executor_adapter.execute(
            user_id=user_id,
            conversation_id=conversation_id,
            message=message,
            route_model=route_model,
            channel=channel,
            trace_id=trace_id,
            preferred_provider=preferred_provider,
        )
        return {
            "ok": result.ok,
            "provider": result.provider,
            "reply": result.reply,
            "error": result.error,
            "evidence": result.evidence or [],
        }

    def executor_diagnostics(self) -> dict[str, Any]:
        if self._executor_adapter is None:
            return {"configured": False, "reason": "executor_adapter_not_configured"}
        if not hasattr(self._executor_adapter, "diagnostics"):
            return {"configured": True, "reason": "diagnostics_not_supported"}
        try:
            detail = self._executor_adapter.diagnostics()  # type: ignore[attr-defined]
        except Exception as exc:  # pragma: no cover
            return {"configured": True, "reason": f"diagnostics_failed:{exc}"}
        if not isinstance(detail, dict):
            return {"configured": True, "reason": "diagnostics_not_dict"}
        return {"configured": True, **detail}
