from pathlib import Path

from app.intelligence.memory import MemoryService


def test_team_task_meta_extra_fields_persist_after_reload(tmp_path: Path) -> None:
    storage = tmp_path / "memory.json"
    service = MemoryService(storage_path=str(storage))

    service.upsert_team_task_meta(
        task_id="task_001",
        owner_role="CTO",
        title="title",
        objective="objective",
        status="running",
        extra_fields={"rework_count": 1, "last_rework_reason": "missing_evidence"},
    )

    reloaded = MemoryService(storage_path=str(storage))
    meta = reloaded.get_team_task_meta(task_id="task_001") or {}

    assert meta.get("rework_count") == 1
    assert meta.get("last_rework_reason") == "missing_evidence"


def test_task_lease_acquire_refresh_release(tmp_path: Path) -> None:
    storage = tmp_path / "memory_lease.json"
    service = MemoryService(storage_path=str(storage))

    first = service.acquire_task_lease(task_id="task_lease", holder="worker_a", ttl_sec=120)
    assert first["acquired"] is True

    second = service.acquire_task_lease(task_id="task_lease", holder="worker_b", ttl_sec=120)
    assert second["acquired"] is False
    assert second.get("reason") == "lease_held_by_other"

    refreshed = service.refresh_task_lease(task_id="task_lease", holder="worker_a", ttl_sec=180)
    assert refreshed is True

    released = service.release_task_lease(task_id="task_lease", holder="worker_a")
    assert released is True

    third = service.acquire_task_lease(task_id="task_lease", holder="worker_b", ttl_sec=120)
    assert third["acquired"] is True


def test_task_record_persists_agent_scope(tmp_path: Path) -> None:
    storage = tmp_path / "memory_agent_scope.json"
    service = MemoryService(storage_path=str(storage))
    created = service.create_task_record(
        conversation_id="api:writer:u1",
        user_id="u1",
        channel="feishu",
        project_key="proj_writer",
        agent_id="writer",
        memory_scope="agent:writer",
        trace_id="trace_writer_1",
        request_text="请写一篇稿子",
        route_model="yoyoo-ceo/team",
        plan_steps=["dispatch"],
        verification_checks=["evidence"],
        rollback_template=["rollback"],
    )
    assert created.agent_id == "writer"
    assert created.memory_scope == "agent:writer"

    reloaded = MemoryService(storage_path=str(storage))
    record = reloaded.get_task_record(task_id=created.task_id)
    assert record is not None
    assert record.agent_id == "writer"
    assert record.memory_scope == "agent:writer"

    writer_tasks = reloaded.recent_tasks_for_user(user_id="u1", channel="feishu", agent_id="writer")
    ceo_tasks = reloaded.recent_tasks_for_user(user_id="u1", channel="feishu", agent_id="ceo")
    assert len(writer_tasks) == 1
    assert len(ceo_tasks) == 0
