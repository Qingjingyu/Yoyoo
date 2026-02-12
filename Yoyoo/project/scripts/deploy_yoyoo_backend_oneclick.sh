#!/usr/bin/env bash
set -euo pipefail

# One-click deploy for Yoyoo backend:
# 1) sync backend code to server
# 2) install runtime dependencies
# 3) create/update systemd service
# 4) run health + deterministic ingress probes

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../backend" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"

HOST="${YOYOO_DEPLOY_HOST:-115.191.36.128}"
USER_NAME="${YOYOO_DEPLOY_USER:-root}"
PORT="${YOYOO_DEPLOY_SSH_PORT:-22}"
KEY="${YOYOO_DEPLOY_SSH_KEY:-${REPO_ROOT}/中转/miyaodui.pem}"
REMOTE_BACKEND_DIR="${YOYOO_REMOTE_BACKEND_DIR:-/root/yoyoo/backend}"
REMOTE_ENV_FILE="${YOYOO_REMOTE_ENV_FILE:-/etc/yoyoo/backend.env}"
REMOTE_SERVICE_FILE="${YOYOO_REMOTE_SERVICE_FILE:-/etc/systemd/system/yoyoo-backend.service}"
SERVICE_NAME="${YOYOO_BACKEND_SERVICE_NAME:-yoyoo-backend.service}"
P0_LOAD_COUNT="${YOYOO_P0_LOAD_COUNT:-20}"
P0_LOAD_TEXT="${YOYOO_P0_LOAD_TEXT:-你好，压测}"

usage() {
  cat <<'EOF'
Usage:
  bash Yoyoo/project/scripts/deploy_yoyoo_backend_oneclick.sh

Optional env vars:
  YOYOO_DEPLOY_HOST
  YOYOO_DEPLOY_USER
  YOYOO_DEPLOY_SSH_PORT
  YOYOO_DEPLOY_SSH_KEY
  YOYOO_REMOTE_BACKEND_DIR
  YOYOO_REMOTE_ENV_FILE
  YOYOO_REMOTE_SERVICE_FILE
  YOYOO_BACKEND_SERVICE_NAME
  YOYOO_P0_LOAD_COUNT
  YOYOO_P0_LOAD_TEXT
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ ! -d "${BACKEND_DIR}" ]]; then
  echo "backend directory not found: ${BACKEND_DIR}" >&2
  exit 1
fi
if [[ ! -f "${KEY}" ]]; then
  echo "ssh key not found: ${KEY}" >&2
  exit 1
fi

SSH_OPTS=(
  -i "${KEY}"
  -p "${PORT}"
  -o BatchMode=yes
  -o UserKnownHostsFile=/dev/null
  -o StrictHostKeyChecking=no
  -o IdentitiesOnly=yes
)
TARGET="${USER_NAME}@${HOST}"

echo "[1/4] Sync backend code -> ${TARGET}:${REMOTE_BACKEND_DIR}"
tar -C "${BACKEND_DIR}" \
  --exclude='.venv' \
  --exclude='__pycache__' \
  --exclude='.pytest_cache' \
  --exclude='.ruff_cache' \
  -czf - . | ssh "${SSH_OPTS[@]}" "${TARGET}" \
  "mkdir -p '${REMOTE_BACKEND_DIR}' && tar -C '${REMOTE_BACKEND_DIR}' -xzf -"

echo "[2/4] Install runtime deps + create service"
ssh "${SSH_OPTS[@]}" "${TARGET}" \
  "REMOTE_BACKEND_DIR='${REMOTE_BACKEND_DIR}' \
   REMOTE_ENV_FILE='${REMOTE_ENV_FILE}' \
   REMOTE_SERVICE_FILE='${REMOTE_SERVICE_FILE}' \
   SERVICE_NAME='${SERVICE_NAME}' \
   bash -s" <<'EOS'
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/tmp/yoyoo_backend_apt_update.log 2>&1
apt-get install -y python3-venv >/tmp/yoyoo_backend_apt_install.log 2>&1

cd "${REMOTE_BACKEND_DIR}"
python3 -m venv .venv
.venv/bin/pip install -U pip >/tmp/yoyoo_backend_pip_bootstrap.log 2>&1

# Avoid editable install pitfalls caused by strict package discovery in newer setuptools.
.venv/bin/pip install \
  'fastapi>=0.115,<1.0' \
  'uvicorn[standard]>=0.32,<1.0' \
  'pydantic>=2.8,<3.0' \
  'httpx>=0.28,<1.0' \
  'pytest>=8.3,<9.0' \
  'ruff>=0.8,<1.0' \
  >/tmp/yoyoo_backend_pip_install.log 2>&1

