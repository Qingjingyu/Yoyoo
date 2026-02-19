#!/usr/bin/env bash
set -euo pipefail

# Yoyoo OpenClaw doctor:
# - check: verify instance health and auto-heal config/runtime drift
# - freeze: snapshot current known-good baseline

ACTION="${1:-check}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

YOYOO_ROLE="${YOYOO_ROLE:-ceo}"
YOYOO_EMPLOYEE_KEY="${YOYOO_EMPLOYEE_KEY:-${YOYOO_ROLE}}"
YOYOO_HOME="${YOYOO_HOME:-/root/.openclaw}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
YOYOO_PROFILE="${YOYOO_PROFILE:-yoyoo-${YOYOO_ROLE}}"
OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT:-}"
YOYOO_EXPECT_FEISHU="${YOYOO_EXPECT_FEISHU:-0}"
YOYOO_EXPECT_FEISHU_GROUP_POLICY="${YOYOO_EXPECT_FEISHU_GROUP_POLICY:-}"
YOYOO_EXPECT_FEISHU_REQUIRE_MENTION="${YOYOO_EXPECT_FEISHU_REQUIRE_MENTION:-}"
YOYOO_EXPECT_FEISHU_UNIFIED_SESSION="${YOYOO_EXPECT_FEISHU_UNIFIED_SESSION:-0}"
YOYOO_AUTO_HEAL="${YOYOO_AUTO_HEAL:-1}"
YOYOO_BASELINE_DIR="${YOYOO_BASELINE_DIR:-${YOYOO_HOME}/baseline}"
YOYOO_FEISHU_SESSION_PATCH_SCRIPT="${YOYOO_FEISHU_SESSION_PATCH_SCRIPT:-${SCRIPT_DIR}/patch_openclaw_feishu_session.sh}"
YOYOO_GUARD_ALERT_WEBHOOK="${YOYOO_GUARD_ALERT_WEBHOOK:-}"
YOYOO_GUARD_ALERT_CHANNEL="${YOYOO_GUARD_ALERT_CHANNEL:-feishu}" # feishu | dingtalk
YOYOO_GUARD_ALERT_ON_RECOVER="${YOYOO_GUARD_ALERT_ON_RECOVER:-0}"
YOYOO_GUARD_ALERT_FEISHU_APP_ID="${YOYOO_GUARD_ALERT_FEISHU_APP_ID:-}"
YOYOO_GUARD_ALERT_FEISHU_APP_SECRET="${YOYOO_GUARD_ALERT_FEISHU_APP_SECRET:-}"
YOYOO_GUARD_ALERT_FEISHU_OPEN_ID="${YOYOO_GUARD_ALERT_FEISHU_OPEN_ID:-}"

if [[ -z "${OPENCLAW_SYSTEMD_UNIT}" ]]; then
  if [[ "${YOYOO_ROLE}" == "ceo" ]]; then
    OPENCLAW_SYSTEMD_UNIT="openclaw-gateway.service"
  else
    OPENCLAW_SYSTEMD_UNIT="openclaw-gateway-${YOYOO_ROLE}.service"
  fi
fi
if [[ "${YOYOO_EXPECT_FEISHU}" == "1" && "${YOYOO_ROLE}" == "ceo" ]]; then
  if [[ -z "${YOYOO_EXPECT_FEISHU_GROUP_POLICY}" ]]; then
    YOYOO_EXPECT_FEISHU_GROUP_POLICY="open"
  fi
  if [[ -z "${YOYOO_EXPECT_FEISHU_REQUIRE_MENTION}" ]]; then
    YOYOO_EXPECT_FEISHU_REQUIRE_MENTION="false"
  fi
fi

OPENCLAW_CONFIG_FILE="${YOYOO_HOME}/openclaw.json"
OPENCLAW_GOLDEN_CONFIG_FILE="${YOYOO_HOME}/openclaw.golden.json"

log() {
  printf '[yoyoo-doctor][%s][%s] %s\n' "${YOYOO_ROLE}" "${ACTION}" "$*"
}

