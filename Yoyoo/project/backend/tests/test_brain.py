from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from app.intelligence.brain import YoyooBrain
from app.intelligence.execution_quality import ExecutionQualityGuard
from app.intelligence.memory import MemoryService
from app.intelligence.model_router import ModelRouter
from app.intelligence.models import Channel, ChatScope, DialogueContext
from app.intelligence.planner import TaskPlanner
from app.intelligence.policy_guard import PolicyGuard
from app.intelligence.research_playbook import ResearchPlaybook
from app.intelligence.verification import TaskVerifier
from app.intelligence.yyos_orchestrator import YYOSRoutingSnapshot
from app.services.chat_service import ChatService


@dataclass
class _FakeAdapterResult:
    ok: bool
    reply: str | None = None
    error: str | None = None


class _FakeAdapter:
    def generate_reply(
        self,
        *,
        user_id: str,
        conversation_id: str,
        message: str,
        route_model: str,
        channel: str,
        trace_id: str | None = None,
    ) -> _FakeAdapterResult:
        _ = (user_id, conversation_id, route_model, channel, trace_id)
        if "执行" in message:
            return _FakeAdapterResult(ok=True, reply="已由 OpenClaw 执行并返回。")
        return _FakeAdapterResult(ok=False, error="no_op")


class _LowThenHighQualityAdapter:
    def __init__(self) -> None:
        self.calls: list[str] = []

    def generate_reply(
        self,
        *,
        user_id: str,
        conversation_id: str,
        message: str,
        route_model: str,
        channel: str,
        trace_id: str | None = None,
    ) -> _FakeAdapterResult:
        _ = (user_id, conversation_id, route_model, channel, trace_id)
        self.calls.append(message)
        if len(self.calls) == 1:
            return _FakeAdapterResult(ok=True, reply="请提供更多信息？")
        return _FakeAdapterResult(
            ok=True,
            reply=(
                "执行状态：已完成。下一步命令：python -m pytest -q。"
                "证据采集：日志输出、健康检查结果。回滚提醒：git revert <commit>。"
            ),
        )


class _FakeYYOSOrchestrator:
    def route(self, *, request_text: str, project: str = "default") -> YYOSRoutingSnapshot:
        _ = (request_text, project)
        return YYOSRoutingSnapshot(
            enabled=True,
            ok=True,
            stage="plan",
            confidence=0.88,
            risk_level="medium",
            decision="route_command",
            recommended_skills=["writing-plans", "verification-before-completion"],
            duration_ms=12,
        )


def _build_brain() -> YoyooBrain:
    return YoyooBrain(
        chat_service=ChatService(),
        memory_service=MemoryService(),
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )


def test_brain_uses_openclaw_adapter_for_task() -> None:
    brain = _build_brain()
    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_1",
            conversation_id="c_1",
            channel=Channel.API,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="请执行这个任务并给我结果",
    )

    assert result.decision.intent == "task_request"
    assert result.decision.plan_steps
    assert result.decision.verification_checks
    assert result.decision.rollback_template
    assert "OpenClaw 执行" in result.reply
    assert "反馈方式：直接回复这条消息" in result.reply


def test_brain_task_reply_contains_adapter_error_when_unavailable() -> None:
    brain = _build_brain()
    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_2",
            conversation_id="c_2",
            channel=Channel.API,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="帮我规划一个发布任务",
    )

    assert result.decision.intent == "task_request"
    assert "执行器暂不可用" in result.reply


def test_brain_applies_execution_quality_correction() -> None:
    memory = MemoryService()
    adapter = _LowThenHighQualityAdapter()
    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=adapter,  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )
    trace_id = "trace_quality_001"

    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_quality",
            conversation_id="c_quality",
            channel=Channel.API,
            scope=ChatScope.PRIVATE,
            trace_id=trace_id,
            trusted=True,
        ),
        text="请执行部署任务并给出结果",
    )
    tasks = memory.find_tasks_by_trace(trace_id=trace_id)

    assert result.decision.intent == "task_request"
    assert result.decision.execution_corrected is True
    assert result.decision.execution_quality_score is not None
    assert result.decision.execution_quality_score >= 0.67
    assert len(adapter.calls) == 2
    assert tasks
    assert tasks[0].correction_applied is True
    assert tasks[0].quality_score == result.decision.execution_quality_score


