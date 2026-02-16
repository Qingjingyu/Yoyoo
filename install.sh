#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_HOME}/workspace"
SKILLS_DIR="${OPENCLAW_HOME}/skills"
BACKUP_ROOT="${OPENCLAW_HOME}/.yoyoo-backup"
MANIFEST_FILE="${WORKSPACE_DIR}/manifest.json"
BASELINE_VERSION="1.0.5"
PLATFORM=""

log() {
  printf '[Yoyoo] %s\n' "$*"
}

usage() {
  cat <<'USAGE'
Yoyoo AI 基础包安装脚本

用法:
  ./install.sh                # 默认安装（同 --install）
  ./install.sh --install      # 执行安装并写入 manifest
  ./install.sh --check        # 校验基础包是否完整
  ./install.sh --rollback     # 回滚到最近一次安装前快照
  ./install.sh --help         # 查看帮助

可选环境变量:
  OPENCLAW_HOME=~/.openclaw   # OpenClaw 数据目录（默认 ~/.openclaw）
  MINIMAX_API_KEY=xxx         # 自动激活 CEO+CTO 时使用
  YOYOO_SKIP_AUTO_ACTIVATE=1  # 仅安装基础包，不自动激活 CEO+CTO
  YOYOO_SKIP_OPENCLAW_UPDATE=1 # 跳过 OpenClaw 自动升级
  YOYOO_OPENCLAW_CHANNEL=stable # OpenClaw 更新通道: stable|beta|dev
USAGE
}

detect_platform() {
  if [[ "${OSTYPE:-}" == darwin* ]]; then
    PLATFORM="macOS"
  elif [[ "${OSTYPE:-}" == linux-gnu* ]]; then
    PLATFORM="Linux"
  else
    echo "不支持的系统: ${OSTYPE:-unknown}" >&2
    exit 1
  fi
}

ensure_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令: $1" >&2
    exit 1
  fi
}

maybe_backup_existing() {
  if [[ ! -d "${WORKSPACE_DIR}" && ! -d "${SKILLS_DIR}" ]]; then
    return 0
  fi

  local ts snapshot
  ts="$(date +%Y%m%d_%H%M%S)"
  snapshot="${BACKUP_ROOT}/${ts}"
  mkdir -p "${snapshot}"

  if [[ -d "${WORKSPACE_DIR}" ]]; then
    cp -a "${WORKSPACE_DIR}" "${snapshot}/workspace"
  fi
  if [[ -d "${SKILLS_DIR}" ]]; then
    cp -a "${SKILLS_DIR}" "${snapshot}/skills"
  fi
  printf '%s\n' "${snapshot}" > "${BACKUP_ROOT}/latest"
  log "已创建回滚快照: ${snapshot}"
}

install_bun_if_missing() {
  if command -v bun >/dev/null 2>&1; then
    log "Bun 已安装，跳过"
    return 0
  fi
  log "正在安装 Bun..."
  ensure_cmd curl
  curl -fsSL https://bun.sh/install | bash
  if [[ -d "${HOME}/.bun/bin" ]]; then
    export PATH="${HOME}/.bun/bin:${PATH}"
  fi
}

install_openclaw_if_missing() {
  if command -v openclaw >/dev/null 2>&1; then
    log "OpenClaw 已安装，跳过"
    return 0
  fi

  if [[ "${PLATFORM}" == "Linux" && "${EUID}" -ne 0 ]]; then
    echo "Linux 安装 OpenClaw 需要 root 权限，请使用 sudo。" >&2
    exit 1
  fi

  log "正在安装 OpenClaw..."
  ensure_cmd curl
  curl -fsSL https://openclaw.ai/install.sh | bash
}

