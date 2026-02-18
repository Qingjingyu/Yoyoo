#!/usr/bin/env bash
set -euo pipefail

BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
USER_ID="${USER_ID:-u_bridge_smoke}"
CHANNEL="${CHANNEL:-api}"
PROJECT_KEY="${PROJECT_KEY:-proj_bridge_smoke}"
MESSAGE="${MESSAGE:-请执行一个 bridge 冒烟任务并返回证据}"

echo "[smoke] backend=${BACKEND_URL}"

create_resp="$(curl -sS -X POST "${BACKEND_URL}/api/v1/team/tasks" \
  -H 'content-type: application/json' \
  -d "{\"user_id\":\"${USER_ID}\",\"message\":\"${MESSAGE}\",\"channel\":\"${CHANNEL}\",\"project_key\":\"${PROJECT_KEY}\"}")"

task_id="$(python3 - <<'PY' "${create_resp}"
import json,sys
data=json.loads(sys.argv[1])
print(data.get("task_id",""))
PY
)"

if [[ -z "${task_id}" ]]; then
  echo "[smoke] failed: task_id empty"
  echo "${create_resp}"
  exit 1
fi

echo "[smoke] task_id=${task_id}"

run_resp="$(curl -sS -X POST "${BACKEND_URL}/api/v1/team/tasks/${task_id}/run" \
  -H 'content-type: application/json' \
  -d '{"max_attempts":2,"resume":true}')"
echo "[smoke] run_resp=${run_resp}"

detail_resp="$(curl -sS "${BACKEND_URL}/api/v1/team/tasks/${task_id}")"
echo "[smoke] detail_resp=${detail_resp}"

executor_resp="$(curl -sS "${BACKEND_URL}/api/v1/ops/executor")"
echo "[smoke] executor_resp=${executor_resp}"

echo "[smoke] done"
