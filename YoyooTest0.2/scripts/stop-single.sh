#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="$(cd "$PROJECT_DIR/.." && pwd)"

log() {
    echo "[stop-single] $*"
}

pid_cwd() {
    local pid="$1"
    lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n1
}

collect_workspace_next_pids() {
    while IFS= read -r pid; do
        [[ -z "$pid" ]] && continue
        local cwd
        cwd="$(pid_cwd "$pid" || true)"
        if [[ -n "$cwd" && "$cwd" == "$WORKSPACE_DIR"* ]]; then
            echo "$pid"
        fi
    done < <(pgrep -f "next-server|next dev|next/dist/bin/next" || true)
}

stop_pid() {
    local pid="$1"
    if ! kill -0 "$pid" 2>/dev/null; then
        return 0
    fi
    kill "$pid" 2>/dev/null || true
    for _ in {1..20}; do
        if ! kill -0 "$pid" 2>/dev/null; then
            return 0
        fi
        sleep 0.1
    done
    kill -9 "$pid" 2>/dev/null || true
}

log "Stopping workspace Next.js instances..."
pids="$(collect_workspace_next_pids | awk 'NF' | sort -u || true)"
if [[ -z "$pids" ]]; then
    log "No workspace frontend process found."
    exit 0
fi

while IFS= read -r pid; do
    [[ -n "$pid" ]] || continue
    log "Stopping PID $pid (cwd: $(pid_cwd "$pid"))"
    stop_pid "$pid"
done <<< "$pids"

log "Done."
