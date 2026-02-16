#!/usr/bin/env bash
set -euo pipefail

# Yoyoo acceptance check:
# - gateway/channel probe
# - CEO unified Feishu session guard
# - auth profile completeness (minimax + anthropic)
# - recent critical error scan in journald

MAX_LOG_LINES="${MAX_LOG_LINES:-400}"
SCAN_ROLES="${SCAN_ROLES:-ceo ops rd-director rd-engineer}"
AUTO_CLEAN_ORPHAN_PORT="${AUTO_CLEAN_ORPHAN_PORT:-0}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail_count=0

log() {
  printf '[acceptance] %s\n' "$*"
}

pass() {
  printf '[PASS] %s\n' "$*"
}

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  fail_count=$((fail_count + 1))
}

role_home() {
  case "$1" in
    ceo) echo "/root/.openclaw" ;;
    ops) echo "/root/.openclaw-ops" ;;
    rd-director) echo "/root/.openclaw-rd-director" ;;
    rd-engineer) echo "/root/.openclaw-rd-engineer" ;;
    *) return 1 ;;
  esac
}

role_port() {
  case "$1" in
    ceo) echo "18789" ;;
    ops) echo "18790" ;;
    rd-director) echo "18791" ;;
    rd-engineer) echo "18793" ;;
    *) return 1 ;;
  esac
}

role_profile() {
  echo "yoyoo-$1"
}

role_unit() {
  case "$1" in
    ceo) echo "openclaw-gateway.service" ;;
    ops) echo "openclaw-gateway-ops.service" ;;
    rd-director) echo "openclaw-gateway-rd-director.service" ;;
    rd-engineer) echo "openclaw-gateway-rd-engineer.service" ;;
    *) return 1 ;;
  esac
}

port_listen_lines() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltnp "( sport = :${port} )" 2>/dev/null | awk 'NR>1'
    return 0
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN 2>/dev/null | awk 'NR>1 {printf "LISTEN users:((\"%s\",pid=%s,fd=%s))\n",$1,$2,$4}'
    return 0
  fi
  return 0
}

port_owner_cmdlines() {
  local lines="$1"
  local pids
  pids="$(printf '%s\n' "${lines}" | rg -o 'pid=[0-9]+' | sed 's/pid=//' | sort -u | paste -sd, -)"
  if [[ -z "${pids}" ]]; then
    return 0
  fi
  ps -p "${pids}" -o pid=,args= 2>/dev/null || true
}

extract_pids() {
  local lines="$1"
  printf '%s\n' "${lines}" | rg -o 'pid=[0-9]+' | sed 's/pid=//' | sort -u
}

kill_pids() {
  local lines="$1"
  local any=0
  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    any=1
    kill "${pid}" >/dev/null 2>&1 || true
  done < <(extract_pids "${lines}")
  if [[ "${any}" -eq 1 ]]; then
    sleep 1
    return 0
  fi
  return 1
}

probe_role() {
  local role="$1"
  local home port profile unit
  home="$(role_home "${role}")"
  port="$(role_port "${role}")"
  profile="$(role_profile "${role}")"
  unit="$(role_unit "${role}")"

  if [[ ! -f "${home}/openclaw.json" ]]; then
    log "skip role=${role} (no openclaw.json at ${home})"
    return 0
  fi

  if OPENCLAW_STATE_DIR="${home}" \
    OPENCLAW_PROFILE="${profile}" \
    OPENCLAW_SYSTEMD_UNIT="${unit}" \
    OPENCLAW_GATEWAY_PORT="${port}" \
    openclaw channels status --probe >/tmp/yoyoo_accept_probe_"${role}".log 2>&1; then
    pass "role=${role} probe"
  else
    fail "role=${role} probe (see /tmp/yoyoo_accept_probe_${role}.log)"
  fi
}

check_auth_profiles() {
  local role="$1"
  local home auth_file
  home="$(role_home "${role}")"
  auth_file="${home}/agents/main/agent/auth-profiles.json"

  if [[ ! -f "${home}/openclaw.json" ]]; then
    return 0
  fi
  if [[ ! -f "${auth_file}" ]]; then
    fail "role=${role} missing auth profiles (${auth_file})"
    return 0
  fi

  local has_minimax has_anthropic key_len
  has_minimax="$(jq -r 'has("minimax")' "${auth_file}" 2>/dev/null || echo false)"
  has_anthropic="$(jq -r 'has("anthropic")' "${auth_file}" 2>/dev/null || echo false)"
  key_len="$(jq -r '.anthropic.apiKey // "" | length' "${auth_file}" 2>/dev/null || echo 0)"

  if [[ "${has_minimax}" == "true" && "${has_anthropic}" == "true" && "${key_len}" -gt 0 ]]; then
    pass "role=${role} auth profiles"
  else
    fail "role=${role} auth profiles invalid (minimax=${has_minimax}, anthropic=${has_anthropic}, anthropicKeyLen=${key_len})"
  fi
}

check_ceo_unified_session() {
  local home="/root/.openclaw"
  local cfg="${home}/openclaw.json"
  local patch_script="${SCRIPT_DIR}/patch_openclaw_feishu_session.sh"
  if [[ ! -f "${cfg}" ]]; then
    log "skip CEO unified-session check (no ${cfg})"
    return 0
  fi

  local session_scope
  session_scope="$(jq -r '.session.scope // "per-sender"' "${cfg}" 2>/dev/null || echo per-sender)"
  if [[ "${session_scope}" == "global" ]]; then
    pass "ceo session.scope=global"
  else
    fail "ceo session.scope drift (expected=global got=${session_scope})"
  fi

  if [[ -x "${patch_script}" ]] && "${patch_script}" >/tmp/yoyoo_accept_ceo_patch.log 2>&1; then
    pass "ceo feishu unified-session patch"
  else
    fail "ceo feishu unified-session patch (see /tmp/yoyoo_accept_ceo_patch.log)"
  fi
}

