#!/usr/bin/env bash
set -euo pipefail

# Yoyoo 1.0.1 employee activation bootstrap
# Expected to run on Ubuntu server as root.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "${SCRIPT_DIR}/../backend" && pwd)"

YOYOO_ROLE="${YOYOO_ROLE:-ceo}"
YOYOO_HOME="${YOYOO_HOME:-}"
OPENCLAW_PORT="${OPENCLAW_PORT:-}"
OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-}"
YOYOO_ENABLE_QMD="${YOYOO_ENABLE_QMD:-1}"
YOYOO_ENABLE_BASE_SKILLS="${YOYOO_ENABLE_BASE_SKILLS:-1}"
YOYOO_DEFAULT_MODEL="${YOYOO_DEFAULT_MODEL:-MiniMax-M2.1}"
YOYOO_FORCE_OPENCLAW_INSTALL="${YOYOO_FORCE_OPENCLAW_INSTALL:-0}"
YOYOO_BASELINE_VERSION="${YOYOO_BASELINE_VERSION:-1.0.1}"
YOYOO_ENABLE_BACKEND_KERNEL="${YOYOO_ENABLE_BACKEND_KERNEL:-1}"
YOYOO_BACKEND_PORT="${YOYOO_BACKEND_PORT:-}"
YOYOO_BACKEND_SERVICE_NAME="${YOYOO_BACKEND_SERVICE_NAME:-}"
YOYOO_BACKEND_ENV_FILE="${YOYOO_BACKEND_ENV_FILE:-}"
YOYOO_BACKEND_MEMORY_FILE="${YOYOO_BACKEND_MEMORY_FILE:-}"
YOYOO_ALLOW_SHARED_INSTANCE="${YOYOO_ALLOW_SHARED_INSTANCE:-0}"
YOYOO_EXPECT_FEISHU="${YOYOO_EXPECT_FEISHU:-}"
YOYOO_EXPECT_FEISHU_GROUP_POLICY="${YOYOO_EXPECT_FEISHU_GROUP_POLICY:-}"
YOYOO_EXPECT_FEISHU_REQUIRE_MENTION="${YOYOO_EXPECT_FEISHU_REQUIRE_MENTION:-}"
YOYOO_EXPECT_FEISHU_UNIFIED_SESSION="${YOYOO_EXPECT_FEISHU_UNIFIED_SESSION:-}"
YOYOO_FREEZE_BASELINE_ON_ACTIVATION="${YOYOO_FREEZE_BASELINE_ON_ACTIVATION:-0}"
YOYOO_PROFILE="${YOYOO_PROFILE:-}"
OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT:-}"
YOYOO_EMPLOYEE_KEY="${YOYOO_EMPLOYEE_KEY:-}"
YOYOO_ASSET_ROOT="${YOYOO_ASSET_ROOT:-/srv/yoyoo}"
YOYOO_ENABLE_STRICT_ISOLATION="${YOYOO_ENABLE_STRICT_ISOLATION:-1}"
YOYOO_LINUX_USER="${YOYOO_LINUX_USER:-}"
YOYOO_LINUX_GROUP="${YOYOO_LINUX_GROUP:-}"
YOYOO_RUNTIME_HOME="${YOYOO_RUNTIME_HOME:-}"
YOYOO_WORKSPACE="${YOYOO_WORKSPACE:-}"

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

role_default_home() {
  case "$1" in
    ceo) echo "/root/.openclaw" ;;
    ops) echo "/root/.openclaw-ops" ;;
    rd-director) echo "/root/.openclaw-rd-director" ;;
    rd-engineer) echo "/root/.openclaw-rd-engineer" ;;
    *) return 1 ;;
  esac
}

role_default_port() {
  case "$1" in
    ceo) echo "18789" ;;
    ops) echo "18790" ;;
    rd-director) echo "18791" ;;
    rd-engineer) echo "18793" ;;
    *) return 1 ;;
  esac
}

role_default_backend_port() {
  case "$1" in
    ceo) echo "8000" ;;
    ops) echo "8001" ;;
    rd-director) echo "8002" ;;
    rd-engineer) echo "8003" ;;
    *) return 1 ;;
  esac
}