upgrade_openclaw_if_possible() {
  if [[ "${YOYOO_SKIP_OPENCLAW_UPDATE:-0}" == "1" ]]; then
    log "YOYOO_SKIP_OPENCLAW_UPDATE=1，跳过 OpenClaw 自动升级"
    return 0
  fi

  if ! command -v openclaw >/dev/null 2>&1; then
    log "OpenClaw 不存在，跳过升级"
    return 0
  fi

  local channel tag tmp_cfg
  channel="${YOYOO_OPENCLAW_CHANNEL:-stable}"
  tag="latest"
  if [[ "${channel}" == "beta" ]]; then
    tag="beta"
  fi

  log "正在升级 OpenClaw（channel=${channel}）..."

  # Use a temporary minimal config to avoid old/broken local config blocking updates.
  tmp_cfg="$(mktemp)"
  printf '{}\n' > "${tmp_cfg}"
  if OPENCLAW_CONFIG_PATH="${tmp_cfg}" openclaw update --yes --channel "${channel}" --no-restart >/tmp/yoyoo_openclaw_update.log 2>&1; then
    rm -f "${tmp_cfg}"
    log "OpenClaw 升级完成: $(openclaw --version 2>/dev/null | head -n 1 || echo unknown)"
    return 0
  fi
  rm -f "${tmp_cfg}"

  log "OpenClaw update 失败，尝试 npm 兜底升级..."
  if command -v npm >/dev/null 2>&1; then
    if npm install -g "openclaw@${tag}" >/tmp/yoyoo_openclaw_update_fallback.log 2>&1; then
      log "OpenClaw npm 兜底升级成功: $(openclaw --version 2>/dev/null | head -n 1 || echo unknown)"
      return 0
    fi
  fi

  log "WARN: OpenClaw 自动升级失败，继续安装流程。可手动执行: openclaw update --yes --channel ${channel}"
  return 0
}

sync_templates() {
  log "正在配置工作空间..."
  mkdir -p "${WORKSPACE_DIR}" "${SKILLS_DIR}"

  log "正在安装 Skills..."
  cp -a "${SCRIPT_DIR}/skills/." "${SKILLS_DIR}/"

  log "正在复制 workspace 模板..."
  cp -a "${SCRIPT_DIR}/workspace/." "${WORKSPACE_DIR}/"
}

write_default_openclaw_config() {
  local cfg
  cfg="${OPENCLAW_HOME}/openclaw.json"
  mkdir -p "${OPENCLAW_HOME}"

  if [[ -f "${cfg}" ]]; then
    if grep -q '"backend"[[:space:]]*:[[:space:]]*"qmd"' "${cfg}"; then
      log "检测到已有 openclaw.json 且已启用 qmd，跳过覆盖"
    else
      log "检测到已有 openclaw.json，保持不覆盖。建议手动确认 memory.backend=qmd"
    fi
    return 0
  fi

  cat > "${cfg}" <<'EOF'
{
  "channels": {
    "feishu": {
      "enabled": false,
      "connectionMode": "websocket",
      "dmPolicy": "open",
      "groupPolicy": "open",
      "requireMention": false,
      "appId": "REPLACE_FEISHU_APP_ID",
      "appSecret": "REPLACE_FEISHU_APP_SECRET"
    },
    "dingtalk": {
      "enabled": false,
      "clientId": "REPLACE_DINGTALK_CLIENT_ID",
      "clientSecret": "REPLACE_DINGTALK_CLIENT_SECRET",
      "robotCode": "REPLACE_DINGTALK_ROBOT_CODE",
      "corpId": "REPLACE_DINGTALK_CORP_ID",
      "agentId": "REPLACE_DINGTALK_AGENT_ID"
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "minimax": {
        "baseURL": "https://api.minimaxi.com/anthropic",
        "apiKey": "REPLACE_MINIMAX_API_KEY"
      }
    }
  },
  "memory": {
    "backend": "qmd",
    "qmd": {
      "limits": {
        "timeoutMs": 8000
      }
    }
  },
  "yoyoo": {
    "llmops": {
      "litellm": {
        "enabled": false,
        "baseURL": "http://127.0.0.1:4000"
      },
      "langfuse": {
        "enabled": false,
        "host": "https://cloud.langfuse.com",
        "publicKey": "REPLACE_LANGFUSE_PUBLIC_KEY",
        "secretKey": "REPLACE_LANGFUSE_SECRET_KEY"
      },
      "promptfoo": {
        "enabled": false,
        "configPath": "~/.openclaw/workspace/ops/promptfooconfig.yaml"
      }
    }
  },
  "messages": {
    "queue": {
      "mode": "steer"
    }
  }
}
EOF
  log "已生成默认 openclaw.json（含 QMD/LiteLLM/Langfuse/Promptfoo 模板）"
}

