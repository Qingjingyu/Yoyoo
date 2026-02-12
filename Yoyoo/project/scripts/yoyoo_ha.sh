#!/usr/bin/env bash
set -euo pipefail

HOST="${YOYOO_HOST:-root@115.191.36.128}"
KEY="${YOYOO_KEY:-/Users/subai/A/A_subai/AIcode/Test/Yoyoo AI/Test0.10codex/中转/miyaodui.pem}"
SSH_OPTS=(-i "$KEY" -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no -o IdentitiesOnly=yes)
MODE="${1:-status}"

run_remote() {
  ssh "${SSH_OPTS[@]}" "$HOST" "$1"
}

case "$MODE" in
  status)
    run_remote 'yoyoo-bot-switch status'
    ;;
  main|openclaw)
    run_remote 'yoyoo-bot-switch openclaw'
    ;;
  backup|nanobot)
    run_remote 'yoyoo-bot-switch nanobot'
    ;;
  drill)
    echo "[1/4] 当前状态"
    run_remote 'yoyoo-bot-switch status >/tmp/yoyoo_ha_status_before.txt && cat /tmp/yoyoo_ha_status_before.txt | sed -n "1,20p"'
    echo "[2/4] 切到备机 nanobot"
    run_remote 'yoyoo-bot-switch nanobot >/tmp/yoyoo_ha_status_backup.txt && cat /tmp/yoyoo_ha_status_backup.txt | sed -n "1,20p"'
    echo "[3/4] 切回主机 openclaw"
    run_remote 'yoyoo-bot-switch openclaw >/tmp/yoyoo_ha_status_main.txt && cat /tmp/yoyoo_ha_status_main.txt | sed -n "1,20p"'
    echo "[4/4] 演练完成"
    ;;
  *)
    cat <<USAGE
Usage: $(basename "$0") {status|main|backup|drill}

Env:
  YOYOO_HOST  默认: root@115.191.36.128
  YOYOO_KEY   默认: /Users/subai/.../中转/miyaodui.pem
USAGE
    exit 1
    ;;
esac
