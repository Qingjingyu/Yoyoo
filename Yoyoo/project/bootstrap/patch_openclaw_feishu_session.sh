#!/usr/bin/env bash
set -euo pipefail

# Unify Feishu DM/group into one session key for one employee instance.
# This makes "same employee, group+DM shared memory" deterministic.

OPENCLAW_DIST_DIR="${OPENCLAW_DIST_DIR:-/usr/lib/node_modules/openclaw/dist}"
SESSION_KEY_JS="${SESSION_KEY_JS:-${OPENCLAW_DIST_DIR}/session-key-BRdRr5Ah.js}"

verify_patch() {
  node --input-type=module - "${SESSION_KEY_JS}" <<'JS'
const sk = await import(`file://${process.argv[2]}`);
const buildPeer = sk.a; // buildAgentPeerSessionKey
const main = "agent:main:main";
const dm = buildPeer({
  agentId: "main",
  mainKey: "main",
  channel: "feishu",
  peerKind: "direct",
  peerId: "ou_demo",
  dmScope: "main",
});
const group = buildPeer({
  agentId: "main",
  mainKey: "main",
  channel: "feishu",
  peerKind: "group",
  peerId: "oc_demo",
});
if (dm === main && group === main) {
  process.stdout.write("OK");
  process.exit(0);
}
process.stderr.write(`dm=${dm} group=${group}`);
process.exit(1);
JS
}

if [[ ! -f "${SESSION_KEY_JS}" ]]; then
  echo "session-key file not found: ${SESSION_KEY_JS}" >&2
  exit 1
fi

if verify_patch >/tmp/yoyoo_feishu_session_verify.log 2>&1; then
  echo "Feishu unified session patch already active."
  exit 0
fi

if ! grep -q 'channel === "feishu" && peerKind === "group"' "${SESSION_KEY_JS}"; then
  cp -a "${SESSION_KEY_JS}" "${SESSION_KEY_JS}.bak.$(date +%s)"
  tmp="$(mktemp)"
  awk '
  {
    print $0
    if ($0 ~ /const channel = \(params\.channel \?\? ""\)\.trim\(\)\.toLowerCase\(\) \|\| "unknown";/) {
      print "\tif (channel === \"feishu\" && peerKind === \"group\") return buildAgentMainSessionKey({"
      print "\t\tagentId: params.agentId,"
      print "\t\tmainKey: params.mainKey"
      print "\t});"
    }
  }
  ' "${SESSION_KEY_JS}" > "${tmp}"
  install -m 644 "${tmp}" "${SESSION_KEY_JS}"
  rm -f "${tmp}"
fi

if verify_patch >/tmp/yoyoo_feishu_session_verify.log 2>&1; then
  echo "Feishu unified session patch applied."
  exit 0
fi

echo "Feishu unified session patch failed verification." >&2
cat /tmp/yoyoo_feishu_session_verify.log >&2 || true
exit 1