write_baseline_runtime_pack() {
  mkdir -p "${WORKSPACE_DIR}/onboarding" "${WORKSPACE_DIR}/ops" "${WORKSPACE_DIR}/bootstrap"

  cat > "${WORKSPACE_DIR}/onboarding/NEW_EMPLOYEE_7D.md" <<'EOF'
# Yoyoo 新员工 7 天入职清单

## Day 1: 系统基础
- 理解角色：Yoyoo 是“脑”，执行器是“手”。
- 会用：`openclaw gateway`、`openclaw doctor --fix`。

## Day 2: 记忆系统
- 启用并理解 QMD。
- 掌握 `skills/yoyoo-memory/backup-memory.sh` 导入导出。

## Day 3: 稳定性
- 学会失败重试、兜底策略、超时治理。
- 能完成一次“服务异常 -> 恢复”的演练。

## Day 4: 可观测
- 接入 Langfuse（可选）并查看一次完整 trace。

## Day 5: 评测
- 使用 Promptfoo（可选）做 3 条关键任务回归。

## Day 6: 组织化记忆
- 按 CEO/后勤/研发设计记忆块并写入规范。

## Day 7: 安全
- 按 OWASP LLM Top 10 完成一次技能/提示词安全检查。
EOF

  cat > "${WORKSPACE_DIR}/ops/LLMOPS_QUICKSTART.md" <<'EOF'
# Yoyoo LLMOps 快速启用

## 1) 启用 QMD（推荐）
```bash
bash ~/.openclaw/workspace/bootstrap/enable_qmd.sh
```

## 2) 启用 LiteLLM/Langfuse/Promptfoo（按需）
```bash
bash ~/.openclaw/workspace/bootstrap/enable_llmops.sh
```

脚本只负责安装与模板提示，不会覆盖你现有业务配置。
EOF

  cat > "${WORKSPACE_DIR}/ops/OPENCLAW_REAL_WORK_PLAYBOOK.md" <<'EOF'
# OpenClaw 真干活实战手册（Yoyoo 内置）

## 1) 基础硬件建议
- 云服务器优先，建议 4G 起步，推荐 8G+。
- 低内存会导致浏览器层和长任务频繁失败。

## 2) 模型策略
- 日常任务走低成本模型，复杂任务切高能力模型。
- 目标：按任务分级，不要全程最高配烧钱。

## 3) 搜索/浏览四层能力
- L0：搜索 + 抓取（低成本、高频）
- L1：无头浏览器（JS 页面）
- L2：有头浏览器（登录/点击/表单）
- L3：截图+视觉（兜底）

## 4) 文件回传
- 优先自动同步/挂载方案，保证“结果可回收”。
- 成果必须回写到标准目录，避免只留在远端临时路径。

## 5) 人格与入职
- 用 SOUL/USER/TOOLS/MEMORY 明确身份、边界、风格。
- 新员工先读组织资料再接任务。

## 6) 日常高频命令
- `/status`：看当前状态
- `/stop`：中断卡住任务
- `/model`：切模型
- `/compact`：压上下文

## 7) 防止“自我改死”
- 配置变更先备份，再校验，再重启。
- 避免让执行体直接批量改核心配置并自动重启。
EOF

  cat > "${WORKSPACE_DIR}/bootstrap/enable_qmd.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "[Yoyoo] Enable QMD baseline..."
if ! command -v bun >/dev/null 2>&1; then
  echo "[Yoyoo] bun not found, please install bun first."
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "[Yoyoo] sqlite3 not found, install sqlite3 first."
  exit 1
fi

if ! command -v qmd >/dev/null 2>&1; then
  bun install -g github:tobi/qmd
fi

CFG="${HOME}/.openclaw/openclaw.json"
if [[ ! -f "${CFG}" ]]; then
  echo "[Yoyoo] ${CFG} not found. Run install.sh first."
  exit 1
fi

if grep -q '"backend"[[:space:]]*:[[:space:]]*"qmd"' "${CFG}"; then
  echo "[Yoyoo] qmd backend already configured."
else
  if command -v python3 >/dev/null 2>&1; then
    CFG_PATH="${CFG}" python3 - <<'PY'
import json
import os
from pathlib import Path

cfg = Path(os.environ["CFG_PATH"])
data = json.loads(cfg.read_text(encoding="utf-8"))
memory = data.setdefault("memory", {})
memory["backend"] = "qmd"
qmd = memory.setdefault("qmd", {})
limits = qmd.setdefault("limits", {})
limits.setdefault("timeoutMs", 8000)
cfg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("[Yoyoo] updated openclaw.json memory.backend=qmd")
PY
  else
    echo "[Yoyoo] WARN: python3 missing, cannot auto patch ${CFG}"
  fi
fi

echo "[Yoyoo] QMD check done."
EOF
  chmod +x "${WORKSPACE_DIR}/bootstrap/enable_qmd.sh"

  cat > "${WORKSPACE_DIR}/bootstrap/enable_llmops.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

echo "[Yoyoo] Enable LLMOps toolkit..."

if command -v python3 >/dev/null 2>&1; then
  python3 -m pip install --user --upgrade litellm || true
  python3 -m pip install --user --upgrade requests || true
else
  echo "[Yoyoo] python3 missing: skip litellm install"
fi

if command -v npm >/dev/null 2>&1; then
  npm i -g promptfoo || true
else
  echo "[Yoyoo] npm missing: skip promptfoo install"
fi

cat <<'TIPS'
[Yoyoo] Next:
1) Fill LANGFUSE keys in ~/.openclaw/openclaw.json (yoyoo.llmops.langfuse)
2) Start LiteLLM proxy when needed
3) Run promptfoo eval on your critical tasks
TIPS
EOF
  chmod +x "${WORKSPACE_DIR}/bootstrap/enable_llmops.sh"

  cat > "${WORKSPACE_DIR}/bootstrap/harden_runtime.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
