#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _bootstrap_path() -> None:
    root_dir = Path(__file__).resolve().parents[1]
    if str(root_dir) not in sys.path:
        sys.path.insert(0, str(root_dir))


_bootstrap_path()


def _breach(
    *,
    metrics: dict[str, Any],
    min_task_success_rate: float,
    min_strategy_hit_rate: float,
    max_low_performance_rate: float,
    min_feedback_binding_success_rate: float,
    min_feedback_binding_attempts: int,
) -> list[dict[str, Any]]:
    alerts: list[dict[str, Any]] = []
    task_success_rate = metrics.get("task_success_rate")
    if isinstance(task_success_rate, (int, float)) and task_success_rate < min_task_success_rate:
        alerts.append(
            {
                "code": "task_success_rate_low",
                "value": round(float(task_success_rate), 4),
                "threshold": min_task_success_rate,
            }
        )

    strategy_hit_rate = metrics.get("strategy_hit_rate")
    if isinstance(strategy_hit_rate, (int, float)) and strategy_hit_rate < min_strategy_hit_rate:
        alerts.append(
            {
                "code": "strategy_hit_rate_low",
                "value": round(float(strategy_hit_rate), 4),
                "threshold": min_strategy_hit_rate,
            }
        )

    low_perf_rate = metrics.get("strategy_low_performance_rate")
    if isinstance(low_perf_rate, (int, float)) and low_perf_rate > max_low_performance_rate:
        alerts.append(
            {
                "code": "strategy_low_performance_rate_high",
                "value": round(float(low_perf_rate), 4),
                "threshold": max_low_performance_rate,
            }
        )

    fb_attempts = int(metrics.get("feedback_binding_attempt_total") or 0)
    fb_success_rate = metrics.get("feedback_binding_success_rate")
    if (
        fb_attempts >= min_feedback_binding_attempts
        and isinstance(fb_success_rate, (int, float))
        and fb_success_rate < min_feedback_binding_success_rate
    ):
        alerts.append(
            {
                "code": "feedback_binding_success_rate_low",
                "value": round(float(fb_success_rate), 4),
                "threshold": min_feedback_binding_success_rate,
                "attempts": fb_attempts,
            }
        )
    return alerts


def run_daily_eval(
    *,
    memory_file: Path,
    report_dir: Path,
    window_hours: float,
    min_task_success_rate: float,
    min_strategy_hit_rate: float,
    max_low_performance_rate: float,
    min_feedback_binding_success_rate: float,
    min_feedback_binding_attempts: int,
    dry_run: bool,
) -> dict[str, Any]:
    from app.intelligence.memory import MemoryService

    memory = MemoryService(storage_path=str(memory_file))
    metrics = memory.daily_execution_snapshot(window_hours=window_hours)
    breaches = _breach(
        metrics=metrics,
        min_task_success_rate=min_task_success_rate,
        min_strategy_hit_rate=min_strategy_hit_rate,
        max_low_performance_rate=max_low_performance_rate,
        min_feedback_binding_success_rate=min_feedback_binding_success_rate,
        min_feedback_binding_attempts=min_feedback_binding_attempts,
    )
    rebalance = {"changed": False, "scopes_reordered": 0, "cards_demoted": 0, "cards_promoted": 0}
    if breaches and not dry_run:
        rebalance = memory.rebalance_strategy_cards()

    result = {
        "timestamp": datetime.now(UTC).isoformat(),
        "memory_file": str(memory_file),
        "window_hours": window_hours,
        "thresholds": {
            "min_task_success_rate": min_task_success_rate,
            "min_strategy_hit_rate": min_strategy_hit_rate,
            "max_low_performance_rate": max_low_performance_rate,
            "min_feedback_binding_success_rate": min_feedback_binding_success_rate,
            "min_feedback_binding_attempts": min_feedback_binding_attempts,
        },
        "metrics": metrics,
        "breaches": breaches,
        "rebalance": rebalance,
        "dry_run": dry_run,
    }

    if not dry_run:
        report_dir.mkdir(parents=True, exist_ok=True)
        report_file = report_dir / f"daily_eval_{datetime.now(UTC).strftime('%Y%m%d')}.json"
        report_file.write_text(
            json.dumps(result, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        result["report_file"] = str(report_file)
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Daily eval and strategy rebalance for Yoyoo memory"
    )
    parser.add_argument(
        "--memory-file",
        default="./data/yoyoo_memory.json",
        help="Path to yoyoo_memory.json",
    )
    parser.add_argument(
        "--report-dir",
        default="./data/reports",
        help="Directory for daily evaluation reports",
    )
    parser.add_argument("--window-hours", type=float, default=24.0)
    parser.add_argument(
        "--min-task-success-rate",
        type=float,
        default=float(os.getenv("YOYOO_EVAL_MIN_TASK_SUCCESS_RATE", "0.60")),
    )
    parser.add_argument(
        "--min-strategy-hit-rate",
        type=float,
        default=float(os.getenv("YOYOO_EVAL_MIN_STRATEGY_HIT_RATE", "0.55")),
    )
    parser.add_argument(
        "--max-low-performance-rate",
        type=float,
        default=float(os.getenv("YOYOO_ALERT_MEMORY_MAX_LOW_PERFORMANCE_RATE", "0.35")),
    )
    parser.add_argument(
        "--min-feedback-binding-success-rate",
        type=float,
        default=float(os.getenv("YOYOO_ALERT_FEEDBACK_MIN_SUCCESS_RATE", "0.85")),
    )
    parser.add_argument(
        "--min-feedback-binding-attempts",
        type=int,
        default=int(os.getenv("YOYOO_ALERT_FEEDBACK_MIN_ATTEMPTS", "20")),
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    result = run_daily_eval(
        memory_file=Path(args.memory_file),
        report_dir=Path(args.report_dir),
        window_hours=float(args.window_hours),
        min_task_success_rate=float(args.min_task_success_rate),
        min_strategy_hit_rate=float(args.min_strategy_hit_rate),
        max_low_performance_rate=float(args.max_low_performance_rate),
        min_feedback_binding_success_rate=float(args.min_feedback_binding_success_rate),
        min_feedback_binding_attempts=int(args.min_feedback_binding_attempts),
        dry_run=bool(args.dry_run),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
