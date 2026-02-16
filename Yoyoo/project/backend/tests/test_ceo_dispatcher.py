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
    assert card.owner_role == "OPS"
    assert card.status == "running"


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
        role="ENG",
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
        role="QA",
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
        role="OPS",
        stage="executing",
        detail="正在发布镜像并检查健康状态",
        evidence=[TaskEvidence(source="log", content="deploy started")],
    )
    timeline = dispatcher.get_task_timeline(task_id=card.task_id)

    assert progress.ok is True
    assert progress.status == "running"
    assert any(item.get("event") == "dispatched" for item in timeline)
    assert any(item.get("event") == "progress" for item in timeline)
