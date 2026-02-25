#!/usr/bin/env bash
set -euo pipefail

# One-line entry for local multi-role collaboration on top of OpenClaw gateway.
# Example:
#   bash scripts/yoyoo_multi_team_run.sh "把本地发布流程做成一键验收"
#   bash scripts/yoyoo_multi_team_run.sh "写发布方案" "coder,writer,growth,legal"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <objective> [roles_csv]"
  echo "roles default: coder,writer,growth"
  exit 1
fi

OBJECTIVE="$1"
ROLES_CSV="${2:-coder,writer,growth}"
BASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$BASE_DIR/shared-memory/reports"
NOW_UTC="$(date -u +%Y%m%d_%H%M%S)"
REPORT_FILE="$REPORT_DIR/multi-team-${NOW_UTC}.md"
TMP_DIR="$(mktemp -d)"
SAFE_CALL_SCRIPT="$BASE_DIR/scripts/openclaw_gateway_call_safe.sh"
trap 'rm -rf "$TMP_DIR"' EXIT

mkdir -p "$REPORT_DIR"

valid_role() {
  case "$1" in
    coder|writer|growth|legal|finance|teacher) return 0 ;;
    *) return 1 ;;
  esac
}

role_instruction() {
  case "$1" in
    coder) echo "你是工程师。请给最小可执行方案、风险、验收点。" ;;
    writer) echo "你是内容官。请给对内说明、对外文案、一句话卖点。" ;;
    growth) echo "你是增长官。请给触达路径、核心指标、7天动作清单。" ;;
    legal) echo "你是法务官。请给合规风险、必须补条款、禁止动作。" ;;
    finance) echo "你是财务官。请给预算、ROI、止损线。" ;;
    teacher) echo "你是培训官。请给SOP、培训大纲、验收清单。" ;;
    *) echo "你是协作成员。请给执行建议。" ;;
  esac
}

if ! command -v openclaw >/dev/null 2>&1; then
  echo "[error] openclaw not found"
  exit 1
fi

if [[ ! -x "$SAFE_CALL_SCRIPT" ]]; then
  echo "[error] safe call script missing or not executable: $SAFE_CALL_SCRIPT"
  exit 1
fi

if ! openclaw gateway health --json --timeout 8000 >"$TMP_DIR/gateway-health.json" 2>&1; then
  echo "[error] gateway unavailable. start it first:"
  echo "  openclaw gateway run --port 18789"
  exit 1
fi

IFS=',' read -r -a ROLES_RAW <<< "$ROLES_CSV"
ROLES=()
for raw in "${ROLES_RAW[@]}"; do
  role="$(echo "$raw" | xargs)"
  [[ -z "$role" ]] && continue
  if ! valid_role "$role"; then
    echo "[error] unsupported role: $role"
    exit 1
  fi
  skip="false"
  for exists in "${ROLES[@]:-}"; do
    if [[ "$exists" == "$role" ]]; then
      skip="true"
      break
    fi
  done
  [[ "$skip" == "false" ]] && ROLES+=("$role")
done

if [[ ${#ROLES[@]} -eq 0 ]]; then
  ROLES=(coder writer growth)
fi

echo "# Yoyoo Multi-Team Report" > "$REPORT_FILE"
echo "- GeneratedAt(UTC): $(date -u '+%Y-%m-%d %H:%M:%S')" >> "$REPORT_FILE"
echo "- Objective: $OBJECTIVE" >> "$REPORT_FILE"
echo "- Roles: $(IFS=','; echo "${ROLES[*]}")" >> "$REPORT_FILE"
echo >> "$REPORT_FILE"

SUMMARY_LINES=()
PASS=0
FAIL=0

for role in "${ROLES[@]}"; do
  session_id="team-${role}-${NOW_UTC}"
  session_key="agent:${role}:main"
  run_id="yoyoo-${role}-${NOW_UTC}"

  prompt="$(role_instruction "$role")
目标：$OBJECTIVE
要求：先结论，再清单，尽量短。"

  params="$(python3 - "$prompt" "$role" "$session_id" "$session_key" "$run_id" <<'PY'
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

  raw_file="$TMP_DIR/${role}.json"
  if ! bash "$SAFE_CALL_SCRIPT" --params "$params" --timeout-ms 120000 --process-timeout-seconds 170 > "$raw_file" 2>"$TMP_DIR/${role}.err"; then
    FAIL=$((FAIL + 1))
    err_msg="$(tail -n 2 "$TMP_DIR/${role}.err" | tr '\n' ' ' | xargs)"
    SUMMARY_LINES+=("- ${role}: [error] ${err_msg}")
    {
      echo "## ${role}"
      echo "[error] ${err_msg}"
      echo
    } >> "$REPORT_FILE"
    continue
  fi

  parse_file="$TMP_DIR/${role}.parsed"
  if python3 - "$raw_file" "$role" > "$parse_file" <<'PY'
import json
import sys
raw_path, role = sys.argv[1], sys.argv[2]
obj = json.loads(open(raw_path, "r", encoding="utf-8").read())
result = obj.get("result") or {}
meta = (result.get("meta") or {}).get("systemPromptReport") or {}
payloads = result.get("payloads") or []
text = ""
if payloads and isinstance(payloads[0], dict):
    text = (payloads[0].get("text") or "").strip()
session_key = (meta.get("sessionKey") or "").strip()
workspace = (meta.get("workspaceDir") or "").strip()
expect_key = f"agent:{role}:main"
if session_key != expect_key:
    raise SystemExit(f"sessionKey mismatch: {session_key} != {expect_key}")
if role != "main" and f"/.openclaw/workspaces/{role}" not in workspace:
    raise SystemExit(f"workspace mismatch: {workspace}")
if not text:
    text = "(empty)"
print(text)
print("----META----")
print(session_key)
print(workspace)
PY
  then
    PASS=$((PASS + 1))
    reply="$(awk '/^----META----$/{exit} {print}' "$parse_file")"
    session_key_line="$(awk 'f==1{print; exit} /^----META----$/{f=1}' "$parse_file")"
    workspace_line="$(awk 'f==1{n++; if(n==2){print; exit}} /^----META----$/{f=1}' "$parse_file")"
    short_reply="$(echo "$reply" | tr '\n' ' ' | sed 's/[[:space:]]\+/ /g' | cut -c1-120)"
    SUMMARY_LINES+=("- ${role}: ${short_reply}")

    {
      echo "## ${role}"
      echo "$reply"
      echo
      echo "- sessionKey: ${session_key_line}"
      echo "- workspace: ${workspace_line}"
      echo
    } >> "$REPORT_FILE"
  else
    FAIL=$((FAIL + 1))
    err_msg="$(tail -n 1 "$parse_file" | xargs)"
    SUMMARY_LINES+=("- ${role}: [error] ${err_msg}")
    {
      echo "## ${role}"
      echo "[error] ${err_msg}"
      echo
    } >> "$REPORT_FILE"
  fi
done

echo "## Summary" >> "$REPORT_FILE"
for line in "${SUMMARY_LINES[@]}"; do
  echo "$line" >> "$REPORT_FILE"
done
echo >> "$REPORT_FILE"
echo "- pass: $PASS" >> "$REPORT_FILE"
echo "- fail: $FAIL" >> "$REPORT_FILE"

echo "[done] report: $REPORT_FILE"
echo "[done] pass: $PASS, fail: $FAIL"
echo
cat "$REPORT_FILE"
