#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTIVATE_SCRIPT="${SCRIPT_DIR}/activate_employee.sh"
ACCEPTANCE_SCRIPT="${SCRIPT_DIR}/acceptance_check.sh"
TEAM_POLICY_TEMPLATE="${SCRIPT_DIR}/profiles/shared/TEAM_ROUTING.md"

YOYOO_TEAM_SHARED_MEMORY="${YOYOO_TEAM_SHARED_MEMORY:-1}"
YOYOO_TEAM_SHARED_USER="${YOYOO_TEAM_SHARED_USER:-1}"

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

install_team_policy() {
  local ceo_workspace="$1"
  local cto_workspace="$2"

  if [[ ! -f "${TEAM_POLICY_TEMPLATE}" ]]; then
    echo "[Yoyoo] team policy template missing, skip: ${TEAM_POLICY_TEMPLATE}" >&2
    return 0
  fi

  mkdir -p "${ceo_workspace}" "${cto_workspace}"
  if [[ ! -f "${ceo_workspace}/TEAM_ROUTING.md" ]]; then
    cp -f "${TEAM_POLICY_TEMPLATE}" "${ceo_workspace}/TEAM_ROUTING.md"
  fi
  ln -sfn "${ceo_workspace}/TEAM_ROUTING.md" "${cto_workspace}/TEAM_ROUTING.md"
}

wire_shared_team_memory() {
  local ceo_home="${YOYOO_CEO_HOME:-/root/.openclaw}"
  local cto_home="${YOYOO_CTO_HOME:-/root/.openclaw-cto}"
  local ceo_workspace="${ceo_home}/workspace"
  local cto_workspace="${cto_home}/workspace"
  local ts

  if [[ "${YOYOO_TEAM_SHARED_MEMORY}" != "1" ]]; then
    echo "[Yoyoo] YOYOO_TEAM_SHARED_MEMORY=${YOYOO_TEAM_SHARED_MEMORY}, skip shared-memory wiring."
    return 0
  fi

  mkdir -p "${ceo_workspace}/memory" "${cto_workspace}"
  install_team_policy "${ceo_workspace}" "${cto_workspace}"

  if [[ ! -f "${ceo_workspace}/MEMORY.md" ]]; then
    cat > "${ceo_workspace}/MEMORY.md" <<'EOF'
# MEMORY.md - Yoyoo Team Shared Memory

- This memory is shared by CEO and CTO in team mode.
EOF
  fi

  ts="$(date +%Y%m%d_%H%M%S)"
  if [[ -e "${cto_workspace}/MEMORY.md" && ! -L "${cto_workspace}/MEMORY.md" ]]; then
    mv "${cto_workspace}/MEMORY.md" "${cto_workspace}/MEMORY.md.bak.${ts}"
  fi
  ln -sfn "${ceo_workspace}/MEMORY.md" "${cto_workspace}/MEMORY.md"

  if [[ -e "${cto_workspace}/memory" && ! -L "${cto_workspace}/memory" ]]; then
    mv "${cto_workspace}/memory" "${cto_workspace}/memory.bak.${ts}"
  fi
  ln -sfn "${ceo_workspace}/memory" "${cto_workspace}/memory"

  if [[ "${YOYOO_TEAM_SHARED_USER}" == "1" ]]; then
    if [[ -e "${cto_workspace}/USER.md" && ! -L "${cto_workspace}/USER.md" ]]; then
      mv "${cto_workspace}/USER.md" "${cto_workspace}/USER.md.bak.${ts}"
    fi
    if [[ -f "${ceo_workspace}/USER.md" ]]; then
      ln -sfn "${ceo_workspace}/USER.md" "${cto_workspace}/USER.md"
    fi
  fi

  echo "[Yoyoo] CEO/CTO shared-memory wiring complete."
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

wire_shared_team_memory

if [[ "${YOYOO_RUN_ACCEPTANCE:-1}" == "1" ]] && [[ -x "${ACCEPTANCE_SCRIPT}" ]]; then
  echo ""
  echo "[Yoyoo] Running acceptance check for ceo + cto"
  SCAN_ROLES="ceo cto" bash "${ACCEPTANCE_SCRIPT}"
fi

echo ""
echo "[Yoyoo] Done. Check service status:"
echo "  systemctl status ${YOYOO_CEO_UNIT:-openclaw-gateway.service} --no-pager"
echo "  systemctl status ${YOYOO_CTO_UNIT:-openclaw-gateway-cto.service} --no-pager"
