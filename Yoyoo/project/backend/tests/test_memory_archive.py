import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.intelligence.memory_archive import archive_memory_file


def test_archive_memory_file_compacts_old_terminal_tasks(tmp_path: Path) -> None:
    now = datetime(2026, 2, 7, tzinfo=UTC)
    old_time = (now - timedelta(days=30)).isoformat()
    new_time = (now - timedelta(days=1)).isoformat()

    memory_file = tmp_path / "memory.json"
    payload = {
        "tasks": {
            "task_old_001": {
                "task_id": "task_old_001",
                "conversation_id": "conv_001",
                "user_id": "u_001",
                "channel": "api",
                "project_key": "general",
                "status": "completed",
                "request_text": "old task",
                "route_model": "m",
                "quality_issues": [],
                "strategy_cards_used": ["card_001"],
                "created_at": old_time,
                "updated_at": old_time,
            },
            "task_new_001": {
                "task_id": "task_new_001",
                "conversation_id": "conv_001",
                "user_id": "u_001",
                "channel": "api",
                "project_key": "general",
                "status": "completed",
                "request_text": "new task",
                "route_model": "m",
                "quality_issues": [],
                "strategy_cards_used": ["card_002"],
                "created_at": new_time,
                "updated_at": new_time,
            },
        },
        "conversation_tasks": {"conv_001": ["task_old_001", "task_new_001"]},
        "strategy_cards": {
            "card_001": {"title": "old card", "updated_at": old_time},
            "card_002": {"title": "new card", "updated_at": new_time},
        },
        "external_message_task_map": {
            "dingtalk|conv_001|msg_old": {"task_id": "task_old_001", "updated_at": old_time},
            "dingtalk|conv_001|msg_new": {"task_id": "task_new_001", "updated_at": new_time},
        },
    }
    memory_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    result = archive_memory_file(
        memory_file=str(memory_file),
        archive_dir=str(tmp_path / "archive"),
        keep_days=7,
        now=now,
    )

    assert result.archived_task_count == 1
    assert result.remaining_task_count == 1
    assert result.pruned_external_map_count >= 1
    assert isinstance(result.archive_file, str)
    assert Path(result.archive_file).exists()

    compacted = json.loads(memory_file.read_text(encoding="utf-8"))
    assert "task_old_001" not in compacted["tasks"]
    assert "task_new_001" in compacted["tasks"]
    assert compacted["conversation_tasks"]["conv_001"] == ["task_new_001"]

    archived = json.loads(Path(result.archive_file).read_text(encoding="utf-8"))
    assert archived["archived_task_count"] == 1
    assert archived["archived_tasks"][0]["task_id"] == "task_old_001"
    assert "card_001" in archived["strategy_cards_snapshot"]


def test_archive_memory_file_noop_when_no_old_tasks(tmp_path: Path) -> None:
    now = datetime(2026, 2, 7, tzinfo=UTC)
    new_time = (now - timedelta(days=1)).isoformat()
    memory_file = tmp_path / "memory.json"
    payload = {
        "tasks": {
            "task_new_001": {
                "task_id": "task_new_001",
                "status": "completed",
                "updated_at": new_time,
            }
        }
    }
    memory_file.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    result = archive_memory_file(
        memory_file=str(memory_file),
        archive_dir=str(tmp_path / "archive"),
        keep_days=7,
        now=now,
    )

    assert result.archived_task_count == 0
    assert result.remaining_task_count == 1
    assert result.archive_file is None