CFG="${OPENCLAW_HOME}/openclaw.json"
SNAP_DIR="${OPENCLAW_HOME}/snapshots"
mkdir -p "${SNAP_DIR}"

echo "[Yoyoo] Runtime hardening start..."

if [[ -f "${CFG}" ]]; then
  cp "${CFG}" "${SNAP_DIR}/openclaw.json.$(date +%Y%m%d_%H%M%S).bak"
  echo "[Yoyoo] backup config done"
fi

if command -v python3 >/dev/null 2>&1 && [[ -f "${CFG}" ]]; then
  CFG_PATH="${CFG}" python3 - <<'PY'
import json
import os
from pathlib import Path

cfg = Path(os.environ["CFG_PATH"])
data = json.loads(cfg.read_text(encoding="utf-8"))
messages = data.setdefault("messages", {})
queue = messages.setdefault("queue", {})
queue["mode"] = "steer"
cfg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("[Yoyoo] ensured messages.queue.mode=steer")
PY
fi

if command -v openclaw >/dev/null 2>&1; then
  openclaw doctor --fix || true
  openclaw gateway status || true
fi

echo "[Yoyoo] Runtime hardening done."
EOF
  chmod +x "${WORKSPACE_DIR}/bootstrap/harden_runtime.sh"

  log "已写入运行时能力包与 LLMOps 启用脚本"
}

