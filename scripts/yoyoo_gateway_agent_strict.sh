#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "Usage: $0 <agent> <message> [session_id]"
  exit 1
fi

AGENT_ID="$1"
shift
MESSAGE="$1"
shift || true
SESSION_ID="${1:-yoyoo-${AGENT_ID}-$(date +%Y%m%d-%H%M%S)}"
SESSION_KEY="agent:${AGENT_ID}:main"
RUN_ID="yoyoo-${AGENT_ID}-${SESSION_ID}"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SAFE_CALL_SCRIPT="$BASE_DIR/scripts/openclaw_gateway_call_safe.sh"

case "$AGENT_ID" in
  main|coder|writer|growth|legal|finance|teacher) ;;
  *)
    echo "[error] unsupported agent: $AGENT_ID"
    exit 1
    ;;
esac

if ! openclaw gateway health --json --timeout 8000 >/tmp/yoyoo_gateway_health.json 2>&1; then
  echo "[error] gateway unavailable. start it first:"
  echo "  openclaw gateway run --port 18789"
  exit 1
fi

if [[ ! -x "$SAFE_CALL_SCRIPT" ]]; then
  echo "[error] safe call script missing or not executable: $SAFE_CALL_SCRIPT"
  exit 1
fi

PARAMS="$(python3 - "$MESSAGE" "$AGENT_ID" "$SESSION_ID" "$SESSION_KEY" "$RUN_ID" <<'PY'
import json
import sys
message, agent, session_id, session_key, run_id = sys.argv[1:]
payload = {
    "message": message,
    "agentId": agent,
    "sessionId": session_id,
    "sessionKey": session_key,
    "channel": "last",
    "timeout": 120,
    "idempotencyKey": run_id,
}
print(json.dumps(payload, ensure_ascii=False))
PY
)"

RAW="$(bash "$SAFE_CALL_SCRIPT" --params "$PARAMS" --timeout-ms 120000 --process-timeout-seconds 150)"
echo "$RAW"

python3 - "$RAW" "$AGENT_ID" <<'PY'
import json
import sys
raw, agent = sys.argv[1], sys.argv[2]
obj = json.loads(raw)
meta = (((obj.get("result") or {}).get("meta") or {}).get("systemPromptReport") or {})
session_key = (meta.get("sessionKey") or "").strip()
workspace = (meta.get("workspaceDir") or "").strip()
expect_key = f"agent:{agent}:main"
if session_key != expect_key:
    raise SystemExit(f"[error] sessionKey mismatch: got={session_key} expect={expect_key}")
if agent != "main":
    expect_workspace = f"/.openclaw/workspaces/{agent}"
    if expect_workspace not in workspace:
        raise SystemExit(f"[error] workspace mismatch: got={workspace} expect~={expect_workspace}")
print(f"[ok] strict routing verified for {agent}: {session_key} -> {workspace}")
PY
