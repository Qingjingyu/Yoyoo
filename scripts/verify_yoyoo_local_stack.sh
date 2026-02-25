#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

SKIP_AGENT_SMOKE="false"
if [[ "${1:-}" == "--skip-agent" ]]; then
  SKIP_AGENT_SMOKE="true"
fi

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

check_cmd() {
  local cmd="$1"
  local tip="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    pass "command '$cmd' exists"
  else
    fail "command '$cmd' missing ($tip)"
  fi
}

json_from_mixed_output() {
  local src="$1"
  local dst="$2"
  python3 - "$src" "$dst" <<'PY'
import json,sys
src,dst=sys.argv[1],sys.argv[2]
text=open(src,'r',encoding='utf-8').read()
pos=text.find('{')
if pos<0:
    raise SystemExit(2)
obj=json.loads(text[pos:])
open(dst,'w',encoding='utf-8').write(json.dumps(obj,ensure_ascii=False))
PY
}

require_string() {
  local file="$1"
  local needle="$2"
  local label="$3"
  if rg -n --fixed-strings -- "$needle" "$file" >/dev/null 2>&1; then
    pass "$label"
  else
    fail "$label"
  fi
}

printf '=== Yoyoo Local Stack Verification ===\n'
printf 'root: %s\n' "$ROOT_DIR"

check_cmd openclaw "npm install -g openclaw"
check_cmd qmd "bun install -g github:tobi/qmd"
check_cmd clawhub "npm install -g clawhub"
check_cmd node "install Node.js"
check_cmd python3 "install Python3"

OPENCLAW_VERSION="$(openclaw --version 2>/dev/null || true)"
if [[ -n "$OPENCLAW_VERSION" ]]; then
  pass "openclaw version detected: $OPENCLAW_VERSION"
else
  fail "openclaw version not detected"
fi

openclaw plugins doctor > "$TMP_DIR/plugins_doctor.txt" 2>&1 || true
require_string "$TMP_DIR/plugins_doctor.txt" "No plugin issues detected." "plugins doctor clean"

openclaw plugins info yoyoo-autobridge > "$TMP_DIR/plugin_info.txt" 2>&1 || true
require_string "$TMP_DIR/plugin_info.txt" "Status: loaded" "yoyoo-autobridge loaded"

openclaw skills list --json > "$TMP_DIR/skills_raw.json" 2>&1 || true
if json_from_mixed_output "$TMP_DIR/skills_raw.json" "$TMP_DIR/skills.json"; then
  pass "skills json parse ok"
else
  fail "skills json parse failed"
fi

python3 - "$TMP_DIR/skills.json" > "$TMP_DIR/skills_check.txt" <<'PY'
import json,sys
skills=json.load(open(sys.argv[1],'r',encoding='utf-8')).get('skills',[])
by={s.get('name'):s for s in skills}
required=[
  'qmd-local-search',
  'capability-evolver',
  'b3ehive-wrapper',
  'clawhub',
  'yoyoo-core-bridge',
  'healthcheck',
  'session-logs',
  'github',
]
ok=True
for name in required:
  s=by.get(name)
  if not s:
    print(f'MISSING::{name}')
    ok=False
    continue
  eligible=s.get('eligible') is True
  disabled=s.get('disabled') is False
  if not eligible or not disabled:
    print(f'BAD::{name}::eligible={s.get("eligible")}::disabled={s.get("disabled")}')
    ok=False
  else:
    print(f'OK::{name}')
if not ok:
  raise SystemExit(1)
PY
if [[ $? -eq 0 ]]; then
  pass "required skills present and enabled"
else
  fail "required skills missing/disabled (see $TMP_DIR/skills_check.txt)"
fi

qmd status > "$TMP_DIR/qmd_status.txt" 2>&1 || true
require_string "$TMP_DIR/qmd_status.txt" "QMD Status" "qmd status available"

EVOLVER_ENTRY="$ROOT_DIR/clawim/evolver/index.js"
if [[ -f "$EVOLVER_ENTRY" ]]; then
  node "$EVOLVER_ENTRY" --help > "$TMP_DIR/evolver_help.txt" 2>&1 || true
  require_string "$TMP_DIR/evolver_help.txt" "--loop" "evolver supports --loop"
else
  fail "evolver entry missing: $EVOLVER_ENTRY"
fi

if [[ "$SKIP_AGENT_SMOKE" == "true" ]]; then
  pass "agent smoke skipped by flag"
else
  openclaw agent --agent main --message "请只回复：本地能力验收通过" --json --timeout 90 > "$TMP_DIR/agent_smoke.txt" 2>&1 || true
  require_string "$TMP_DIR/agent_smoke.txt" "本地能力验收通过" "agent smoke reply ok"
fi

printf '\n=== Summary ===\n'
printf 'PASS: %d\n' "$PASS_COUNT"
printf 'FAIL: %d\n' "$FAIL_COUNT"

if [[ "$FAIL_COUNT" -gt 0 ]]; then
  printf 'Result: FAILED\n'
  exit 1
fi

printf 'Result: ALL GREEN\n'
