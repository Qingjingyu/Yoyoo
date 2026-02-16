#!/usr/bin/env bash
set -euo pipefail

# Install role-isolated guard + asset protection timers for one Yoyoo employee:
# - doctor timer (health and auto-heal)
# - asset backup timer (tar snapshots)
# - asset git snapshot timer (fine-grained rollback history)
# - rollback helper script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YOYOO_ROLE="${YOYOO_ROLE:-ceo}"
YOYOO_EMPLOYEE_KEY="${YOYOO_EMPLOYEE_KEY:-${YOYOO_ROLE}}"
YOYOO_HOME="${YOYOO_HOME:-/root/.openclaw}"
YOYOO_WORKSPACE="${YOYOO_WORKSPACE:-${YOYOO_HOME}/workspace}"
YOYOO_RUNTIME_HOME="${YOYOO_RUNTIME_HOME:-$(dirname "${YOYOO_HOME}")}"
OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
YOYOO_PROFILE="${YOYOO_PROFILE:-yoyoo-${YOYOO_EMPLOYEE_KEY}}"
OPENCLAW_SYSTEMD_UNIT="${OPENCLAW_SYSTEMD_UNIT:-}"
YOYOO_BACKEND_SERVICE_NAME="${YOYOO_BACKEND_SERVICE_NAME:-}"
YOYOO_EXPECT_FEISHU="${YOYOO_EXPECT_FEISHU:-0}"
YOYOO_EXPECT_FEISHU_GROUP_POLICY="${YOYOO_EXPECT_FEISHU_GROUP_POLICY:-}"
YOYOO_EXPECT_FEISHU_REQUIRE_MENTION="${YOYOO_EXPECT_FEISHU_REQUIRE_MENTION:-}"
YOYOO_EXPECT_FEISHU_UNIFIED_SESSION="${YOYOO_EXPECT_FEISHU_UNIFIED_SESSION:-0}"
YOYOO_AUTO_HEAL="${YOYOO_AUTO_HEAL:-1}"
YOYOO_DOCTOR_SCRIPT="${YOYOO_DOCTOR_SCRIPT:-${SCRIPT_DIR}/yoyoo_doctor.sh}"
YOYOO_LINUX_USER="${YOYOO_LINUX_USER:-root}"
YOYOO_LINUX_GROUP="${YOYOO_LINUX_GROUP:-${YOYOO_LINUX_USER}}"
YOYOO_BACKUP_DIR="${YOYOO_BACKUP_DIR:-${YOYOO_RUNTIME_HOME}/backups}"
YOYOO_BACKUP_INTERVAL_MIN="${YOYOO_BACKUP_INTERVAL_MIN:-10}"
YOYOO_BACKUP_KEEP="${YOYOO_BACKUP_KEEP:-432}"
YOYOO_GIT_SNAPSHOT_INTERVAL_MIN="${YOYOO_GIT_SNAPSHOT_INTERVAL_MIN:-5}"
YOYOO_SNAPSHOT_REPO_DIR="${YOYOO_SNAPSHOT_REPO_DIR:-${YOYOO_RUNTIME_HOME}/asset-history.git}"
YOYOO_SNAPSHOT_BRANCH="${YOYOO_SNAPSHOT_BRANCH:-main}"

sanitize_key() {
  local raw="$1"
  local cleaned
  cleaned="$(printf '%s' "${raw}" | tr '[:upper:]' '[:lower:]' | tr -c 'a-z0-9.-' '-' | sed -E 's/-+/-/g; s/^-+//; s/-+$//')"
  printf '%s\n' "${cleaned}"
}

YOYOO_EMPLOYEE_KEY="$(sanitize_key "${YOYOO_EMPLOYEE_KEY}")"
if [[ -z "${YOYOO_EMPLOYEE_KEY}" ]]; then
  echo "YOYOO_EMPLOYEE_KEY is invalid" >&2
  exit 1
fi