role_default_backend_service() {
  case "$1" in
    ceo) echo "yoyoo-backend-ceo.service" ;;
    ops) echo "yoyoo-backend-ops.service" ;;
    rd-director) echo "yoyoo-backend-rd-director.service" ;;
    rd-engineer) echo "yoyoo-backend-rd-engineer.service" ;;
    *) return 1 ;;
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

ensure_isolated_employee_root() {
  local root_dir="$1"
  local svc_user="$2"
  local svc_group="$3"

  if ! id -u "${svc_user}" >/dev/null 2>&1; then
    useradd --system --user-group --home-dir "${root_dir}" --shell /usr/sbin/nologin "${svc_user}" >/tmp/yoyoo_bootstrap_useradd.log 2>&1
  fi

  mkdir -p "${root_dir}" "${root_dir}/state" "${root_dir}/workspace" "${root_dir}/backups" "${root_dir}/baseline" "${root_dir}/backend"
  chown -R "${svc_user}:${svc_group}" "${root_dir}"
  chmod 700 "${root_dir}" "${root_dir}/state" "${root_dir}/workspace" "${root_dir}/backups" "${root_dir}/baseline" "${root_dir}/backend"
}

apply_asset_permissions() {
  if [[ -n "${YOYOO_LINUX_USER:-}" && -n "${YOYOO_LINUX_GROUP:-}" ]]; then
    chown -R "${YOYOO_LINUX_USER}:${YOYOO_LINUX_GROUP}" "${YOYOO_HOME}" "${YOYOO_WORKSPACE}" "${YOYOO_RUNTIME_HOME}" >/tmp/yoyoo_bootstrap_chown.log 2>&1 || true
    chmod 700 "${YOYOO_HOME}" "${YOYOO_WORKSPACE}" "${YOYOO_RUNTIME_HOME}" >/tmp/yoyoo_bootstrap_chmod.log 2>&1 || true
  fi
}

wait_for_http() {
  local url="$1"
  local timeout_sec="${2:-30}"
  local waited=0
  while (( waited < timeout_sec )); do
    if curl -fsS "${url}" >/tmp/yoyoo_bootstrap_backend_healthz.json 2>/dev/null; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  return 1
}

disable_user_gateway_units() {
  if [[ ! -S /run/user/0/bus ]]; then
    return 0
  fi
  local old_xdg old_dbus units unit
  old_xdg="${XDG_RUNTIME_DIR:-}"
  old_dbus="${DBUS_SESSION_BUS_ADDRESS:-}"
  export XDG_RUNTIME_DIR=/run/user/0
  export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/0/bus
  units=(
    "openclaw-gateway.service"
    "openclaw-gateway-${YOYOO_ROLE}.service"
    "openclaw-gateway-${YOYOO_PROFILE}.service"
    "openclaw-gateway-yoyoo-${YOYOO_ROLE}.service"
    "openclaw-gateway-yoyoo-${YOYOO_PROFILE}.service"
  )
  for unit in "${units[@]}"; do
    systemctl --user stop "${unit}" >/dev/null 2>&1 || true
    systemctl --user disable "${unit}" >/dev/null 2>&1 || true
    systemctl --user reset-failed "${unit}" >/dev/null 2>&1 || true
  done
  if [[ -n "${old_xdg}" ]]; then
    export XDG_RUNTIME_DIR="${old_xdg}"
  else
    unset XDG_RUNTIME_DIR
  fi
  if [[ -n "${old_dbus}" ]]; then
    export DBUS_SESSION_BUS_ADDRESS="${old_dbus}"
  else
    unset DBUS_SESSION_BUS_ADDRESS
  fi
}

