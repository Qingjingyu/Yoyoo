#!/usr/bin/env bash
set -euo pipefail

# Yoyoo 1.0 employee activation bootstrap
# Expected to run on Ubuntu server as root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

YOYOO_ROLE="${YOYOO_ROLE:-ceo}"
YOYOO_HOME="${YOYOO_HOME:-/root/.openclaw}"
YOYOO_WORKSPACE="${YOYOO_WORKSPACE:-${YOYOO_HOME}/workspace}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
YOYOO_ENABLE_QMD="${YOYOO_ENABLE_QMD:-1}"
YOYOO_ENABLE_BASE_SKILLS="${YOYOO_ENABLE_BASE_SKILLS:-1}"
YOYOO_DEFAULT_MODEL="${YOYOO_DEFAULT_MODEL:-MiniMax-M2.1}"

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "MINIMAX_API_KEY is required" >&2
  exit 1
fi

case "${YOYOO_ROLE}" in
  ceo|ops|rd-director|rd-engineer) ;;
  *)
    echo "Unsupported YOYOO_ROLE: ${YOYOO_ROLE}" >&2
    exit 1
    ;;
esac

if [[ -z "${OPENCLAW_GATEWAY_TOKEN}" ]]; then
  OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 24)"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/tmp/yoyoo_bootstrap_apt_update.log 2>&1
apt-get install -y curl git jq ca-certificates sqlite3 >/tmp/yoyoo_bootstrap_apt_install.log 2>&1

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash >/tmp/yoyoo_bootstrap_node_setup.log 2>&1
  apt-get install -y nodejs >/tmp/yoyoo_bootstrap_node_install.log 2>&1
fi

npm i -g openclaw@latest >/tmp/yoyoo_bootstrap_openclaw_install.log 2>&1

mkdir -p "${YOYOO_HOME}/agents/main/agent" "${YOYOO_WORKSPACE}"

cat > "${YOYOO_HOME}/openclaw.json" <<JSON
{
  "gateway": {
    "mode": "local",
    "port": ${OPENCLAW_PORT},
    "auth": { "token": "${OPENCLAW_GATEWAY_TOKEN}" }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "minimax": {
        "baseUrl": "https://api.minimaxi.com/anthropic",
        "apiKey": "${MINIMAX_API_KEY}",
        "api": "anthropic-messages",
        "authHeader": true,
        "models": [
          {"id":"MiniMax-M2.5","name":"MiniMax M2.5","reasoning":false,"input":["text"],"contextWindow":200000,"maxTokens":8192},
          {"id":"MiniMax-M2.1","name":"MiniMax M2.1","reasoning":false,"input":["text"],"contextWindow":200000,"maxTokens":8192},
          {"id":"MiniMax-M2.1-lightning","name":"MiniMax M2.1 lightning","reasoning":false,"input":["text"],"contextWindow":200000,"maxTokens":8192}
        ]
      }
    }
  }
}
JSON
chmod 600 "${YOYOO_HOME}/openclaw.json"

cp -f "${SCRIPT_DIR}/profiles/${YOYOO_ROLE}/"*.md "${YOYOO_WORKSPACE}/"

openclaw gateway uninstall >/tmp/yoyoo_bootstrap_gateway_uninstall.log 2>&1 || true
openclaw gateway install --force --port "${OPENCLAW_PORT}" --token "${OPENCLAW_GATEWAY_TOKEN}" >/tmp/yoyoo_bootstrap_gateway_install.log 2>&1
openclaw gateway start >/tmp/yoyoo_bootstrap_gateway_start.log 2>&1
sleep 2

openclaw models set "minimax/${YOYOO_DEFAULT_MODEL}" >/tmp/yoyoo_bootstrap_model_set.log 2>&1 || true

if [[ "${YOYOO_ENABLE_QMD}" == "1" ]]; then
  bash "${SCRIPT_DIR}/qmd_enable.sh"
fi

if [[ "${YOYOO_ENABLE_BASE_SKILLS}" == "1" ]]; then
  bash "${SCRIPT_DIR}/install_base_skills.sh"
fi

bash "${SCRIPT_DIR}/setup_guard.sh"

openclaw gateway status
openclaw models status --json | jq '{defaultModel,resolvedDefault,allowed}'
openclaw agent --local --agent main -m "只回复pong" --json | jq '{payloads,meta:{durationMs,agentMeta}}'

echo "Activation complete"
echo "role=${YOYOO_ROLE}"
echo "workspace=${YOYOO_WORKSPACE}"
echo "gateway_port=${OPENCLAW_PORT}"