install_qmd_builtin() {
  local qmd_script
  qmd_script="${WORKSPACE_DIR}/bootstrap/enable_qmd.sh"
  log "内置能力：自动启用 QMD..."

  if [[ ! -x "${qmd_script}" ]]; then
    log "WARN: 未找到 ${qmd_script}，跳过 QMD 自动启用"
    return 0
  fi

  if ! "${qmd_script}"; then
    log "WARN: QMD 自动启用失败。可手动执行：bash ${qmd_script}"
    return 0
  fi
  log "QMD 已内置启用"
}

install_llmops_builtin() {
  local llmops_script
  llmops_script="${WORKSPACE_DIR}/bootstrap/enable_llmops.sh"
  log "内置能力：自动安装 LLMOps 基线..."

  if [[ ! -x "${llmops_script}" ]]; then
    log "WARN: 未找到 ${llmops_script}，跳过 LLMOps 自动安装"
    return 0
  fi

  if ! "${llmops_script}"; then
    log "WARN: LLMOps 自动安装失败。可手动执行：bash ${llmops_script}"
    return 0
  fi
  log "LLMOps 基线已内置"
}

write_manifest() {
  local installed_at openclaw_ver bun_ver
  installed_at="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  openclaw_ver="$(openclaw --version 2>/dev/null | head -n 1 || echo 'unknown')"
  bun_ver="$(bun --version 2>/dev/null || echo 'unknown')"

  cat > "${MANIFEST_FILE}" <<EOF
{
  "name": "Yoyoo AI Base Pack",
  "version": "${BASELINE_VERSION}",
  "installed_at_utc": "${installed_at}",
  "platform": "${PLATFORM}",
  "openclaw_home": "${OPENCLAW_HOME}",
  "openclaw_version": "${openclaw_ver}",
  "bun_version": "${bun_ver}",
  "features": ["install", "check", "rollback", "manifest", "baseline-runtime-pack", "qmd-autoinstall", "llmops-autoinstall", "x-fetcher", "wechat-learning", "steer-default", "runtime-hardening"]
}
EOF
  log "已写入 manifest: ${MANIFEST_FILE}"
}

run_check() {
  local failures=0
  local required_files=(
    "${WORKSPACE_DIR}/IDENTITY.md"
    "${WORKSPACE_DIR}/USER.md"
    "${WORKSPACE_DIR}/SOUL.md"
    "${WORKSPACE_DIR}/MEMORY.md"
    "${WORKSPACE_DIR}/onboarding/NEW_EMPLOYEE_7D.md"
    "${WORKSPACE_DIR}/ops/LLMOPS_QUICKSTART.md"
    "${WORKSPACE_DIR}/ops/OPENCLAW_REAL_WORK_PLAYBOOK.md"
    "${WORKSPACE_DIR}/bootstrap/enable_qmd.sh"
    "${WORKSPACE_DIR}/bootstrap/enable_llmops.sh"
    "${WORKSPACE_DIR}/bootstrap/harden_runtime.sh"
    "${SKILLS_DIR}/yoyoo-memory/SKILL.md"
    "${SKILLS_DIR}/yoyoo-workflow/SKILL.md"
    "${SKILLS_DIR}/x-fetcher/SKILL.md"
    "${SKILLS_DIR}/x-fetcher/fetch_x.py"
    "${SKILLS_DIR}/wechat-learning/SKILL.md"
    "${SKILLS_DIR}/wechat-learning/wechat_search.py"
    "${MANIFEST_FILE}"
  )

  detect_platform
  log "执行自检..."
  log "系统: ${PLATFORM}"

  if command -v bun >/dev/null 2>&1; then
    log "PASS: bun 已安装"
  else
    log "FAIL: bun 未安装"
    failures=$((failures + 1))
  fi

  if command -v openclaw >/dev/null 2>&1; then
    log "PASS: openclaw 已安装"
  else
    log "FAIL: openclaw 未安装"
    failures=$((failures + 1))
  fi

  for file in "${required_files[@]}"; do
    if [[ -f "${file}" ]]; then
      log "PASS: ${file}"
    else
      log "FAIL: 缺少 ${file}"
      failures=$((failures + 1))
    fi
  done

  if (( failures > 0 )); then
    log "自检失败，错误数: ${failures}"
    return 1
  fi
  log "自检通过"
}

