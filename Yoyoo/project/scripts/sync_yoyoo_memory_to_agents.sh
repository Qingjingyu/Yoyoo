#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SOUL_DIR="${REPO_ROOT}/Yoyoo/soul"

HOST="${YOYOO_SYNC_HOST:-115.191.36.128}"
USER_NAME="${YOYOO_SYNC_USER:-root}"
SSH_KEY_DEFAULT="${REPO_ROOT}/中转/miyaodui.pem"
SSH_KEY="${YOYOO_SYNC_SSH_KEY:-${SSH_KEY_DEFAULT}}"
PORT="${YOYOO_SYNC_SSH_PORT:-22}"

if [[ ! -d "${SOUL_DIR}" ]]; then
  echo "Missing soul directory: ${SOUL_DIR}" >&2
  exit 1
fi

if [[ ! -f "${SSH_KEY}" ]]; then
  echo "Missing SSH key: ${SSH_KEY}" >&2
  exit 1
fi

for f in AGENTS.md SOUL.md USER.md TOOLS.md IDENTITY.md HEARTBEAT.md MEMORY.md; do
  if [[ ! -f "${SOUL_DIR}/${f}" ]]; then
    echo "Missing required file: ${SOUL_DIR}/${f}" >&2
    exit 1
  fi
done

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT
export COPYFILE_DISABLE=1

cp "${SOUL_DIR}/AGENTS.md" "${TMP_DIR}/AGENTS.md"
cp "${SOUL_DIR}/SOUL.md" "${TMP_DIR}/SOUL.md"
cp "${SOUL_DIR}/USER.md" "${TMP_DIR}/USER.md"
cp "${SOUL_DIR}/TOOLS.md" "${TMP_DIR}/TOOLS.md"
cp "${SOUL_DIR}/IDENTITY.md" "${TMP_DIR}/IDENTITY.md"
cp "${SOUL_DIR}/HEARTBEAT.md" "${TMP_DIR}/HEARTBEAT.md"
cp "${SOUL_DIR}/MEMORY.md" "${TMP_DIR}/MEMORY_FULL.md"

if [[ -f "${SOUL_DIR}/MEMORY_SYNC.md" ]]; then
  cp "${SOUL_DIR}/MEMORY_SYNC.md" "${TMP_DIR}/MEMORY_SYNC.md"
else
  cp "${SOUL_DIR}/MEMORY.md" "${TMP_DIR}/MEMORY_SYNC.md"
fi

REMOTE_STAGING="/tmp/yoyoo-memory-sync"
TS="$(date +%Y%m%d_%H%M%S)"

tar -C "${TMP_DIR}" -czf - . | ssh -i "${SSH_KEY}" -p "${PORT}" \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o LogLevel=ERROR \
  "${USER_NAME}@${HOST}" "rm -rf '${REMOTE_STAGING}' && mkdir -p '${REMOTE_STAGING}' && tar -xzf - -C '${REMOTE_STAGING}'"

ssh -i "${SSH_KEY}" -p "${PORT}" \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o IdentitiesOnly=yes -o LogLevel=ERROR \
  "${USER_NAME}@${HOST}" "set -euo pipefail
BACKUP_BASE='/root/yoyoo/backups/memory-sync-${TS}'
mkdir -p \"\${BACKUP_BASE}/openclaw\" \"\${BACKUP_BASE}/nanobot\"

OPENCLAW_WS='/root/.openclaw/workspace'
NANOBOT_WS='/root/.nanobot/workspace'

mkdir -p \"\${OPENCLAW_WS}/memory\" \"\${NANOBOT_WS}/memory\"

for f in AGENTS.md SOUL.md USER.md TOOLS.md IDENTITY.md HEARTBEAT.md MEMORY.md; do
  if [[ -f \"\${OPENCLAW_WS}/\${f}\" ]]; then
    cp \"\${OPENCLAW_WS}/\${f}\" \"\${BACKUP_BASE}/openclaw/\${f}\"
  fi
done

for f in AGENTS.md SOUL.md USER.md TOOLS.md IDENTITY.md HEARTBEAT.md; do
  if [[ -f \"\${NANOBOT_WS}/\${f}\" ]]; then
    cp \"\${NANOBOT_WS}/\${f}\" \"\${BACKUP_BASE}/nanobot/\${f}\"
  fi
done

if [[ -f \"\${NANOBOT_WS}/memory/MEMORY.md\" ]]; then
  cp \"\${NANOBOT_WS}/memory/MEMORY.md\" \"\${BACKUP_BASE}/nanobot/MEMORY.md\"
fi

install -m 0644 '${REMOTE_STAGING}/AGENTS.md' \"\${OPENCLAW_WS}/AGENTS.md\"
install -m 0644 '${REMOTE_STAGING}/SOUL.md' \"\${OPENCLAW_WS}/SOUL.md\"
install -m 0644 '${REMOTE_STAGING}/USER.md' \"\${OPENCLAW_WS}/USER.md\"
install -m 0644 '${REMOTE_STAGING}/TOOLS.md' \"\${OPENCLAW_WS}/TOOLS.md\"
install -m 0644 '${REMOTE_STAGING}/IDENTITY.md' \"\${OPENCLAW_WS}/IDENTITY.md\"
install -m 0644 '${REMOTE_STAGING}/HEARTBEAT.md' \"\${OPENCLAW_WS}/HEARTBEAT.md\"
install -m 0644 '${REMOTE_STAGING}/MEMORY_FULL.md' \"\${OPENCLAW_WS}/MEMORY.md\"

install -m 0644 '${REMOTE_STAGING}/AGENTS.md' \"\${NANOBOT_WS}/AGENTS.md\"
install -m 0644 '${REMOTE_STAGING}/SOUL.md' \"\${NANOBOT_WS}/SOUL.md\"
install -m 0644 '${REMOTE_STAGING}/USER.md' \"\${NANOBOT_WS}/USER.md\"
install -m 0644 '${REMOTE_STAGING}/TOOLS.md' \"\${NANOBOT_WS}/TOOLS.md\"
install -m 0644 '${REMOTE_STAGING}/IDENTITY.md' \"\${NANOBOT_WS}/IDENTITY.md\"
install -m 0644 '${REMOTE_STAGING}/HEARTBEAT.md' \"\${NANOBOT_WS}/HEARTBEAT.md\"
install -m 0644 '${REMOTE_STAGING}/MEMORY_SYNC.md' \"\${NANOBOT_WS}/memory/MEMORY.md\"

systemctl restart openclaw.service
systemctl restart nanobot.service
sleep 2
systemctl is-active openclaw.service nanobot.service

echo 'backup_dir='\"\${BACKUP_BASE}\"
echo 'openclaw_memory='\"\${OPENCLAW_WS}/MEMORY.md\"
echo 'nanobot_memory='\"\${NANOBOT_WS}/memory/MEMORY.md\"
"

echo "Synced memory/persona files to OpenClaw + Nanobot on ${HOST}"
