#!/usr/bin/env bash
set -euo pipefail

WINDOW_MINUTES="${YOYOO_GUARD_WINDOW_MINUTES:-5}"
MIN_EVENTS="${YOYOO_GUARD_MIN_EVENTS:-1}"
FORWARDER_UNIT="${YOYOO_FORWARDER_UNIT:-yoyoo-dingtalk-forwarder.service}"
BACKEND_UNIT="${YOYOO_BACKEND_UNIT:-yoyoo-backend.service}"
TAG="${YOYOO_GUARD_LOG_TAG:-yoyoo-dingtalk-guard}"
AUTO_RESTART="${YOYOO_GUARD_AUTO_RESTART:-0}"
ALERT_WEBHOOK="${YOYOO_GUARD_ALERT_WEBHOOK:-}"

if ! [[ "${WINDOW_MINUTES}" =~ ^[0-9]+$ ]] || [[ "${WINDOW_MINUTES}" -le 0 ]]; then
  echo "invalid YOYOO_GUARD_WINDOW_MINUTES: ${WINDOW_MINUTES}" >&2
  exit 1
fi
if ! [[ "${MIN_EVENTS}" =~ ^[0-9]+$ ]]; then
  echo "invalid YOYOO_GUARD_MIN_EVENTS: ${MIN_EVENTS}" >&2
  exit 1
fi
if ! command -v journalctl >/dev/null 2>&1; then
  echo "journalctl not found; this guard script must run on systemd host" >&2
  exit 1
fi

SINCE="${WINDOW_MINUTES} min ago"
event_count="$(
  journalctl -u "${FORWARDER_UNIT}" --since "${SINCE}" --no-pager |
    rg -c -- "\\[dingtalk-forwarder\\] envelope source=callback topic=/v1.0/im/bot/messages/get" || true
)"
if [[ -z "${event_count}" ]]; then
  event_count="0"
fi
heartbeat_count="$(
  journalctl -u "${FORWARDER_UNIT}" --since "${SINCE}" --no-pager |
    rg -c -- "CLIENT-SIDE HEARTBEAT|connect success" || true
)"
if [[ -z "${heartbeat_count}" ]]; then
  heartbeat_count="0"
fi

forwarder_active="$(systemctl is-active "${FORWARDER_UNIT}" 2>/dev/null || true)"
backend_active="$(systemctl is-active "${BACKEND_UNIT}" 2>/dev/null || true)"

notify_webhook() {
  local text="$1"
  [[ -n "${ALERT_WEBHOOK}" ]] || return 0
  curl -sS -m 6 -X POST "${ALERT_WEBHOOK}" \
    -H "Content-Type: application/json" \
    -d "{\"msgtype\":\"text\",\"text\":{\"content\":\"${text}\"}}" >/dev/null || true
}

# Hard failure: core services are not active.
if [[ "${forwarder_active}" != "active" || "${backend_active}" != "active" ]]; then
  msg="ALERT service_inactive forwarder=${forwarder_active:-unknown} backend=${backend_active:-unknown} forwarder_unit=${FORWARDER_UNIT} backend_unit=${BACKEND_UNIT}"
  logger -t "${TAG}" "${msg}"
  notify_webhook "${msg}"
  if [[ "${AUTO_RESTART}" == "1" ]]; then
    systemctl restart "${FORWARDER_UNIT}" || true
    systemctl restart "${BACKEND_UNIT}" || true
    logger -t "${TAG}" "ACTION restart_services forwarder=${FORWARDER_UNIT} backend=${BACKEND_UNIT}"
  fi
  echo "${msg}"
  exit 0
fi

if [[ "${event_count}" -lt "${MIN_EVENTS}" ]]; then
  # No message traffic but heartbeat is alive: treat as idle-healthy, do not alert.
  if [[ "${heartbeat_count}" -gt 0 ]]; then
    ok_idle_msg="OK idle_healthy window=${WINDOW_MINUTES}m events=${event_count} heartbeat=${heartbeat_count}"
    logger -t "${TAG}" "${ok_idle_msg}"
    echo "${ok_idle_msg}"
    exit 0
  fi

  msg="ALERT stream_unhealthy window=${WINDOW_MINUTES}m min_events=${MIN_EVENTS} actual=${event_count} heartbeat=${heartbeat_count} unit=${FORWARDER_UNIT}"
  logger -t "${TAG}" "${msg}"
  notify_webhook "${msg}"

  if [[ "${AUTO_RESTART}" == "1" ]]; then
    systemctl restart "${FORWARDER_UNIT}" || true
    logger -t "${TAG}" "ACTION restart_forwarder unit=${FORWARDER_UNIT}"
  fi
  echo "${msg}"
  exit 0
fi

ok_msg="OK dingtalk_events window=${WINDOW_MINUTES}m events=${event_count} heartbeat=${heartbeat_count}"
logger -t "${TAG}" "${ok_msg}"
echo "${ok_msg}"
