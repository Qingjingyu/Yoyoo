from app.intelligence.memory import MemoryService


def test_federated_memory_sync_department_to_ceo() -> None:
    memory = MemoryService()

    result = memory.sync_department_to_ceo(
        role="ENG",
        patch={
            "task_id": "task_20260210120000_abc12345",
            "summary": "代码修复完成",
            "evidence": [{"type": "log", "content": "pytest pass"}],
        },
    )
    dept_records = memory.read_namespace_memory(namespace="memory.dept.eng", limit=5)
    ceo_records = memory.read_namespace_memory(namespace="memory.ceo", limit=5)

    assert result["ok"] is True
    assert result["conflict"] is False
    assert dept_records
    assert ceo_records
    assert ceo_records[-1]["task_id"] == "task_20260210120000_abc12345"


def test_federated_memory_conflict_uses_ceo_authority_and_keeps_snapshot() -> None:
    memory = MemoryService()
    task_id = "task_20260210120000_conflict01"
    memory.sync_department_to_ceo(
        role="ENG",
        patch={"task_id": task_id, "summary": "版本A"},
    )

    result = memory.sync_department_to_ceo(
        role="ENG",
        patch={"task_id": task_id, "summary": "版本B"},
    )
    ceo_records = memory.read_namespace_memory(namespace="memory.ceo", limit=20)
    conflicts = memory.read_namespace_memory(namespace="memory.ceo_conflicts", limit=20)

    latest_for_task = [item for item in ceo_records if item.get("task_id") == task_id][-1]
    assert result["conflict"] is True
    assert latest_for_task["summary"] == "版本A"
    assert conflicts
    assert conflicts[-1]["task_id"] == task_id
