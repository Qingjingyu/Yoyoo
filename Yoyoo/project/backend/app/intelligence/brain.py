from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from time import monotonic

from app.intelligence.execution_quality import ExecutionQualityGuard
from app.intelligence.intent import classify_intent, extract_feedback_label, extract_task_id_hint
from app.intelligence.memory import MemoryService, UserProfile
from app.intelligence.memory_pipeline import MemoryPipeline
from app.intelligence.model_router import ModelRouter
from app.intelligence.models import BrainDecision, BrainResult, Channel, ChatScope, DialogueContext
from app.intelligence.planner import TaskPlanner
from app.intelligence.policy_guard import PolicyGuard
from app.intelligence.strategy_cards import StrategyCardSelector
from app.intelligence.verification import TaskVerifier
from app.intelligence.yyos_orchestrator import YYOSOrchestrator, YYOSRoutingSnapshot
from app.services.chat_service import ChatService
from app.services.memory_sidecar import MemorySidecarClient
from app.services.openclaw_adapter import OpenClawAdapter, OpenClawAdapterResult

logger = logging.getLogger(__name__)
_TASK_ID_STRIP_PATTERN = re.compile(r"\btask_\d{14}_[a-z0-9]{8}\b", re.IGNORECASE)
_TASK_REPLY_FEEDBACK_HINT = (
    "\n\n反馈方式：直接回复这条消息“这次很好”或“这次不好”，"
    "我会自动绑定到该任务。"
)
_TASK_RETRYABLE_ERROR_TOKENS = (
    "timeout",
    "timed out",
    "network",
    "connection refused",
    "connection reset",
    "local_unhealthy",
    "session_locked",
    "circuit_open",
)
_TASK_RESUME_TOKENS = ("继续", "重试", "再试", "接着", "resume", "retry")
_FEEDBACK_BINDING_SOURCE_TEXT: dict[str, str] = {
    "hint_user": "你在消息里提供了 task_id",
    "hint_trusted_channel": "你在消息里提供了 task_id（同渠道可信绑定）",
    "conversation_user_recent": "同会话最近任务",
    "user_channel_recent": "同用户同渠道最近任务",
    "trusted_conversation_recent": "可信模式下同会话最近任务",
    "trusted_channel_recent": "可信模式下同渠道最近任务",
    "conversation_user_recent_short_retry": "短窗口重试命中：同会话刚创建任务",
    "user_channel_recent_short_retry": "短窗口重试命中：同用户同渠道刚创建任务",
    "trusted_conversation_recent_short_retry": "短窗口重试命中：可信同会话刚创建任务",
    "trusted_channel_recent_short_retry": "短窗口重试命中：可信同渠道刚创建任务",
    "conversation_private_relaxed": "私聊会话兜底：同会话最近任务",
    "conversation_relaxed_single_candidate": "会话兜底：同会话唯一候选任务",
    "conversation_user_recent_long_window": "长窗口兜底：同会话最近任务",
    "user_channel_recent_long_window": "长窗口兜底：同用户同渠道最近任务",
    "trusted_conversation_recent_long_window": "长窗口兜底：可信同会话最近任务",
    "trusted_channel_recent_long_window": "长窗口兜底：可信同渠道最近任务",
    "conversation_private_relaxed_long_window": "长窗口兜底：私聊同会话最近任务",
    "conversation_relaxed_single_candidate_long_window": "长窗口兜底：会话唯一候选任务",
}


@dataclass(frozen=True)
class FeedbackBindingResolution:
    task_id: str | None
    source: str
    failure_reason: str | None = None


