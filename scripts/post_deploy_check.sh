#!/usr/bin/env bash
set -euo pipefail

YOYOO_MODE="${YOYOO_MODE:-single}"
REQUIRE_CTO="${REQUIRE_CTO:-}"
STRICT_PROBE="${STRICT_PROBE:-0}"
if [[ -z "${REQUIRE_CTO}" ]]; then
  if [[ "${YOYOO_MODE}" == "dual" ]]; then
    REQUIRE_CTO="1"
  else
    REQUIRE_CTO="0"
  fi
fi
FAIL=0

check_systemd_unit() {
  local unit="$1"
  if ! command -v systemctl >/dev/null 2>&1; then
    echo "[post-check] systemctl not found, skip unit check: ${unit}"
    return 0
  fi
  if systemctl is-active --quiet "${unit}"; then
    echo "[post-check] ${unit}: active"
    return 0
  fi
  echo "[post-check] ${unit}: not active" >&2
  FAIL=1
}

check_port() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :${port} )" 2>/dev/null | awk 'NR>1{print $0}' | grep -q .; then
      echo "[post-check] port ${port}: listening"
      return 0
    fi
  elif command -v lsof >/dev/null 2>&1; then
    if lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
      echo "[post-check] port ${port}: listening"
      return 0
    fi
  fi
  echo "[post-check] port ${port}: not listening" >&2
  FAIL=1
}

probe_openclaw() {
  local state_dir="$1"
  local profile="$2"
  local unit="$3"
  local port="$4"
  if ! command -v openclaw >/dev/null 2>&1; then
    echo "[post-check] openclaw not found, skip probe for ${profile}" >&2
    FAIL=1
    return
  fi
  if OPENCLAW_STATE_DIR="${state_dir}" \
    OPENCLAW_PROFILE="${profile}" \
    OPENCLAW_SYSTEMD_UNIT="${unit}" \
    OPENCLAW_GATEWAY_PORT="${port}" \
    openclaw channels status --probe >/tmp/yoyoo_post_check_"${profile}".log 2>&1; then
    echo "[post-check] probe ${profile}: pass"
  else
    if [[ "${STRICT_PROBE}" == "1" ]]; then
      echo "[post-check] probe ${profile}: fail (strict mode, see /tmp/yoyoo_post_check_${profile}.log)" >&2
      FAIL=1
    else
      echo "[post-check] probe ${profile}: warn (non-strict, see /tmp/yoyoo_post_check_${profile}.log)"
    fi
  fi
}

check_http() {
  local url="$1"
  if curl -fsS "${url}" >/dev/null 2>&1; then
    echo "[post-check] ${url}: ok"
    return 0
  fi
  echo "[post-check] ${url}: failed" >&2
  FAIL=1
}

check_systemd_unit "openclaw-gateway.service"
check_port 18789
probe_openclaw "/root/.openclaw" "yoyoo-ceo" "openclaw-gateway.service" "18789"

if [[ "${REQUIRE_CTO}" == "1" ]]; then
  check_systemd_unit "openclaw-gateway-cto.service"
  check_port 18794
  probe_openclaw "/root/.openclaw-cto" "yoyoo-cto" "openclaw-gateway-cto.service" "18794"
fi

check_http "http://127.0.0.1:8000/healthz"

if [[ "${REQUIRE_CTO}" == "1" ]]; then
  check_http "http://127.0.0.1:8004/healthz"
fi

if [[ "${FAIL}" -ne 0 ]]; then
  echo "[post-check] FAILED" >&2
  exit 1
fi

echo "[post-check] OK"
