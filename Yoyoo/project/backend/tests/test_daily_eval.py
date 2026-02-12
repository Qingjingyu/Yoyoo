from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

from app.intelligence.memory import MemoryService, StrategyCard


def test_daily_eval_script_triggers_rebalance_and_report(tmp_path: Path) -> None:
    memory_file = tmp_path / "memory.json"
    report_dir = tmp_path / "reports"
    memory = MemoryService(storage_path=str(memory_file), max_events_per_conversation=10)
    scope = "u_daily_eval|api|proj_daily_eval"
    now = datetime.now(UTC)

    low_card = StrategyCard(
        card_id="card_daily_eval_low",
        scope=scope,
        tag="deploy",
        title="[deploy] low",
        summary="low card",
        trigger_tags=["deploy", "task_request"],
        recommended_steps=["low step"],
        cautions=["low caution"],
        evidence_requirements=["low evidence"],
        confidence=0.86,
        source="seed_test",
        created_at=now - timedelta(days=3),
        updated_at=now - timedelta(days=3),
    )
    high_card = StrategyCard(
        card_id="card_daily_eval_high",
        scope=scope,
        tag="deploy",
        title="[deploy] high",
        summary="high card",
        trigger_tags=["deploy", "task_request"],
        recommended_steps=["high step"],
        cautions=["high caution"],
        evidence_requirements=["high evidence"],
        confidence=0.72,
        source="seed_test",
        created_at=now - timedelta(days=1),
        updated_at=now - timedelta(hours=2),
    )
    memory._strategy_cards[low_card.card_id] = low_card
    memory._strategy_cards[high_card.card_id] = high_card
    memory._scope_strategy_cards[scope].append(low_card.card_id)
    memory._scope_strategy_cards[scope].append(high_card.card_id)
    memory._strategy_card_runtime_metrics[low_card.card_id] = {
        "success_total": 0.0,
        "failed_total": 2.0,
        "timeout_total": 2.0,
        "feedback_good": 0.0,
        "feedback_bad": 1.0,
        "last_task_id": "task_low",
        "last_updated": now.isoformat(),
    }
    memory._strategy_card_runtime_metrics[high_card.card_id] = {
        "success_total": 3.0,
        "failed_total": 0.0,
        "timeout_total": 0.0,
        "feedback_good": 1.0,
        "feedback_bad": 0.0,
        "last_task_id": "task_high",
        "last_updated": now.isoformat(),
    }
    task = memory.create_task_record(
        conversation_id="conv_daily_eval",
        user_id="u_daily_eval",
        channel="api",
        project_key="proj_daily_eval",
        trace_id="trace_daily_eval_1",
        request_text="部署任务",
        route_model="openai/gpt-5.2-codex",
        plan_steps=["部署"],
        verification_checks=["检查"],
        rollback_template=["回滚"],
    )
    memory.update_task_record(
        task_id=task.task_id,
        status="failed",
        executor_error="timeout",
    )

    backend_dir = Path(__file__).resolve().parents[1]
    completed = subprocess.run(
        [
            sys.executable,
            str(backend_dir / "scripts" / "daily_eval_and_rebalance.py"),
            "--memory-file",
            str(memory_file),
            "--report-dir",
            str(report_dir),
            "--min-task-success-rate",
            "1.0",
            "--min-strategy-hit-rate",
            "1.0",
            "--max-low-performance-rate",
            "0.0",
            "--min-feedback-binding-attempts",
            "0",
        ],
        check=True,
        cwd=str(backend_dir),
        capture_output=True,
        text=True,
    )
    payload = json.loads(completed.stdout)

    assert payload["breaches"]
    assert payload["rebalance"]["changed"] is True
    report_file = Path(payload["report_file"])
    assert report_file.exists()

    reloaded = MemoryService(storage_path=str(memory_file), max_events_per_conversation=10)
    order = list(reloaded._scope_strategy_cards[scope])
    assert order[0] == "card_daily_eval_high"