check_reserved_role_ports() {
  local role port home lines cmds
  for role in ceo ops rd-director rd-engineer; do
    port="$(role_port "${role}")"
    home="$(role_home "${role}")"
    lines="$(port_listen_lines "${port}")"
    if [[ -z "${lines}" ]]; then
      continue
    fi
    cmds="$(port_owner_cmdlines "${lines}")"
    if [[ ! -f "${home}/openclaw.json" ]]; then
      if [[ "${AUTO_CLEAN_ORPHAN_PORT}" == "1" ]] && printf '%s\n' "${cmds}" | rg -q 'openclaw-gateway|node .*openclaw'; then
        if kill_pids "${lines}"; then
          local after_lines after_cmds
          after_lines="$(port_listen_lines "${port}")"
          if [[ -z "${after_lines}" ]]; then
            pass "reserved port ${port} orphan cleaned (role=${role})"
          else
            after_cmds="$(port_owner_cmdlines "${after_lines}")"
            fail "reserved port ${port} orphan clean failed. owner=${after_cmds:-unknown}"
          fi
        else
          fail "reserved port ${port} orphan clean skipped (no pid found). owner=${cmds:-unknown}"
        fi
      else
        fail "reserved port ${port} is occupied but role=${role} not activated. owner=${cmds:-unknown}"
      fi
      continue
    fi
    if printf '%s\n' "${cmds}" | rg -q 'openclaw|node .*openclaw'; then
      pass "reserved port ${port} owner check (role=${role})"
    else
      fail "reserved port ${port} occupied by unexpected process. owner=${cmds:-unknown}"
    fi
  done
}

check_legacy_rd_engineer_port() {
  local legacy_port="18792"
  local lines cmds
  lines="$(port_listen_lines "${legacy_port}")"
  if [[ -z "${lines}" ]]; then
    pass "legacy port ${legacy_port} clear"
    return 0
  fi

  cmds="$(port_owner_cmdlines "${lines}")"
  local ceo_lines ceo_pids legacy_pids shared_pid
  ceo_lines="$(port_listen_lines "$(role_port ceo)")"
  ceo_pids="$(extract_pids "${ceo_lines}" | paste -sd, -)"
  legacy_pids="$(extract_pids "${lines}" | paste -sd, -)"
  shared_pid="$(printf '%s\n' "${legacy_pids}" | tr ',' '\n' | rg -x -f <(printf '%s\n' "${ceo_pids}" | tr ',' '\n') || true)"
  if [[ -n "${shared_pid}" ]]; then
    pass "legacy port ${legacy_port} co-listened by CEO gateway pid=${shared_pid}"
    return 0
  fi

  if ! printf '%s\n' "${cmds}" | rg -q 'openclaw|node .*openclaw'; then
    log "legacy port ${legacy_port} occupied by non-openclaw process, ignore. owner=${cmds:-unknown}"
    return 0
  fi

  if [[ "${AUTO_CLEAN_ORPHAN_PORT}" == "1" ]]; then
    if kill_pids "${lines}"; then
      local after_lines after_cmds
      after_lines="$(port_listen_lines "${legacy_port}")"
      if [[ -z "${after_lines}" ]]; then
        pass "legacy port ${legacy_port} stale openclaw listener cleaned"
      else
        after_cmds="$(port_owner_cmdlines "${after_lines}")"
        fail "legacy port ${legacy_port} cleanup failed. owner=${after_cmds:-unknown}"
      fi
    else
      fail "legacy port ${legacy_port} stale listener detected but pid not found. owner=${cmds:-unknown}"
    fi
  else
    fail "legacy port ${legacy_port} has stale openclaw listener. owner=${cmds:-unknown}"
  fi
}

scan_critical_logs() {
  local role="$1"
  local home unit
  home="$(role_home "${role}")"
  unit="$(role_unit "${role}")"
  if [[ ! -f "${home}/openclaw.json" ]]; then
    return 0
  fi

  local log_file="/tmp/yoyoo_accept_journal_${role}.log"
  journalctl -u "${unit}" -n "${MAX_LOG_LINES}" --no-pager >"${log_file}" 2>&1 || true

  local bad=0
  if rg -q 'No API key found for provider "anthropic"' "${log_file}"; then
    bad=1
  fi
  if rg -q "unknown option '--model'" "${log_file}"; then
    bad=1
  fi
  if [[ "${bad}" -eq 0 ]]; then
    pass "role=${role} critical-log scan"
  else
    fail "role=${role} critical-log scan (see ${log_file})"
  fi
}

main() {
  log "roles=${SCAN_ROLES} max_log_lines=${MAX_LOG_LINES}"

  check_ceo_unified_session
  check_reserved_role_ports
  check_legacy_rd_engineer_port

  for role in ${SCAN_ROLES}; do
    probe_role "${role}"
    check_auth_profiles "${role}"
    scan_critical_logs "${role}"
  done

  if [[ "${fail_count}" -gt 0 ]]; then
    echo
    echo "ACCEPTANCE_RESULT=FAIL (${fail_count} checks failed)"
    exit 1
  fi
  echo
  echo "ACCEPTANCE_RESULT=PASS"
}

main "$@"
