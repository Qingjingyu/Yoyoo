#!/usr/bin/env bash
set -euo pipefail

CONFIG_FILE="${OPENCLAW_CONFIG:-$HOME/.openclaw/openclaw.json}"
MAIN_WORKSPACE="${MAIN_WORKSPACE:-$HOME/.openclaw/workspace}"
WORKSPACES_ROOT="${WORKSPACES_ROOT:-$HOME/.openclaw/workspaces}"
SHARED_ROOT="${SHARED_ROOT:-$MAIN_WORKSPACE/shared-memory}"
MODEL_ID="${YOYOO_TEAM_MODEL:-minimax/MiniMax-M2.5}"
TS="$(date +%Y%m%d_%H%M%S)"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "[error] openclaw not found"
  exit 1
fi

if [[ ! -f "$CONFIG_FILE" ]]; then
  echo "[error] openclaw config not found: $CONFIG_FILE"
  exit 1
fi

mkdir -p "$WORKSPACES_ROOT"
mkdir -p "$SHARED_ROOT/archive"

ensure_file() {
  local path="$1"
  local content="$2"
  if [[ ! -f "$path" ]]; then
    printf "%s\n" "$content" > "$path"
  fi
}

ensure_file "$SHARED_ROOT/.abstract" "# Shared Memory L0 Index
- user-profile.md: stable user preferences and identity (P0)
- active-tasks.md: current active tasks and milestones (P1)
- cross-agent-log.md: cross-agent key conclusions (P0/P1/P2)"

ensure_file "$SHARED_ROOT/user-profile.md" "# User Profile (P0)
- name:
- style:
- constraints:"

ensure_file "$SHARED_ROOT/active-tasks.md" "# Active Tasks (P1)
- [ ]"

ensure_file "$SHARED_ROOT/cross-agent-log.md" "# Cross Agent Log"

create_role_workspace() {
  local role_id="$1"
  local role_name="$2"
  local role_emoji="$3"
  local role_desc="$4"
  local role_focus="$5"
  local ws="$WORKSPACES_ROOT/$role_id"

  mkdir -p "$ws/memory" "$ws/shared-memory"

  cat > "$ws/IDENTITY.md" <<EOF
# IDENTITY.md - ${role_name}

- **Name:** ${role_name}
- **Role:** Yoyoo ${role_name}
- **Vibe:** focused, concise, execution-first
- **Emoji:** ${role_emoji}

## Mission
- ${role_desc}
- 先给结论，再给证据，不说空话。
EOF

  cat > "$ws/AGENTS.md" <<EOF
# AGENTS.md - ${role_name} 工作手册

## 你是谁
你是 ${role_name}，职责是：${role_desc}

## 你的边界
- 只做和「${role_focus}」有关的任务。
- 超出边界时，先说明风险，再请求 main 分派到对应角色。

## 协作规则（必须执行）
- 完成任务后，把关键结论追加到：\`${SHARED_ROOT}/cross-agent-log.md\`
- 记录格式：\`- [YYYY-MM-DD] [${role_id}] [P0|P1|P2] 结论（不超过两行）\`
- 只记结论，不记冗长过程。
EOF

  ensure_file "$ws/MEMORY.md" "# MEMORY.md - ${role_name}

- 这里记录本角色私有记忆，不和其他角色混写。
"

  cat > "$ws/shared-memory/README.md" <<EOF
# Shared Memory Pointer

统一共享记忆目录：
\`${SHARED_ROOT}\`
EOF
}

create_role_workspace "coder" "工程师" "🛠️" "负责代码实现、调试、测试和质量修复。" "代码实现与工程交付"
create_role_workspace "writer" "内容官" "✍️" "负责文案、文档、对外表达和说明整理。" "内容写作与表达"
create_role_workspace "growth" "增长官" "📈" "负责拉新、转化、增长策略和复盘。" "增长策略与转化"
create_role_workspace "legal" "法务官" "⚖️" "负责合规、风险条款、对外法务提醒。" "合规和法务风险"
create_role_workspace "finance" "财务官" "💰" "负责成本、预算、收益模型和账目建议。" "预算和财务核算"
create_role_workspace "teacher" "培训官" "🎓" "负责培训、SOP、上手指南和团队赋能。" "培训和知识沉淀"

mkdir -p "$HOME/.openclaw/agents"
for role in coder writer growth legal finance teacher; do
  role_agent_dir="$HOME/.openclaw/agents/$role/agent"
  mkdir -p "$role_agent_dir"
  if [[ -f "$HOME/.openclaw/agents/main/agent/auth-profiles.json" ]] && [[ ! -f "$role_agent_dir/auth-profiles.json" ]]; then
    cp "$HOME/.openclaw/agents/main/agent/auth-profiles.json" "$role_agent_dir/auth-profiles.json"
  fi
done

cp "$CONFIG_FILE" "$CONFIG_FILE.bak.$TS"

python3 - "$CONFIG_FILE" "$WORKSPACES_ROOT" "$MODEL_ID" <<'PY'
import json
import sys
from pathlib import Path

config_path = Path(sys.argv[1])
root = Path(sys.argv[2])
model_id = sys.argv[3]

roles = [
    ("coder", "工程师", "🛠️"),
    ("writer", "内容官", "✍️"),
    ("growth", "增长官", "📈"),
    ("legal", "法务官", "⚖️"),
    ("finance", "财务官", "💰"),
    ("teacher", "培训官", "🎓"),
]

data = json.loads(config_path.read_text(encoding="utf-8"))

# Force agent-isolated session routing for multi-team mode.
session_cfg = data.setdefault("session", {})
session_cfg["scope"] = "per-sender"
session_cfg.setdefault("mainKey", "main")

agents = data.setdefault("agents", {})
alist = agents.setdefault("list", [])

by_id = {}
for item in alist:
    if isinstance(item, dict) and item.get("id"):
        by_id[item["id"]] = item

if "main" not in by_id:
    by_id["main"] = {"id": "main"}

for role_id, role_name, role_emoji in roles:
    by_id[role_id] = {
        "id": role_id,
        "name": role_id,
        "workspace": str(root / role_id),
        "agentDir": str(Path.home() / ".openclaw" / "agents" / role_id / "agent"),
        "model": model_id,
        "identity": {
            "name": role_name,
            "emoji": role_emoji,
        },
    }

final_ids = ["main"] + [r[0] for r in roles]
for item in alist:
    if isinstance(item, dict):
        aid = item.get("id")
        if aid and aid not in final_ids:
            final_ids.append(aid)

agents["list"] = [by_id[x] for x in final_ids if x in by_id]
config_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

echo "[done] V2 isolated workspaces applied"
echo "config backup: $CONFIG_FILE.bak.$TS"
echo "shared memory: $SHARED_ROOT"
echo "workspaces root: $WORKSPACES_ROOT"
echo
echo "verify:"
echo "1) openclaw agents list --json"
echo "2) openclaw agent --agent coder --message \"请只回复：coder-v2-ready\" --json --timeout 120"
echo "3) openclaw agent --agent writer --message \"请只回复：writer-v2-ready\" --json --timeout 120"