if [[ -z "${OPENCLAW_SYSTEMD_UNIT}" ]]; then
  if [[ "${YOYOO_ROLE}" == "ceo" && "${YOYOO_EMPLOYEE_KEY}" == "ceo" ]]; then
    OPENCLAW_SYSTEMD_UNIT="openclaw-gateway.service"
  else
    OPENCLAW_SYSTEMD_UNIT="openclaw-gateway-${YOYOO_EMPLOYEE_KEY}.service"
  fi
fi

if [[ -z "${YOYOO_BACKEND_SERVICE_NAME}" ]]; then
  if [[ "${YOYOO_EMPLOYEE_KEY}" == "${YOYOO_ROLE}" ]]; then
    case "${YOYOO_ROLE}" in
      ceo) YOYOO_BACKEND_SERVICE_NAME="yoyoo-backend-ceo.service" ;;
      ops) YOYOO_BACKEND_SERVICE_NAME="yoyoo-backend-ops.service" ;;
      rd-director) YOYOO_BACKEND_SERVICE_NAME="yoyoo-backend-rd-director.service" ;;
      rd-engineer) YOYOO_BACKEND_SERVICE_NAME="yoyoo-backend-rd-engineer.service" ;;
      *) YOYOO_BACKEND_SERVICE_NAME="yoyoo-backend-${YOYOO_EMPLOYEE_KEY}.service" ;;
    esac
  else
    YOYOO_BACKEND_SERVICE_NAME="yoyoo-backend-${YOYOO_EMPLOYEE_KEY}.service"
  fi
fi

mkdir -p "${YOYOO_BACKUP_DIR}" "${YOYOO_RUNTIME_HOME}"
chown -R "${YOYOO_LINUX_USER}:${YOYOO_LINUX_GROUP}" "${YOYOO_RUNTIME_HOME}" >/tmp/yoyoo_guard_chown.log 2>&1 || true
chmod 700 "${YOYOO_RUNTIME_HOME}" "${YOYOO_BACKUP_DIR}" >/tmp/yoyoo_guard_chmod.log 2>&1 || true

DOCTOR_SCRIPT_RUNTIME="/usr/local/bin/yoyoo-openclaw-doctor-${YOYOO_EMPLOYEE_KEY}.sh"
BACKUP_SCRIPT_RUNTIME="/usr/local/bin/yoyoo-asset-backup-${YOYOO_EMPLOYEE_KEY}.sh"
SNAPSHOT_SCRIPT_RUNTIME="/usr/local/bin/yoyoo-asset-snapshot-${YOYOO_EMPLOYEE_KEY}.sh"
ROLLBACK_SCRIPT_RUNTIME="/usr/local/bin/yoyoo-asset-rollback-${YOYOO_EMPLOYEE_KEY}.sh"

DOCTOR_SERVICE="/etc/systemd/system/yoyoo-openclaw-doctor-${YOYOO_EMPLOYEE_KEY}.service"
DOCTOR_TIMER="/etc/systemd/system/yoyoo-openclaw-doctor-${YOYOO_EMPLOYEE_KEY}.timer"
BACKUP_SERVICE="/etc/systemd/system/yoyoo-asset-backup-${YOYOO_EMPLOYEE_KEY}.service"
BACKUP_TIMER="/etc/systemd/system/yoyoo-asset-backup-${YOYOO_EMPLOYEE_KEY}.timer"
SNAPSHOT_SERVICE="/etc/systemd/system/yoyoo-asset-snapshot-${YOYOO_EMPLOYEE_KEY}.service"
SNAPSHOT_TIMER="/etc/systemd/system/yoyoo-asset-snapshot-${YOYOO_EMPLOYEE_KEY}.timer"