install_system_gateway_service() {
  cat > "/etc/systemd/system/${OPENCLAW_SYSTEMD_UNIT}" <<UNIT
[Unit]
Description=OpenClaw Gateway (${YOYOO_ROLE})
After=network.target

[Service]
Type=simple
User=${YOYOO_LINUX_USER}
Group=${YOYOO_LINUX_GROUP}
UMask=0077
WorkingDirectory=${YOYOO_RUNTIME_HOME}
Environment="HOME=${YOYOO_RUNTIME_HOME}"
Environment="OPENCLAW_STATE_DIR=${YOYOO_HOME}"
Environment="OPENCLAW_PROFILE=${YOYOO_PROFILE}"
Environment="OPENCLAW_GATEWAY_PORT=${OPENCLAW_PORT}"
Environment="OPENCLAW_GATEWAY_TOKEN=${OPENCLAW_GATEWAY_TOKEN}"
ExecStart=/usr/bin/openclaw gateway run --port ${OPENCLAW_PORT} --token ${OPENCLAW_GATEWAY_TOKEN} --bind loopback
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl stop "${OPENCLAW_SYSTEMD_UNIT}" >/tmp/yoyoo_bootstrap_gateway_stop.log 2>&1 || true
  pkill -f "/usr/lib/node_modules/openclaw/dist/index.js gateway --port ${OPENCLAW_PORT}" >/dev/null 2>&1 || true
  sleep 1
  systemctl enable --now "${OPENCLAW_SYSTEMD_UNIT}" >/tmp/yoyoo_bootstrap_gateway_enable.log 2>&1
}

if [[ -z "${YOYOO_EMPLOYEE_KEY}" ]]; then
  YOYOO_EMPLOYEE_KEY="${YOYOO_ROLE}"
fi
YOYOO_EMPLOYEE_KEY="$(sanitize_employee_key "${YOYOO_EMPLOYEE_KEY}")"
if [[ -z "${YOYOO_EMPLOYEE_KEY}" ]]; then
  echo "YOYOO_EMPLOYEE_KEY is invalid" >&2
  exit 1
fi

if [[ -z "${OPENCLAW_PORT}" ]]; then
  OPENCLAW_PORT="$(role_default_port "${YOYOO_ROLE}")"
fi
if [[ -z "${YOYOO_PROFILE}" ]]; then
  YOYOO_PROFILE="yoyoo-${YOYOO_EMPLOYEE_KEY}"
fi
if [[ -z "${OPENCLAW_SYSTEMD_UNIT}" ]]; then
  if [[ "${YOYOO_ROLE}" == "ceo" && "${YOYOO_EMPLOYEE_KEY}" == "ceo" ]]; then
    OPENCLAW_SYSTEMD_UNIT="openclaw-gateway.service"
  else
    OPENCLAW_SYSTEMD_UNIT="openclaw-gateway-${YOYOO_EMPLOYEE_KEY}.service"
  fi
fi
if [[ -z "${YOYOO_BACKEND_PORT}" ]]; then
  YOYOO_BACKEND_PORT="$(role_default_backend_port "${YOYOO_ROLE}")"
fi
if [[ -z "${YOYOO_BACKEND_SERVICE_NAME}" ]]; then
  if [[ "${YOYOO_EMPLOYEE_KEY}" == "${YOYOO_ROLE}" ]]; then
    YOYOO_BACKEND_SERVICE_NAME="$(role_default_backend_service "${YOYOO_ROLE}")"
  else
    YOYOO_BACKEND_SERVICE_NAME="yoyoo-backend-${YOYOO_EMPLOYEE_KEY}.service"
  fi
fi
if [[ -z "${YOYOO_BACKEND_ENV_FILE}" ]]; then
  YOYOO_BACKEND_ENV_FILE="/etc/yoyoo/backend-${YOYOO_EMPLOYEE_KEY}.env"
