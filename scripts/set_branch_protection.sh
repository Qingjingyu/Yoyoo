#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-master}"

if ! command -v gh >/dev/null 2>&1; then
  echo "gh CLI is required." >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

origin_url="$(git remote get-url origin)"
repo="$(printf '%s' "${origin_url}" | sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##')"
if [[ -z "${repo}" ]]; then
  echo "Failed to parse repo from origin: ${origin_url}" >&2
  exit 1
fi

echo "[branch-protection] repo=${repo} branch=${BRANCH}"
gh api -X PUT "repos/${repo}/branches/${BRANCH}/protection" \
  -H "Accept: application/vnd.github+json" \
  --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "quality-gate / shell-and-policy"},
      {"context": "quality-gate / backend-tests"},
      {"context": "security-gitleaks / gitleaks"}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
EOF

echo "[branch-protection] applied."
