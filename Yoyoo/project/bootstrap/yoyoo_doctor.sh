#!/usr/bin/env bash
set -euo pipefail

# Yoyoo OpenClaw doctor:
# - check: verify instance health and auto-heal config/runtime drift
# - freeze: snapshot current known-good baseline

ACTION="${1:-check}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

YOYOO_ROLE="${YOYOO_ROLE:-ceo}"
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
  ensure_golden_exists

  if ! config_is_valid_json; then
    log "config missing or invalid JSON"
    if [[ "${YOYOO_AUTO_HEAL}" == "1" ]]; then
      restore_from_golden
    fi
  fi

  if ! config_is_valid_json; then
    log "healthcheck failed: config still invalid"
    return 1
  fi

  fix_gateway_port_if_needed
  check_feishu_if_required
  check_feishu_unified_session_if_required

  if probe_gateway; then
    log "probe ok"
    return 0
  fi

  log "probe failed, restarting gateway"
  restart_gateway

  if probe_gateway; then
    log "probe ok after restart"
    return 0
  fi

  if [[ "${YOYOO_AUTO_HEAL}" == "1" ]]; then
    log "restoring config from golden and retrying"
    restore_from_golden
    restart_gateway
    if probe_gateway; then
      log "probe ok after config restore"
      return 0
    fi
  fi

  log "healthcheck failed after auto-heal attempts"
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
