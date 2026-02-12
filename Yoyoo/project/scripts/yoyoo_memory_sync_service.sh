#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SYNC_SCRIPT="${REPO_ROOT}/Yoyoo/project/scripts/sync_yoyoo_memory_global.sh"
LABEL="com.yoyoo.memory-sync"
PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
LOG_DIR="${REPO_ROOT}/Yoyoo/soul/.sync_state"
OUT_LOG="${LOG_DIR}/launchd.out.log"
ERR_LOG="${LOG_DIR}/launchd.err.log"
INTERVAL_SEC="${YOYOO_SYNC_INTERVAL_SEC:-180}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [install|uninstall|status|run-once]
  install   Install and load launchd agent (interval: YOYOO_SYNC_INTERVAL_SEC, default 180)
  uninstall Unload and remove launchd agent
  status    Show launchd agent status
  run-once  Run one incremental sync immediately
EOF
}

ensure_paths() {
  [[ -f "${SYNC_SCRIPT}" ]] || {
    echo "Missing sync script: ${SYNC_SCRIPT}" >&2
    exit 1
  }
  mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}"
}

install_agent() {
  ensure_paths
  cat > "${PLIST_PATH}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>${SYNC_SCRIPT}</string>
    <string>sync</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${REPO_ROOT}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>StartInterval</key>
  <integer>${INTERVAL_SEC}</integer>
  <key>StandardOutPath</key>
  <string>${OUT_LOG}</string>
  <key>StandardErrorPath</key>
  <string>${ERR_LOG}</string>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
  launchctl enable "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true

  echo "Installed: ${PLIST_PATH}"
  echo "Interval: ${INTERVAL_SEC}s"
  launchctl print "gui/$(id -u)/${LABEL}" | sed -n '1,40p' || true
}

uninstall_agent() {
  launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
  rm -f "${PLIST_PATH}"
  echo "Removed: ${PLIST_PATH}"
}

status_agent() {
  if [[ -f "${PLIST_PATH}" ]]; then
    echo "plist: ${PLIST_PATH}"
  else
    echo "plist: missing (${PLIST_PATH})"
  fi
  launchctl print "gui/$(id -u)/${LABEL}" | sed -n '1,80p' || true
}

run_once() {
  ensure_paths
  /bin/bash "${SYNC_SCRIPT}" sync
}

main() {
  local cmd="${1:-}"
  case "${cmd}" in
    install) install_agent ;;
    uninstall) uninstall_agent ;;
    status) status_agent ;;
    run-once) run_once ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