cat > "${DOCTOR_SCRIPT_RUNTIME}" <<SH
#!/usr/bin/env bash
set -euo pipefail
export YOYOO_ROLE='${YOYOO_ROLE}'
export YOYOO_EMPLOYEE_KEY='${YOYOO_EMPLOYEE_KEY}'
export YOYOO_HOME='${YOYOO_HOME}'
export YOYOO_WORKSPACE='${YOYOO_WORKSPACE}'
export OPENCLAW_PORT='${OPENCLAW_PORT}'
export YOYOO_PROFILE='${YOYOO_PROFILE}'
export OPENCLAW_SYSTEMD_UNIT='${OPENCLAW_SYSTEMD_UNIT}'
export YOYOO_EXPECT_FEISHU='${YOYOO_EXPECT_FEISHU}'
export YOYOO_EXPECT_FEISHU_GROUP_POLICY='${YOYOO_EXPECT_FEISHU_GROUP_POLICY}'
export YOYOO_EXPECT_FEISHU_REQUIRE_MENTION='${YOYOO_EXPECT_FEISHU_REQUIRE_MENTION}'
export YOYOO_EXPECT_FEISHU_UNIFIED_SESSION='${YOYOO_EXPECT_FEISHU_UNIFIED_SESSION}'
export YOYOO_AUTO_HEAL='${YOYOO_AUTO_HEAL}'
bash '${YOYOO_DOCTOR_SCRIPT}' check >>'/tmp/yoyoo_openclaw_doctor_${YOYOO_EMPLOYEE_KEY}.log' 2>&1
SH
chmod +x "${DOCTOR_SCRIPT_RUNTIME}"

cat > "${BACKUP_SCRIPT_RUNTIME}" <<SH
#!/usr/bin/env bash
set -euo pipefail
mkdir -p '${YOYOO_RUNTIME_HOME}/locks'
LOCK='${YOYOO_RUNTIME_HOME}/locks/yoyoo_asset_backup_${YOYOO_EMPLOYEE_KEY}.lock'
exec 9>"\${LOCK}"
if ! flock -n 9; then
  exit 0
fi
mkdir -p '${YOYOO_BACKUP_DIR}'
ts="\$(date +%Y%m%d_%H%M%S)"
out="${YOYOO_BACKUP_DIR}/asset_\${ts}.tar.gz"

targets=()
for p in \
  '${YOYOO_HOME}' \
  '${YOYOO_WORKSPACE}' \
  '${YOYOO_SNAPSHOT_REPO_DIR}'
do
  if [[ -e "\${p}" ]]; then
    targets+=("\${p}")
  fi
done
if [[ "\${#targets[@]}" -eq 0 ]]; then
  exit 0
fi

tar -czf "\${out}" "\${targets[@]}" >/tmp/yoyoo_asset_backup_${YOYOO_EMPLOYEE_KEY}.log 2>&1 || {
  rm -f "\${out}" || true
  exit 1
}

if ! tar -tzf "\${out}" >/dev/null 2>&1; then
  rm -f "\${out}" || true
  exit 1
fi

ln -sfn "\$(basename "\${out}")" '${YOYOO_BACKUP_DIR}/latest.tar.gz'
ls -1t '${YOYOO_BACKUP_DIR}'/asset_*.tar.gz 2>/dev/null | tail -n +$((YOYOO_BACKUP_KEEP + 1)) | xargs -r rm -f
SH
chmod +x "${BACKUP_SCRIPT_RUNTIME}"

cat > "${SNAPSHOT_SCRIPT_RUNTIME}" <<SH
#!/usr/bin/env bash
set -euo pipefail
mkdir -p '${YOYOO_RUNTIME_HOME}/locks'
LOCK='${YOYOO_RUNTIME_HOME}/locks/yoyoo_asset_snapshot_${YOYOO_EMPLOYEE_KEY}.lock'
exec 9>"\${LOCK}"
if ! flock -n 9; then
  exit 0
fi

WORKSPACE='${YOYOO_WORKSPACE}'
REPO='${YOYOO_SNAPSHOT_REPO_DIR}'
BRANCH='${YOYOO_SNAPSHOT_BRANCH}'
mkdir -p "\${WORKSPACE}" "\${REPO}"

git_cmd() {
  git --git-dir="\${REPO}" --work-tree="\${WORKSPACE}" "\$@"
}

if [[ ! -f "\${REPO}/HEAD" ]]; then
  git init --bare "\${REPO}" >/tmp/yoyoo_asset_snapshot_${YOYOO_EMPLOYEE_KEY}.log 2>&1
fi

