from __future__ import annotations

import json
import os
import shutil
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

_TERMINAL_TASK_STATUSES = {"completed", "completed_with_warnings", "failed", "timeout"}


@dataclass(frozen=True)
class ArchiveResult:
    archive_file: str | None
    archived_task_count: int
    remaining_task_count: int
    pruned_external_map_count: int


def archive_memory_file(
    *,
    memory_file: str,
    archive_dir: str,
    keep_days: int = 14,
    now: datetime | None = None,
) -> ArchiveResult:
    if keep_days < 1:
        raise ValueError("keep_days must be >= 1")
    if not os.path.exists(memory_file):
        return ArchiveResult(
            archive_file=None,
            archived_task_count=0,
            remaining_task_count=0,
            pruned_external_map_count=0,
        )

    payload = _read_json(memory_file)
    if not isinstance(payload, dict):
        return ArchiveResult(
            archive_file=None,
            archived_task_count=0,
            remaining_task_count=0,
            pruned_external_map_count=0,
        )

    now_dt = now or datetime.now(UTC)
    cutoff = now_dt - timedelta(days=keep_days)
    tasks = payload.get("tasks")
    if not isinstance(tasks, dict):
        tasks = {}

    archived_task_ids: set[str] = set()
    archived_task_items: list[dict[str, Any]] = []
    for task_id, item in tasks.items():
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "").strip().lower()
        updated_at = _parse_datetime(item.get("updated_at"))
        if status not in _TERMINAL_TASK_STATUSES:
            continue
        if updated_at is None or updated_at >= cutoff:
            continue
        task_id_text = str(task_id).strip()
        if not task_id_text:
            continue
        archived_task_ids.add(task_id_text)
        archived_task_items.append(
            {
                "task_id": task_id_text,
                "conversation_id": str(item.get("conversation_id") or ""),
                "user_id": str(item.get("user_id") or ""),
                "channel": str(item.get("channel") or ""),
                "project_key": str(item.get("project_key") or ""),
                "status": str(item.get("status") or ""),
                "request_text": str(item.get("request_text") or ""),
                "route_model": str(item.get("route_model") or ""),
                "quality_score": item.get("quality_score"),
                "quality_issues": list(item.get("quality_issues") or []),
                "strategy_cards_used": list(item.get("strategy_cards_used") or []),
                "human_feedback": item.get("human_feedback"),
                "created_at": item.get("created_at"),
                "updated_at": item.get("updated_at"),
            }
        )

    if not archived_task_ids:
        return ArchiveResult(
            archive_file=None,
            archived_task_count=0,
            remaining_task_count=len(tasks),
            pruned_external_map_count=0,
        )

    strategy_cards = payload.get("strategy_cards")
    if not isinstance(strategy_cards, dict):
        strategy_cards = {}
    referenced_card_ids = {
        str(card_id)
        for task in archived_task_items
        for card_id in task.get("strategy_cards_used", [])
        if isinstance(card_id, str) and card_id.strip()
    }
    strategy_cards_snapshot = {
        card_id: strategy_cards[card_id]
        for card_id in sorted(referenced_card_ids)
        if card_id in strategy_cards
    }

    archive_payload = {
        "generated_at": now_dt.isoformat(),
        "source_memory_file": memory_file,
        "keep_days": keep_days,
        "archived_task_count": len(archived_task_items),
        "archived_tasks": archived_task_items,
        "strategy_cards_snapshot": strategy_cards_snapshot,
    }
    os.makedirs(archive_dir, exist_ok=True)
    ts = now_dt.strftime("%Y%m%d_%H%M%S")
    archive_file = os.path.join(archive_dir, f"yoyoo_memory_archive_{ts}.json")
    _write_json_atomic(path=archive_file, payload=archive_payload, backup=False)

    compacted_tasks = {k: v for k, v in tasks.items() if str(k) not in archived_task_ids}
    payload["tasks"] = compacted_tasks

    conversation_tasks = payload.get("conversation_tasks")
    if isinstance(conversation_tasks, dict):
        compacted_conversation_tasks: dict[str, list[str]] = {}
        for conversation_id, items in conversation_tasks.items():
            if not isinstance(items, list):
                continue
            remaining = [str(item) for item in items if str(item) in compacted_tasks]
            if remaining:
                compacted_conversation_tasks[str(conversation_id)] = remaining
        payload["conversation_tasks"] = compacted_conversation_tasks

    pruned_external_map_count = _prune_external_message_task_map(
        payload=payload,
        archived_task_ids=archived_task_ids,
        cutoff=cutoff,
    )

    _write_json_atomic(path=memory_file, payload=payload, backup=True)
    return ArchiveResult(
        archive_file=archive_file,
        archived_task_count=len(archived_task_items),
        remaining_task_count=len(compacted_tasks),
        pruned_external_map_count=pruned_external_map_count,
    )


def _prune_external_message_task_map(
    *,
    payload: dict[str, Any],
    archived_task_ids: set[str],
    cutoff: datetime,
) -> int:
    data = payload.get("external_message_task_map")
    if not isinstance(data, dict):
        return 0
    retained: dict[str, dict[str, Any]] = {}
    pruned = 0
    for key, item in data.items():
        if not isinstance(item, dict):
            pruned += 1
            continue
        task_id = str(item.get("task_id") or "").strip()
        if not task_id or task_id in archived_task_ids:
            pruned += 1
            continue
        updated_at = _parse_datetime(item.get("updated_at"))
        if updated_at is not None and updated_at < (cutoff - timedelta(days=7)):
            pruned += 1
            continue
        retained[str(key)] = {
            "task_id": task_id,
            "updated_at": str(item.get("updated_at") or ""),
        }
    payload["external_message_task_map"] = retained
    return pruned


def _read_json(path: str) -> dict[str, Any] | None:
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return data


def _write_json_atomic(*, path: str, payload: dict[str, Any], backup: bool) -> None:
    directory = os.path.dirname(path) or "."
    os.makedirs(directory, exist_ok=True)
    timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    if backup and os.path.exists(path):
        backup_path = f"{path}.prearchive.{timestamp}.bak"
        shutil.copy2(path, backup_path)

    fd, temp_path = tempfile.mkstemp(
        prefix=".archive_tmp_",
        suffix=".json",
        dir=directory,
        text=True,
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)


def _parse_datetime(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None