send_guard_alert() {
  local status="${1:-failed}"
  local detail="${2:-healthcheck failed}"
  local webhook="${YOYOO_GUARD_ALERT_WEBHOOK}"
  local channel="${YOYOO_GUARD_ALERT_CHANNEL,,}"

  if [[ -z "${webhook}" ]]; then
    return 0
  fi
  if [[ "${status}" == "recovered" && "${YOYOO_GUARD_ALERT_ON_RECOVER}" != "1" ]]; then
    return 0
  fi

  local host payload text
  host="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo unknown-host)"
  text="[YoyooGuard][${status}] role=${YOYOO_ROLE} employee=${YOYOO_EMPLOYEE_KEY} host=${host} port=${OPENCLAW_PORT} unit=${OPENCLAW_SYSTEMD_UNIT}\n${detail}"

  # Preferred: direct Feishu app message (no webhook required)
  if [[ -z "${webhook}" && "${channel}" == "feishu" && -n "${YOYOO_GUARD_ALERT_FEISHU_APP_ID}" && -n "${YOYOO_GUARD_ALERT_FEISHU_APP_SECRET}" && -n "${YOYOO_GUARD_ALERT_FEISHU_OPEN_ID}" ]]; then
    local token_json token access_token content_json direct_payload
    token_json="$(
      curl -fsS -m 8 -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg id "${YOYOO_GUARD_ALERT_FEISHU_APP_ID}" --arg sec "${YOYOO_GUARD_ALERT_FEISHU_APP_SECRET}" '{app_id:$id,app_secret:$sec}')" \
        "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal" \
        2>/tmp/yoyoo_guard_alert_token_"${YOYOO_ROLE}".log || true
    )"
    access_token="$(printf '%s' "${token_json}" | jq -r '.tenant_access_token // empty' 2>/dev/null || true)"
    if [[ -n "${access_token}" ]]; then
      content_json="$(jq -nc --arg t "${text}" '{text:$t}')"
      direct_payload="$(jq -nc --arg rid "${YOYOO_GUARD_ALERT_FEISHU_OPEN_ID}" --arg c "${content_json}" '{receive_id:$rid,msg_type:"text",content:$c}')"
      if curl -fsS -m 8 \
        -H "Authorization: Bearer ${access_token}" \
        -H 'Content-Type: application/json' \
        -d "${direct_payload}" \
        "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id" \
        >/tmp/yoyoo_guard_alert_direct_"${YOYOO_ROLE}".log 2>&1; then
        return 0
      fi
      log "direct feishu push failed"
    else
      log "get feishu tenant_access_token failed"
    fi
  fi

  # Fallback: webhook push
  if [[ "${channel}" == "dingtalk" ]]; then
    payload="$(jq -nc --arg text "${text}" '{msgtype:"text",text:{content:$text}}')"
  else
    payload="$(jq -nc --arg text "${text}" '{msg_type:"text",content:{text:$text}}')"
  fi

  if ! curl -fsS -m 8 -H 'Content-Type: application/json' -d "${payload}" "${webhook}" >/tmp/yoyoo_guard_alert_"${YOYOO_ROLE}".log 2>&1; then
    log "alert push failed (channel=${channel})"
  fi
}

openclaw_cmd() {
  OPENCLAW_STATE_DIR="${YOYOO_HOME}" \
  OPENCLAW_PROFILE="${YOYOO_PROFILE}" \
  OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT}" \
  OPENCLAW_GATEWAY_PORT="${OPENCLAW_PORT}" \
  openclaw "$@"
}

ensure_golden_exists() {
  if [[ ! -f "${OPENCLAW_GOLDEN_CONFIG_FILE}" && -f "${OPENCLAW_CONFIG_FILE}" ]]; then
    install -m 600 "${OPENCLAW_CONFIG_FILE}" "${OPENCLAW_GOLDEN_CONFIG_FILE}"
    log "golden config created from current config"
  fi
}

restore_from_golden() {
  if [[ ! -f "${OPENCLAW_GOLDEN_CONFIG_FILE}" ]]; then
    log "golden config not found: ${OPENCLAW_GOLDEN_CONFIG_FILE}"
    return 1
  fi
  install -m 600 "${OPENCLAW_GOLDEN_CONFIG_FILE}" "${OPENCLAW_CONFIG_FILE}"
  log "restored openclaw config from golden"
}

config_is_valid_json() {
  [[ -f "${OPENCLAW_CONFIG_FILE}" ]] && jq empty "${OPENCLAW_CONFIG_FILE}" >/dev/null 2>&1
}

fix_gateway_port_if_needed() {
  local current_port tmp
  current_port="$(jq -r '.gateway.port // empty' "${OPENCLAW_CONFIG_FILE}" 2>/dev/null || true)"
  if [[ "${current_port}" == "${OPENCLAW_PORT}" ]]; then
    return 0
  fi
  if [[ "${YOYOO_AUTO_HEAL}" != "1" ]]; then
    log "gateway port drift detected (expected=${OPENCLAW_PORT}, got=${current_port:-empty})"
    return 1
  fi
  tmp="$(mktemp)"
  jq --argjson p "${OPENCLAW_PORT}" '.gateway = ((.gateway // {}) * {port:$p,mode:"local"})' "${OPENCLAW_CONFIG_FILE}" > "${tmp}"
  install -m 600 "${tmp}" "${OPENCLAW_CONFIG_FILE}"
  rm -f "${tmp}"
  log "gateway port auto-healed to ${OPENCLAW_PORT}"
}