git_cmd config user.name "Yoyoo Snapshot Bot (${YOYOO_EMPLOYEE_KEY})" >/dev/null 2>&1 || true
git_cmd config user.email "yoyoo-${YOYOO_EMPLOYEE_KEY}@local" >/dev/null 2>&1 || true
git_cmd symbolic-ref HEAD "refs/heads/\${BRANCH}" >/dev/null 2>&1 || true

targets=(
  "AGENTS.md"
  "SOUL.md"
  "USER.md"
  "IDENTITY.md"
  "MEMORY.md"
  "TOOLS.md"
  "HEARTBEAT.md"
  "memory"
)

for t in "\${targets[@]}"; do
  if [[ -e "\${WORKSPACE}/\${t}" ]]; then
    git_cmd add -A -- "\${t}"
  fi
done

if git_cmd diff --cached --quiet; then
  exit 0
fi

msg="snapshot(${YOYOO_EMPLOYEE_KEY}): \$(date -Iseconds)"
git_cmd commit -m "\${msg}" >/tmp/yoyoo_asset_snapshot_${YOYOO_EMPLOYEE_KEY}.log 2>&1
git_cmd update-ref "refs/heads/\${BRANCH}" HEAD >/dev/null 2>&1 || true
SH
chmod +x "${SNAPSHOT_SCRIPT_RUNTIME}"

cat > "${ROLLBACK_SCRIPT_RUNTIME}" <<SH
#!/usr/bin/env bash
set -euo pipefail

WORKSPACE='${YOYOO_WORKSPACE}'
REPO='${YOYOO_SNAPSHOT_REPO_DIR}'
BRANCH='${YOYOO_SNAPSHOT_BRANCH}'
OPENCLAW_UNIT='${OPENCLAW_SYSTEMD_UNIT}'
BACKEND_UNIT='${YOYOO_BACKEND_SERVICE_NAME}'
RUN_AS='${YOYOO_LINUX_USER}'

as_user() {
  if [[ "\${RUN_AS}" == "root" ]]; then
    "\$@"
  else
    runuser -u "\${RUN_AS}" -- "\$@"
  fi
}

git_cmd() {
  as_user git --git-dir="\${REPO}" --work-tree="\${WORKSPACE}" "\$@"
}

usage() {
  cat <<USAGE
Usage:
  \$(basename "\$0") --list
  \$(basename "\$0") --to <commit_or_ref>
USAGE
}

if [[ ! -f "\${REPO}/HEAD" ]]; then
  echo "No snapshot repository found: \${REPO}" >&2
  exit 1
fi

case "\${1:-}" in
  --list)
    git_cmd log --oneline --decorate -n 30 "\${BRANCH}"
    ;;
  --to)
    rev="\${2:-}"
    if [[ -z "\${rev}" ]]; then
      usage
      exit 2
    fi
    systemctl stop "\${OPENCLAW_UNIT}" >/tmp/yoyoo_asset_rollback_${YOYOO_EMPLOYEE_KEY}.log 2>&1 || true
    systemctl stop "\${BACKEND_UNIT}" >/tmp/yoyoo_asset_rollback_${YOYOO_EMPLOYEE_KEY}.log 2>&1 || true
    targets=(AGENTS.md SOUL.md USER.md IDENTITY.md MEMORY.md TOOLS.md HEARTBEAT.md memory)
    existing=()
    while IFS= read -r path; do
      [[ -n "\${path}" ]] && existing+=("\${path}")
    done < <(git_cmd ls-tree -r --name-only "\${rev}" -- "\${targets[@]}" 2>/dev/null || true)
    if [[ "\${#existing[@]}" -eq 0 ]]; then
      echo "No matching files found in revision: \${rev}" >&2
      exit 1
    fi
    git_cmd checkout "\${rev}" -- "\${existing[@]}"
    chown -R '${YOYOO_LINUX_USER}:${YOYOO_LINUX_GROUP}' "\${WORKSPACE}" >/tmp/yoyoo_asset_rollback_${YOYOO_EMPLOYEE_KEY}.log 2>&1 || true
    systemctl start "\${OPENCLAW_UNIT}" >/tmp/yoyoo_asset_rollback_${YOYOO_EMPLOYEE_KEY}.log 2>&1 || true
    systemctl start "\${BACKEND_UNIT}" >/tmp/yoyoo_asset_rollback_${YOYOO_EMPLOYEE_KEY}.log 2>&1 || true
    echo "Rollback finished: \${rev}"
    ;;
  *)
    usage
    exit 2
    ;;
