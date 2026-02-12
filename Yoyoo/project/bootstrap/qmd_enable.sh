#!/usr/bin/env bash
set -euo pipefail

# Enable QMD backend for OpenClaw memory.

YOYOO_HOME="${YOYOO_HOME:-/root/.openclaw}"
OPENCLAW_CONFIG="${YOYOO_HOME}/openclaw.json"
QMD_TIMEOUT_MS="${QMD_TIMEOUT_MS:-8000}"

if [[ ! -f "${OPENCLAW_CONFIG}" ]]; then
  echo "openclaw config not found: ${OPENCLAW_CONFIG}" >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  npm i -g bun >/tmp/yoyoo_qmd_bun_install.log 2>&1
fi

if ! command -v qmd >/dev/null 2>&1; then
  bun install -g github:tobi/qmd >/tmp/yoyoo_qmd_install.log 2>&1 || true
fi

python3 - <<PY
import json
from pathlib import Path

cfg_path = Path("${OPENCLAW_CONFIG}")
obj = json.loads(cfg_path.read_text(encoding="utf-8"))
mem = obj.setdefault("memory", {})
mem["backend"] = "qmd"
qmd = mem.setdefault("qmd", {})
limits = qmd.setdefault("limits", {})
limits["timeoutMs"] = int("${QMD_TIMEOUT_MS}")
cfg_path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

openclaw gateway restart >/tmp/yoyoo_qmd_gateway_restart.log 2>&1 || true
sleep 2
openclaw gateway status || true
qmd --version >/tmp/yoyoo_qmd_version.log 2>&1 || true

echo "QMD enable script finished"