check_feishu_if_required() {
  if [[ "${YOYOO_EXPECT_FEISHU}" != "1" ]]; then
    return 0
  fi
  local plugin_enabled channel_enabled
  plugin_enabled="$(jq -r '.plugins.entries.feishu.enabled // false' "${OPENCLAW_CONFIG_FILE}" 2>/dev/null || echo false)"
  channel_enabled="$(jq -r '.channels.feishu.enabled // false' "${OPENCLAW_CONFIG_FILE}" 2>/dev/null || echo false)"
  local actual_group_policy actual_require_mention
  actual_group_policy="$(jq -r '.channels.feishu.groupPolicy // empty' "${OPENCLAW_CONFIG_FILE}" 2>/dev/null || true)"
  actual_require_mention="$(
    jq -r 'if (.channels.feishu | has("requireMention")) then (.channels.feishu.requireMention | tostring) else "missing" end' \
      "${OPENCLAW_CONFIG_FILE}" 2>/dev/null || echo missing
  )"

  local drift="0"
  local reasons=()
  if [[ "${plugin_enabled}" != "true" ]]; then
    drift="1"
    reasons+=("plugin=${plugin_enabled}")
  fi
  if [[ "${channel_enabled}" != "true" ]]; then
    drift="1"
    reasons+=("channel=${channel_enabled}")
  fi
  if [[ -n "${YOYOO_EXPECT_FEISHU_GROUP_POLICY}" && "${actual_group_policy}" != "${YOYOO_EXPECT_FEISHU_GROUP_POLICY}" ]]; then
    drift="1"
    reasons+=("groupPolicy=${actual_group_policy:-empty}")
  fi
  if [[ -n "${YOYOO_EXPECT_FEISHU_REQUIRE_MENTION}" && "${actual_require_mention}" != "${YOYOO_EXPECT_FEISHU_REQUIRE_MENTION}" ]]; then
    drift="1"
    reasons+=("requireMention=${actual_require_mention}")
  fi
  if [[ "${drift}" == "0" ]]; then
    return 0
  fi
  log "feishu config drift detected (${reasons[*]})"
  if [[ "${YOYOO_AUTO_HEAL}" != "1" ]]; then
    return 1
  fi
  restore_from_golden
}

check_feishu_unified_session_if_required() {
  if [[ "${YOYOO_EXPECT_FEISHU_UNIFIED_SESSION}" != "1" ]]; then
    return 0
  fi
  local session_scope
  session_scope="$(jq -r '.session.scope // "per-sender"' "${OPENCLAW_CONFIG_FILE}" 2>/dev/null || echo per-sender)"
  if [[ "${session_scope}" != "global" ]]; then
    log "session.scope drift detected (expected=global, got=${session_scope})"
    if [[ "${YOYOO_AUTO_HEAL}" != "1" ]]; then
      return 1
    fi
    local tmp tmp2
    tmp="$(mktemp)"
    jq '.session = ((.session // {}) * {scope:"global"})' "${OPENCLAW_CONFIG_FILE}" > "${tmp}"
    install -m 600 "${tmp}" "${OPENCLAW_CONFIG_FILE}"
    rm -f "${tmp}"
    if [[ -f "${OPENCLAW_GOLDEN_CONFIG_FILE}" ]]; then
      tmp2="$(mktemp)"
      jq '.session = ((.session // {}) * {scope:"global"})' "${OPENCLAW_GOLDEN_CONFIG_FILE}" > "${tmp2}"
      install -m 600 "${tmp2}" "${OPENCLAW_GOLDEN_CONFIG_FILE}"
      rm -f "${tmp2}"
    fi
  fi
  if [[ ! -x "${YOYOO_FEISHU_SESSION_PATCH_SCRIPT}" ]]; then
    log "missing feishu patch script: ${YOYOO_FEISHU_SESSION_PATCH_SCRIPT}"
    return 1
  fi
  if "${YOYOO_FEISHU_SESSION_PATCH_SCRIPT}" >/tmp/yoyoo_doctor_feishu_patch_"${YOYOO_ROLE}".log 2>&1; then
    return 0
  fi
  log "feishu unified-session check failed"
  if [[ "${YOYOO_AUTO_HEAL}" != "1" ]]; then
    return 1
  fi
  log "attempting feishu unified-session auto-heal"
  "${YOYOO_FEISHU_SESSION_PATCH_SCRIPT}" >/tmp/yoyoo_doctor_feishu_patch_"${YOYOO_ROLE}".log 2>&1
}

probe_gateway() {
  openclaw_cmd channels status --probe >/tmp/yoyoo_doctor_probe_"${YOYOO_ROLE}".log 2>&1
}