mkdir -p "$(dirname "${REMOTE_ENV_FILE}")"
if [[ ! -f "${REMOTE_ENV_FILE}" ]]; then
  cat > "${REMOTE_ENV_FILE}" <<'ENV'
YOYOO_MEMORY_FILE=/root/yoyoo/backend/data/yoyoo_memory.json
YOYOO_YYOS_ENABLED=0
OPENCLAW_LOCAL_EXEC=1
OPENCLAW_FALLBACK_TO_SSH_ON_LOCAL_FAILURE=1
OPENCLAW_REMOTE_OPENCLAW_BIN=openclaw
OPENCLAW_EXEC_TIMEOUT_SEC=45
ENV
  chmod 600 "${REMOTE_ENV_FILE}"
fi

cat > "${REMOTE_SERVICE_FILE}" <<UNIT
[Unit]
Description=Yoyoo Backend Service
After=network.target openclaw-gateway.service

[Service]
Type=simple
User=root
WorkingDirectory=${REMOTE_BACKEND_DIR}
EnvironmentFile=-${REMOTE_ENV_FILE}
Environment=PYTHONUNBUFFERED=1
ExecStart=${REMOTE_BACKEND_DIR}/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"
EOS

echo "[3/4] Run deterministic ingress probes"
ssh "${SSH_OPTS[@]}" "${TARGET}" \
  "SERVICE_NAME='${SERVICE_NAME}' P0_LOAD_COUNT='${P0_LOAD_COUNT}' P0_LOAD_TEXT='${P0_LOAD_TEXT}' bash -s" <<'EOS'
set -euo pipefail

curl -sS http://127.0.0.1:8000/healthz >/tmp/yoyoo_backend_healthz.json
ops_before="$(curl -sS http://127.0.0.1:8000/api/v1/ops/health)"

event_id="evt_probe_$(date +%s)"
payload="$(cat <<JSON
{"eventType":"chat_message","eventId":"${event_id}","senderStaffId":"staff_probe_001","conversationId":"conv_probe_001","text":{"content":"请执行一个部署任务并反馈"}}
JSON
)"

first="$(curl -sS -X POST http://127.0.0.1:8000/api/v1/dingtalk/events -H 'Content-Type: application/json' -d "${payload}")"
second="$(curl -sS -X POST http://127.0.0.1:8000/api/v1/dingtalk/events -H 'Content-Type: application/json' -d "${payload}")"

systemctl restart "${SERVICE_NAME}"
sleep 2
third="$(curl -sS -X POST http://127.0.0.1:8000/api/v1/dingtalk/events -H 'Content-Type: application/json' -d "${payload}")"
ops_after="$(curl -sS http://127.0.0.1:8000/api/v1/ops/health)"

FIRST="${first}" SECOND="${second}" THIRD="${third}" OPS_BEFORE="${ops_before}" OPS_AFTER="${ops_after}" \
python3 - <<'PY'
import json
import os

first = json.loads(os.environ["FIRST"])
second = json.loads(os.environ["SECOND"])
third = json.loads(os.environ["THIRD"])
ops_before = json.loads(os.environ["OPS_BEFORE"])
ops_after = json.loads(os.environ["OPS_AFTER"])

assert first.get("ok") is True and first.get("ignored") is False
assert second.get("ok") is True and second.get("ignored") is True
assert second.get("reason") == "duplicate_event_deduped"
assert third.get("ok") is True and third.get("ignored") is True
assert third.get("reason") == "duplicate_event_deduped"

memory_before = ops_before.get("memory", {})
memory_after = ops_after.get("memory", {})

summary = {
    "probe": "dedupe_and_restart_persistence",
    "first": {
        "ignored": first.get("ignored"),
        "task_id": first.get("task_id"),
    },
    "second": {
        "ignored": second.get("ignored"),
        "reason": second.get("reason"),
    },
    "third": {
        "ignored": third.get("ignored"),
        "reason": third.get("reason"),
    },
    "ops_after": {
        "task_intake_total": memory_after.get("task_intake_total"),
        "duplicate_dropped_total": memory_after.get("duplicate_dropped_total"),
        "dedupe_hit_rate": memory_after.get("dedupe_hit_rate"),
    },
    "ops_before": {
        "task_intake_total": memory_before.get("task_intake_total"),
        "duplicate_dropped_total": memory_before.get("duplicate_dropped_total"),
        "dedupe_hit_rate": memory_before.get("dedupe_hit_rate"),
    },
}
print(json.dumps(summary, ensure_ascii=False))
PY

