#!/usr/bin/env bash
set -euo pipefail

# Install a cron guard for gateway one-shot self-heal checks.
# Default: every 5 minutes.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CRON_EXPR="${1:-*/5 * * * *}"
LOG_DIR="$HOME/.openclaw/logs"
LOG_FILE="$LOG_DIR/yoyoo-gateway-guard-cron.log"
MARKER="yoyoo_gateway_guard_once.sh"

mkdir -p "$LOG_DIR"

job_cmd="bash '$ROOT_DIR/scripts/yoyoo_gateway_guard_once.sh' >> '$LOG_FILE' 2>&1"
new_line="$CRON_EXPR $job_cmd"

tmp_file="$(mktemp)"
trap 'rm -f "$tmp_file"' EXIT

if crontab -l >/dev/null 2>&1; then
  crontab -l | rg -v "$MARKER" >"$tmp_file" || true
else
  : >"$tmp_file"
fi

echo "$new_line" >>"$tmp_file"
crontab "$tmp_file"

echo "[ok] installed cron guard"
echo "[info] schedule: $CRON_EXPR"
echo "[info] command: $job_cmd"
echo "[info] logs: $LOG_FILE"
echo
echo "[current crontab]"
crontab -l