restart_gateway() {
  openclaw_cmd gateway restart >/tmp/yoyoo_doctor_restart_"${YOYOO_ROLE}".log 2>&1 || true
  sleep 3
}

run_check() {
  local notes=()
  local notes_text=""

  ensure_golden_exists

  if ! config_is_valid_json; then
    notes+=("config_invalid")
    log "config missing or invalid JSON"
    if [[ "${YOYOO_AUTO_HEAL}" == "1" ]]; then
      restore_from_golden
    fi
  fi

  if ! config_is_valid_json; then
    log "healthcheck failed: config still invalid"
    notes_text="$(IFS='; '; echo "${notes[*]}")"
    send_guard_alert "failed" "${notes_text:-config still invalid}"
    return 1
  fi

  if ! fix_gateway_port_if_needed; then
    notes+=("gateway_port_drift")
    notes_text="$(IFS='; '; echo "${notes[*]}")"
    send_guard_alert "failed" "${notes_text}"
    return 1
  fi
  if ! check_feishu_if_required; then
    notes+=("feishu_config_drift")
    notes_text="$(IFS='; '; echo "${notes[*]}")"
    send_guard_alert "failed" "${notes_text}"
    return 1
  fi
  if ! check_feishu_unified_session_if_required; then
    notes+=("feishu_session_patch_failed")
    notes_text="$(IFS='; '; echo "${notes[*]}")"
    send_guard_alert "failed" "${notes_text}"
    return 1
  fi

  if probe_gateway; then
    log "probe ok"
    return 0
  fi

  log "probe failed, restarting gateway"
  notes+=("probe_failed")
  restart_gateway

  if probe_gateway; then
    log "probe ok after restart"
    notes+=("recovered_by_restart")
    notes_text="$(IFS='; '; echo "${notes[*]}")"
    send_guard_alert "recovered" "${notes_text}"
    return 0
  fi

  if [[ "${YOYOO_AUTO_HEAL}" == "1" ]]; then
    log "restoring config from golden and retrying"
    notes+=("restore_golden_retry")
    restore_from_golden
    restart_gateway
    if probe_gateway; then
      log "probe ok after config restore"
      notes+=("recovered_by_restore")
      notes_text="$(IFS='; '; echo "${notes[*]}")"
      send_guard_alert "recovered" "${notes_text}"
      return 0
    fi
  fi

  log "healthcheck failed after auto-heal attempts"
  notes+=("final_failure")
  notes_text="$(IFS='; '; echo "${notes[*]}")"
  send_guard_alert "failed" "${notes_text}"
  return 1
}

run_freeze() {
  local ts snapshot_dir manifest_file
  ts="$(date +%Y%m%d_%H%M%S)"
  snapshot_dir="${YOYOO_BASELINE_DIR}/snapshots/${ts}"
  manifest_file="${snapshot_dir}/manifest.json"

  mkdir -p "${snapshot_dir}"
  ensure_golden_exists

  [[ -f "${OPENCLAW_CONFIG_FILE}" ]] && install -m 600 "${OPENCLAW_CONFIG_FILE}" "${snapshot_dir}/openclaw.json"
  [[ -f "${OPENCLAW_GOLDEN_CONFIG_FILE}" ]] && install -m 600 "${OPENCLAW_GOLDEN_CONFIG_FILE}" "${snapshot_dir}/openclaw.golden.json"

  openclaw_cmd gateway status > "${snapshot_dir}/gateway_status.txt" 2>&1 || true
  openclaw_cmd channels status --probe > "${snapshot_dir}/channels_status.txt" 2>&1 || true
  openclaw_cmd models status --json > "${snapshot_dir}/models_status.json" 2>&1 || true

  jq -n \
    --arg role "${YOYOO_ROLE}" \
    --arg home "${YOYOO_HOME}" \
    --arg profile "${YOYOO_PROFILE}" \
    --arg unit "${OPENCLAW_SYSTEMD_UNIT}" \
    --arg config "${OPENCLAW_CONFIG_FILE}" \
    --arg golden "${OPENCLAW_GOLDEN_CONFIG_FILE}" \
    --arg port "${OPENCLAW_PORT}" \
    --arg at "${ts}" \
    '{
      role: $role,
      frozenAt: $at,
      openclawHome: $home,
      openclawProfile: $profile,
      openclawSystemdUnit: $unit,
      openclawPort: $port,
      configFile: $config,
      goldenConfigFile: $golden
    }' > "${manifest_file}"

  ln -sfn "${snapshot_dir}" "${YOYOO_BASELINE_DIR}/latest"
  log "baseline frozen at ${snapshot_dir}"
}

case "${ACTION}" in
  check)
    run_check
    ;;
  freeze)
    run_freeze
    ;;
  *)
    echo "Usage: $0 [check|freeze]" >&2
    exit 2
    ;;
esac
