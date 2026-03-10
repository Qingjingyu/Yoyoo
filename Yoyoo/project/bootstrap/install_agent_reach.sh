#!/usr/bin/env bash
set -euo pipefail

# Install Agent Reach into the employee runtime home.
# This is a per-instance toolchain install, not a shared global install.

YOYOO_HOME="${YOYOO_HOME:-/root/.openclaw}"
YOYOO_RUNTIME_HOME="${YOYOO_RUNTIME_HOME:-$(dirname "${YOYOO_HOME}")}"
YOYOO_LINUX_USER="${YOYOO_LINUX_USER:-root}"
YOYOO_LINUX_GROUP="${YOYOO_LINUX_GROUP:-${YOYOO_LINUX_USER}}"
AGENT_REACH_HOME="${AGENT_REACH_HOME:-${YOYOO_RUNTIME_HOME}/.agent-reach}"
AGENT_REACH_NPM_PREFIX="${AGENT_REACH_NPM_PREFIX:-${AGENT_REACH_HOME}/npm}"
AGENT_REACH_VENV="${AGENT_REACH_VENV:-${AGENT_REACH_HOME}/venv}"
AGENT_REACH_SAFE_MODE="${AGENT_REACH_SAFE_MODE:-1}"
TARGET_SKILL_DIR="${YOYOO_HOME}/skills"

mkdir -p "${AGENT_REACH_HOME}" "${AGENT_REACH_NPM_PREFIX}" "${YOYOO_RUNTIME_HOME}/.local/bin" "${TARGET_SKILL_DIR}"
chown -R "${YOYOO_LINUX_USER}:${YOYOO_LINUX_GROUP}" "${AGENT_REACH_HOME}" "${YOYOO_RUNTIME_HOME}/.local" "${TARGET_SKILL_DIR}" >/tmp/yoyoo_agent_reach_chown.log 2>&1 || true

run_as_user() {
  if [[ "${YOYOO_LINUX_USER}" == "root" ]]; then
    HOME="${YOYOO_RUNTIME_HOME}" "$@"
  else
    runuser -u "${YOYOO_LINUX_USER}" -- env HOME="${YOYOO_RUNTIME_HOME}" "$@"
  fi
}

run_as_user python3 -m venv "${AGENT_REACH_VENV}"
run_as_user "${AGENT_REACH_VENV}/bin/pip" install --upgrade pip setuptools wheel >/tmp/yoyoo_agent_reach_pip_bootstrap.log 2>&1
run_as_user "${AGENT_REACH_VENV}/bin/pip" install \
  "https://github.com/Panniantong/agent-reach/archive/main.zip" \
  >/tmp/yoyoo_agent_reach_pip_install.log 2>&1
run_as_user "${AGENT_REACH_VENV}/bin/pip" install \
  yt-dlp \
  feedparser \
  markdownify \
  beautifulsoup4 \
  httpx \
  mcp \
  miku_ai \
  "camoufox[geoip]" \
  "git+https://github.com/Panniantong/mcp-server-weibo.git" \
  >/tmp/yoyoo_agent_reach_extra_pip_install.log 2>&1

run_as_user npm install --prefix "${AGENT_REACH_NPM_PREFIX}" -g mcporter xreach-cli undici >/tmp/yoyoo_agent_reach_npm_install.log 2>&1

ln -sf "${AGENT_REACH_VENV}/bin/agent-reach" "${YOYOO_RUNTIME_HOME}/.local/bin/agent-reach"
ln -sf "${AGENT_REACH_NPM_PREFIX}/bin/mcporter" "${YOYOO_RUNTIME_HOME}/.local/bin/mcporter"
ln -sf "${AGENT_REACH_NPM_PREFIX}/bin/xreach" "${YOYOO_RUNTIME_HOME}/.local/bin/xreach"
ln -sf "${AGENT_REACH_VENV}/bin/yt-dlp" "${YOYOO_RUNTIME_HOME}/.local/bin/yt-dlp"
ln -sf "${AGENT_REACH_VENV}/bin/mcp-server-weibo" "${YOYOO_RUNTIME_HOME}/.local/bin/mcp-server-weibo"

mkdir -p "${YOYOO_RUNTIME_HOME}/.config/yt-dlp"
grep -qxF -- '--js-runtimes node' "${YOYOO_RUNTIME_HOME}/.config/yt-dlp/config" 2>/dev/null || echo '--js-runtimes node' >> "${YOYOO_RUNTIME_HOME}/.config/yt-dlp/config"
chown -R "${YOYOO_LINUX_USER}:${YOYOO_LINUX_GROUP}" "${YOYOO_RUNTIME_HOME}/.config" >/tmp/yoyoo_agent_reach_config_chown.log 2>&1 || true

if [[ "${AGENT_REACH_SAFE_MODE}" == "1" ]]; then
  run_as_user "${AGENT_REACH_VENV}/bin/agent-reach" install --env=auto --safe >/tmp/yoyoo_agent_reach_install.log 2>&1 || true
else
  run_as_user "${AGENT_REACH_VENV}/bin/agent-reach" install --env=auto >/tmp/yoyoo_agent_reach_install.log 2>&1 || true
fi

run_as_user "${YOYOO_RUNTIME_HOME}/.local/bin/mcporter" config add exa https://mcp.exa.ai/mcp >/tmp/yoyoo_agent_reach_mcporter_exa.log 2>&1 || true
run_as_user "${YOYOO_RUNTIME_HOME}/.local/bin/mcporter" config add weibo --command "${AGENT_REACH_VENV}/bin/mcp-server-weibo" >/tmp/yoyoo_agent_reach_mcporter_weibo.log 2>&1 || true

SKILL_SOURCE="$("${AGENT_REACH_VENV}/bin/python" - <<'PY'
from pathlib import Path
import agent_reach
print(Path(agent_reach.__file__).resolve().parent / "skill")
PY
)"

if [[ -f "${SKILL_SOURCE}/SKILL.md" ]]; then
  rm -rf "${TARGET_SKILL_DIR}/agent-reach"
  cp -R "${SKILL_SOURCE}" "${TARGET_SKILL_DIR}/agent-reach"
fi

chown -R "${YOYOO_LINUX_USER}:${YOYOO_LINUX_GROUP}" "${AGENT_REACH_HOME}" "${YOYOO_RUNTIME_HOME}/.local" "${TARGET_SKILL_DIR}/agent-reach" >/tmp/yoyoo_agent_reach_finalize_chown.log 2>&1 || true

echo "Agent Reach install script finished"
