#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _bootstrap_path() -> None:
    root_dir = Path(__file__).resolve().parents[1]
    if str(root_dir) not in sys.path:
        sys.path.insert(0, str(root_dir))


_bootstrap_path()


def run_memory_maintenance(
    *,
    memory_file: Path,
    archive_dir: Path,
    report_dir: Path,
    keep_days: int,
    window_hours: float,
    dry_run: bool,
) -> dict[str, Any]:
    from app.intelligence.memory import MemoryService
    from app.intelligence.memory_archive import archive_memory_file
    from scripts.daily_eval_and_rebalance import run_daily_eval

    memory_before = MemoryService(storage_path=str(memory_file))
    before_snapshot = memory_before.ops_health_snapshot()

    archive_summary: dict[str, Any] = {
        "archive_file": None,
        "archived_task_count": 0,
        "remaining_task_count": before_snapshot.get("task_total", 0),
        "pruned_external_map_count": 0,
        "executed": False,
    }
    if not dry_run:
        archive_result = archive_memory_file(
            memory_file=str(memory_file),
            archive_dir=str(archive_dir),
            keep_days=keep_days,
        )
        archive_summary = {
            "archive_file": archive_result.archive_file,
            "archived_task_count": archive_result.archived_task_count,
            "remaining_task_count": archive_result.remaining_task_count,
            "pruned_external_map_count": archive_result.pruned_external_map_count,
            "executed": True,
        }

    daily_eval_result = run_daily_eval(
        memory_file=memory_file,
        report_dir=report_dir,
        window_hours=window_hours,
        min_task_success_rate=0.60,
        min_strategy_hit_rate=0.55,
        max_low_performance_rate=0.35,
        min_feedback_binding_success_rate=0.85,
        min_feedback_binding_attempts=20,
        dry_run=dry_run,
    )

    memory_after = MemoryService(storage_path=str(memory_file))
    after_snapshot = memory_after.ops_health_snapshot()
    result = {
        "timestamp": datetime.now(UTC).isoformat(),
        "memory_file": str(memory_file),
        "archive_dir": str(archive_dir),
        "report_dir": str(report_dir),
        "keep_days": keep_days,
        "window_hours": window_hours,
        "dry_run": dry_run,
        "archive": archive_summary,
        "daily_eval": daily_eval_result,
        "memory_before": {
            "task_total": before_snapshot.get("task_total"),
            "feedback_pending": before_snapshot.get("feedback_pending"),
            "memory_quality": before_snapshot.get("memory_quality"),
        },
        "memory_after": {
            "task_total": after_snapshot.get("task_total"),
            "feedback_pending": after_snapshot.get("feedback_pending"),
            "memory_quality": after_snapshot.get("memory_quality"),
        },
    }
    if not dry_run:
        report_dir.mkdir(parents=True, exist_ok=True)
        report_file = report_dir / f"memory_maintenance_{datetime.now(UTC).strftime('%Y%m%d')}.json"
        report_file.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        result["report_file"] = str(report_file)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run Yoyoo memory maintenance: archive + daily eval + strategy rebalance"
    )
    parser.add_argument(
        "--memory-file",
        default="./data/yoyoo_memory.json",
        help="Path to yoyoo_memory.json",
    )
    parser.add_argument(
        "--archive-dir",
        default="./data/archive",
        help="Directory for memory archive snapshots",
    )
    parser.add_argument(
        "--report-dir",
        default="./data/reports",
        help="Directory for maintenance reports",
    )
    parser.add_argument("--keep-days", type=int, default=14)
    parser.add_argument("--window-hours", type=float, default=24.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = run_memory_maintenance(
        memory_file=Path(args.memory_file),
        archive_dir=Path(args.archive_dir),
        report_dir=Path(args.report_dir),
        keep_days=int(args.keep_days),
        window_hours=float(args.window_hours),
        dry_run=bool(args.dry_run),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
