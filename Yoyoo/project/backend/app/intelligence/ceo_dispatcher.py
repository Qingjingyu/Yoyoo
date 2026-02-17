from __future__ import annotations

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

        if error:
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
            )
            return AcceptanceResult(
                ok=False,
                task_id=task_id,
                status="failed",
                issues=["execution_error"],
                reply=f"CEO 验收未通过：执行失败。错误：{error}",
                next_step="请先排查错误并重新提交结果。",
            )

        if not evidence:
            self._memory.append_task_timeline_event(
                task_id=task_id,
                event_type="review_required",
                actor="CEO",
                role="CEO",
                stage="review",
                detail="结果缺少证据，已要求 CTO 补证。",
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
            )
            return AcceptanceResult(
                ok=False,
                task_id=task_id,
                status="review",
                score=0.55,
                issues=["missing_evidence"],
                reply="CEO 暂不验收通过：结果缺少证据。",
                next_step="请补充日志、命令输出或截图后再提交。",
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