class YoyooBrain:
    """Yoyoo Intelligence Layer: orchestrates policy, memory, and reply generation."""

    def __init__(
        self,
        *,
        chat_service: ChatService,
        memory_service: MemoryService,
        policy_guard: PolicyGuard,
        model_router: ModelRouter,
        task_planner: TaskPlanner,
        task_verifier: TaskVerifier,
        openclaw_adapter: OpenClawAdapter,
        execution_quality_guard: ExecutionQualityGuard,
        yyos_orchestrator: YYOSOrchestrator | None = None,
        memory_sidecar: MemorySidecarClient | None = None,
        feedback_binding_explain_enabled: bool = True,
        task_max_attempts: int = 2,
        task_resume_window_hours: float = 24.0,
    ) -> None:
        self._chat_service = chat_service
        self._memory_service = memory_service
        self._policy_guard = policy_guard
        self._model_router = model_router
        self._task_planner = task_planner
        self._task_verifier = task_verifier
        self._openclaw_adapter = openclaw_adapter
        self._execution_quality_guard = execution_quality_guard
        self._yyos_orchestrator = yyos_orchestrator
        self._feedback_binding_explain_enabled = feedback_binding_explain_enabled
        self._task_max_attempts = max(int(task_max_attempts), 1)
        self._task_resume_window_hours = max(float(task_resume_window_hours), 1.0)
        self._memory_pipeline = MemoryPipeline(
            memory_service=memory_service,
            memory_sidecar=memory_sidecar,
        )
        self._strategy_card_selector = StrategyCardSelector()

    def handle_message(self, *, context: DialogueContext, text: str) -> BrainResult:
        message = " ".join(text.split()).strip()
        intent = classify_intent(message)
        logger.info(
            "brain_handle_message trace_id=%s conversation_id=%s user_id=%s intent=%s",
            context.trace_id,
            context.conversation_id,
            context.user_id,
            intent,
        )
        learned_name = self._memory_service.learn_from_user_text(
            user_id=context.user_id,
            text=message,
        )
        profile = self._memory_service.get_or_create_profile(user_id=context.user_id)

        self._memory_service.append_event(
            conversation_id=context.conversation_id,
            user_id=context.user_id,
            direction="incoming",
            text=message,
            intent=intent,
            trace_id=context.trace_id or None,
        )

        decision = self._policy_guard.evaluate(context=context, text=message, intent=intent)
        decision.route_model = self._model_router.choose(intent=intent, text=message)
        if not decision.should_reply:
            return BrainResult(reply="", decision=decision)

        if decision.safety_blocked:
            reply = (
                "这个请求包含高风险系统操作。我不会直接执行。"
                "请先提供明确目标，我会给你一个可回滚的安全执行方案。"
            )
        else:
            reply = self._compose_reply(
                intent=intent,
                message=message,
                profile=profile,
                learned_name=learned_name,
                conversation_id=context.conversation_id,
                decision=decision,
                context=context,
            )

        self._memory_service.append_event(
            conversation_id=context.conversation_id,
            user_id=context.user_id,
            direction="outgoing",
            text=reply,
            intent=intent,
            trace_id=context.trace_id or None,
        )
        return BrainResult(reply=reply, decision=decision)

    def _compose_reply(
        self,
        *,
        intent: str,
        message: str,
        profile: UserProfile,
        learned_name: str | None,
        conversation_id: str,
        decision: BrainDecision,
        context: DialogueContext,
    ) -> str:
        context_pack = self._memory_pipeline.build_context(
            conversation_id=conversation_id,
            user_id=context.user_id,
            channel=context.channel.value,
            query=message,
            intent=intent,
        )
        project_key = str(context_pack.get("project_key") or "general")
        name = profile.preferred_name or "朋友"
        if intent == "set_name" and learned_name:
            return f"记住了，我会称呼你{name}。我是Yoyoo，我们继续。"
        if intent == "greeting":
            return f"你好，{name}。我是Yoyoo，现在可以开始任务。"
        if intent == "capability":
            return (
                "我是 Yoyoo 的智能中间层，负责对话编排、记忆管理、策略防护，"
                "并调度 OpenClaw 等执行能力。"
                f"当前建议模型路由：{decision.route_model}。"
            )
        if intent == "status":
            recent_count = len(
                self._memory_service.recent_events(
                    conversation_id=conversation_id,
                    limit=20,
                )
            )
            recent_tasks = context_pack["recent_tasks"]
            today_note_count = context_pack["today_note_count"]
            return (
                f"当前状态正常。已记录近期对话 {recent_count} 条，"
                f"今日记忆笔记 {today_note_count} 条，"
                f"最近任务 {len(recent_tasks)} 条，随时可继续执行任务。"
            )
        if intent == "task_feedback":
            feedback = extract_feedback_label(message)
            if feedback is None:
                self._log_feedback_binding_audit(
                    context=context,
                    feedback=None,
                    resolution=FeedbackBindingResolution(
                        task_id=None,
                        source="invalid_feedback_label",
                        failure_reason="feedback_label_missing",
                    ),
                )
                return "我已收到你的反馈，但还没识别到评价方向。请直接说“好/不好”，或附上 task_id。"
            resolution = self._resolve_feedback_target(
                message=message,
                conversation_id=conversation_id,
                user_id=context.user_id,
                channel=context.channel.value,
                trusted=context.trusted,
                scope=context.scope.value,
            )
            self._log_feedback_binding_audit(
                context=context,
                feedback=feedback,
                resolution=resolution,
            )
            self._memory_service.record_feedback_binding_attempt(
                source=resolution.source,
                success=resolution.task_id is not None,
            )
            if resolution.task_id is None:
                return self._build_feedback_not_found_reply(
                    conversation_id=conversation_id,
                    user_id=context.user_id,
                    channel=context.channel.value,
                    failure_reason=resolution.failure_reason,
                )
            updated = self._memory_service.apply_task_feedback(
                task_id=resolution.task_id,
                feedback=feedback,
                note=self._normalize_feedback_note(message),
            )
            if updated is None:
                return f"反馈写入失败，任务不存在：{resolution.task_id}。"
            decision.task_id = updated.task_id
            feedback_text = "正向" if feedback == "good" else "负向"
            binding_reason = self._format_feedback_binding_reason(source=resolution.source)
            reason_text = f"绑定依据：{binding_reason}。" if binding_reason else ""
            return (
                f"已记录{feedback_text}反馈，任务：{updated.task_id}。"
                f"{reason_text}"
                "后续相似任务会自动调整策略卡和执行优先级。"
            )
        if intent == "task_request":
            yyos_snapshot = self._route_with_yyos(message=message, project_key=project_key)
            decision.yyos_stage = yyos_snapshot.stage
            decision.yyos_confidence = yyos_snapshot.confidence
            decision.yyos_risk_level = yyos_snapshot.risk_level
            decision.yyos_decision = yyos_snapshot.decision
            decision.yyos_recommended_skills = yyos_snapshot.recommended_skills
            plan_steps, references = self._task_planner.build_plan(message)
            strategy_cards = self._strategy_card_selector.select(
                cards=list(context_pack["strategy_cards"]),
                query=message,
                intent=intent,
                limit=3,
            )
            learning_hints = context_pack["learning_hints"][:3]
            yyos_read_only_guard = (
                yyos_snapshot.ok
                and str(yyos_snapshot.risk_level or "").lower() in {"high", "critical"}
            )
            plan_steps = self._task_planner.apply_strategy_cards(
                steps=plan_steps,
                strategy_cards=strategy_cards,
                enforce_read_only_first=(
                    self._task_planner.should_enforce_read_only_first(message)
                    or yyos_read_only_guard
                ),
                include_evidence_step=True,
            )
            plan_steps = self._task_planner.apply_learning_hints(
                steps=plan_steps,
                learning_hints=learning_hints,
            )
            verification_checks, rollback_template = self._task_verifier.build(task_text=message)
            decision.plan_steps = plan_steps
            decision.verification_checks = verification_checks
            decision.rollback_template = rollback_template
            decision.strategy_cards = [
                str(item.get("card_id") or item.get("title") or "unknown")
                for item in strategy_cards
            ]
            decision.strategy_id = decision.strategy_cards[0] if decision.strategy_cards else None

            resumed = False
            task = None
            if self._looks_like_resume_request(message):
                task = self._memory_service.find_resumable_task(
                    conversation_id=conversation_id,
                    user_id=context.user_id,
                    channel=context.channel.value,
                    max_age_hours=self._task_resume_window_hours,
                )
                resumed = task is not None
            if task is None:
                task = self._memory_service.create_task_record(
                    conversation_id=conversation_id,
                    user_id=context.user_id,
                    channel=context.channel.value,
                    project_key=project_key,
                    trace_id=context.trace_id,
                    request_text=message,
                    route_model=decision.route_model,
                    plan_steps=plan_steps,
                    verification_checks=verification_checks,
                    rollback_template=rollback_template,
                )
            else:
                decision.route_model = task.route_model or decision.route_model
                if not task.plan_steps:
                    task.plan_steps = list(plan_steps)
                if not task.verification_checks:
                    task.verification_checks = list(verification_checks)
                if not task.rollback_template:
                    task.rollback_template = list(rollback_template)

            decision.task_id = task.task_id
            execution_message = task.request_text if resumed else message
            max_attempts = max(task.max_attempts, self._task_max_attempts)
            self._memory_service.mark_task_running(
                task_id=task.task_id,
                max_attempts=max_attempts,
                resumed=resumed,
                resume_reason=message if resumed else None,
            )

            execution_started_at = monotonic()
            bridge_result = OpenClawAdapterResult(ok=False, error="bridge_not_called")
            attempt_count = max(task.execution_attempts, 0)
            correction_applied = False
            quality_score: float | None = None
            quality_issues: list[str] = []
            execution_reply: str | None = None
            while attempt_count < max_attempts:
                attempt_count += 1
                self._memory_service.record_task_attempt(
                    task_id=task.task_id,
                    attempt_no=attempt_count,
                    reason="resume_execution" if resumed else "task_execution",
                )
                bridge_result = self._call_openclaw(
                    context=context,
                    message=execution_message,
                    route_model=decision.route_model,
                )
                execution_reply = bridge_result.reply
                if bridge_result.ok and bridge_result.reply:
                    quality = self._execution_quality_guard.assess(
                        task_text=execution_message,
                        reply_text=bridge_result.reply,
                    )
                    quality_score = quality.score
                    quality_issues = quality.issues
                    if quality.needs_correction:
                        correction_prompt = self._execution_quality_guard.build_correction_prompt(
                            task_text=execution_message,
                            low_quality_reply=bridge_result.reply,
                        )
                        correction_result = self._call_openclaw(
                            context=context,
                            message=correction_prompt,
                            route_model=decision.route_model,
                        )
                        if correction_result.ok and correction_result.reply:
                            corrected_quality = self._execution_quality_guard.assess(
                                task_text=execution_message,
                                reply_text=correction_result.reply,
                            )
                            if corrected_quality.score >= quality.score:
                                bridge_result = correction_result
                                execution_reply = correction_result.reply
                                quality_score = corrected_quality.score
                                quality_issues = corrected_quality.issues
                                correction_applied = True
                    decision.execution_quality_score = quality_score
                    decision.execution_quality_issues = quality_issues
                    decision.execution_corrected = correction_applied
                    break
                if attempt_count >= max_attempts:
                    break
                if not self._is_retryable_task_error(bridge_result.error):
                    break
                self._memory_service.touch_task_heartbeat(
                    task_id=task.task_id,
                    note=(
                        "retry_scheduled "
                        f"attempt={attempt_count + 1}/{max_attempts} "
                        f"reason={(bridge_result.error or 'unknown')[:160]}"
                    ),
                )
            if not bridge_result.ok:
                self._memory_service.touch_task_heartbeat(
                    task_id=task.task_id,
                    note=f"execution_failed attempts={attempt_count}/{max_attempts}",
                )

            execution_duration_ms = max(int((monotonic() - execution_started_at) * 1000), 0)
            evidence_structured = self._build_execution_evidence(
                trace_id=context.trace_id or None,
                route_model=decision.route_model,
                bridge_ok=bridge_result.ok,
                bridge_error=bridge_result.error,
                execution_reply=execution_reply,
                quality_score=quality_score,
                quality_issues=quality_issues,
                correction_applied=correction_applied,
                execution_duration_ms=execution_duration_ms,
                yyos_snapshot=yyos_snapshot,
            )
            evidence_structured.append(
                {
                    "type": "execution_attempts",
                    "value": {"used": attempt_count, "max": max_attempts, "resumed": resumed},
                    "source": "brain",
                }
            )
            decision.execution_duration_ms = execution_duration_ms
            decision.evidence_structured = evidence_structured
            task_status = "failed"
            if bridge_result.ok:
                task_status = "completed"
                if quality_score is not None and quality_score < 0.67:
                    task_status = "completed_with_warnings"
                self._memory_service.update_task_record(
                    task_id=task.task_id,
                    status=task_status,
                    executor_reply=execution_reply,
                    evidence=[
                        f"trace:{context.trace_id}",
                        f"route_model:{decision.route_model}",
                    ],
                    evidence_structured=evidence_structured,
                    execution_duration_ms=execution_duration_ms,
                    quality_score=quality_score,
                    quality_issues=quality_issues,
                    correction_applied=correction_applied,
                    strategy_cards_used=decision.strategy_cards,
                    execution_attempts=attempt_count,
                    max_attempts=max_attempts,
                    resume_count=task.resume_count,
                )
            else:
                self._memory_service.update_task_record(
                    task_id=task.task_id,
                    status="failed",
                    executor_error=bridge_result.error,
                    evidence=[
                        f"trace:{context.trace_id}",
                        f"route_model:{decision.route_model}",
                    ],
                    evidence_structured=evidence_structured,
                    execution_duration_ms=execution_duration_ms,
                    quality_score=quality_score,
                    quality_issues=quality_issues,
                    correction_applied=correction_applied,
                    strategy_cards_used=decision.strategy_cards,
                    execution_attempts=attempt_count,
                    max_attempts=max_attempts,
                    resume_count=task.resume_count,
                )
            logger.info(
                "task_ledger_updated trace_id=%s task_id=%s status=%s attempts=%s/%s resumed=%s",
                context.trace_id,
                task.task_id,
                task_status if bridge_result.ok else "failed",
                attempt_count,
                max_attempts,
                resumed,
            )
            refs = "\n".join(f"- {item}" for item in references)
            steps = "\n".join(plan_steps)
            checks = "\n".join(f"- {item}" for item in verification_checks)
            rollback = "\n".join(f"- {item}" for item in rollback_template)
            relevant_memories = context_pack["relevant_memories"][:3]
            memory_context = (
                "\n上下文记忆：\n"
                + "\n".join(
                    f"- ({item['source']}:{item['score']}) {item['text']}"
                    for item in relevant_memories
                )
                if relevant_memories
                else "\n上下文记忆：\n- 暂无历史关键点。"
            )
            strategy_context = (
                "\n策略卡：\n"
                + "\n".join(
                    f"- {item.get('title', '策略卡')} (confidence={item.get('confidence', 0)})"
                    for item in strategy_cards
                )
                if strategy_cards
                else "\n策略卡：\n- 当前暂无可复用策略卡。"
            )
            strategy_brief = ""
            if context.channel == Channel.DINGTALK:
                strategy_brief = self._build_strategy_brief(strategy_cards=strategy_cards)
            learning_context = (
                "\n学习建议：\n" + "\n".join(f"- {item}" for item in learning_hints)
                if learning_hints
                else "\n学习建议：\n- 当前暂无可复用经验。"
            )
            quality_context = ""
            if quality_score is not None:
                issues = "、".join(quality_issues) if quality_issues else "none"
                quality_context = (
                    f"\n执行质量评分：{quality_score}"
                    f"\n执行质量问题：{issues}"
                    f"\n执行质量纠偏：{'已纠偏' if correction_applied else '未纠偏'}"
                )
            execution_retry_context = f"\n执行尝试：{attempt_count}/{max_attempts}"
            if resumed:
                execution_retry_context += f"\n任务恢复：已复用 task_id={task.task_id}"
            yyos_context = self._build_yyos_context(snapshot=yyos_snapshot)
            if bridge_result.ok and execution_reply:
                execution = f"\n执行器反馈：\n{execution_reply}"
            elif bridge_result.error:
                execution = f"\n执行器反馈：执行器暂不可用（{bridge_result.error}），先输出计划。"
            else:
                execution = "\n执行器反馈：当前未接入 OpenClaw bridge，先输出计划。"
            return (
                f"收到，{name}。我会按 SOP 先规划再执行。\n"
                f"任务台账ID：{task.task_id}\n"
                f"Trace ID：{context.trace_id or 'n/a'}\n"
                f"推荐模型：{decision.route_model}\n"
                f"执行步骤：\n{steps}\n"
                f"参考资料：\n{refs}"
                f"{memory_context}"
                f"{strategy_context}"
                f"{strategy_brief}"
                f"{learning_context}"
                f"{yyos_context}"
                f"{quality_context}"
                f"{execution_retry_context}"
                f"\n验收清单：\n{checks}"
                f"\n回滚模板：\n{rollback}"
                f"{execution}"
                f"{_TASK_REPLY_FEEDBACK_HINT}"
            )

        bridge_result = self._call_openclaw(
            context=context,
            message=message,
            route_model=decision.route_model,
        )
        if bridge_result.ok and bridge_result.reply:
            return f"{name}，{bridge_result.reply}"

        model_reply = self._chat_service.reply(message)
        if model_reply.startswith("[echo] "):
            model_reply = model_reply[7:]
        return f"{name}，我收到了：{model_reply}"

    def _build_strategy_brief(self, *, strategy_cards: list[dict[str, object]]) -> str:
        if not strategy_cards:
            return "\n本次采用策略：暂无（冷启动阶段）。"
        selected = strategy_cards[0]
        title = str(
            selected.get("title")
            or selected.get("card_id")
            or selected.get("tag")
            or "未命名策略"
        )
        confidence = self._safe_float(selected.get("confidence"), default=0.0)
        performance_score = self._safe_float(selected.get("performance_score"), default=0.0)
        return (
            "\n本次采用策略："
            f"{title}（置信度 {confidence:.2f}，表现分 {performance_score:.2f}）"
        )

    def _route_with_yyos(self, *, message: str, project_key: str) -> YYOSRoutingSnapshot:
        if self._yyos_orchestrator is None:
            return YYOSRoutingSnapshot(enabled=False, ok=False, error="not_configured")
        return self._yyos_orchestrator.route(request_text=message, project=project_key)

    def _build_yyos_context(self, *, snapshot: YYOSRoutingSnapshot) -> str:
        if not snapshot.enabled:
            return "\nYYOS 编排：未启用。"
        if not snapshot.ok:
            return f"\nYYOS 编排：不可用（{snapshot.error or 'unknown'}）。"
        confidence_text = (
            f"{snapshot.confidence:.2f}" if isinstance(snapshot.confidence, float) else "n/a"
        )
        skills = "、".join(snapshot.recommended_skills or []) or "none"
        return (
            "\nYYOS 编排："
            f"stage={snapshot.stage or 'n/a'}，"
            f"risk={snapshot.risk_level or 'n/a'}，"
            f"decision={snapshot.decision or 'n/a'}，"
            f"confidence={confidence_text}，"
            f"skills={skills}"
        )

    def _resolve_feedback_target(
        self,
        *,
        message: str,
        conversation_id: str,
        user_id: str,
        channel: str,
        trusted: bool,
        scope: str,
    ) -> FeedbackBindingResolution:
        primary = self._resolve_feedback_target_once(
            message=message,
            conversation_id=conversation_id,
            user_id=user_id,
            channel=channel,
            trusted=trusted,
            scope=scope,
            max_age_hours=72.0,
            include_planned=False,
        )
        if primary.task_id is not None:
            return primary

        retry = self._resolve_feedback_target_once(
            message=message,
            conversation_id=conversation_id,
            user_id=user_id,
            channel=channel,
            trusted=trusted,
            scope=scope,
            max_age_hours=0.5,
            include_planned=True,
        )
        if retry.task_id is not None:
            return FeedbackBindingResolution(
                task_id=retry.task_id,
                source=f"{retry.source}_short_retry",
            )

        reasons = [item for item in [primary.failure_reason, retry.failure_reason] if item]
        if channel == Channel.DINGTALK.value and scope == ChatScope.PRIVATE.value:
            long_window = self._resolve_feedback_target_once(
                message=message,
                conversation_id=conversation_id,
                user_id=user_id,
                channel=channel,
                trusted=trusted,
                scope=scope,
                max_age_hours=168.0,
                include_planned=False,
            )
            if long_window.task_id is not None:
                return FeedbackBindingResolution(
                    task_id=long_window.task_id,
                    source=f"{long_window.source}_long_window",
                )
            if long_window.failure_reason:
                reasons.append(long_window.failure_reason)

        return FeedbackBindingResolution(
            task_id=None,
            source="not_found",
            failure_reason="|".join(reasons) if reasons else "unknown",
        )

    def _resolve_feedback_target_once(
        self,
        *,
        message: str,
        conversation_id: str,
        user_id: str,
        channel: str,
        trusted: bool,
        scope: str,
        max_age_hours: float,
        include_planned: bool,
    ) -> FeedbackBindingResolution:
        reasons: list[str] = []
        hint = extract_task_id_hint(message)
        if hint is not None:
            record = self._memory_service.get_task_record(task_id=hint)
            hint_max_age_hours = max(max_age_hours, 336.0)
            if record is None:
                reasons.append("hint_not_found")
            elif not self._feedback_status_allows_binding(
                record.status,
                include_planned=include_planned,
            ):
                reasons.append("hint_status_filtered")
            elif not self._is_recent_feedback_target(
                record.updated_at,
                max_age_hours=hint_max_age_hours,
            ):
                reasons.append("hint_not_recent")
            else:
                if record.user_id == user_id:
                    return FeedbackBindingResolution(task_id=record.task_id, source="hint_user")
                if trusted and record.channel == channel:
                    return FeedbackBindingResolution(
                        task_id=record.task_id,
                        source="hint_trusted_channel",
                    )
                if record.user_id != user_id and not trusted:
                    reasons.append("hint_user_mismatch")

        # Fallback: use the latest task in current conversation for the same user.
        recent = self._memory_service.recent_tasks(conversation_id=conversation_id, limit=20)
        has_recent_conversation_task = False
        for item in reversed(recent):
            if item.user_id != user_id:
                continue
            if not self._feedback_status_allows_binding(
                item.status,
                include_planned=include_planned,
            ):
                continue
            if not self._is_recent_feedback_target(item.updated_at, max_age_hours=max_age_hours):
                continue
            has_recent_conversation_task = True
            return FeedbackBindingResolution(
                task_id=item.task_id,
                source="conversation_user_recent",
            )
        if not has_recent_conversation_task:
            reasons.append("conversation_user_recent_not_found")

        # Fallback across conversations for same user/channel.
        recent_user_tasks = self._memory_service.recent_tasks_for_user(
            user_id=user_id,
            channel=channel,
            limit=30,
        )
        has_recent_user_task = False
        for item in reversed(recent_user_tasks):
            if not self._feedback_status_allows_binding(
                item.status,
                include_planned=include_planned,
            ):
                continue
            if not self._is_recent_feedback_target(item.updated_at, max_age_hours=max_age_hours):
                continue
            has_recent_user_task = True
            return FeedbackBindingResolution(task_id=item.task_id, source="user_channel_recent")
        if not has_recent_user_task:
            reasons.append("user_channel_recent_not_found")

        if channel == Channel.DINGTALK.value:
            relaxed_candidates: list[str] = []
            for item in reversed(recent):
                if not self._feedback_status_allows_binding(
                    item.status,
                    include_planned=include_planned,
                ):
                    continue
                if not self._is_recent_feedback_target(
                    item.updated_at,
                    max_age_hours=max_age_hours,
                ):
                    continue
                relaxed_candidates.append(item.task_id)
            if scope == ChatScope.PRIVATE.value and relaxed_candidates:
                return FeedbackBindingResolution(
                    task_id=relaxed_candidates[0],
                    source="conversation_private_relaxed",
                )
            if scope != ChatScope.PRIVATE.value and len(relaxed_candidates) == 1:
                return FeedbackBindingResolution(
                    task_id=relaxed_candidates[0],
                    source="conversation_relaxed_single_candidate",
                )
            if not relaxed_candidates:
                reasons.append("conversation_private_relaxed_not_found")

        if trusted:
            # For trusted operators in shared chats, allow binding to recent channel tasks.
            has_recent_conversation_task = False
            for item in reversed(recent):
                if not self._feedback_status_allows_binding(
                    item.status,
                    include_planned=include_planned,
                ):
                    continue
                if not self._is_recent_feedback_target(
                    item.updated_at,
                    max_age_hours=max_age_hours,
                ):
                    continue
                has_recent_conversation_task = True
                return FeedbackBindingResolution(
                    task_id=item.task_id,
                    source="trusted_conversation_recent",
                )
            if not has_recent_conversation_task:
                reasons.append("trusted_conversation_recent_not_found")

            recent_channel_tasks = self._memory_service.recent_tasks_for_channel(
                channel=channel,
                limit=50,
            )
            has_recent_channel_task = False
            for item in reversed(recent_channel_tasks):
                if not self._feedback_status_allows_binding(
                    item.status,
                    include_planned=include_planned,
                ):
                    continue
                if not self._is_recent_feedback_target(
                    item.updated_at,
                    max_age_hours=max_age_hours,
                ):
                    continue
                has_recent_channel_task = True
                return FeedbackBindingResolution(
                    task_id=item.task_id,
                    source="trusted_channel_recent",
                )
            if not has_recent_channel_task:
                reasons.append("trusted_channel_recent_not_found")
        return FeedbackBindingResolution(
            task_id=None,
            source="not_found",
            failure_reason="|".join(reasons) if reasons else "unknown",
        )

    def _feedback_status_allows_binding(self, status: str, *, include_planned: bool) -> bool:
        normalized = (status or "").strip().lower()
        if normalized == "planned" and not include_planned:
            return False
        return True

    def _log_feedback_binding_audit(
        self,
        *,
        context: DialogueContext,
        feedback: str | None,
        resolution: FeedbackBindingResolution,
    ) -> None:
        logger.info(
            "feedback_binding_audit trace_id=%s conversation_id=%s user_id=%s channel=%s "
            "feedback=%s source=%s task_id=%s failure_reason=%s",
            context.trace_id,
            context.conversation_id,
            context.user_id,
            context.channel.value,
            feedback,
            resolution.source,
            resolution.task_id,
            resolution.failure_reason,
        )

    def _is_recent_feedback_target(self, updated_at: datetime, max_age_hours: float = 72.0) -> bool:
        age_hours = max((datetime.now(UTC) - updated_at).total_seconds() / 3600.0, 0.0)
        if age_hours > max_age_hours:
            return False
        return True

    def _normalize_feedback_note(self, message: str) -> str:
        cleaned = _TASK_ID_STRIP_PATTERN.sub(" ", message or "")
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
        return cleaned or message.strip()

    def _build_feedback_not_found_reply(
        self,
        *,
        conversation_id: str,
        user_id: str,
        channel: str,
        failure_reason: str | None,
    ) -> str:
        platform = "钉钉里" if channel == "dingtalk" else "会话里"
        recent = self._memory_service.recent_tasks(conversation_id=conversation_id, limit=5)
        has_recent_visible_task = any(
            item.user_id == user_id
            and self._is_recent_feedback_target(item.updated_at, max_age_hours=24.0)
            for item in recent
        )
        if has_recent_visible_task:
            return (
                f"我没成功绑定这次反馈。请在{platform}对目标任务消息点“回复”，"
                "然后只发“这次很好”或“这次不好”，不需要手输 task_id。"
            )
        guidance = (
            "我没找到可反馈的最近任务。请先发一个任务请求，"
            "或直接回复我上一条任务结果消息再发“这次很好/这次不好”。"
            "你也可以直接发“反馈上一条：好/不好”，不需要 task_id。"
        )
        if failure_reason:
            return f"{guidance}\n绑定诊断：{failure_reason}"
        return guidance

    def _format_feedback_binding_reason(self, *, source: str) -> str:
        if not self._feedback_binding_explain_enabled:
            return ""
        return _FEEDBACK_BINDING_SOURCE_TEXT.get(source, source)

    def _build_execution_evidence(
        self,
        *,
        trace_id: str | None,
        route_model: str,
        bridge_ok: bool,
        bridge_error: str | None,
        execution_reply: str | None,
        quality_score: float | None,
        quality_issues: list[str],
        correction_applied: bool,
        execution_duration_ms: int,
        yyos_snapshot: YYOSRoutingSnapshot,
    ) -> list[dict[str, object]]:
        evidence: list[dict[str, object]] = [
            {"type": "route_model", "value": route_model, "source": "brain"},
            {
                "type": "execution_outcome",
                "value": "ok" if bridge_ok else "failed",
                "source": "openclaw_adapter",
            },
            {
                "type": "execution_duration_ms",
                "value": execution_duration_ms,
                "source": "brain",
            },
        ]
        if trace_id:
            evidence.append({"type": "trace_id", "value": trace_id, "source": "request"})
        if bridge_error:
            evidence.append(
                {
                    "type": "executor_error",
                    "value": bridge_error[:300],
                    "source": "openclaw_adapter",
                }
            )
        if execution_reply:
            evidence.append(
                {
                    "type": "executor_reply_summary",
                    "value": execution_reply.strip()[:300],
                    "source": "openclaw_adapter",
                }
            )
        if quality_score is not None:
            evidence.append(
                {
                    "type": "execution_quality_score",
                    "value": round(float(quality_score), 4),
                    "source": "quality_guard",
                }
            )
        if quality_issues:
            evidence.append(
                {
                    "type": "execution_quality_issues",
                    "value": " | ".join(quality_issues)[:500],
                    "source": "quality_guard",
                }
            )
        if correction_applied:
            evidence.append(
                {
                    "type": "execution_correction",
                    "value": "applied",
                    "source": "quality_guard",
                }
            )
        if yyos_snapshot.enabled:
            if yyos_snapshot.ok:
                evidence.append(
                    {
                        "type": "yyos_routing",
                        "value": {
                            "stage": yyos_snapshot.stage,
                            "risk_level": yyos_snapshot.risk_level,
                            "decision": yyos_snapshot.decision,
                            "confidence": yyos_snapshot.confidence,
                            "recommended_skills": yyos_snapshot.recommended_skills or [],
                            "duration_ms": yyos_snapshot.duration_ms,
                        },
                        "source": "yyos",
                    }
                )
            else:
                evidence.append(
                    {
                        "type": "yyos_routing_error",
                        "value": yyos_snapshot.error or "unknown",
                        "source": "yyos",
                    }
                )
        return evidence

    def _looks_like_resume_request(self, message: str) -> bool:
        normalized = (message or "").strip().lower()
        if not normalized:
            return False
        return any(token in normalized for token in _TASK_RESUME_TOKENS)

    def _is_retryable_task_error(self, error: str | None) -> bool:
        normalized = (error or "").strip().lower()
        if not normalized:
            return False
        return any(token in normalized for token in _TASK_RETRYABLE_ERROR_TOKENS)

    def _call_openclaw(
        self,
        *,
        context: DialogueContext,
        message: str,
        route_model: str,
    ) -> OpenClawAdapterResult:
        result = self._openclaw_adapter.generate_reply(
            user_id=context.user_id,
            conversation_id=context.conversation_id,
            message=message,
            route_model=route_model,
            channel=context.channel.value,
            trace_id=context.trace_id or None,
        )
        return result

    def _safe_float(self, value: object, *, default: float) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default
