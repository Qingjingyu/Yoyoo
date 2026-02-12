#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[release-check] lint"
make lint
echo "[release-check] test"
make test
echo "[release-check] baseline replay"
make baseline

if [[ "${CHECK_HTTP:-0}" == "1" ]]; then
  BASE_URL="${BASE_URL:-http://127.0.0.1:8000}"
  echo "[release-check] http health checks: ${BASE_URL}"
  curl -fsS "${BASE_URL}/healthz" >/dev/null
  curl -fsS "${BASE_URL}/api/v1/ops/health" >/dev/null
  curl -fsS "${BASE_URL}/api/v1/ops/alerts" >/dev/null
fi

echo "[release-check] done"
