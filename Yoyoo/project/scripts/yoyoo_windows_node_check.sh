#!/usr/bin/env bash
set -euo pipefail

WINDOWS_NODE="${1:-100.92.126.71}"
WINDOWS_TOKEN="${YOYOO_WINDOWS_TOKEN:-${2:-}}"
WINDOWS_PORT="${YOYOO_WINDOWS_PORT:-8088}"
TIMEOUT_SEC="${YOYOO_WINDOWS_TIMEOUT_SEC:-6}"

json_escape() {
  python3 - <<'PY'
import json,sys
print(json.dumps(sys.stdin.read()))
PY
}

status_json=$(tailscale status --json)
online=$(printf '%s' "$status_json" | jq -r --arg ip "$WINDOWS_NODE" '.Peer[] | select((.TailscaleIPs // []) | index($ip)) | .Online' | head -n1)
hostname=$(printf '%s' "$status_json" | jq -r --arg ip "$WINDOWS_NODE" '.Peer[] | select((.TailscaleIPs // []) | index($ip)) | .HostName' | head -n1)
ssh_keys=$(printf '%s' "$status_json" | jq -r --arg ip "$WINDOWS_NODE" '.Peer[] | select((.TailscaleIPs // []) | index($ip)) | (.SSH_HostKeys != null)' | head -n1)

if [[ -z "$hostname" || "$hostname" == "null" ]]; then
  echo '{"ok":false,"reason":"node_not_found"}'
  exit 2
fi

if [[ "$online" != "true" ]]; then
  echo "{\"ok\":false,\"reason\":\"offline\",\"node\":\"$hostname\",\"ip\":\"$WINDOWS_NODE\"}"
  exit 3
fi

health_url="http://${WINDOWS_NODE}:${WINDOWS_PORT}/health"
if ! health_resp=$(curl -m "$TIMEOUT_SEC" -fsS "$health_url" 2>/dev/null); then
  echo "{\"ok\":false,\"reason\":\"health_unreachable\",\"node\":\"$hostname\",\"ip\":\"$WINDOWS_NODE\",\"ssh_enabled\":$ssh_keys}"
  exit 4
fi

if [[ -z "$WINDOWS_TOKEN" ]]; then
  echo "{\"ok\":true,\"node\":\"$hostname\",\"ip\":\"$WINDOWS_NODE\",\"health\":$health_resp,\"exec\":\"skipped_no_token\",\"ssh_enabled\":$ssh_keys}"
  exit 0
fi

exec_resp=$(curl -m "$TIMEOUT_SEC" -fsS \
  -H "Authorization: Bearer $WINDOWS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"command":"echo yoyoo_worker_ok"}' \
  "http://${WINDOWS_NODE}:${WINDOWS_PORT}/exec" 2>/dev/null || true)

if [[ -z "$exec_resp" ]]; then
  echo "{\"ok\":false,\"reason\":\"exec_failed\",\"node\":\"$hostname\",\"ip\":\"$WINDOWS_NODE\",\"health\":$health_resp,\"ssh_enabled\":$ssh_keys}"
  exit 5
fi

echo "{\"ok\":true,\"node\":\"$hostname\",\"ip\":\"$WINDOWS_NODE\",\"health\":$health_resp,\"exec\":$exec_resp,\"ssh_enabled\":$ssh_keys}"
