#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

echo "[preflight] root=${ROOT_DIR}"

required_cmds=(git curl jq)
for cmd in "${required_cmds[@]}"; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "[preflight] missing command: ${cmd}" >&2
    exit 1
  fi
done

pinned_version="$(grep -E 'OPENCLAW_PINNED_VERSION=' install.sh | head -n 1 | sed -E 's/.*:-([^"}]+).*/\1/')"
if command -v openclaw >/dev/null 2>&1; then
  current_version="$(openclaw --version 2>/dev/null | head -n 1 | tr -d '\r' | xargs || true)"
  echo "[preflight] openclaw_current=${current_version:-unknown}"
  echo "[preflight] openclaw_pinned=${pinned_version:-unknown}"
else
  echo "[preflight] openclaw not found in PATH (will be installed by install.sh)"
fi

for port in 18789 18794; do
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn "( sport = :${port} )" 2>/dev/null | awk 'NR>1{print $0}' | grep -q .; then
      echo "[preflight] port ${port} already in use"
    else
      echo "[preflight] port ${port} is free"
    fi
  fi
done

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "[preflight] MINIMAX_API_KEY is not set (interactive install will prompt)."
else
  echo "[preflight] MINIMAX_API_KEY is set."
fi

echo "[preflight] OK"