run_rollback() {
  local latest snapshot
  latest="${BACKUP_ROOT}/latest"

  if [[ -f "${latest}" ]]; then
    snapshot="$(cat "${latest}")"
  else
    snapshot="$(find "${BACKUP_ROOT}" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort | tail -n 1 || true)"
  fi

  if [[ -z "${snapshot}" || ! -d "${snapshot}" ]]; then
    echo "未找到可回滚快照，请先执行一次安装。(${BACKUP_ROOT})" >&2
    exit 1
  fi

  log "回滚到快照: ${snapshot}"
  mkdir -p "${OPENCLAW_HOME}"

  if [[ -d "${snapshot}/workspace" ]]; then
    rm -rf "${WORKSPACE_DIR}"
    cp -a "${snapshot}/workspace" "${WORKSPACE_DIR}"
  fi
  if [[ -d "${snapshot}/skills" ]]; then
    rm -rf "${SKILLS_DIR}"
    cp -a "${snapshot}/skills" "${SKILLS_DIR}"
  fi

  log "回滚完成"
}

ensure_minimax_api_key() {
  if [[ -n "${MINIMAX_API_KEY:-}" ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    log "未检测到 MINIMAX_API_KEY 且当前非交互终端，跳过自动激活 CEO+CTO"
    return 1
  fi
  printf "[Yoyoo] 请输入 MiniMax API Key（用于自动激活 CEO+CTO）: "
  read -r MINIMAX_API_KEY
  if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
    log "未输入 API Key，跳过自动激活 CEO+CTO"
    return 1
  fi
  return 0
}

auto_activate_ceo_cto() {
  local activate_script
  if [[ "${YOYOO_SKIP_AUTO_ACTIVATE:-0}" == "1" ]]; then
    log "YOYOO_SKIP_AUTO_ACTIVATE=1，跳过自动激活 CEO+CTO"
    return 0
  fi

  activate_script="${SCRIPT_DIR}/Yoyoo/project/bootstrap/activate_ceo_cto.sh"
  if [[ ! -x "${activate_script}" ]]; then
    log "未找到激活脚本，跳过自动激活: ${activate_script}"
    return 0
  fi

  if ! ensure_minimax_api_key; then
    return 0
  fi

  log "正在自动激活 CEO + CTO..."
  if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      sudo env MINIMAX_API_KEY="${MINIMAX_API_KEY}" bash "${activate_script}"
    else
      log "当前不是 root 且没有 sudo，跳过自动激活 CEO+CTO"
      return 0
    fi
  else
    MINIMAX_API_KEY="${MINIMAX_API_KEY}" bash "${activate_script}"
  fi
}

run_install() {
  detect_platform
  log "=========================================="
  log "   Yoyoo AI ${BASELINE_VERSION} 安装脚本"
  log "=========================================="
  log "检测到系统: ${PLATFORM}"

  maybe_backup_existing
  install_bun_if_missing
  install_openclaw_if_missing
  upgrade_openclaw_if_possible
  sync_templates
  write_default_openclaw_config
  write_baseline_runtime_pack
  install_qmd_builtin
  install_llmops_builtin
  "${WORKSPACE_DIR}/bootstrap/harden_runtime.sh" || true
  write_manifest
  run_check
  auto_activate_ceo_cto

  log ""
  log "=========================================="
  log "   安装完成"
  log "=========================================="
  log "当前默认流程：安装即自动激活 CEO+CTO。"
  log "如需仅安装基础包，可使用 YOYOO_SKIP_AUTO_ACTIVATE=1 bash install.sh"
}

main() {
  local action="${1:---install}"
  case "${action}" in
    --install|install)
      run_install
      ;;
    --check|check)
      run_check
      ;;
    --rollback|rollback)
      run_rollback
      ;;
    --help|-h|help)
      usage
      ;;
    *)
      echo "未知参数: ${action}" >&2
      usage
      exit 1
      ;;
  esac
}

main "${1:---install}"
