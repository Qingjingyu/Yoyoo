#!/usr/bin/env bash
set -euo pipefail

# Stabilize local gateway in single-supervisor mode (Yoyoo).
# Goal:
# - keep ONLY ai.yoyoo.gateway.supervisor
# - disable conflicting ai.openclaw.gateway + broken memory-sync
# - normalize config (remove stale fields like identity.reportsTo)
# - verify by gateway-level probes (no model call dependency)

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"
LOG_DIR="$HOME/.openclaw/logs"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PORT=18789
UID_NUM="$(id -u)"
LABEL_NEW="ai.yoyoo.gateway.supervisor"
LABEL_OLD="ai.openclaw.gateway"
LABEL_MEM="com.yoyoo.memory-sync"
PLIST_PATH="$HOME/Library/LaunchAgents/${LABEL_NEW}.plist"
OPENCLAW_BIN="$(command -v openclaw || true)"

if [[ -z "$OPENCLAW_BIN" ]]; then
  echo "[error] openclaw not found"
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[error] openclaw config missing: $CONFIG_FILE"
  exit 1
fi

mkdir -p "$LOG_DIR"

TS="$(date +%Y%m%d_%H%M%S)"
cp "$CONFIG_FILE" "$CONFIG_FILE.bak.gateway.$TS"
echo "[info] config backup: $CONFIG_FILE.bak.gateway.$TS"

python3 - "$CONFIG_FILE" <<'PY'
import json
import pathlib
import sys

cfg_path = pathlib.Path(sys.argv[1])
cfg = json.loads(cfg_path.read_text(encoding="utf-8"))

channels = cfg.setdefault("channels", {})
discord = channels.setdefault("discord", {})
token = str(discord.get("token") or "").strip()
if token.startswith("placeholder-") or token == "":
    discord["enabled"] = False
discord.pop("streaming", None)

slack = channels.get("slack")
if isinstance(slack, dict):
    slack.pop("streaming", None)
    slack.pop("nativeStreaming", None)

gateway = cfg.setdefault("gateway", {})
gateway["port"] = int(gateway.get("port") or 18789)
gateway["mode"] = str(gateway.get("mode") or "local")
gateway["bind"] = str(gateway.get("bind") or "loopback")

commands = cfg.get("commands")
if isinstance(commands, dict):
    commands.pop("ownerDisplay", None)

memory = cfg.setdefault("memory", {})
if isinstance(memory, dict):
    qmd = memory.get("qmd")
    if isinstance(qmd, dict):
        update = qmd.get("update")
        if isinstance(update, dict):
            update["onBoot"] = False
            update["waitForBootSync"] = False

agents = cfg.get("agents")
if isinstance(agents, dict):
    agent_list = agents.get("list")
    if isinstance(agent_list, list):
        for item in agent_list:
            if not isinstance(item, dict):
                continue
            identity = item.get("identity")
            if isinstance(identity, dict):
                identity.pop("reportsTo", None)

cfg_path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY
echo "[info] config normalized (gateway+qmd+identity)"

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
    <string>cd '${ROOT_DIR}' &amp;&amp; OPENCLAW_BIN='${OPENCLAW_BIN}' OPENCLAW_GATEWAY_PORT='${PORT}' bash '${ROOT_DIR}/scripts/yoyoo_gateway_supervisor.sh'</string>
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
echo "[info] launchd plist written: $PLIST_PATH"

echo "[step] stop old/duplicate services"
openclaw gateway stop >/dev/null 2>&1 || true
launchctl bootout "gui/$UID_NUM/$LABEL_OLD" >/dev/null 2>&1 || true
launchctl bootout "gui/$UID_NUM/$LABEL_NEW" >/dev/null 2>&1 || true
launchctl bootout "gui/$UID_NUM/$LABEL_MEM" >/dev/null 2>&1 || true
launchctl disable "gui/$UID_NUM/$LABEL_OLD" >/dev/null 2>&1 || true
launchctl disable "gui/$UID_NUM/$LABEL_MEM" >/dev/null 2>&1 || true
pkill -TERM -f openclaw-gateway >/dev/null 2>&1 || true
sleep 1
for _ in {1..10}; do
  if ! lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "[step] start yoyoo supervisor service"
launchctl bootstrap "gui/$UID_NUM" "$PLIST_PATH"
launchctl kickstart -k "gui/$UID_NUM/$LABEL_NEW"

gateway_ready() {
  local out_file="$1"
  if ! lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    return 1
  fi
  if ! openclaw gateway health --json --timeout 25000 >/dev/null 2>&1; then
    return 1
  fi
  openclaw channels status --json --timeout 25000 >"$out_file" 2>&1
}

channels_status_ready() {
  openclaw channels status --json --timeout 25000 >/dev/null 2>&1
}

final_reconcile_ready() {
  local out_file="$1"
  if ! lsof -nP -iTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    return 1
  fi
  if ! openclaw gateway health --json --timeout 25000 >/dev/null 2>&1; then
    return 1
  fi
  if channels_status_ready; then
    return 0
  fi
  openclaw channels status --json --timeout 25000 >"$out_file" 2>&1
}

echo "[step] verify gateway by health + channel probes"
VERIFY_TIMEOUT_SEC="${YOYOO_GATEWAY_VERIFY_TIMEOUT_SEC:-600}"
VERIFY_INTERVAL_SEC="${YOYOO_GATEWAY_VERIFY_INTERVAL_SEC:-5}"
KICKSTART_INTERVAL_SEC="${YOYOO_GATEWAY_KICKSTART_INTERVAL_SEC:-0}"
ok="false"
started_at="$(date +%s)"
next_kickstart_at="$started_at"
attempt=0

sleep 2
while true; do
  now="$(date +%s)"
  elapsed="$((now - started_at))"
  if (( elapsed >= VERIFY_TIMEOUT_SEC )); then
    break
  fi

  attempt="$((attempt + 1))"
  if gateway_ready "$TMP_DIR/ping-${attempt}.json"; then
    ok="true"
    break
  fi
  if final_reconcile_ready "$TMP_DIR/ping-final-${attempt}.json"; then
    ok="true"
    break
  fi

  if (( KICKSTART_INTERVAL_SEC > 0 && now >= next_kickstart_at )); then
    echo "[warn] verify not ready at ${elapsed}s, kickstart supervisor once"
    launchctl kickstart -k "gui/$UID_NUM/$LABEL_NEW" >/dev/null 2>&1 || true
    next_kickstart_at="$((now + KICKSTART_INTERVAL_SEC))"
  fi
  sleep "$VERIFY_INTERVAL_SEC"
done

if [[ "$ok" != "true" ]]; then
  echo "[error] gateway still unstable after ${VERIFY_TIMEOUT_SEC}s verify window"
  echo "[hint] check logs:"
  echo "  ~/.openclaw/logs/yoyoo-gateway-supervisor.log"
  echo "  ~/.openclaw/logs/yoyoo-gateway-supervisor.err.log"
  exit 1
fi

echo "[ok] single-supervisor gateway is healthy"
echo
echo "[summary]"
echo "- active launch service: ${LABEL_NEW}"
echo "- disabled launch service: ${LABEL_OLD}"
echo "- disabled launch service: ${LABEL_MEM}"
echo "- config: $CONFIG_FILE"
echo "- supervisor logs: ~/.openclaw/logs/yoyoo-gateway-supervisor.log"