esac
SH
chmod +x "${ROLLBACK_SCRIPT_RUNTIME}"

cat > "${DOCTOR_SERVICE}" <<UNIT
[Unit]
Description=Yoyoo OpenClaw doctor (${YOYOO_EMPLOYEE_KEY})
After=network.target

[Service]
Type=oneshot
ExecStart=${DOCTOR_SCRIPT_RUNTIME}
UNIT

cat > "${DOCTOR_TIMER}" <<UNIT
[Unit]
Description=Run Yoyoo OpenClaw doctor every 2 minutes (${YOYOO_EMPLOYEE_KEY})

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
Unit=$(basename "${DOCTOR_SERVICE}")

[Install]
WantedBy=timers.target
UNIT

cat > "${BACKUP_SERVICE}" <<UNIT
[Unit]
Description=Yoyoo asset backup (${YOYOO_EMPLOYEE_KEY})
After=network.target

[Service]
Type=oneshot
ExecStart=${BACKUP_SCRIPT_RUNTIME}
UNIT

cat > "${BACKUP_TIMER}" <<UNIT
[Unit]
Description=Run Yoyoo asset backup every ${YOYOO_BACKUP_INTERVAL_MIN} minutes (${YOYOO_EMPLOYEE_KEY})

[Timer]
OnBootSec=2min
OnUnitActiveSec=${YOYOO_BACKUP_INTERVAL_MIN}min
Unit=$(basename "${BACKUP_SERVICE}")

[Install]
WantedBy=timers.target
UNIT

cat > "${SNAPSHOT_SERVICE}" <<UNIT
[Unit]
Description=Yoyoo asset git snapshot (${YOYOO_EMPLOYEE_KEY})
After=network.target

[Service]
Type=oneshot
User=${YOYOO_LINUX_USER}
Group=${YOYOO_LINUX_GROUP}
Environment=HOME=${YOYOO_RUNTIME_HOME}
ExecStart=${SNAPSHOT_SCRIPT_RUNTIME}
UNIT

cat > "${SNAPSHOT_TIMER}" <<UNIT
[Unit]
Description=Run Yoyoo asset git snapshot every ${YOYOO_GIT_SNAPSHOT_INTERVAL_MIN} minutes (${YOYOO_EMPLOYEE_KEY})

[Timer]
OnBootSec=3min
OnUnitActiveSec=${YOYOO_GIT_SNAPSHOT_INTERVAL_MIN}min
Unit=$(basename "${SNAPSHOT_SERVICE}")

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now "$(basename "${DOCTOR_TIMER}")" >/tmp/yoyoo_guard_enable_"${YOYOO_EMPLOYEE_KEY}".log 2>&1
systemctl enable --now "$(basename "${BACKUP_TIMER}")" >/tmp/yoyoo_asset_backup_enable_"${YOYOO_EMPLOYEE_KEY}".log 2>&1
systemctl enable --now "$(basename "${SNAPSHOT_TIMER}")" >/tmp/yoyoo_asset_snapshot_enable_"${YOYOO_EMPLOYEE_KEY}".log 2>&1

echo "Guard setup complete:"
echo "  employee=${YOYOO_EMPLOYEE_KEY}"
echo "  role=${YOYOO_ROLE}"
echo "  gateway_port=${OPENCLAW_PORT}"
echo "  doctor_timer=$(basename "${DOCTOR_TIMER}")"
echo "  backup_timer=$(basename "${BACKUP_TIMER}")"
echo "  snapshot_timer=$(basename "${SNAPSHOT_TIMER}")"
echo "  rollback_helper=${ROLLBACK_SCRIPT_RUNTIME}"
