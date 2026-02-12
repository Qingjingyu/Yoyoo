#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SOUL_DIR="${REPO_ROOT}/Yoyoo/soul"

MODE="${1:-sync}" # pull|push|sync|daemon|status

HOST="${YOYOO_SYNC_HOST:-115.191.36.128}"
USER_NAME="${YOYOO_SYNC_USER:-root}"
SSH_KEY_DEFAULT="${REPO_ROOT}/中转/miyaodui.pem"
SSH_KEY="${YOYOO_SYNC_SSH_KEY:-${SSH_KEY_DEFAULT}}"
PORT="${YOYOO_SYNC_SSH_PORT:-22}"
INTERVAL_SEC="${YOYOO_SYNC_INTERVAL_SEC:-120}"

LOCAL_MEMORY_FULL="${SOUL_DIR}/MEMORY.md"
LOCAL_MEMORY_SYNC="${SOUL_DIR}/MEMORY_SYNC.md"
LOCAL_DAILY_DIR="${SOUL_DIR}/memory"

STATE_DIR="${SOUL_DIR}/.sync_state"
STATE_FILE="${STATE_DIR}/memory_sync_state.env"
CONFLICT_DIR="${STATE_DIR}/conflicts"
ARCHIVE_DIR="${SOUL_DIR}/remote_memory"

REMOTE_OPENCLAW_WS="/root/.openclaw/workspace"
REMOTE_NANOBOT_WS="/root/.nanobot/workspace"
REMOTE_OPENCLAW_MEMORY="${REMOTE_OPENCLAW_WS}/MEMORY.md"
REMOTE_NANOBOT_MEMORY="${REMOTE_NANOBOT_WS}/memory/MEMORY.md"
REMOTE_OPENCLAW_DAILY_DIR="${REMOTE_OPENCLAW_WS}/memory"
REMOTE_NANOBOT_DAILY_DIR="${REMOTE_NANOBOT_WS}/memory"

SSH_OPTS=(
  -i "${SSH_KEY}"
  -o StrictHostKeyChecking=no
  -o UserKnownHostsFile=/dev/null
  -o IdentitiesOnly=yes
  -o LogLevel=ERROR
)

ts() {
  date +"%Y-%m-%d %H:%M:%S"
}

