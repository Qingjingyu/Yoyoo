#!/usr/bin/env bash
set -euo pipefail

# Safe employee hiring wrapper:
# - enforces role isolation defaults
# - executes hire_employee_from_git.sh
# - verifies new employee instance + CEO instance are both healthy

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HIRE_SCRIPT="${SCRIPT_DIR}/hire_employee_from_git.sh"

ROLE="${1:-ops}"
EMPLOYEE_KEY="${2:-${YOYOO_EMPLOYEE_KEY:-${ROLE}}}"
CEO_HOME="${CEO_HOME:-/root/.openclaw}"
CEO_PORT="${CEO_PORT:-18789}"
CEO_PROFILE="${CEO_PROFILE:-yoyoo-ceo}"
CEO_SYSTEMD_UNIT="${CEO_SYSTEMD_UNIT:-openclaw-gateway.service}"
YOYOO_RUN_ACCEPTANCE="${YOYOO_RUN_ACCEPTANCE:-1}"
ACCEPTANCE_SCRIPT="${SCRIPT_DIR}/acceptance_check.sh"

usage() {
  cat <<USAGE
Usage:
  bash $(basename "$0") [role] [employee_key]

Roles:
  ops | rd-director | rd-engineer

Examples:
  bash $(basename "$0") ops
  bash $(basename "$0") ops xiaoguang-ops
  MINIMAX_API_KEY='xxx' bash $(basename "$0") rd-director
USAGE
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

resolve_role_defaults() {
  EMPLOYEE_KEY="$(sanitize_employee_key "${EMPLOYEE_KEY}")"
  if [[ -z "${EMPLOYEE_KEY}" ]]; then
    echo "Invalid employee key: ${EMPLOYEE_KEY}" >&2
    exit 2
  fi
  case "${ROLE}" in
    ops)
      if [[ "${EMPLOYEE_KEY}" == "ops" ]]; then
        YOYOO_HOME="/root/.openclaw-ops"
        OPENCLAW_PORT="18790"
      else
        YOYOO_HOME="/srv/yoyoo/${EMPLOYEE_KEY}/state"
        OPENCLAW_PORT="$(find_free_port)"
      fi
      YOYOO_PROFILE="yoyoo-${EMPLOYEE_KEY}"
      OPENCLAW_SYSTEMD_UNIT="openclaw-gateway-${EMPLOYEE_KEY}.service"
      YOYOO_EXPECT_FEISHU="0"
      ;;
    rd-director)
      if [[ "${EMPLOYEE_KEY}" == "rd-director" ]]; then
        YOYOO_HOME="/root/.openclaw-rd-director"
        OPENCLAW_PORT="18791"
      else
        YOYOO_HOME="/srv/yoyoo/${EMPLOYEE_KEY}/state"
        OPENCLAW_PORT="$(find_free_port)"
      fi
      YOYOO_PROFILE="yoyoo-${EMPLOYEE_KEY}"
      OPENCLAW_SYSTEMD_UNIT="openclaw-gateway-${EMPLOYEE_KEY}.service"
      YOYOO_EXPECT_FEISHU="0"
      ;;
    rd-engineer)
      if [[ "${EMPLOYEE_KEY}" == "rd-engineer" ]]; then
        YOYOO_HOME="/root/.openclaw-rd-engineer"
        OPENCLAW_PORT="18793"
      else
        YOYOO_HOME="/srv/yoyoo/${EMPLOYEE_KEY}/state"
        OPENCLAW_PORT="$(find_free_port)"
      fi
      YOYOO_PROFILE="yoyoo-${EMPLOYEE_KEY}"
      OPENCLAW_SYSTEMD_UNIT="openclaw-gateway-${EMPLOYEE_KEY}.service"
      YOYOO_EXPECT_FEISHU="0"
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      echo "Unsupported role: ${ROLE}" >&2
      usage
      exit 2
      ;;
  esac
}

load_minimax_key_if_missing() {
  if [[ -n "${MINIMAX_API_KEY:-}" ]]; then
    return 0
  fi
  if [[ -f "${CEO_HOME}/openclaw.json" ]]; then
    MINIMAX_API_KEY="$(jq -r '.models.providers.minimax.apiKey // empty' "${CEO_HOME}/openclaw.json" 2>/dev/null || true)"
  else
    MINIMAX_API_KEY=""
  fi
  if [[ -z "${MINIMAX_API_KEY}" ]]; then
    echo "MINIMAX_API_KEY is required (env not set and CEO config missing key)." >&2
    exit 1
  fi
  export MINIMAX_API_KEY
}

