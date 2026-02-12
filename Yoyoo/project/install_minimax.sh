#!/usr/bin/env bash
set -e
# OpenClaw + MiniMax M2.1 一键安装配置

: "${MINIMAX_API_KEY:?Please export MINIMAX_API_KEY first}"
: "${OPENCLAW_GATEWAY_TOKEN:?Please export OPENCLAW_GATEWAY_TOKEN first}"

# 1) 安装 OpenClaw（若已安装可跳过）
if ! command -v openclaw >/dev/null 2>&1; then
  curl -fsSL https://molt.bot/install.sh | bash
fi

# 2) 写配置
cat > /root/.openclaw/openclaw.json <<'EOF'
{ "gateway": { "mode": "local", "port": 18789, "auth": { "token": "${OPENCLAW_GATEWAY_TOKEN}" } } }
EOF

cat > /root/.openclaw/agents/main/agent/models.json <<'EOF'
{
  "providers": {
    "minimax": {
      "baseUrl": "https://api.minimaxi.com/anthropic",
      "apiKey": "${MINIMAX_API_KEY}",
      "api": "anthropic-messages",
      "authHeader": true,
      "models": [
        { "id": "MiniMax-M2.1", "name": "MiniMax M2.1", "reasoning": false, "input": ["text"], "cost": { "input": 15, "output": 60, "cacheRead": 2, "cacheWrite": 10 }, "contextWindow": 200000, "maxTokens": 8192 }
      ]
    }
  }
}
EOF

cat > /root/.openclaw/agents/main/auth-profiles.json <<'EOF'
{ "minimax": { "apiKey": "${MINIMAX_API_KEY}" } }
EOF

# 3) 修复配置
openclaw doctor --fix || true

# 4) 启动网关
OPENCLAW_AGENT_MODEL_PROVIDER=minimax \
OPENCLAW_AGENT_MODEL=minimax/MiniMax-M2.1 \
nohup openclaw gateway --verbose --token "${OPENCLAW_GATEWAY_TOKEN}" > /tmp/gateway.log 2>&1 &
sleep 5

echo "--- gateway tail ---"
grep -E 'agent model|listening on' /tmp/gateway.log || tail -20 /tmp/gateway.log
