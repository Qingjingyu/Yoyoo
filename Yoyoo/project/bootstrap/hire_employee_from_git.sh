#!/usr/bin/env bash
set -euo pipefail

# Pull Yoyoo repo and activate one employee profile.

GIT_URL="${GIT_URL:-git@github.com:Qingjingyu/Yoyoo.git}"
GIT_REF="${GIT_REF:-master}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/yoyoo-runtime}"
YOYOO_ROLE="${YOYOO_ROLE:-ceo}"
YOYOO_EMPLOYEE_KEY="${YOYOO_EMPLOYEE_KEY:-${YOYOO_ROLE}}"
YOYOO_HOME="${YOYOO_HOME:-}"
OPENCLAW_PORT="${OPENCLAW_PORT:-}"
YOYOO_ALLOW_SHARED_INSTANCE="${YOYOO_ALLOW_SHARED_INSTANCE:-0}"
YOYOO_GIT_AUTO_STASH="${YOYOO_GIT_AUTO_STASH:-1}"
YOYOO_ASSET_ROOT="${YOYOO_ASSET_ROOT:-/srv/yoyoo}"
YOYOO_FORCE_CLEAN_RUNTIME="${YOYOO_FORCE_CLEAN_RUNTIME:-0}"

role_default_home() {
  case "$1" in
    ceo) echo "/root/.openclaw" ;;
    ops) echo "/root/.openclaw-ops" ;;
    cto) echo "/root/.openclaw-cto" ;;
    rd-director) echo "/root/.openclaw-rd-director" ;;
    rd-engineer) echo "/root/.openclaw-rd-engineer" ;;
    *)
      echo "Unsupported YOYOO_ROLE: $1" >&2
      exit 1
      ;;
  esac
}

role_default_port() {
  case "$1" in
    ceo) echo "18789" ;;
    ops) echo "18790" ;;
    cto) echo "18794" ;;
    rd-director) echo "18791" ;;
    rd-engineer) echo "18793" ;;
    *)
      echo "Unsupported YOYOO_ROLE: $1" >&2
      exit 1
      ;;
  esac
}

sanitize_employee_key() {
  local raw="$1"
  local cleaned
  cleaned="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9.-' '-' | sed -E 's/-+/-/g; s/^-+//; s/-+$//')"
  if [[ -z "${cleaned}" ]]; then
    return 1
  fi
  printf '%s\n' "${cleaned}"
}

is_port_busy() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :${p} )" 2>/dev/null | awk 'NR>1{print $0}' | grep -q .
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  return 1
}

find_free_port() {
  local p
  for p in $(seq 18850 19999); do
    if ! is_port_busy "${p}"; then
      echo "${p}"
      return 0
    fi
  done
  return 1
}

YOYOO_EMPLOYEE_KEY="$(sanitize_employee_key "${YOYOO_EMPLOYEE_KEY}")"
if [[ -z "${YOYOO_EMPLOYEE_KEY}" ]]; then
  echo "YOYOO_EMPLOYEE_KEY is invalid" >&2
  exit 1
fi

if [[ -z "${YOYOO_HOME}" ]]; then
  if [[ "${YOYOO_EMPLOYEE_KEY}" == "${YOYOO_ROLE}" ]]; then
    YOYOO_HOME="$(role_default_home "${YOYOO_ROLE}")"
  else
    YOYOO_HOME="${YOYOO_ASSET_ROOT}/${YOYOO_EMPLOYEE_KEY}/state"
  fi
fi
if [[ -z "${OPENCLAW_PORT}" ]]; then
  if [[ "${YOYOO_EMPLOYEE_KEY}" == "${YOYOO_ROLE}" ]]; then
    OPENCLAW_PORT="$(role_default_port "${YOYOO_ROLE}")"
  else
    OPENCLAW_PORT="$(find_free_port)"
    if [[ -z "${OPENCLAW_PORT}" ]]; then
      echo "No available port in 18850-19999 for employee ${YOYOO_EMPLOYEE_KEY}" >&2
      exit 1
    fi
  fi
fi

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "MINIMAX_API_KEY is required" >&2
  exit 1
fi

if [[ -e "${RUNTIME_DIR}" && ! -d "${RUNTIME_DIR}" ]]; then
  echo "RUNTIME_DIR is not a directory: ${RUNTIME_DIR}" >&2
  exit 1
fi

case "${RUNTIME_DIR}" in
  "/"|"/root"|"/home"|"/srv"|"/opt"|"/var"|"/usr"|"/etc")
    echo "Refuse to use unsafe RUNTIME_DIR=${RUNTIME_DIR}" >&2
    exit 1
    ;;
esac

update_repo() {
  local stashed=0
  if [[ "${YOYOO_GIT_AUTO_STASH}" == "1" ]]; then
    if [[ -n "$(git -C "${RUNTIME_DIR}" status --porcelain 2>/dev/null)" ]]; then
      git -C "${RUNTIME_DIR}" stash push -u -m "yoyoo-auto-stash-$(date +%Y%m%d_%H%M%S)" >/tmp/yoyoo_hire_git_stash.log 2>&1 || true
      stashed=1
    fi
  fi

  git -C "${RUNTIME_DIR}" fetch --all --tags
  git -C "${RUNTIME_DIR}" checkout "${GIT_REF}"
  if ! git -C "${RUNTIME_DIR}" pull --ff-only origin "${GIT_REF}" >/tmp/yoyoo_hire_git_pull.log 2>&1; then
    echo "Git pull failed for ref=${GIT_REF}. See /tmp/yoyoo_hire_git_pull.log" >&2
    if [[ "${stashed}" == "1" ]]; then
      echo "Auto-stash was created. Check with: git -C ${RUNTIME_DIR} stash list" >&2
    fi
    exit 1
  fi
}

if [[ -d "${RUNTIME_DIR}/.git" ]]; then
  update_repo
else
  if [[ -d "${RUNTIME_DIR}" ]] && [[ -n "$(ls -A "${RUNTIME_DIR}" 2>/dev/null || true)" ]] && [[ "${YOYOO_FORCE_CLEAN_RUNTIME}" != "1" ]]; then
    echo "RUNTIME_DIR is non-empty and not a git repo: ${RUNTIME_DIR}" >&2
    echo "Refuse to remove automatically. Set YOYOO_FORCE_CLEAN_RUNTIME=1 to force." >&2
    exit 1
  fi
  rm -rf "${RUNTIME_DIR}"
  git clone "${GIT_URL}" "${RUNTIME_DIR}"
  git -C "${RUNTIME_DIR}" checkout "${GIT_REF}"
fi

export YOYOO_ROLE YOYOO_EMPLOYEE_KEY YOYOO_HOME OPENCLAW_PORT YOYOO_ALLOW_SHARED_INSTANCE
bash "${RUNTIME_DIR}/Yoyoo/project/bootstrap/activate_employee.sh"
