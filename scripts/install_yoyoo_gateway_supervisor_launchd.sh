#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
UID_NUM="$(id -u)"
OPENCLAW_BIN="$(command -v openclaw)"

if [[ -z "$OPENCLAW_BIN" ]]; then
  echo "[error] openclaw not found in PATH"
  exit 1
fi

mkdir -p "$HOME/.openclaw/logs"

PLIST_PATH="$HOME/Library/LaunchAgents/ai.yoyoo.gateway.supervisor.plist"
LABEL_NEW="ai.yoyoo.gateway.supervisor"
LABEL_OLD="ai.openclaw.gateway"

cat >"$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL_NEW}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>cd '${ROOT_DIR}' &amp;&amp; OPENCLAW_BIN='${OPENCLAW_BIN}' OPENCLAW_GATEWAY_PORT='18789' bash '${ROOT_DIR}/scripts/yoyoo_gateway_supervisor.sh'</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>StandardOutPath</key>
  <string>${HOME}/.openclaw/logs/yoyoo-gateway-supervisor.log</string>
  <key>StandardErrorPath</key>
  <string>${HOME}/.openclaw/logs/yoyoo-gateway-supervisor.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.nvm/versions/node/v22.16.0/bin</string>
    <key>HOME</key>
    <string>${HOME}</string>
  </dict>
</dict>
</plist>
EOF

echo "[info] wrote launchd plist: $PLIST_PATH"

# Stop official gateway service if loaded.
openclaw gateway stop >/dev/null 2>&1 || true
launchctl bootout "gui/$UID_NUM/$LABEL_OLD" >/dev/null 2>&1 || true

# Restart custom supervisor.
launchctl bootout "gui/$UID_NUM/$LABEL_NEW" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_NUM" "$PLIST_PATH"
launchctl kickstart -k "gui/$UID_NUM/$LABEL_NEW"

echo "[step] waiting for gateway"
ok="false"
for _ in {1..15}; do
  if openclaw gateway health --json --timeout 8000 >/tmp/yoyoo_gateway_health.json 2>&1; then
    ok="true"
    break
  fi
  sleep 2
done

if [[ "$ok" != "true" ]]; then
  echo "[error] gateway health still failed"
  echo "[hint] logs:"
  echo "  ~/.openclaw/logs/yoyoo-gateway-supervisor.log"
  echo "  ~/.openclaw/logs/yoyoo-gateway-supervisor.err.log"
  exit 1
fi

echo "[ok] gateway supervisor launchd installed and healthy"
echo "[info] status:"
launchctl print "gui/$UID_NUM/$LABEL_NEW" | sed -n '1,80p'