# P0 load test: 20 unique requests + 20 duplicate replay
count="${P0_LOAD_COUNT:-20}"
load_text="${P0_LOAD_TEXT:-你好，压测}"
batch="batch_$(date +%s)"
ok_unique=0
bad_unique=0
ok_dup=0
bad_dup=0

for i in $(seq 1 "${count}"); do
  eid="evt_${batch}_${i}"
  payload="$(cat <<JSON
{"eventType":"chat_message","eventId":"${eid}","senderStaffId":"staff_p0_001","conversationId":"conv_p0_001","text":{"content":"${load_text}${i}"}}
JSON
)"
  resp="$(curl -sS -X POST http://127.0.0.1:8000/api/v1/dingtalk/events -H 'Content-Type: application/json' -d "${payload}")"
  if python3 - <<'PY' "${resp}" >/dev/null 2>&1
import json,sys
obj=json.loads(sys.argv[1])
assert obj.get("ok") is True
assert obj.get("ignored") is False
PY
  then
    ok_unique=$((ok_unique+1))
  else
    bad_unique=$((bad_unique+1))
  fi
done

for i in $(seq 1 "${count}"); do
  eid="evt_${batch}_${i}"
  payload="$(cat <<JSON
{"eventType":"chat_message","eventId":"${eid}","senderStaffId":"staff_p0_001","conversationId":"conv_p0_001","text":{"content":"${load_text}${i}"}}
JSON
)"
  resp="$(curl -sS -X POST http://127.0.0.1:8000/api/v1/dingtalk/events -H 'Content-Type: application/json' -d "${payload}")"
  if python3 - <<'PY' "${resp}" >/dev/null 2>&1
import json,sys
obj=json.loads(sys.argv[1])
assert obj.get("ok") is True
assert obj.get("ignored") is True
assert obj.get("reason") == "duplicate_event_deduped"
PY
  then
    ok_dup=$((ok_dup+1))
  else
    bad_dup=$((bad_dup+1))
  fi
done

ops_batch_after="$(curl -sS http://127.0.0.1:8000/api/v1/ops/health)"
OPS_BEFORE="${ops_before}" OPS_AFTER="${ops_batch_after}" \
OK_UNIQUE="${ok_unique}" BAD_UNIQUE="${bad_unique}" OK_DUP="${ok_dup}" BAD_DUP="${bad_dup}" COUNT="${count}" P0_LOAD_TEXT="${load_text}" \
python3 - <<'PY'
import json, os
before = json.loads(os.environ["OPS_BEFORE"]).get("memory", {})
after = json.loads(os.environ["OPS_AFTER"]).get("memory", {})
ok_unique = int(os.environ["OK_UNIQUE"])
bad_unique = int(os.environ["BAD_UNIQUE"])
ok_dup = int(os.environ["OK_DUP"])
bad_dup = int(os.environ["BAD_DUP"])
count = int(os.environ["COUNT"])
delta_task_intake = (after.get("task_intake_total") or 0) - (before.get("task_intake_total") or 0)
delta_dropped = (after.get("duplicate_dropped_total") or 0) - (before.get("duplicate_dropped_total") or 0)
assert ok_unique == count, f"unique pass mismatch: {ok_unique}/{count}"
assert bad_unique == 0, f"unique failed: {bad_unique}"
assert ok_dup == count, f"dup pass mismatch: {ok_dup}/{count}"
assert bad_dup == 0, f"dup failed: {bad_dup}"
assert delta_dropped >= count, f"dropped delta too small: {delta_dropped}"
print(json.dumps({
  "probe": "p0_cutover_load_test",
  "load_text": os.environ.get("P0_LOAD_TEXT", ""),
  "count": count,
  "unique_ok": ok_unique,
  "duplicate_ok": ok_dup,
  "delta_task_intake_total": delta_task_intake,
  "delta_duplicate_dropped_total": delta_dropped,
  "dedupe_hit_rate_after": after.get("dedupe_hit_rate"),
}, ensure_ascii=False))
PY
EOS

echo "[4/4] Final service status"
ssh "${SSH_OPTS[@]}" "${TARGET}" \
  "systemctl is-active '${SERVICE_NAME}'; systemctl is-enabled '${SERVICE_NAME}'"

echo "Done: one-click deploy + probes succeeded."
