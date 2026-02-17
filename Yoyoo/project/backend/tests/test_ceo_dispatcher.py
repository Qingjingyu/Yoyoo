from datetime import UTC, datetime, timedelta

from app.intelligence.ceo_dispatcher import CEODispatcher
from app.intelligence.memory import MemoryService
from app.intelligence.team_models import TaskEvidence


def test_ceo_dispatcher_routes_role_and_creates_task() -> None:
    memory = MemoryService()
    dispatcher = CEODispatcher(memory_service=memory)

    card = dispatcher.create_task(
        user_id="u_dispatcher",
        conversation_id="api:u_dispatcher",
        channel="api",
        project_key="general",
        request_text="请部署后端服务并重启",
        trace_id="trace_ceo_dispatch_1",
    )

    assert card.task_id.startswith("task_")
    assert card.owner_role == "CTO"
    assert card.status == "running"
    assert card.eta_minutes == 45


def test_ceo_dispatcher_marks_review_when_evidence_missing() -> None:
    memory = MemoryService()
    dispatcher = CEODispatcher(memory_service=memory)
    card = dispatcher.create_task(
        user_id="u_review",
        conversation_id="api:u_review",
        channel="api",
        project_key="general",
        request_text="请修复一个接口",
        trace_id="trace_ceo_dispatch_2",
    )

    result = dispatcher.accept_result(
        task_id=card.task_id,
        role="CTO",
        reply="修复已完成",
        error=None,
        evidence=[],
    )

    assert result.ok is False
    assert result.status == "review"
    assert "missing_evidence" in result.issues


def test_ceo_dispatcher_accepts_with_evidence_and_syncs_to_ceo_memory() -> None:
    memory = MemoryService()
    dispatcher = CEODispatcher(memory_service=memory)
    card = dispatcher.create_task(
        user_id="u_done",
        conversation_id="api:u_done",
        channel="api",
        project_key="general",
        request_text="请完成测试并提交结果",
        trace_id="trace_ceo_dispatch_3",
    )

    result = dispatcher.accept_result(
        task_id=card.task_id,
        role="CTO",
        reply="全部测试通过",
        error=None,
        evidence=[TaskEvidence(source="pytest", content="42 passed")],
    )
    ceo_records = memory.read_namespace_memory(namespace="memory.ceo", limit=20)

    assert result.ok is True
    assert result.status == "done"
    assert ceo_records
    assert ceo_records[-1]["task_id"] == card.task_id


def test_ceo_dispatcher_progress_is_visible_in_timeline() -> None:
    memory = MemoryService()
    dispatcher = CEODispatcher(memory_service=memory)
    card = dispatcher.create_task(
        user_id="u_progress",
        conversation_id="api:u_progress",
        channel="api",
        project_key="general",
        request_text="请执行一次部署并持续汇报",
        trace_id="trace_ceo_dispatch_4",
    )

    progress = dispatcher.report_progress(
        task_id=card.task_id,
        role="CTO",
        stage="executing",
        detail="正在发布镜像并检查健康状态",
        evidence=[TaskEvidence(source="log", content="deploy started")],
    )
    timeline = dispatcher.get_task_timeline(task_id=card.task_id)

    assert progress.ok is True
    assert progress.status == "running"
    assert any(item.get("event") == "dispatched" for item in timeline)
    assert any(item.get("event") == "progress" for item in timeline)


def test_ceo_dispatcher_rejects_non_cto_progress_and_result() -> None:
    memory = MemoryService()
    dispatcher = CEODispatcher(memory_service=memory)
    card = dispatcher.create_task(
        user_id="u_reject",
        conversation_id="api:u_reject",
        channel="api",
        project_key="general",
        request_text="请执行接口联调",
        trace_id="trace_ceo_dispatch_5",
    )

    progress = dispatcher.report_progress(
        task_id=card.task_id,
        role="OPS",
        stage="executing",
        detail="尝试回报",
        evidence=[],
    )
    result = dispatcher.accept_result(
        task_id=card.task_id,
        role="QA",
        reply="尝试提交",
        error=None,
        evidence=[TaskEvidence(source="log", content="x")],
    )

    assert progress.ok is False
    assert progress.status == "failed"
    assert "CTO" in progress.reply
    assert result.ok is False
    assert result.status == "failed"
    assert "invalid_executor_role" in result.issues


def test_ceo_dispatcher_picks_execution_mode_by_task_complexity() -> None:
    memory = MemoryService()
    dispatcher = CEODispatcher(memory_service=memory)

    short_card = dispatcher.create_task(
        user_id="u_mode_short",
        conversation_id="api:u_mode_short",
        channel="api",
        project_key="general",
        request_text="帮我检查一个接口状态",
        trace_id="trace_mode_short",
    )
    long_card = dispatcher.create_task(
        user_id="u_mode_long",
        conversation_id="api:u_mode_long",
        channel="api",
        project_key="general",
        request_text=(
            "请基于现有服务做企业级重构，包含多阶段规划、架构设计、"
            "长任务执行、发布流程和回归验证，最终给出可回滚方案。"
        ),
        trace_id="trace_mode_long",
    )

    short_meta = memory.get_team_task_meta(task_id=short_card.task_id) or {}
    long_meta = memory.get_team_task_meta(task_id=long_card.task_id) or {}

    assert short_meta.get("execution_mode") == "subagent"
    assert long_meta.get("execution_mode") == "employee_instance"


def test_ceo_dispatcher_watchdog_nudge_and_degrade() -> None:
    memory = MemoryService()
    dispatcher = CEODispatcher(memory_service=memory)
    nudge_card = dispatcher.create_task(
        user_id="u_nudge",
        conversation_id="api:u_nudge",
        channel="api",
        project_key="general",
        request_text="请执行部署任务",
        trace_id="trace_nudge",
    )
    degrade_card = dispatcher.create_task(
        user_id="u_degrade",
        conversation_id="api:u_degrade",
        channel="api",
        project_key="general",
        request_text="请完成一次长期任务",
        trace_id="trace_degrade",
    )

    nudge_record = memory.get_task_record(task_id=nudge_card.task_id)
    degrade_record = memory.get_task_record(task_id=degrade_card.task_id)
    assert nudge_record is not None
    assert degrade_record is not None

    now = datetime.now(UTC)
    nudge_record.updated_at = now - timedelta(seconds=130)
    nudge_record.last_heartbeat_at = now - timedelta(seconds=130)
    degrade_record.updated_at = now - timedelta(seconds=400)
    degrade_record.last_heartbeat_at = now - timedelta(seconds=400)

    result = dispatcher.watchdog_scan(
        stale_progress_sec=90,
        stale_degrade_sec=300,
        max_scan=50,
        min_repeat_sec=30,
    )

    assert result["ok"] is True
    assert result["nudged"] >= 1
    assert result["degraded"] >= 1

    nudge_timeline = dispatcher.get_task_timeline(task_id=nudge_card.task_id)
    degrade_timeline = dispatcher.get_task_timeline(task_id=degrade_card.task_id)
    degrade_latest = memory.get_task_record(task_id=degrade_card.task_id)
    assert degrade_latest is not None

    assert any(item.get("event") == "nudge" for item in nudge_timeline)
    assert any(item.get("event") == "degraded" for item in degrade_timeline)
    assert degrade_latest.status == "failed"
