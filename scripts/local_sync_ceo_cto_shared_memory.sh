#!/usr/bin/env bash
set -euo pipefail

# Local macOS helper:
# - keep existing CEO memory
# - create/refresh CTO runtime
# - share MEMORY.md + memory/ between CEO and CTO

CEO_HOME="${CEO_HOME:-$HOME/.openclaw}"
CTO_HOME="${CTO_HOME:-$HOME/.openclaw-cto}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/yoyoo_local_backups}"

mkdir -p "${BACKUP_DIR}"
ts="$(date +%Y%m%d_%H%M%S)"

tar -czf "${BACKUP_DIR}/openclaw_backup_${ts}.tar.gz" -C "${HOME}" .openclaw
cp -a "${CEO_HOME}/workspace" "${BACKUP_DIR}/workspace_snapshot_${ts}"

mkdir -p "${CTO_HOME}/workspace"

python3 - <<PY
import json, pathlib, secrets
ceo = pathlib.Path("${CEO_HOME}") / "openclaw.json"
cto = pathlib.Path("${CTO_HOME}") / "openclaw.json"
obj = json.loads(ceo.read_text())
obj.setdefault("gateway", {})["port"] = 18794
obj["gateway"].setdefault("auth", {})["token"] = secrets.token_hex(24)
obj.setdefault("messages", {}).setdefault("queue", {})["mode"] = "steer"
obj.setdefault("session", {})["scope"] = "global"
cto.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\\n")
PY

rm -f "${CTO_HOME}/workspace/MEMORY.md" || true
ln -s "${CEO_HOME}/workspace/MEMORY.md" "${CTO_HOME}/workspace/MEMORY.md"

rm -rf "${CTO_HOME}/workspace/memory" || true
ln -s "${CEO_HOME}/workspace/memory" "${CTO_HOME}/workspace/memory"

rm -f "${CTO_HOME}/workspace/USER.md" || true
ln -s "${CEO_HOME}/workspace/USER.md" "${CTO_HOME}/workspace/USER.md"

cat > "${CTO_HOME}/workspace/IDENTITY.md" <<'EOF'
# IDENTITY.md - Yoyoo CTO
- Name: 子夜-CTO
- Role: 执行总监（CTO）
EOF

echo "[ok] CEO/CTO shared-memory wiring completed."
echo "[backup] ${BACKUP_DIR}/openclaw_backup_${ts}.tar.gz"
