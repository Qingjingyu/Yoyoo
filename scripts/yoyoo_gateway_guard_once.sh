#!/usr/bin/env bash
set -euo pipefail

# One-shot gateway guard for cron.
# If gateway-level checks fail, run full stabilize workflow.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"

if lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1 \
  && openclaw gateway health --json --timeout 25000 >/dev/null 2>&1 \
  && openclaw channels status --json --timeout 25000 >/dev/null 2>&1; then
  echo "[ok] gateway healthy"
  exit 0
fi

echo "[warn] gateway unhealthy, running stabilize workflow..."
bash "$ROOT_DIR/scripts/yoyoo_gateway_stabilize.sh"
