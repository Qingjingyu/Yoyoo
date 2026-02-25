#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SKIP_GATEWAY="false"
SKIP_AGENT="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-gateway)
      SKIP_GATEWAY="true"
      ;;
    --skip-agent)
      SKIP_AGENT="true"
      ;;
    *)
      echo "unknown flag: $1"
      echo "usage: $0 [--skip-gateway] [--skip-agent]"
      exit 1
      ;;
  esac
  shift
done

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  PASS_COUNT=$((PASS_COUNT + 1))
  printf '[PASS] %s\n' "$1"
}

fail() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  printf '[FAIL] %s\n' "$1"
}

require_cmd() {
  local cmd="$1"
  local tip="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    pass "command '$cmd' exists"
  else
    fail "command '$cmd' missing ($tip)"
  fi
}

printf '=== Yoyoo V2 Multi-Team Verification ===\n'
printf 'root: %s\n' "$ROOT_DIR"

require_cmd openclaw "install openclaw first"
require_cmd python3 "install python3 first"

python3 - "$TMP_DIR/session_check.txt" <<'PY'
import json
import pathlib
import sys

out = pathlib.Path(sys.argv[1])
cfg = pathlib.Path.home() / ".openclaw" / "openclaw.json"
if not cfg.exists():
    out.write_text("missing config\n", encoding="utf-8")
    raise SystemExit(2)

obj = json.loads(cfg.read_text(encoding="utf-8"))
session = obj.get("session") or {}
scope = session.get("scope")
main_key = session.get("mainKey")
out.write_text(
    f"scope={scope}\nmainKey={main_key}\n",
    encoding="utf-8",
)
if scope != "per-sender" or main_key != "main":
    raise SystemExit(1)
PY
if [[ $? -eq 0 ]]; then
  pass "session isolation config is correct (per-sender/main)"
else
  fail "session isolation config invalid (expect per-sender/main)"
fi

openclaw agents list --json > "$TMP_DIR/agents.json" 2>"$TMP_DIR/agents.err" || true
python3 - "$TMP_DIR/agents.json" "$TMP_DIR/agents_report.txt" <<'PY'
import json
import pathlib
import sys

src = pathlib.Path(sys.argv[1])
report = pathlib.Path(sys.argv[2])
roles = ["main", "coder", "writer", "growth", "legal", "finance", "teacher"]
text = src.read_text(encoding="utf-8").strip()
if not text:
    report.write_text("empty output\n", encoding="utf-8")
    raise SystemExit(2)

arr = json.loads(text)
by_id = {x.get("id"): x for x in arr if isinstance(x, dict) and x.get("id")}

lines = []
ok = True
for role in roles:
    item = by_id.get(role)
    if not item:
        lines.append(f"MISSING::{role}")
        ok = False
        continue
    ws = item.get("workspace") or ""
    if role == "main":
        if "/.openclaw/workspace" not in ws:
            lines.append(f"BAD_WORKSPACE::{role}::{ws}")
            ok = False
        else:
            lines.append(f"OK::{role}::{ws}")
        continue
    expect = f"/.openclaw/workspaces/{role}"
    if expect not in ws:
        lines.append(f"BAD_WORKSPACE::{role}::{ws}")
        ok = False
    else:
        lines.append(f"OK::{role}::{ws}")

report.write_text("\n".join(lines) + "\n", encoding="utf-8")
if not ok:
    raise SystemExit(1)
PY
if [[ $? -eq 0 ]]; then
  pass "agent list includes all roles with correct workspace mapping"
else
  fail "agent list/workspace mapping check failed (see $TMP_DIR/agents_report.txt)"
fi

for role in coder writer growth legal finance teacher; do
  ws="$HOME/.openclaw/workspaces/$role"
  if [[ -d "$ws" ]]; then
    pass "$role workspace exists"
  else
    fail "$role workspace missing: $ws"
    continue
  fi
  for f in IDENTITY.md AGENTS.md MEMORY.md; do
    if [[ -f "$ws/$f" ]]; then
      pass "$role/$f exists"
    else
      fail "$role/$f missing"
    fi
  done
done

if [[ "$SKIP_GATEWAY" == "true" ]]; then
  pass "gateway strict checks skipped by flag"
