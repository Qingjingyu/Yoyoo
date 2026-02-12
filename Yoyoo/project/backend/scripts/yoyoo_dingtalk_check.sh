#!/usr/bin/env bash
set -euo pipefail

WINDOW_MINUTES="${1:-${YOYOO_CHECK_WINDOW_MINUTES:-5}}"
BACKEND_URL="${YOYOO_BACKEND_URL:-http://127.0.0.1:8000}"
FORWARDER_UNIT="${YOYOO_FORWARDER_UNIT:-yoyoo-dingtalk-forwarder.service}"
BACKEND_UNIT="${YOYOO_BACKEND_UNIT:-yoyoo-backend.service}"
SINCE="${WINDOW_MINUTES} min ago"

if ! [[ "${WINDOW_MINUTES}" =~ ^[0-9]+$ ]] || [[ "${WINDOW_MINUTES}" -le 0 ]]; then
  echo "invalid WINDOW_MINUTES: ${WINDOW_MINUTES}" >&2
  exit 1
fi

count_lines() {
  local unit="$1"
  local pattern="$2"
  local out
  if ! command -v journalctl >/dev/null 2>&1; then
    echo "na"
    return 0
  fi
  out="$(journalctl -u "${unit}" --since "${SINCE}" --no-pager | rg -c -- "${pattern}" || true)"
  if [[ -z "${out}" ]]; then
    echo "0"
  else
    echo "${out}"
  fi
}

forwarder_event_count="$(
  count_lines "${FORWARDER_UNIT}" "\\[dingtalk-forwarder\\] envelope source=callback topic=/v1.0/im/bot/messages/get"
)"
forwarder_forwarded_count="$(
  count_lines "${FORWARDER_UNIT}" "\\[dingtalk-forwarder\\] forwarded event="
)"
backend_ingress_count="$(
  count_lines "${BACKEND_UNIT}" "dingtalk_event trace_id="
)"
backend_outbound_ok_count="$(
  count_lines "${BACKEND_UNIT}" "dingtalk_outbound .* delivered=True"
)"
backend_outbound_fail_count="$(
  count_lines "${BACKEND_UNIT}" "dingtalk_outbound .* delivered=False"
)"

ops_json="$(curl -fsS "${BACKEND_URL}/api/v1/ops/health" 2>/dev/null || true)"

ops_summary="$(
  OPS_JSON="${ops_json}" python3 - <<'PY'
import json
import os

raw = os.environ.get("OPS_JSON", "").strip()
if not raw:
    print("task_intake_total=na duplicate_dropped_total=na dedupe_hit_rate=na")
    raise SystemExit(0)
try:
    payload = json.loads(raw)
except json.JSONDecodeError:
    print("task_intake_total=na duplicate_dropped_total=na dedupe_hit_rate=na")
    raise SystemExit(0)
memory = payload.get("memory", {})
print(
    "task_intake_total="
    + str(memory.get("task_intake_total", "na"))
    + " duplicate_dropped_total="
    + str(memory.get("duplicate_dropped_total", "na"))
    + " dedupe_hit_rate="
    + str(memory.get("dedupe_hit_rate", "na"))
)
PY
)"

echo "window_minutes=${WINDOW_MINUTES}"
echo "forwarder_event_count=${forwarder_event_count}"
echo "forwarder_forwarded_count=${forwarder_forwarded_count}"
echo "backend_ingress_count=${backend_ingress_count}"
echo "backend_outbound_ok_count=${backend_outbound_ok_count}"
echo "backend_outbound_fail_count=${backend_outbound_fail_count}"
echo "${ops_summary}"
