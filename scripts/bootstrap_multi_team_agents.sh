#!/usr/bin/env bash
set -euo pipefail

WORKSPACE_DIR="${1:-$HOME/.openclaw/workspace}"
MODEL_ID="${YOYOO_TEAM_MODEL:-minimax/MiniMax-M2.5}"
AGENTS_MD="$WORKSPACE_DIR/AGENTS.md"
SHARED_DIR="$WORKSPACE_DIR/shared-memory"

if ! command -v openclaw >/dev/null 2>&1; then
  echo "[error] openclaw command not found"
  exit 1
fi

mkdir -p "$WORKSPACE_DIR"
mkdir -p "$SHARED_DIR/archive"

ensure_file() {
  local path="$1"
  local content="$2"
  if [[ ! -f "$path" ]]; then
    printf "%s\n" "$content" > "$path"
  fi
}

ensure_file "$SHARED_DIR/.abstract" "# Shared Memory L0 Index
- user-profile.md: stable user preferences and identity (P0)
- active-tasks.md: current active tasks and milestones (P1)
- cross-agent-log.md: cross-agent key conclusions (P0/P1/P2)"

ensure_file "$SHARED_DIR/user-profile.md" "# User Profile (P0)
- name:
- style:
- constraints:"

ensure_file "$SHARED_DIR/active-tasks.md" "# Active Tasks (P1)
- [ ]"

ensure_file "$SHARED_DIR/cross-agent-log.md" "# Cross Agent Log"

if [[ ! -f "$AGENTS_MD" ]]; then
  cat > "$AGENTS_MD" <<'EOF'
# AGENTS.md - Yoyoo 多团队协作规则
EOF
fi

if ! rg -q "YOYOO_MULTI_TEAM_RULES_BEGIN" "$AGENTS_MD"; then
  cat >> "$AGENTS_MD" <<'EOF'

<!-- YOYOO_MULTI_TEAM_RULES_BEGIN -->
## 多团队协作规则（Yoyoo）
- `main` 是总控：负责拆任务、派任务、收结果。
- 每个角色只做自己的事情：工程、内容、增长、法务、财务、培训。
- 重要结论必须写入 `shared-memory/cross-agent-log.md`。
- 记录格式：`- [YYYY-MM-DD] [角色] [P0|P1|P2] 结论（不超过两行）`
- `P0` 是永久知识，`P1` 是当前项目，`P2` 是临时记录。
<!-- YOYOO_MULTI_TEAM_RULES_END -->
EOF
fi

agent_exists() {
  local agent_id="$1"
  openclaw agents list --json | rg -q "\"id\": \"$agent_id\""
}

ensure_agent() {
  local agent_id="$1"
  local display_name="$2"
  local emoji="$3"
  local target_agent_dir="$HOME/.openclaw/agents/$agent_id/agent"

  if agent_exists "$agent_id"; then
    echo "[skip] $agent_id already exists"
  else
    openclaw agents add "$agent_id" \
      --non-interactive \
      --workspace "$WORKSPACE_DIR" \
      --agent-dir "$target_agent_dir" \
      --model "$MODEL_ID" \
      --json >/dev/null
    echo "[add] $agent_id created"
  fi

  mkdir -p "$target_agent_dir"
  if [[ -f "$HOME/.openclaw/agents/main/agent/auth-profiles.json" ]] && [[ ! -f "$target_agent_dir/auth-profiles.json" ]]; then
    cp "$HOME/.openclaw/agents/main/agent/auth-profiles.json" "$target_agent_dir/auth-profiles.json"
    echo "[ok] auth profile copied to $agent_id"
  fi

  openclaw agents set-identity \
    --agent "$agent_id" \
    --workspace "$WORKSPACE_DIR" \
    --name "$display_name" \
    --emoji "$emoji" \
    --json >/dev/null
  echo "[ok] identity set for $agent_id => $display_name $emoji"
}

ensure_agent "coder" "工程师" "🛠️"
ensure_agent "writer" "内容官" "✍️"
ensure_agent "growth" "增长官" "📈"
ensure_agent "legal" "法务官" "⚖️"
ensure_agent "finance" "财务官" "💰"
ensure_agent "teacher" "培训官" "🎓"

echo
echo "[done] multi-team agents ready"
echo "Workspace: $WORKSPACE_DIR"
echo "Shared memory: $SHARED_DIR"
echo
echo "Next:"
echo "1) openclaw agents list --json"
echo "2) openclaw agent --agent coder --message \"请只回复：coder-ready\" --json --timeout 120"
echo "3) openclaw agent --agent writer --message \"请只回复：writer-ready\" --json --timeout 120"
