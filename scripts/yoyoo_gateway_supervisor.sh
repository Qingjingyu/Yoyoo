#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_BIN="${OPENCLAW_BIN:-$(command -v openclaw)}"
PORT="${OPENCLAW_GATEWAY_PORT:-18789}"
SLEEP_SECS="${YOYOO_GATEWAY_RETRY_SECONDS:-3}"

if [[ -z "$OPENCLAW_BIN" || ! -x "$OPENCLAW_BIN" ]]; then
  echo "[yoyoo-gateway-supervisor] openclaw command not found"
  exit 1
fi

echo "[yoyoo-gateway-supervisor] starting loop. openclaw=$OPENCLAW_BIN port=$PORT"

while true; do
  "$OPENCLAW_BIN" gateway run --port "$PORT" || true
  echo "[yoyoo-gateway-supervisor] gateway exited, restart in ${SLEEP_SECS}s"
  sleep "$SLEEP_SECS"
done
