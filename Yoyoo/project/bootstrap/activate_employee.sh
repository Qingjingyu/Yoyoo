#!/usr/bin/env bash
set -euo pipefail

# Yoyoo 1.0.1 employee activation bootstrap
# Expected to run on Ubuntu server as root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../backend" && pwd)"

YOYOO_ROLE="${YOYOO_ROLE:-ceo}"
YOYOO_HOME="${YOYOO_HOME:-/root/.openclaw}"
YOYOO_WORKSPACE="${YOYOO_WORKSPACE:-${YOYOO_HOME}/workspace}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
YOYOO_ENABLE_QMD="${YOYOO_ENABLE_QMD:-1}"
YOYOO_ENABLE_BASE_SKILLS="${YOYOO_ENABLE_BASE_SKILLS:-1}"
YOYOO_DEFAULT_MODEL="${YOYOO_DEFAULT_MODEL:-MiniMax-M2.1}"
YOYOO_FORCE_OPENCLAW_INSTALL="${YOYOO_FORCE_OPENCLAW_INSTALL:-0}"
YOYOO_BASELINE_VERSION="${YOYOO_BASELINE_VERSION:-1.0.1}"
YOYOO_ENABLE_BACKEND_KERNEL="${YOYOO_ENABLE_BACKEND_KERNEL:-1}"
YOYOO_BACKEND_PORT="${YOYOO_BACKEND_PORT:-8000}"
YOYOO_BACKEND_SERVICE_NAME="${YOYOO_BACKEND_SERVICE_NAME:-yoyoo-backend.service}"
YOYOO_BACKEND_ENV_FILE="${YOYOO_BACKEND_ENV_FILE:-/etc/yoyoo/backend.env}"
YOYOO_BACKEND_MEMORY_FILE="${YOYOO_BACKEND_MEMORY_FILE:-${BACKEND_DIR}/data/yoyoo_memory.json}"

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
apt-get install -y curl git jq ca-certificates sqlite3 python3-venv >/tmp/yoyoo_bootstrap_apt_install.log 2>&1

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash >/tmp/yoyoo_bootstrap_node_setup.log 2>&1
  apt-get install -y nodejs >/tmp/yoyoo_bootstrap_node_install.log 2>&1
fi

if [[ "${YOYOO_FORCE_OPENCLAW_INSTALL}" == "1" ]] || ! command -v openclaw >/dev/null 2>&1; then
  npm i -g openclaw@latest >/tmp/yoyoo_bootstrap_openclaw_install.log 2>&1
fi

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

if [[ "${YOYOO_ENABLE_BACKEND_KERNEL}" == "1" ]]; then
  python3 -m venv "${BACKEND_DIR}/.venv"
  "${BACKEND_DIR}/.venv/bin/pip" install -U pip >/tmp/yoyoo_bootstrap_backend_pip_bootstrap.log 2>&1
  "${BACKEND_DIR}/.venv/bin/pip" install \
    'fastapi>=0.115,<1.0' \
    'uvicorn[standard]>=0.32,<1.0' \
    'pydantic>=2.8,<3.0' \
    'httpx>=0.28,<1.0' \
    'pytest>=8.3,<9.0' \
    'ruff>=0.8,<1.0' \
    >/tmp/yoyoo_bootstrap_backend_pip_install.log 2>&1

  mkdir -p "$(dirname "${YOYOO_BACKEND_ENV_FILE}")" "${BACKEND_DIR}/data"
  if [[ ! -f "${YOYOO_BACKEND_ENV_FILE}" ]]; then
    cat > "${YOYOO_BACKEND_ENV_FILE}" <<ENV
YOYOO_MEMORY_FILE=${YOYOO_BACKEND_MEMORY_FILE}
YOYOO_YYOS_ENABLED=0
OPENCLAW_LOCAL_EXEC=1
OPENCLAW_FALLBACK_TO_SSH_ON_LOCAL_FAILURE=1
OPENCLAW_REMOTE_OPENCLAW_BIN=openclaw
OPENCLAW_EXEC_TIMEOUT_SEC=45
ENV
    chmod 600 "${YOYOO_BACKEND_ENV_FILE}"
  fi

  cat > "/etc/systemd/system/${YOYOO_BACKEND_SERVICE_NAME}" <<UNIT
[Unit]
Description=Yoyoo Backend Service
After=network.target openclaw-gateway.service

[Service]
Type=simple
User=root
WorkingDirectory=${BACKEND_DIR}
EnvironmentFile=-${YOYOO_BACKEND_ENV_FILE}
Environment=PYTHONUNBUFFERED=1
ExecStart=${BACKEND_DIR}/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port ${YOYOO_BACKEND_PORT}
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT

  systemctl daemon-reload
  systemctl enable --now "${YOYOO_BACKEND_SERVICE_NAME}" >/tmp/yoyoo_bootstrap_backend_service.log 2>&1
  curl -fsS "http://127.0.0.1:${YOYOO_BACKEND_PORT}/healthz" >/tmp/yoyoo_bootstrap_backend_healthz.json
fi

openclaw gateway status
openclaw models status --json | jq '{defaultModel,resolvedDefault,allowed}'
openclaw agent --local --agent main -m "只回复pong" --json | jq '{payloads,meta:{durationMs,agentMeta}}'

echo "Activation complete"
echo "baseline_version=${YOYOO_BASELINE_VERSION}"
echo "role=${YOYOO_ROLE}"
echo "workspace=${YOYOO_WORKSPACE}"
echo "gateway_port=${OPENCLAW_PORT}"
if [[ "${YOYOO_ENABLE_BACKEND_KERNEL}" == "1" ]]; then
  echo "backend_service=${YOYOO_BACKEND_SERVICE_NAME}"
  echo "backend_port=${YOYOO_BACKEND_PORT}"
fi
