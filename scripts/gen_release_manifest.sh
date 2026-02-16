#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

extract_with_default() {
  local value="$1"
  local fallback="$2"
  if [[ -n "${value}" ]]; then
    printf '%s\n' "${value}"
  else
    printf '%s\n' "${fallback}"
  fi
}

badge_version="$(grep -Eo 'badge/version-[0-9]+\.[0-9]+\.[0-9]+' README.md | head -n 1 | sed 's#badge/version-##')"
install_openclaw="$(grep -E 'OPENCLAW_PINNED_VERSION=' install.sh | head -n 1 | sed -E 's/.*:-([^"}]+).*/\1/')"
bootstrap_openclaw="$(grep -E 'YOYOO_OPENCLAW_VERSION=' Yoyoo/project/bootstrap/activate_employee.sh | head -n 1 | sed -E 's/.*:-([^"}]+).*/\1/')"
default_ref="$(grep -E 'GIT_REF=' Yoyoo/project/bootstrap/hire_employee_from_git.sh | head -n 1 | sed -E 's/.*:-([^"}]+).*/\1/')"

badge_version="$(extract_with_default "${badge_version}" "unknown")"
install_openclaw="$(extract_with_default "${install_openclaw}" "unknown")"
bootstrap_openclaw="$(extract_with_default "${bootstrap_openclaw}" "unknown")"
default_ref="$(extract_with_default "${default_ref}" "unknown")"

jq -n \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg commit "$(git rev-parse HEAD)" \
  --arg release_tag "${GITHUB_REF_NAME:-manual}" \
  --arg badge_version "${badge_version}" \
  --arg install_openclaw "${install_openclaw}" \
  --arg bootstrap_openclaw "${bootstrap_openclaw}" \
  --arg default_ref "${default_ref}" \
  '{
    product: "Yoyoo",
    generated_at: $generated_at,
    git: {
      commit: $commit,
      release_tag: $release_tag,
      default_ref: $default_ref
    },
    baseline: {
      yoyoo_version_badge: $badge_version,
      openclaw_pinned_install: $install_openclaw,
      openclaw_pinned_bootstrap: $bootstrap_openclaw
    }
  }'