fi
if [[ "${YOYOO_ENABLE_STRICT_ISOLATION}" == "1" ]]; then
  if [[ "${YOYOO_EMPLOYEE_KEY}" == "${YOYOO_ROLE}" && -z "${YOYOO_HOME}" ]]; then
    YOYOO_HOME="$(role_default_home "${YOYOO_ROLE}")"
    if [[ -z "${YOYOO_RUNTIME_HOME}" ]]; then
      YOYOO_RUNTIME_HOME="$(dirname "${YOYOO_HOME}")"
    fi
    if [[ -z "${YOYOO_WORKSPACE}" ]]; then
      YOYOO_WORKSPACE="${YOYOO_HOME}/workspace"
    fi
    if [[ -z "${YOYOO_LINUX_USER}" ]]; then
      YOYOO_LINUX_USER="root"
    fi
    if [[ -z "${YOYOO_LINUX_GROUP}" ]]; then
      YOYOO_LINUX_GROUP="root"
    fi
  else
    if [[ -z "${YOYOO_LINUX_USER}" ]]; then
      YOYOO_LINUX_USER="yoyoo-${YOYOO_EMPLOYEE_KEY}"
    fi
    if [[ -z "${YOYOO_LINUX_GROUP}" ]]; then
      YOYOO_LINUX_GROUP="${YOYOO_LINUX_USER}"
    fi
    YOYOO_RUNTIME_HOME="${YOYOO_RUNTIME_HOME:-${YOYOO_ASSET_ROOT}/${YOYOO_EMPLOYEE_KEY}}"
    ensure_isolated_employee_root "${YOYOO_RUNTIME_HOME}" "${YOYOO_LINUX_USER}" "${YOYOO_LINUX_GROUP}"
    if [[ -z "${YOYOO_HOME}" ]]; then
      YOYOO_HOME="${YOYOO_RUNTIME_HOME}/state"
    fi
    if [[ -z "${YOYOO_WORKSPACE}" ]]; then
      YOYOO_WORKSPACE="${YOYOO_RUNTIME_HOME}/workspace"
    fi
  fi
else
  if [[ -z "${YOYOO_HOME}" ]]; then
    YOYOO_HOME="$(role_default_home "${YOYOO_ROLE}")"
  fi
  if [[ -z "${YOYOO_WORKSPACE}" ]]; then
    YOYOO_WORKSPACE="${YOYOO_HOME}/workspace"
  fi
  if [[ -z "${YOYOO_RUNTIME_HOME}" ]]; then
    YOYOO_RUNTIME_HOME="$(dirname "${YOYOO_HOME}")"
  fi
  if [[ -z "${YOYOO_LINUX_USER}" ]]; then
    YOYOO_LINUX_USER="root"
  fi
  if [[ -z "${YOYOO_LINUX_GROUP}" ]]; then
    YOYOO_LINUX_GROUP="root"
  fi
fi

if [[ -z "${YOYOO_BACKEND_MEMORY_FILE}" ]]; then
  if [[ "${YOYOO_ENABLE_STRICT_ISOLATION}" == "1" ]]; then
    YOYOO_BACKEND_MEMORY_FILE="${YOYOO_RUNTIME_HOME}/backend/yoyoo_memory.json"
  else
    YOYOO_BACKEND_MEMORY_FILE="${BACKEND_DIR}/data/yoyoo_memory_${YOYOO_ROLE}.json"
  fi
fi
if [[ -z "${YOYOO_EXPECT_FEISHU}" ]]; then
  if [[ "${YOYOO_ROLE}" == "ceo" ]]; then
    YOYOO_EXPECT_FEISHU="1"
  else
    YOYOO_EXPECT_FEISHU="0"
  fi
fi
if [[ -z "${YOYOO_EXPECT_FEISHU_GROUP_POLICY}" && "${YOYOO_ROLE}" == "ceo" ]]; then
  YOYOO_EXPECT_FEISHU_GROUP_POLICY="open"
fi
if [[ -z "${YOYOO_EXPECT_FEISHU_REQUIRE_MENTION}" && "${YOYOO_ROLE}" == "ceo" ]]; then
  YOYOO_EXPECT_FEISHU_REQUIRE_MENTION="false"
fi
if [[ -z "${YOYOO_EXPECT_FEISHU_UNIFIED_SESSION}" ]]; then
  if [[ "${YOYOO_ROLE}" == "ceo" ]]; then
    YOYOO_EXPECT_FEISHU_UNIFIED_SESSION="1"
  else
    YOYOO_EXPECT_FEISHU_UNIFIED_SESSION="0"
  fi
