from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

from scripts.memory_maintenance import run_memory_maintenance


def _write_memory_file(path: Path) -> None:
    old_time = (datetime.now(UTC) - timedelta(days=10)).isoformat()
    payload = {
        "tasks": {
            "task_old_1": {
                "task_id": "task_old_1",
                "conversation_id": "conv_1",
                "user_id": "u_1",
                "channel": "api",
                "project_key": "proj_1",
                "status": "failed",
                "request_text": "部署任务",
                "route_model": "openai/gpt-5.2-codex",
                "created_at": old_time,
                "updated_at": old_time,
                "strategy_cards_used": [],
                "quality_issues": [],
            }
        },
        "conversation_tasks": {"conv_1": ["task_old_1"]},
        "external_message_task_map": {},
        "strategy_cards": {},
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def test_memory_maintenance_dry_run(tmp_path: Path) -> None:
    memory_file = tmp_path / "memory.json"
    archive_dir = tmp_path / "archive"
    report_dir = tmp_path / "reports"
    _write_memory_file(memory_file)

    result = run_memory_maintenance(
        memory_file=memory_file,
        archive_dir=archive_dir,
        report_dir=report_dir,
        keep_days=1,
        window_hours=24.0,
        dry_run=True,
    )

    assert result["dry_run"] is True
    assert result["archive"]["executed"] is False
    assert "daily_eval" in result
    assert "memory_before" in result
    assert "memory_after" in result


def test_memory_maintenance_archive_and_report(tmp_path: Path) -> None:
    memory_file = tmp_path / "memory.json"
    archive_dir = tmp_path / "archive"
    report_dir = tmp_path / "reports"
    _write_memory_file(memory_file)

    result = run_memory_maintenance(
        memory_file=memory_file,
        archive_dir=archive_dir,
        report_dir=report_dir,
        keep_days=1,
        window_hours=24.0,
        dry_run=False,
    )

    assert result["dry_run"] is False
    assert result["archive"]["executed"] is True
    assert result["archive"]["archived_task_count"] == 1
    assert Path(result["report_file"]).exists()

    updated_payload = json.loads(memory_file.read_text(encoding="utf-8"))
    assert updated_payload["tasks"] == {}
