#!/usr/bin/env bash
set -euo pipefail

# Install Yoyoo 1.0 base skills (no extra paid keys required).

if ! command -v npx >/dev/null 2>&1; then
  echo "npx is required" >&2
  exit 1
fi

SKILLS=(
  clawhub
  coding-agent
  healthcheck
  session-logs
  skill-creator
  tmux
  weather
)

for skill in "${SKILLS[@]}"; do
  echo "Installing skill: ${skill}"
  npx clawhub@latest install "${skill}" >/tmp/yoyoo_skill_${skill}.log 2>&1 || true
done

openclaw skills check || true

echo "Base skills install script finished"