fi
if ! [[ "${OPENCLAW_PORT}" =~ ^[0-9]+$ ]]; then
  echo "OPENCLAW_PORT must be numeric: ${OPENCLAW_PORT}" >&2
  exit 1
fi
if [[ "${YOYOO_ROLE}" != "ceo" && "${YOYOO_ALLOW_SHARED_INSTANCE}" != "1" ]]; then
  if [[ "${YOYOO_HOME}" == "/root/.openclaw" ]]; then
    echo "Refused: non-CEO role cannot use CEO home (/root/.openclaw). Set YOYOO_HOME explicitly or YOYOO_ALLOW_SHARED_INSTANCE=1." >&2
    exit 1
  fi
  if [[ "${OPENCLAW_PORT}" == "18789" ]]; then
    echo "Refused: non-CEO role cannot use CEO port (18789). Set OPENCLAW_PORT explicitly or YOYOO_ALLOW_SHARED_INSTANCE=1." >&2
    exit 1
  fi
fi
YOYOO_WORKSPACE="${YOYOO_WORKSPACE:-${YOYOO_HOME}/workspace}"
OPENCLAW_CONFIG_FILE="${YOYOO_HOME}/openclaw.json"
OPENCLAW_GOLDEN_CONFIG_FILE="${YOYOO_HOME}/openclaw.golden.json"
export OPENCLAW_STATE_DIR="${YOYOO_HOME}"
export OPENCLAW_PROFILE="${YOYOO_PROFILE}"
export OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT}"
export OPENCLAW_GATEWAY_PORT="${OPENCLAW_PORT}"
export YOYOO_ROLE="${YOYOO_ROLE}"
export YOYOO_HOME="${YOYOO_HOME}"
export YOYOO_EMPLOYEE_KEY="${YOYOO_EMPLOYEE_KEY}"
export YOYOO_LINUX_USER="${YOYOO_LINUX_USER}"
export YOYOO_LINUX_GROUP="${YOYOO_LINUX_GROUP}"
export YOYOO_RUNTIME_HOME="${YOYOO_RUNTIME_HOME}"
export YOYOO_WORKSPACE="${YOYOO_WORKSPACE}"
export YOYOO_BACKEND_SERVICE_NAME="${YOYOO_BACKEND_SERVICE_NAME}"

openclaw_cmd() {
  OPENCLAW_STATE_DIR="${YOYOO_HOME}" \
  OPENCLAW_PROFILE="${YOYOO_PROFILE}" \
  OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT}" \
  OPENCLAW_GATEWAY_PORT="${OPENCLAW_PORT}" \
  openclaw "$@"
}

export DEBIAN_FRONTEND=noninteractive
detect_pkg_manager() {
  if command -v apt-get >/dev/null 2>&1; then
    printf '%s\n' "apt"
    return 0
  fi
  if command -v dnf >/dev/null 2>&1; then
    printf '%s\n' "dnf"
    return 0
  fi
  if command -v yum >/dev/null 2>&1; then
    printf '%s\n' "yum"
    return 0
  fi
  return 1
}

install_base_packages() {
  local pm="$1"
  case "${pm}" in
    apt)
      apt-get update -y >/tmp/yoyoo_bootstrap_apt_update.log 2>&1
      apt-get install -y curl git jq ca-certificates sqlite3 python3 python3-venv >/tmp/yoyoo_bootstrap_apt_install.log 2>&1
      ;;
    dnf)
      dnf makecache -y >/tmp/yoyoo_bootstrap_dnf_update.log 2>&1 || true
      dnf install -y curl git jq ca-certificates sqlite python3 >/tmp/yoyoo_bootstrap_dnf_install.log 2>&1
      ;;
    yum)
      yum makecache -y >/tmp/yoyoo_bootstrap_yum_update.log 2>&1 || true
      yum install -y curl git jq ca-certificates sqlite python3 >/tmp/yoyoo_bootstrap_yum_install.log 2>&1
      ;;
    *)
      echo "Unsupported package manager: ${pm}" >&2
      return 1
      ;;
  esac
}

