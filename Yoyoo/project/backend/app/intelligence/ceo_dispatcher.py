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

_ROLE_RULES: list[tuple[str, tuple[str, ...]]] = [
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
        task = self._memory.create_task_record(
            conversation_id=conversation_id,
            user_id=user_id,
            channel=channel,
            project_key=project_key,
            trace_id=trace_id,
            request_text=request_text,
            route_model="yoyoo-ceo/team",
            plan_steps=[f"CEO 分发给 {owner_role} 执行"],
            verification_checks=["执行结果必须附证据"],
            rollback_template=["回退到上一稳定状态"],
        )
        self._memory.update_task_record(task_id=task.task_id, status="running")
        dispatch_detail = f"CEO 已派单给 CTO（{owner_role}）开始执行。"
        self._memory.append_task_timeline_event(
            task_id=task.task_id,
            event_type="dispatched",
            actor="CEO",
            role="CEO",
            stage="assigned",
            detail=dispatch_detail,
            source="ceo_dispatcher",
        )
        self._memory.upsert_team_task_meta(
            task_id=task.task_id,
            owner_role=owner_role,
            title=self._make_title(request_text),
            objective=request_text,
            status="running",
            next_step=f"等待 CTO（{owner_role}）回报首个进度。",
        )
        self._memory.sync_department_to_ceo(
            role="CEO",
            patch={
                "task_id": task.task_id,
                "summary": dispatch_detail,
                "event_type": "dispatched",
                "updated_at": datetime.now(UTC).isoformat(),
            },
        )
        return self.get_task(task.task_id)

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

        normalized_role = (role or "").strip().upper() or "CTO"
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
            owner_role=normalized_role,
            title=self._make_title(task.request_text),
            objective=task.request_text,
            status="running",
            next_step=f"CTO 正在{self._stage_cn(normalized_stage)}：{detail_text[:60]}",
        )
        ceo_summary = (
            f"CEO 汇报：CTO（{normalized_role}）进度[{self._stage_cn(normalized_stage)}] "
            f"{detail_text}"
        )
        self._memory.sync_department_to_ceo(
            role=normalized_role,
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
            status="running",
            reply=ceo_summary,
            next_step="继续执行并在关键节点回报。",
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
                role=role,
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
                owner_role=role,
                title=self._make_title(task.request_text),
                objective=task.request_text,
                status="failed",
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
                owner_role=role,
                title=self._make_title(task.request_text),
                objective=task.request_text,
                status="review",
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
            owner_role=role,
            title=self._make_title(task.request_text),
            objective=task.request_text,
            status="done",
        )
        self._memory.sync_department_to_ceo(
            role=role,
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
            updated_at=record.updated_at,
            created_at=record.created_at,
        )

    def route_role(self, *, request_text: str) -> str:
        message = request_text.lower()
        for role, keywords in _ROLE_RULES:
            if any(token.lower() in message for token in keywords):
                return role
        return "ENG"

    def _make_title(self, request_text: str) -> str:
        compact = " ".join(request_text.split()).strip()
        if len(compact) <= 36:
            return compact
        return f"{compact[:33]}..."

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
