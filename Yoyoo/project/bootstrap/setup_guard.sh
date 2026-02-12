#!/usr/bin/env bash
set -euo pipefail

# Install a lightweight guard timer for OpenClaw gateway.

OPENCLAW_PORT="${OPENCLAW_PORT:-18789}"
GUARD_SCRIPT="/usr/local/bin/yoyoo-openclaw-healthcheck.sh"
GUARD_SERVICE="/etc/systemd/system/yoyoo-openclaw-healthcheck.service"
GUARD_TIMER="/etc/systemd/system/yoyoo-openclaw-healthcheck.timer"

cat > "${GUARD_SCRIPT}" <<SH
#!/usr/bin/env bash
set -euo pipefail
if ! openclaw gateway health >/tmp/yoyoo_openclaw_healthcheck.log 2>&1; then
  openclaw gateway restart >/tmp/yoyoo_openclaw_restart.log 2>&1 || true
fi
SH
chmod +x "${GUARD_SCRIPT}"

cat > "${GUARD_SERVICE}" <<UNIT
[Unit]
Description=Yoyoo OpenClaw health check
After=network.target

[Service]
Type=oneshot
ExecStart=${GUARD_SCRIPT}
UNIT

cat > "${GUARD_TIMER}" <<UNIT
[Unit]
Description=Run Yoyoo OpenClaw health check every 2 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
Unit=yoyoo-openclaw-healthcheck.service

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now yoyoo-openclaw-healthcheck.timer >/tmp/yoyoo_guard_enable.log 2>&1
systemctl is-active yoyoo-openclaw-healthcheck.timer

echo "Guard setup complete on port ${OPENCLAW_PORT}"