install_nodejs_if_missing() {
  local pm="$1"
  if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
    return 0
  fi
  case "${pm}" in
    apt)
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash >/tmp/yoyoo_bootstrap_node_setup.log 2>&1
      apt-get install -y nodejs >/tmp/yoyoo_bootstrap_node_install.log 2>&1
      ;;
    dnf|yum)
      if ! "${pm}" install -y nodejs npm >/tmp/yoyoo_bootstrap_node_install.log 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_20.x | bash >/tmp/yoyoo_bootstrap_node_setup.log 2>&1
        "${pm}" install -y nodejs >/tmp/yoyoo_bootstrap_node_install.log 2>&1
      fi
      ;;
    *)
      echo "Unsupported package manager for nodejs install: ${pm}" >&2
      return 1
      ;;
  esac
}

PKG_MANAGER="$(detect_pkg_manager || true)"
if [[ -z "${PKG_MANAGER}" ]]; then
  echo "No supported package manager found (apt/dnf/yum)." >&2
  exit 1
fi

install_base_packages "${PKG_MANAGER}"
install_nodejs_if_missing "${PKG_MANAGER}"

if [[ "${YOYOO_FORCE_OPENCLAW_INSTALL}" == "1" ]] || ! command -v openclaw >/dev/null 2>&1; then
  npm i -g openclaw@latest >/tmp/yoyoo_bootstrap_openclaw_install.log 2>&1
fi

mkdir -p "${YOYOO_HOME}/agents/main/agent" "${YOYOO_WORKSPACE}" "$(dirname "${YOYOO_BACKEND_MEMORY_FILE}")"

if [[ -z "${OPENCLAW_GATEWAY_TOKEN}" ]] && [[ -f "${OPENCLAW_CONFIG_FILE}" ]]; then
  OPENCLAW_GATEWAY_TOKEN="$(jq -r '.gateway.auth.token // empty' "${OPENCLAW_CONFIG_FILE}" 2>/dev/null || true)"
fi
if [[ -z "${OPENCLAW_GATEWAY_TOKEN}" ]]; then
  OPENCLAW_GATEWAY_TOKEN="$(openssl rand -hex 24)"
fi

CONFIG_FRAGMENT_FILE="$(mktemp)"
CONFIG_MERGED_FILE="$(mktemp)"
cleanup_files() {
  rm -f "${CONFIG_FRAGMENT_FILE}" "${CONFIG_MERGED_FILE}"
}
trap cleanup_files EXIT

jq -n \
  --arg token "${OPENCLAW_GATEWAY_TOKEN}" \
  --arg api_key "${MINIMAX_API_KEY}" \
  --argjson port "${OPENCLAW_PORT}" \
  '{
    gateway: {
      mode: "local",
      port: $port,
      auth: { token: $token }
    },
    models: {
      mode: "merge",
      providers: {
        minimax: {
          baseUrl: "https://api.minimaxi.com/anthropic",
          apiKey: $api_key,
          api: "anthropic-messages",
          authHeader: true,
          models: [
            {id: "MiniMax-M2.5", name: "MiniMax M2.5", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 8192},
            {id: "MiniMax-M2.1", name: "MiniMax M2.1", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 8192},
            {id: "MiniMax-M2.1-lightning", name: "MiniMax M2.1 lightning", reasoning: false, input: ["text"], contextWindow: 200000, maxTokens: 8192}
          ]
        }
      }
    },
    session: {
      scope: "global"
    }
  }' > "${CONFIG_FRAGMENT_FILE}"

if [[ -f "${OPENCLAW_CONFIG_FILE}" ]] && jq empty "${OPENCLAW_CONFIG_FILE}" >/dev/null 2>&1; then
  jq -s '.[0] * .[1]' "${OPENCLAW_CONFIG_FILE}" "${CONFIG_FRAGMENT_FILE}" > "${CONFIG_MERGED_FILE}"
else
  cp -f "${CONFIG_FRAGMENT_FILE}" "${CONFIG_MERGED_FILE}"
fi