def test_brain_exposes_yyos_routing_metadata() -> None:
    memory = MemoryService()
    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
        yyos_orchestrator=_FakeYYOSOrchestrator(),  # type: ignore[arg-type]
    )

    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_yyos",
            conversation_id="c_yyos",
            channel=Channel.API,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="请执行这个任务并给我结果",
    )

    assert result.decision.intent == "task_request"
    assert result.decision.yyos_stage == "plan"
    assert result.decision.yyos_risk_level == "medium"
    assert result.decision.yyos_decision == "route_command"
    assert result.decision.yyos_recommended_skills == [
        "writing-plans",
        "verification-before-completion",
    ]
    assert "YYOS 编排：stage=plan" in result.reply
    assert isinstance(result.decision.evidence_structured, list)
    assert any(item.get("type") == "yyos_routing" for item in result.decision.evidence_structured)


def test_brain_direct_feedback_updates_latest_task() -> None:
    memory = MemoryService()
    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )

    first = brain.handle_message(
        context=DialogueContext(
            user_id="u_fb",
            conversation_id="c_fb",
            channel=Channel.API,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="请执行这个任务并给我结果",
    )
    assert first.decision.task_id is not None

    second = brain.handle_message(
        context=DialogueContext(
            user_id="u_fb",
            conversation_id="c_fb",
            channel=Channel.API,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="这次做得很好",
    )

    updated = memory.get_task_record(task_id=first.decision.task_id)
    assert second.decision.intent == "task_feedback"
    assert second.decision.task_id == first.decision.task_id
    assert updated is not None
    assert updated.human_feedback == "good"
    assert updated.human_feedback_weight is not None
    assert "绑定依据：同会话最近任务" in second.reply


def test_brain_feedback_falls_back_to_user_recent_task_across_conversations() -> None:
    memory = MemoryService()
    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )

    first = brain.handle_message(
        context=DialogueContext(
            user_id="u_fb2",
            conversation_id="c_fb2_a",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="请执行这个任务并给我结果",
    )
    assert first.decision.task_id is not None

    second = brain.handle_message(
        context=DialogueContext(
            user_id="u_fb2",
            conversation_id="c_fb2_b",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="这次不行",
    )

    updated = memory.get_task_record(task_id=first.decision.task_id)
    assert second.decision.intent == "task_feedback"
    assert second.decision.task_id == first.decision.task_id
    assert updated is not None
    assert updated.human_feedback == "bad"


def test_brain_feedback_without_task_returns_guidance() -> None:
    brain = _build_brain()
    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_none",
            conversation_id="c_none",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="这次不行",
    )

    assert result.decision.intent == "task_feedback"
    assert "我没找到可反馈的最近任务" in result.reply


def test_brain_feedback_short_retry_binds_planned_task() -> None:
    memory = MemoryService()
    seeded = memory.create_task_record(
        conversation_id="c_retry",
        user_id="u_retry",
        channel="dingtalk",
        project_key="proj_retry",
        trace_id="trace_retry",
        request_text="刚创建任务，尚未执行",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["1. 等待执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )

    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_retry",
            conversation_id="c_retry",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="这次不好",
    )

    updated = memory.get_task_record(task_id=seeded.task_id)
    assert result.decision.intent == "task_feedback"
    assert result.decision.task_id == seeded.task_id
    assert updated is not None
    assert updated.human_feedback == "bad"
    assert "绑定依据：短窗口重试命中：同会话刚创建任务" in result.reply


def test_brain_feedback_emits_binding_audit_log(caplog) -> None:  # type: ignore[no-untyped-def]
    caplog.set_level(logging.INFO)
    brain = _build_brain()
    first = brain.handle_message(
        context=DialogueContext(
            user_id="u_audit",
            conversation_id="c_audit",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=True,
            trace_id="trace_audit_task",
        ),
        text="请执行这个任务并给我结果",
    )
    assert isinstance(first.decision.task_id, str)

    caplog.clear()
    second = brain.handle_message(
        context=DialogueContext(
            user_id="u_audit",
            conversation_id="c_audit",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=True,
            trace_id="trace_audit_feedback",
        ),
        text="这次不行",
    )
    assert second.decision.task_id == first.decision.task_id
    assert any(
        "feedback_binding_audit" in item.message
        and "source=conversation_user_recent" in item.message
        and f"task_id={first.decision.task_id}" in item.message
        for item in caplog.records
    )


def test_brain_sets_strategy_id_from_selected_strategy_card() -> None:
    memory = MemoryService()
    first = memory.create_task_record(
        conversation_id="c_strategy_seed",
        user_id="u_strategy",
        channel="api",
        project_key="proj_strategy",
        trace_id="trace_strategy_seed_1",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=first.task_id,
        status="failed",
        executor_error="timeout",
    )
    second = memory.create_task_record(
        conversation_id="c_strategy_seed",
        user_id="u_strategy",
        channel="api",
        project_key="proj_strategy",
        trace_id="trace_strategy_seed_2",
        request_text="继续部署后端服务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=second.task_id,
        status="failed",
        executor_error="timeout",
    )

    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )
    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_strategy",
            conversation_id="c_strategy_live",
            channel=Channel.API,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="继续部署后端服务",
    )

    assert result.decision.intent == "task_request"
    assert result.decision.strategy_cards
    assert result.decision.strategy_id == result.decision.strategy_cards[0]


def test_brain_feedback_trusted_falls_back_to_recent_channel_task() -> None:
    memory = MemoryService()
    seeded = memory.create_task_record(
        conversation_id="c_old",
        user_id="u_old",
        channel="dingtalk",
        project_key="proj_old",
        trace_id="trace_old",
        request_text="部署任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["1. 执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=seeded.task_id,
        status="completed",
        executor_reply="完成",
    )
    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )

    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_new",
            conversation_id="c_new",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=True,
        ),
        text="这次不行",
    )
    updated = memory.get_task_record(task_id=seeded.task_id)

    assert result.decision.intent == "task_feedback"
    assert result.decision.task_id == seeded.task_id
    assert updated is not None
    assert updated.human_feedback == "bad"


