#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "[build-safe] Stopping workspace dev instances..."
bash "$SCRIPT_DIR/stop-single.sh"

echo "[build-safe] Cleaning .next..."
rm -rf "$PROJECT_DIR/.next"

echo "[build-safe] Building..."
cd "$PROJECT_DIR"
exec npx next build