else
  if openclaw gateway health --json --timeout 8000 > "$TMP_DIR/gateway_health.json" 2>&1; then
    pass "gateway health reachable"
  else
    fail "gateway health unreachable (start gateway first)"
  fi

  if bash "$ROOT_DIR/scripts/yoyoo_gateway_agent_strict.sh" coder "请只回复：coder-v2-gateway-ok" > "$TMP_DIR/gw_coder.txt" 2>&1; then
    if rg -n --fixed-strings -- "[ok] strict routing verified for coder" "$TMP_DIR/gw_coder.txt" >/dev/null 2>&1; then
      pass "gateway strict routing for coder"
    else
      fail "gateway coder check ran but strict marker not found"
    fi
  else
    fail "gateway strict routing for coder failed"
  fi

  if bash "$ROOT_DIR/scripts/yoyoo_gateway_agent_strict.sh" writer "请只回复：writer-v2-gateway-ok" > "$TMP_DIR/gw_writer.txt" 2>&1; then
    if rg -n --fixed-strings -- "[ok] strict routing verified for writer" "$TMP_DIR/gw_writer.txt" >/dev/null 2>&1; then
      pass "gateway strict routing for writer"
    else
      fail "gateway writer check ran but strict marker not found"
    fi
  else
    fail "gateway strict routing for writer failed"
  fi
fi

if [[ "$SKIP_AGENT" == "true" ]]; then
  pass "direct agent checks skipped by flag"
else
  openclaw agent --agent coder --message "请只回复：coder-v2-direct-ok" --json --timeout 120 > "$TMP_DIR/agent_coder.json" 2>&1 || true
  python3 - "$TMP_DIR/agent_coder.json" coder "$TMP_DIR/agent_coder_report.txt" <<'PY'
import json
import pathlib
import sys

src = pathlib.Path(sys.argv[1])
role = sys.argv[2]
report = pathlib.Path(sys.argv[3])
text = src.read_text(encoding="utf-8")
pos = text.find("{")
if pos < 0:
    report.write_text("no json found\n", encoding="utf-8")
    raise SystemExit(2)
obj = json.loads(text[pos:])
meta = (((obj.get("result") or {}).get("meta") or {}).get("systemPromptReport") or {})
key = meta.get("sessionKey") or ""
ws = meta.get("workspaceDir") or ""
payload = (obj.get("result") or {}).get("payloads") or []
first = payload[0].get("text") if payload and isinstance(payload[0], dict) else ""
expect_key = f"agent:{role}:main"
expect_ws = f"/.openclaw/workspaces/{role}"
ok = True
lines = [f"sessionKey={key}", f"workspaceDir={ws}", f"reply={first}"]
if key != expect_key:
    ok = False
if expect_ws not in ws:
    ok = False
if "direct-ok" not in first:
    ok = False
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
if not ok:
    raise SystemExit(1)
PY
  if [[ $? -eq 0 ]]; then
    pass "direct agent check for coder"
  else
    fail "direct agent check for coder failed"
  fi

  openclaw agent --agent writer --message "请只回复：writer-v2-direct-ok" --json --timeout 120 > "$TMP_DIR/agent_writer.json" 2>&1 || true
  python3 - "$TMP_DIR/agent_writer.json" writer "$TMP_DIR/agent_writer_report.txt" <<'PY'
import json
import pathlib
import sys

src = pathlib.Path(sys.argv[1])
role = sys.argv[2]
report = pathlib.Path(sys.argv[3])
text = src.read_text(encoding="utf-8")
pos = text.find("{")
if pos < 0:
    report.write_text("no json found\n", encoding="utf-8")
    raise SystemExit(2)
obj = json.loads(text[pos:])
meta = (((obj.get("result") or {}).get("meta") or {}).get("systemPromptReport") or {})
key = meta.get("sessionKey") or ""
ws = meta.get("workspaceDir") or ""
payload = (obj.get("result") or {}).get("payloads") or []
first = payload[0].get("text") if payload and isinstance(payload[0], dict) else ""
expect_key = f"agent:{role}:main"
expect_ws = f"/.openclaw/workspaces/{role}"
ok = True
lines = [f"sessionKey={key}", f"workspaceDir={ws}", f"reply={first}"]
if key != expect_key:
    ok = False
if expect_ws not in ws:
    ok = False
if "direct-ok" not in first:
    ok = False
report.write_text("\n".join(lines) + "\n", encoding="utf-8")
if not ok:
    raise SystemExit(1)
PY
  if [[ $? -eq 0 ]]; then
    pass "direct agent check for writer"
  else
    fail "direct agent check for writer failed"
  fi
fi

printf '\n=== Summary ===\n'
printf 'PASS: %d\n' "$PASS_COUNT"
printf 'FAIL: %d\n' "$FAIL_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  printf 'Result: FAILED\n'
  exit 1
fi

printf 'Result: ALL GREEN\n'