probe_instance() {
  local state_dir="$1"
  local profile="$2"
  local unit="$3"
  local port="$4"
  local log_file="$5"
  OPENCLAW_STATE_DIR="${state_dir}" \
  OPENCLAW_PROFILE="${profile}" \
  OPENCLAW_SYSTEMD_UNIT="${unit}" \
  OPENCLAW_GATEWAY_PORT="${port}" \
  openclaw channels status --probe >"${log_file}" 2>&1
}

resolve_role_defaults
load_minimax_key_if_missing

if [[ -z "${OPENCLAW_PORT:-}" ]]; then
  echo "Failed to allocate OPENCLAW_PORT for employee ${EMPLOYEE_KEY}" >&2
  exit 1
fi

echo "[safe-hire] role=${ROLE} home=${YOYOO_HOME} port=${OPENCLAW_PORT} profile=${YOYOO_PROFILE}"
echo "[safe-hire] starting hire flow..."

export YOYOO_ROLE="${ROLE}"
export YOYOO_EMPLOYEE_KEY="${EMPLOYEE_KEY}"
export YOYOO_HOME
export OPENCLAW_PORT
export YOYOO_PROFILE
export OPENCLAW_SYSTEMD_UNIT
export YOYOO_EXPECT_FEISHU
export YOYOO_ALLOW_SHARED_INSTANCE="0"

bash "${HIRE_SCRIPT}"

new_probe_log="/tmp/yoyoo_hire_probe_${ROLE}.log"
ceo_probe_log="/tmp/yoyoo_hire_probe_ceo.log"

new_ok="0"
ceo_ok="0"

if probe_instance "${YOYOO_HOME}" "${YOYOO_PROFILE}" "${OPENCLAW_SYSTEMD_UNIT}" "${OPENCLAW_PORT}" "${new_probe_log}"; then
  new_ok="1"
fi
if probe_instance "${CEO_HOME}" "${CEO_PROFILE}" "${CEO_SYSTEMD_UNIT}" "${CEO_PORT}" "${ceo_probe_log}"; then
  ceo_ok="1"
fi

echo "=== Hire Report ==="
echo "new_employee_role=${ROLE}"
echo "new_employee_key=${EMPLOYEE_KEY}"
echo "new_employee_probe=$([[ "${new_ok}" == "1" ]] && echo PASS || echo FAIL)"
echo "ceo_probe=$([[ "${ceo_ok}" == "1" ]] && echo PASS || echo FAIL)"
echo "new_employee_log=${new_probe_log}"
echo "ceo_log=${ceo_probe_log}"

if [[ "${new_ok}" != "1" || "${ceo_ok}" != "1" ]]; then
  echo "[safe-hire] verification failed, check logs above." >&2
  exit 1
fi

echo "[safe-hire] success: employee hired and CEO still healthy."

if [[ "${YOYOO_RUN_ACCEPTANCE}" == "1" ]]; then
  if [[ -x "${ACCEPTANCE_SCRIPT}" ]]; then
    if [[ "${EMPLOYEE_KEY}" == "${ROLE}" ]]; then
      echo "[safe-hire] running acceptance check for ceo + ${ROLE}..."
      if SCAN_ROLES="ceo ${ROLE}" "${ACCEPTANCE_SCRIPT}"; then
        echo "[safe-hire] acceptance PASS (ceo + ${ROLE})"
      else
        echo "[safe-hire] acceptance FAIL (ceo + ${ROLE})" >&2
        exit 1
      fi
    else
      echo "[safe-hire] custom employee key detected (${EMPLOYEE_KEY}), running acceptance for ceo only..."
      if SCAN_ROLES="ceo" "${ACCEPTANCE_SCRIPT}"; then
        echo "[safe-hire] acceptance PASS (ceo). custom employee validated by direct probe."
      else
        echo "[safe-hire] acceptance FAIL (ceo)" >&2
        exit 1
      fi
    fi
  else
    echo "[safe-hire] acceptance script not executable: ${ACCEPTANCE_SCRIPT}" >&2
    exit 1
  fi
fi
