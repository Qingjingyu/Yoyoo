#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTIVATE_SCRIPT="${SCRIPT_DIR}/activate_employee.sh"
ACCEPTANCE_SCRIPT="${SCRIPT_DIR}/acceptance_check.sh"

if [[ ! -x "${ACTIVATE_SCRIPT}" ]]; then
  echo "activate script not found or not executable: ${ACTIVATE_SCRIPT}" >&2
  exit 1
fi

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "MINIMAX_API_KEY is required" >&2
  exit 1
fi

run_activate() {
  local role="$1"
  local home="$2"
  local port="$3"
  local profile="$4"
  local unit="$5"
  local expect_feishu="$6"

  echo ""
  echo "[Yoyoo] Activating role=${role} home=${home} port=${port}"
  MINIMAX_API_KEY="${MINIMAX_API_KEY}" \
  YOYOO_ROLE="${role}" \
  YOYOO_HOME="${home}" \
  OPENCLAW_PORT="${port}" \
  YOYOO_PROFILE="${profile}" \
  OPENCLAW_SYSTEMD_UNIT="${unit}" \
  YOYOO_EXPECT_FEISHU="${expect_feishu}" \
  bash "${ACTIVATE_SCRIPT}"
}

run_activate \
  "ceo" \
  "${YOYOO_CEO_HOME:-/root/.openclaw}" \
  "${YOYOO_CEO_PORT:-18789}" \
  "${YOYOO_CEO_PROFILE:-yoyoo-ceo}" \
  "${YOYOO_CEO_UNIT:-openclaw-gateway.service}" \
  "${YOYOO_CEO_EXPECT_FEISHU:-1}"

run_activate \
  "cto" \
  "${YOYOO_CTO_HOME:-/root/.openclaw-cto}" \
  "${YOYOO_CTO_PORT:-18794}" \
  "${YOYOO_CTO_PROFILE:-yoyoo-cto}" \
  "${YOYOO_CTO_UNIT:-openclaw-gateway-cto.service}" \
  "${YOYOO_CTO_EXPECT_FEISHU:-0}"

if [[ "${YOYOO_RUN_ACCEPTANCE:-1}" == "1" ]] && [[ -x "${ACCEPTANCE_SCRIPT}" ]]; then
  echo ""
  echo "[Yoyoo] Running acceptance check for ceo + cto"
  SCAN_ROLES="ceo cto" bash "${ACCEPTANCE_SCRIPT}"
fi

echo ""
echo "[Yoyoo] Done. Check service status:"
echo "  systemctl status ${YOYOO_CEO_UNIT:-openclaw-gateway.service} --no-pager"
echo "  systemctl status ${YOYOO_CTO_UNIT:-openclaw-gateway-cto.service} --no-pager"
