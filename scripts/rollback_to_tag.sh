#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  ROLLBACK_CONFIRM=YES bash scripts/rollback_to_tag.sh <tag> [branch]

Example:
  ROLLBACK_CONFIRM=YES bash scripts/rollback_to_tag.sh v1.0.5 master
USAGE
}

TAG="${1:-}"
BRANCH="${2:-master}"

if [[ -z "${TAG}" ]]; then
  usage
  exit 2
fi

if [[ "${ROLLBACK_CONFIRM:-}" != "YES" ]]; then
  echo "Refuse to rollback without ROLLBACK_CONFIRM=YES" >&2
  exit 2
fi

git fetch --all --tags

if ! git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null 2>&1; then
  echo "Tag not found: ${TAG}" >&2
  exit 1
fi

echo "[rollback] branch=${BRANCH} tag=${TAG}"
git checkout "${BRANCH}"
git reset --hard "${TAG}"
git clean -fd

if [[ -x "Yoyoo/project/bootstrap/acceptance_check.sh" ]]; then
  echo "[rollback] running acceptance check..."
  bash Yoyoo/project/bootstrap/acceptance_check.sh
fi

echo "[rollback] completed at $(git rev-parse --short HEAD)"

