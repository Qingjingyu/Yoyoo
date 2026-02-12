#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

echo "[yoyoo-release-check] base release check"
bash scripts/release_check.sh

echo "[yoyoo-release-check] memory maintenance dry-run"
python3 scripts/memory_maintenance.py --dry-run >/dev/null

echo "[yoyoo-release-check] full stack smoke"
bash scripts/smoke_full_stack.sh

echo "[yoyoo-release-check] done"