install -m 600 "${CONFIG_MERGED_FILE}" "${OPENCLAW_CONFIG_FILE}"
install -m 600 "${OPENCLAW_CONFIG_FILE}" "${OPENCLAW_GOLDEN_CONFIG_FILE}"

cp -f "${SCRIPT_DIR}/profiles/${YOYOO_ROLE}/"*.md "${YOYOO_WORKSPACE}/"
mkdir -p "${YOYOO_WORKSPACE}/memory"
today_file="${YOYOO_WORKSPACE}/memory/$(date +%F).md"
if [[ ! -f "${today_file}" ]]; then
  printf '# %s\n\n' "$(date +%F)" > "${today_file}"
fi

mkdir -p "${YOYOO_HOME}/agents/main" "${YOYOO_HOME}/agents/main/agent"
cat > "${YOYOO_HOME}/agents/main/auth-profiles.json" <<EOF
{
  "minimax": {
    "apiKey": "${MINIMAX_API_KEY}"
  },
  "anthropic": {
    "apiKey": "${MINIMAX_API_KEY}"
  }
}
EOF
install -m 600 "${YOYOO_HOME}/agents/main/auth-profiles.json" "${YOYOO_HOME}/agents/main/agent/auth-profiles.json"
apply_asset_permissions

disable_user_gateway_units
install_system_gateway_service
if [[ "${YOYOO_EXPECT_FEISHU_UNIFIED_SESSION}" == "1" ]]; then
  bash "${SCRIPT_DIR}/patch_openclaw_feishu_session.sh" >/tmp/yoyoo_bootstrap_feishu_session_patch.log 2>&1
fi
openclaw_cmd channels status --probe >/tmp/yoyoo_bootstrap_gateway_probe.log 2>&1 || true
sleep 2

openclaw_cmd models set "minimax/${YOYOO_DEFAULT_MODEL}" >/tmp/yoyoo_bootstrap_model_set.log 2>&1 || true

if [[ "${YOYOO_ENABLE_QMD}" == "1" ]]; then
  bash "${SCRIPT_DIR}/qmd_enable.sh"
fi

if [[ "${YOYOO_ENABLE_BASE_SKILLS}" == "1" ]]; then
  bash "${SCRIPT_DIR}/install_base_skills.sh"
fi

openclaw_cmd doctor --fix >/tmp/yoyoo_bootstrap_doctor_fix.log 2>&1 || true

bash "${SCRIPT_DIR}/setup_guard.sh"
bash "${SCRIPT_DIR}/yoyoo_doctor.sh" check
if [[ "${YOYOO_FREEZE_BASELINE_ON_ACTIVATION}" == "1" ]]; then
  bash "${SCRIPT_DIR}/yoyoo_doctor.sh" freeze
fi

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

  mkdir -p "$(dirname "${YOYOO_BACKEND_ENV_FILE}")" "${BACKEND_DIR}/data" "$(dirname "${YOYOO_BACKEND_MEMORY_FILE}")"
  chown -R "${YOYOO_LINUX_USER}:${YOYOO_LINUX_GROUP}" "$(dirname "${YOYOO_BACKEND_MEMORY_FILE}")" >/tmp/yoyoo_bootstrap_backend_chown.log 2>&1 || true
  chmod 700 "$(dirname "${YOYOO_BACKEND_MEMORY_FILE}")" >/tmp/yoyoo_bootstrap_backend_chmod.log 2>&1 || true
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
After=network.target ${OPENCLAW_SYSTEMD_UNIT}

[Service]
Type=simple
User=${YOYOO_LINUX_USER}
Group=${YOYOO_LINUX_GROUP}
UMask=0077
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
  if ! wait_for_http "http://127.0.0.1:${YOYOO_BACKEND_PORT}/healthz" 30; then
    echo "Backend health check timeout: role=${YOYOO_ROLE} port=${YOYOO_BACKEND_PORT}" >&2
    systemctl status "${YOYOO_BACKEND_SERVICE_NAME}" --no-pager || true
    exit 1
  fi
fi

apply_asset_permissions

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
