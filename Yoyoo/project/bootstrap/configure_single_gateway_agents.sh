#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEAM_POLICY_TEMPLATE="${SCRIPT_DIR}/profiles/shared/TEAM_ROUTING.md"

YOYOO_HOME="${YOYOO_HOME:-/root/.openclaw}"
YOYOO_PROFILE="${YOYOO_PROFILE:-yoyoo-ceo}"
YOYOO_CTO_AGENT_ID="${YOYOO_CTO_AGENT_ID:-cto}"
YOYOO_CTO_MODEL="${YOYOO_CTO_MODEL:-minimax/MiniMax-M2.5}"
YOYOO_CTO_WORKSPACE="${YOYOO_CTO_WORKSPACE:-${YOYOO_HOME}/workspace-cto}"
YOYOO_TEAM_SHARED_MEMORY="${YOYOO_TEAM_SHARED_MEMORY:-1}"
YOYOO_TEAM_SHARED_USER="${YOYOO_TEAM_SHARED_USER:-1}"

OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH:-${YOYOO_HOME}/openclaw.json}"
RUNTIME_HOME="${YOYOO_RUNTIME_HOME:-$(dirname "${YOYOO_HOME}")}"

oc() {
  HOME="${RUNTIME_HOME}" \
    OPENCLAW_STATE_DIR="${YOYOO_HOME}" \
    OPENCLAW_CONFIG_PATH="${OPENCLAW_CONFIG_PATH}" \
    OPENCLAW_PROFILE="${YOYOO_PROFILE}" \
    openclaw "$@"
}

has_agent() {
  local target="$1"
  if command -v python3 >/dev/null 2>&1; then
    local agents_json
    agents_json="$(oc agents list --json 2>/dev/null || echo '[]')"
    python3 - "$target" "$agents_json" <<'PY'
import json
import sys
target = sys.argv[1]
raw = sys.argv[2]
agents = json.loads(raw)
print("1" if any((a or {}).get("id") == target for a in agents) else "0")
PY
    return 0
  fi
  oc agents list | grep -qE "(^|[[:space:]])${target}([[:space:]]|$)"
}

wire_shared_memory() {
  local ceo_workspace cto_workspace ts
  ceo_workspace="${YOYOO_HOME}/workspace"
  cto_workspace="${YOYOO_CTO_WORKSPACE}"

  mkdir -p "${ceo_workspace}/memory" "${cto_workspace}"

  if [[ -f "${TEAM_POLICY_TEMPLATE}" ]]; then
    cp -f "${TEAM_POLICY_TEMPLATE}" "${ceo_workspace}/TEAM_ROUTING.md"
    ln -sfn "${ceo_workspace}/TEAM_ROUTING.md" "${cto_workspace}/TEAM_ROUTING.md"
  fi

  if [[ "${YOYOO_TEAM_SHARED_MEMORY}" != "1" ]]; then
    echo "[Yoyoo] shared memory disabled (YOYOO_TEAM_SHARED_MEMORY=${YOYOO_TEAM_SHARED_MEMORY})"
    return 0
  fi

  if [[ ! -f "${ceo_workspace}/MEMORY.md" ]]; then
    cat > "${ceo_workspace}/MEMORY.md" <<'EOF'
# MEMORY.md - Yoyoo Team Shared Memory

- This memory is shared by CEO and CTO in single-gateway mode.
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

  if [[ "${YOYOO_TEAM_SHARED_USER}" == "1" && -f "${ceo_workspace}/USER.md" ]]; then
    if [[ -e "${cto_workspace}/USER.md" && ! -L "${cto_workspace}/USER.md" ]]; then
      mv "${cto_workspace}/USER.md" "${cto_workspace}/USER.md.bak.${ts}"
    fi
    ln -sfn "${ceo_workspace}/USER.md" "${cto_workspace}/USER.md"
  fi
}

main() {
  if ! command -v openclaw >/dev/null 2>&1; then
    echo "openclaw not found" >&2
    exit 1
  fi

  mkdir -p "${YOYOO_HOME}" "${YOYOO_CTO_WORKSPACE}"

  local exists
  exists="$(has_agent "${YOYOO_CTO_AGENT_ID}" || true)"
  if [[ "${exists}" != "1" ]]; then
    echo "[Yoyoo] adding CTO agent (${YOYOO_CTO_AGENT_ID})..."
    oc agents add "${YOYOO_CTO_AGENT_ID}" \
      --non-interactive \
      --workspace "${YOYOO_CTO_WORKSPACE}" \
      --model "${YOYOO_CTO_MODEL}" >/tmp/yoyoo_single_mode_add_cto.log 2>&1
  else
    echo "[Yoyoo] CTO agent already exists: ${YOYOO_CTO_AGENT_ID}"
  fi

  oc agents set-identity \
    --agent "${YOYOO_CTO_AGENT_ID}" \
    --name "Yoyoo CTO" \
    --emoji "🛠️" >/tmp/yoyoo_single_mode_cto_identity.log 2>&1 || true

  wire_shared_memory

  echo "[Yoyoo] single gateway team configured: CEO(main) + CTO(${YOYOO_CTO_AGENT_ID})"
}

main "$@"
