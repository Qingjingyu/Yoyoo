#!/usr/bin/env bash
set -euo pipefail

# Yoyoo task progress watchdog:
# - nudge: if running task has no progress for N seconds
# - degrade: if running task has no progress for M seconds
#
# This script mutates YOYOO_MEMORY_FILE directly (JSON) in an atomic way.

YOYOO_MEMORY_FILE="${YOYOO_MEMORY_FILE:-${YOYOO_BACKEND_MEMORY_FILE:-/root/.openclaw/backend/yoyoo_memory.json}}"
YOYOO_STALE_PROGRESS_SEC="${YOYOO_STALE_PROGRESS_SEC:-90}"
YOYOO_STALE_DEGRADE_SEC="${YOYOO_STALE_DEGRADE_SEC:-300}"
YOYOO_GUARD_ACTOR="${YOYOO_GUARD_ACTOR:-YOYOO_GUARD}"
YOYOO_GUARD_SOURCE="${YOYOO_GUARD_SOURCE:-task_progress_watchdog}"
YOYOO_GUARD_MAX_SCAN="${YOYOO_GUARD_MAX_SCAN:-200}"
YOYOO_GUARD_MIN_REPEAT_SEC="${YOYOO_GUARD_MIN_REPEAT_SEC:-120}"

if [[ ! -f "${YOYOO_MEMORY_FILE}" ]]; then
  echo "[watchdog] memory file not found: ${YOYOO_MEMORY_FILE}"
  exit 0
fi

python3 - "${YOYOO_MEMORY_FILE}" "${YOYOO_STALE_PROGRESS_SEC}" "${YOYOO_STALE_DEGRADE_SEC}" "${YOYOO_GUARD_ACTOR}" "${YOYOO_GUARD_SOURCE}" "${YOYOO_GUARD_MAX_SCAN}" "${YOYOO_GUARD_MIN_REPEAT_SEC}" <<'PY'
from __future__ import annotations

import json
import os
import sys
import tempfile
from datetime import UTC, datetime
from typing import Any


def parse_iso(raw: Any) -> datetime | None:
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    if not s:
        return None
    try:
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=UTC)
        return dt.astimezone(UTC)
    except ValueError:
        return None


def iso_now() -> str:
    return datetime.now(UTC).isoformat()


def latest_guard_event_at(record: dict[str, Any], event_type: str) -> datetime | None:
    events = record.get("evidence_structured")
    if not isinstance(events, list):
        return None
    latest: datetime | None = None
    for item in events:
        if not isinstance(item, dict):
            continue
        if str(item.get("type") or "").strip().lower() != "timeline":
            continue
        if str(item.get("event_type") or "").strip().lower() != event_type:
            continue
        dt = parse_iso(item.get("timestamp"))
        if dt is None:
            continue
        if latest is None or dt > latest:
            latest = dt
    return latest


def append_timeline(record: dict[str, Any], *, actor: str, source: str, event_type: str, stage: str, detail: str) -> None:
    events = record.setdefault("evidence_structured", [])
    if not isinstance(events, list):
        events = []
        record["evidence_structured"] = events
    events.append(
        {
            "type": "timeline",
            "event_type": event_type,
            "actor": actor,
            "role": "CTO",
            "stage": stage,
            "detail": detail,
            "source": source,
            "timestamp": iso_now(),
        }
    )


def save_atomic(path: str, payload: dict[str, Any]) -> None:
    directory = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(prefix=".yoyoo_watchdog_", suffix=".json", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


def main() -> int:
    memory_file = sys.argv[1]
    stale_progress_sec = max(int(sys.argv[2]), 30)
    stale_degrade_sec = max(int(sys.argv[3]), stale_progress_sec + 30)
    actor = (sys.argv[4] or "YOYOO_GUARD").strip()
    source = (sys.argv[5] or "task_progress_watchdog").strip()
    max_scan = max(int(sys.argv[6]), 1)
    min_repeat_sec = max(int(sys.argv[7]), 30)

    with open(memory_file, "r", encoding="utf-8") as handle:
        root = json.load(handle)

    tasks = root.get("tasks")
    if not isinstance(tasks, dict):
        print("[watchdog] no task map, skip")
        return 0

    team_task_meta = root.setdefault("team_task_meta", {})
    if not isinstance(team_task_meta, dict):
        team_task_meta = {}
        root["team_task_meta"] = team_task_meta

    now = datetime.now(UTC)
    changed = False
    nudged = 0
    degraded = 0

    items = list(tasks.items())
    items.sort(key=lambda pair: str((pair[1] or {}).get("updated_at") or ""))
    for task_id, record in items[-max_scan:]:
        if not isinstance(record, dict):
            continue
        status = str(record.get("status") or "").strip().lower()
        if status not in {"running", "in_progress", "planned"}:
            continue

        baseline = (
            parse_iso(record.get("last_heartbeat_at"))
            or parse_iso(record.get("updated_at"))
            or parse_iso(record.get("started_at"))
            or parse_iso(record.get("created_at"))
        )
        if baseline is None:
            continue
        age_sec = max((now - baseline).total_seconds(), 0.0)

        # hard degrade path
        if age_sec >= stale_degrade_sec:
            last_degraded = latest_guard_event_at(record, "degraded")
            if last_degraded and (now - last_degraded).total_seconds() < min_repeat_sec:
                continue
            detail = (
                f"CTO 长时间无进度（{int(age_sec)}秒），已自动降级为 failed，"
                "请 CEO 重新分派或人工接管。"
            )
            append_timeline(
                record,
                actor=actor,
                source=source,
                event_type="degraded",
                stage="blocked",
                detail=detail,
            )
            record["status"] = "failed"
            record["executor_error"] = "auto_degraded_no_progress"
            record["close_reason"] = "auto_degraded_no_progress"
            record["closed_at"] = iso_now()
            record["updated_at"] = iso_now()
            meta = team_task_meta.get(task_id, {})
            if not isinstance(meta, dict):
                meta = {}
            meta["status"] = "failed"
            meta["next_step"] = "任务已自动降级，请 CEO 重新分派或人工接管。"
            meta["updated_at"] = iso_now()
            team_task_meta[task_id] = meta
            changed = True
            degraded += 1
            continue

        # soft nudge path
        if age_sec >= stale_progress_sec:
            last_nudge = latest_guard_event_at(record, "nudge")
            if last_nudge and (now - last_nudge).total_seconds() < min_repeat_sec:
                continue
            detail = (
                f"CTO 超过 {stale_progress_sec} 秒无进度，已自动催办。"
                "请在 90 秒内回报阶段进度。"
            )
            append_timeline(
                record,
                actor=actor,
                source=source,
                event_type="nudge",
                stage="executing",
                detail=detail,
            )
            record["updated_at"] = iso_now()
            meta = team_task_meta.get(task_id, {})
            if not isinstance(meta, dict):
                meta = {}
            if str(meta.get("status") or "").strip().lower() in {"", "pending"}:
                meta["status"] = "running"
            meta["next_step"] = "已自动催办 CTO，请尽快回报阶段进度。"
            meta["updated_at"] = iso_now()
            team_task_meta[task_id] = meta
            changed = True
            nudged += 1

    if changed:
        save_atomic(memory_file, root)
    print(f"[watchdog] scanned={min(len(items), max_scan)} nudged={nudged} degraded={degraded} changed={changed}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
PY
