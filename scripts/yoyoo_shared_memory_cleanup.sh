#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="${1:-$HOME/.openclaw/workspace}"
LOG_FILE="$ROOT_DIR/shared-memory/cross-agent-log.md"
ARCHIVE_DIR="$ROOT_DIR/shared-memory/archive"
NOW_UTC="$(date -u +%Y-%m-%d)"
MONTH_UTC="$(date -u +%Y-%m)"

if [[ ! -f "$LOG_FILE" ]]; then
  echo "[yoyoo-cleanup] skip: log file not found: $LOG_FILE"
  exit 0
fi

mkdir -p "$ARCHIVE_DIR"
ARCHIVE_FILE="$ARCHIVE_DIR/$MONTH_UTC.md"

python3 - "$LOG_FILE" "$ARCHIVE_FILE" "$NOW_UTC" <<'PY'
from __future__ import annotations
import datetime as dt
import pathlib
import re
import sys

log_file = pathlib.Path(sys.argv[1])
archive_file = pathlib.Path(sys.argv[2])
now = dt.datetime.strptime(sys.argv[3], "%Y-%m-%d").date()

line_re = re.compile(r"^- \[(\d{4}-\d{2}-\d{2})\] \[([^\]]+)\] \[(P[012])\] (.+)$")

def is_expired(date_text: str, priority: str) -> bool:
    try:
        created = dt.datetime.strptime(date_text, "%Y-%m-%d").date()
    except ValueError:
        return False

    if priority == "P0":
        return False

    age_days = (now - created).days
    if priority == "P1":
        return age_days > 90
    return age_days > 30

raw = log_file.read_text(encoding="utf-8").splitlines()
keep: list[str] = []
archived: list[str] = []

for line in raw:
    m = line_re.match(line.strip())
    if not m:
        keep.append(line)
        continue

    date_text, _role, priority, _summary = m.groups()
    if is_expired(date_text, priority):
        archived.append(line)
    else:
        keep.append(line)

if archived:
    if archive_file.exists():
        old = archive_file.read_text(encoding="utf-8").rstrip("\n")
    else:
        old = f"# Archived shared-memory logs ({now.isoformat()})"
    archive_file.write_text(old + "\n" + "\n".join(archived) + "\n", encoding="utf-8")

log_file.write_text("\n".join(keep).rstrip("\n") + "\n", encoding="utf-8")
print(f"[yoyoo-cleanup] archived={len(archived)} kept={len([x for x in keep if x.strip().startswith('- [')])}")
PY