log() {
  echo "[$(ts)] $*"
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

ensure_paths() {
  [[ -d "${SOUL_DIR}" ]] || die "Missing soul directory: ${SOUL_DIR}"
  [[ -f "${SSH_KEY}" ]] || die "Missing SSH key: ${SSH_KEY}"
  [[ -f "${LOCAL_MEMORY_FULL}" ]] || die "Missing local memory file: ${LOCAL_MEMORY_FULL}"
  [[ -f "${LOCAL_MEMORY_SYNC}" ]] || die "Missing local sync memory file: ${LOCAL_MEMORY_SYNC}"
  mkdir -p "${LOCAL_DAILY_DIR}" "${STATE_DIR}" "${CONFLICT_DIR}" "${ARCHIVE_DIR}/openclaw" "${ARCHIVE_DIR}/nanobot"
  export COPYFILE_DISABLE=1
}

run_ssh() {
  ssh "${SSH_OPTS[@]}" -p "${PORT}" "${USER_NAME}@${HOST}" "$@"
}

remote_file_exists() {
  local remote_path="$1"
  run_ssh "test -f '${remote_path}'"
}

sha_local() {
  local path="$1"
  if [[ -f "${path}" ]]; then
    shasum -a 256 "${path}" | awk '{print $1}'
  else
    echo ""
  fi
}

sha_remote() {
  local remote_path="$1"
  run_ssh "if [ -f '${remote_path}' ]; then sha256sum '${remote_path}' | awk '{print \$1}'; fi"
}

pull_file() {
  local remote_path="$1"
  local local_path="$2"
  if remote_file_exists "${remote_path}"; then
    run_ssh "cat '${remote_path}'" > "${local_path}"
    return 0
  fi
  return 1
}

push_file() {
  local local_path="$1"
  local remote_path="$2"
  local remote_tmp="${remote_path}.tmp_sync"
  run_ssh "mkdir -p '$(dirname "${remote_path}")'"
  cat "${local_path}" | run_ssh "cat > '${remote_tmp}'"
  run_ssh "install -m 0644 '${remote_tmp}' '${remote_path}' && rm -f '${remote_tmp}'"
}

sync_daily_dir_from_remote() {
  local remote_dir="$1"
  local local_dir="$2"
  mkdir -p "${local_dir}"
  local tmp_tar
  tmp_tar="$(mktemp)"
  if run_ssh "[ -d '${remote_dir}' ]"; then
    if run_ssh "tar -C '${remote_dir}' -czf - . " > "${tmp_tar}"; then
      if [[ -s "${tmp_tar}" ]]; then
        tar -xzf "${tmp_tar}" -C "${local_dir}"
      fi
    fi
  fi
  rm -f "${tmp_tar}"
}

append_daily_note() {
  local title="$1"
  local body="$2"
  local today_file="${LOCAL_DAILY_DIR}/$(date +%F).md"
  if [[ ! -f "${today_file}" ]]; then
    cat > "${today_file}" <<EOF
# $(date +%F)

EOF
  fi
  cat >> "${today_file}" <<EOF
## ${title}
- time: $(ts)
${body}

EOF
}

load_state() {
  LAST_LOCAL_FULL_HASH=""
  LAST_LOCAL_SYNC_HASH=""
  LAST_REMOTE_OPENCLAW_HASH=""
  LAST_REMOTE_NANOBOT_HASH=""
  if [[ -f "${STATE_FILE}" ]]; then
    # shellcheck disable=SC1090
    source "${STATE_FILE}"
  fi
}

save_state() {
  cat > "${STATE_FILE}" <<EOF
LAST_LOCAL_FULL_HASH=${CURRENT_LOCAL_FULL_HASH}
LAST_LOCAL_SYNC_HASH=${CURRENT_LOCAL_SYNC_HASH}
LAST_REMOTE_OPENCLAW_HASH=${CURRENT_REMOTE_OPENCLAW_HASH}
LAST_REMOTE_NANOBOT_HASH=${CURRENT_REMOTE_NANOBOT_HASH}
LAST_SYNC_AT=$(date +%s)
EOF
}

pull_phase() {
  local pull_tmp
  pull_tmp="$(mktemp -d)"
  local now_tag
  now_tag="$(date +%Y%m%d_%H%M%S)"

  local open_tmp="${pull_tmp}/openclaw_MEMORY.md"
  local nano_tmp="${pull_tmp}/nanobot_MEMORY.md"
  local got_open=0
  local got_nano=0

  if pull_file "${REMOTE_OPENCLAW_MEMORY}" "${open_tmp}"; then
    got_open=1
    cp "${open_tmp}" "${ARCHIVE_DIR}/openclaw/MEMORY_${now_tag}.md"
  fi
  if pull_file "${REMOTE_NANOBOT_MEMORY}" "${nano_tmp}"; then
    got_nano=1
    cp "${nano_tmp}" "${ARCHIVE_DIR}/nanobot/MEMORY_${now_tag}.md"
  fi

  sync_daily_dir_from_remote "${REMOTE_OPENCLAW_DAILY_DIR}" "${ARCHIVE_DIR}/openclaw/daily"
  sync_daily_dir_from_remote "${REMOTE_NANOBOT_DAILY_DIR}" "${ARCHIVE_DIR}/nanobot/daily"

  if [[ "${got_open}" -eq 1 ]]; then
    local open_hash
    open_hash="$(sha_local "${open_tmp}")"
    local local_hash_before
    local_hash_before="$(sha_local "${LOCAL_MEMORY_FULL}")"
    local local_changed=0
    if [[ -n "${LAST_LOCAL_FULL_HASH}" && "${local_hash_before}" != "${LAST_LOCAL_FULL_HASH}" ]]; then
      local_changed=1
    fi
    if [[ -n "${LAST_REMOTE_OPENCLAW_HASH}" && "${open_hash}" != "${LAST_REMOTE_OPENCLAW_HASH}" ]]; then
      if [[ "${local_changed}" -eq 0 ]]; then
        cp "${LOCAL_MEMORY_FULL}" "${STATE_DIR}/local_MEMORY_before_pull_${now_tag}.md"
        cp "${open_tmp}" "${LOCAL_MEMORY_FULL}"
        append_daily_note "memory-sync pull(openclaw)" "- remote update applied to local MEMORY.md"
        log "Pulled OpenClaw MEMORY.md -> local"
      else
        cp "${LOCAL_MEMORY_FULL}" "${CONFLICT_DIR}/MEMORY_local_${now_tag}.md"
        cp "${open_tmp}" "${CONFLICT_DIR}/MEMORY_openclaw_${now_tag}.md"
        append_daily_note "memory-sync conflict(openclaw)" "- both local and remote changed; snapshots saved under .sync_state/conflicts"
        log "Conflict detected for MEMORY.md (local/openclaw), snapshots saved"
      fi
    fi
  fi

  if [[ "${got_nano}" -eq 1 ]]; then
    local nano_hash
    nano_hash="$(sha_local "${nano_tmp}")"
    local local_sync_hash_before
    local_sync_hash_before="$(sha_local "${LOCAL_MEMORY_SYNC}")"
    local local_sync_changed=0
    if [[ -n "${LAST_LOCAL_SYNC_HASH}" && "${local_sync_hash_before}" != "${LAST_LOCAL_SYNC_HASH}" ]]; then
      local_sync_changed=1
    fi
    if [[ -n "${LAST_REMOTE_NANOBOT_HASH}" && "${nano_hash}" != "${LAST_REMOTE_NANOBOT_HASH}" ]]; then
      if [[ "${local_sync_changed}" -eq 0 ]]; then
        cp "${LOCAL_MEMORY_SYNC}" "${STATE_DIR}/local_MEMORY_SYNC_before_pull_${now_tag}.md"
        cp "${nano_tmp}" "${LOCAL_MEMORY_SYNC}"
        append_daily_note "memory-sync pull(nanobot)" "- remote update applied to local MEMORY_SYNC.md"
        log "Pulled Nanobot MEMORY.md -> local MEMORY_SYNC.md"
      else
        cp "${LOCAL_MEMORY_SYNC}" "${CONFLICT_DIR}/MEMORY_SYNC_local_${now_tag}.md"
        cp "${nano_tmp}" "${CONFLICT_DIR}/MEMORY_SYNC_nanobot_${now_tag}.md"
        append_daily_note "memory-sync conflict(nanobot)" "- both local MEMORY_SYNC and remote nanobot memory changed; snapshots saved"
        log "Conflict detected for MEMORY_SYNC.md (local/nanobot), snapshots saved"
      fi
    fi
  fi

  rm -rf "${pull_tmp}"
}

push_phase() {
  local remote_open_hash_before
  local remote_nano_hash_before
  remote_open_hash_before="$(sha_remote "${REMOTE_OPENCLAW_MEMORY}")"
  remote_nano_hash_before="$(sha_remote "${REMOTE_NANOBOT_MEMORY}")"

  local local_full_hash
  local local_sync_hash
  local_full_hash="$(sha_local "${LOCAL_MEMORY_FULL}")"
  local_sync_hash="$(sha_local "${LOCAL_MEMORY_SYNC}")"

  if [[ "${local_full_hash}" != "${remote_open_hash_before}" ]]; then
    push_file "${LOCAL_MEMORY_FULL}" "${REMOTE_OPENCLAW_MEMORY}"
    append_daily_note "memory-sync push(openclaw)" "- local MEMORY.md pushed to OpenClaw"
    log "Pushed local MEMORY.md -> OpenClaw"
  fi

  if [[ "${local_sync_hash}" != "${remote_nano_hash_before}" ]]; then
    push_file "${LOCAL_MEMORY_SYNC}" "${REMOTE_NANOBOT_MEMORY}"
    append_daily_note "memory-sync push(nanobot)" "- local MEMORY_SYNC.md pushed to Nanobot memory"
    log "Pushed local MEMORY_SYNC.md -> Nanobot"
  fi

  for f in AGENTS.md SOUL.md USER.md TOOLS.md IDENTITY.md HEARTBEAT.md; do
    if [[ -f "${SOUL_DIR}/${f}" ]]; then
      push_file "${SOUL_DIR}/${f}" "${REMOTE_OPENCLAW_WS}/${f}"
      push_file "${SOUL_DIR}/${f}" "${REMOTE_NANOBOT_WS}/${f}"
    fi
  done
}

refresh_current_hashes() {
  CURRENT_LOCAL_FULL_HASH="$(sha_local "${LOCAL_MEMORY_FULL}")"
  CURRENT_LOCAL_SYNC_HASH="$(sha_local "${LOCAL_MEMORY_SYNC}")"
  CURRENT_REMOTE_OPENCLAW_HASH="$(sha_remote "${REMOTE_OPENCLAW_MEMORY}")"
  CURRENT_REMOTE_NANOBOT_HASH="$(sha_remote "${REMOTE_NANOBOT_MEMORY}")"
}

show_status() {
  load_state
  refresh_current_hashes
  cat <<EOF
mode=status
host=${HOST}
local_memory=${LOCAL_MEMORY_FULL}
local_memory_sync=${LOCAL_MEMORY_SYNC}
current_local_full_hash=${CURRENT_LOCAL_FULL_HASH}
current_local_sync_hash=${CURRENT_LOCAL_SYNC_HASH}
current_remote_openclaw_hash=${CURRENT_REMOTE_OPENCLAW_HASH}
current_remote_nanobot_hash=${CURRENT_REMOTE_NANOBOT_HASH}
last_local_full_hash=${LAST_LOCAL_FULL_HASH}
last_local_sync_hash=${LAST_LOCAL_SYNC_HASH}
last_remote_openclaw_hash=${LAST_REMOTE_OPENCLAW_HASH}
last_remote_nanobot_hash=${LAST_REMOTE_NANOBOT_HASH}
state_file=${STATE_FILE}
archive_dir=${ARCHIVE_DIR}
EOF
}

run_once() {
  load_state
  case "${MODE}" in
    pull)
      pull_phase
      ;;
    push)
      push_phase
      ;;
    sync)
      pull_phase
      push_phase
      ;;
    *)
      die "Unsupported mode: ${MODE}"
      ;;
  esac
  refresh_current_hashes
  save_state
  run_ssh "systemctl is-active openclaw.service nanobot.service" >/dev/null
  log "Sync ${MODE} completed (openclaw + nanobot active)"
}

run_daemon() {
  log "Starting daemon mode, interval=${INTERVAL_SEC}s"
  set +e
  while true; do
    MODE="sync" run_once
    rc=$?
    if [[ "${rc}" -ne 0 ]]; then
      log "Sync round failed (exit=${rc}), will retry"
    fi
    sleep "${INTERVAL_SEC}"
  done
}

main() {
  ensure_paths
  case "${MODE}" in
    status)
      show_status
      ;;
    pull|push|sync)
      run_once
      ;;
    daemon)
      run_daemon
      ;;
    *)
      cat <<EOF
Usage: $(basename "$0") [pull|push|sync|daemon|status]
  pull   - pull remote memory changes to local (with conflict snapshots)
  push   - push local memory/persona to remote agents
  sync   - pull then push (default)
  daemon - run sync loop (interval: YOYOO_SYNC_INTERVAL_SEC, default 120)
  status - print sync hashes and state
EOF
      exit 1
      ;;
  esac
}

main "$@"
