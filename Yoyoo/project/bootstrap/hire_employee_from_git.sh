#!/usr/bin/env bash
set -euo pipefail

# Pull Yoyoo repo and activate one employee profile.

GIT_URL="${GIT_URL:-git@github.com:Qingjingyu/Yoyoo.git}"
GIT_REF="${GIT_REF:-release/yoyoo-1.0-rc1}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/yoyoo-runtime}"
YOYOO_ROLE="${YOYOO_ROLE:-ceo}"

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "MINIMAX_API_KEY is required" >&2
  exit 1
fi

if [[ -d "${RUNTIME_DIR}/.git" ]]; then
  git -C "${RUNTIME_DIR}" fetch --all --tags
  git -C "${RUNTIME_DIR}" checkout "${GIT_REF}"
  git -C "${RUNTIME_DIR}" pull --ff-only origin "${GIT_REF}" || true
else
  rm -rf "${RUNTIME_DIR}"
  git clone "${GIT_URL}" "${RUNTIME_DIR}"
  git -C "${RUNTIME_DIR}" checkout "${GIT_REF}"
fi

export YOYOO_ROLE
bash "${RUNTIME_DIR}/Yoyoo/project/bootstrap/activate_employee.sh"
