#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "${ROOT_DIR}/.env"
  set +a
fi

BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
BRIDGE_URL="${BRIDGE_URL:-http://127.0.0.1:18080}"
BRIDGE_TOKEN="${BRIDGE_TOKEN:-${OPENCLAW_BRIDGE_TOKEN:-}}"
RUN_EXECUTION_SMOKE="${RUN_EXECUTION_SMOKE:-1}"

echo "[smoke] backend health"
curl -fsS "${BASE_URL}/healthz" >/dev/null
curl -fsS "${BASE_URL}/api/v1/ops/health" >/dev/null
curl -fsS "${BASE_URL}/api/v1/ops/alerts" >/dev/null

echo "[smoke] api chat"
curl -fsS \
  -H "Content-Type: application/json" \
  -d '{"user_id":"u_smoke","conversation_id":"c_smoke","message":"状态"}' \
  "${BASE_URL}/api/v1/chat" >/dev/null

echo "[smoke] bridge health"
curl -fsS "${BRIDGE_URL}/healthz" >/dev/null

if [[ "${RUN_EXECUTION_SMOKE}" == "1" ]]; then
  echo "[smoke] bridge execution"
  if [[ -n "${BRIDGE_TOKEN}" ]]; then
    curl -fsS \
      -H "Authorization: Bearer ${BRIDGE_TOKEN}" \
      -H "Content-Type: application/json" \
      -d '{"user_id":"u_smoke_bridge","conversation_id":"c_smoke_bridge","message":"请执行任务：输出 smoke_ok","channel":"dingtalk","trace_id":"trace_smoke_bridge"}' \
      "${BRIDGE_URL}/bridge/chat" >/dev/null
  else
    echo "[smoke] skip bridge execution: BRIDGE_TOKEN not configured"
  fi
fi

echo "[smoke] done"