def test_brain_feedback_private_dingtalk_relaxed_binding_for_user_drift() -> None:
    memory = MemoryService()
    seeded = memory.create_task_record(
        conversation_id="c_private_drift",
        user_id="u_old_binding",
        channel="dingtalk",
        project_key="proj_private_drift",
        trace_id="trace_private_drift",
        request_text="部署任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["1. 执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=seeded.task_id,
        status="completed",
        executor_reply="完成",
    )
    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )

    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_new_binding",
            conversation_id="c_private_drift",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=False,
        ),
        text="这次不行",
    )
    updated = memory.get_task_record(task_id=seeded.task_id)

    assert result.decision.intent == "task_feedback"
    assert result.decision.task_id == seeded.task_id
    assert "私聊会话兜底" in result.reply
    assert updated is not None
    assert updated.human_feedback == "bad"


def test_brain_feedback_private_dingtalk_uses_long_window_fallback() -> None:
    memory = MemoryService()
    seeded = memory.create_task_record(
        conversation_id="c_private_long_window",
        user_id="u_old_long_window",
        channel="dingtalk",
        project_key="proj_private_long_window",
        trace_id="trace_private_long_window",
        request_text="部署任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["1. 执行"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=seeded.task_id,
        status="completed",
        executor_reply="完成",
    )
    seeded_record = memory.get_task_record(task_id=seeded.task_id)
    assert seeded_record is not None
    seeded_record.updated_at = datetime.now(UTC) - timedelta(hours=80)

    brain = YoyooBrain(
        chat_service=ChatService(),
        memory_service=memory,
        policy_guard=PolicyGuard(),
        model_router=ModelRouter(),
        task_planner=TaskPlanner(playbook=ResearchPlaybook()),
        task_verifier=TaskVerifier(),
        openclaw_adapter=_FakeAdapter(),  # type: ignore[arg-type]
        execution_quality_guard=ExecutionQualityGuard(),
    )

    result = brain.handle_message(
        context=DialogueContext(
            user_id="u_new_long_window",
            conversation_id="c_private_long_window",
            channel=Channel.DINGTALK,
            scope=ChatScope.PRIVATE,
            trusted=False,
        ),
        text="这次不行",
    )
    updated = memory.get_task_record(task_id=seeded.task_id)

    assert result.decision.intent == "task_feedback"
    assert result.decision.task_id == seeded.task_id
    assert "长窗口兜底" in result.reply
    assert updated is not None
    assert updated.human_feedback == "bad"
