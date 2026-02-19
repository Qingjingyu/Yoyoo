#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_HOME}/workspace"
SKILLS_DIR="${OPENCLAW_HOME}/skills"
BACKUP_ROOT="${OPENCLAW_HOME}/.yoyoo-backup"
MANIFEST_FILE="${WORKSPACE_DIR}/manifest.json"
BASELINE_VERSION="1.0.5"
OPENCLAW_PINNED_VERSION="${YOYOO_OPENCLAW_VERSION:-2026.2.17}"
YOYOO_MODE="${YOYOO_MODE:-single}"
YOYOO_EXECUTION_PROFILE="${YOYOO_EXECUTION_PROFILE:-balanced}"
YOYOO_WIZARD="${YOYOO_WIZARD:-1}"
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
  MINIMAX_API_KEY=xxx         # 自动激活团队模式时使用
  YOYOO_MODE=single           # 安装后自动激活模式: single(默认) | dual
  YOYOO_EXECUTION_PROFILE=balanced # 执行档位: lean | balanced(默认) | aggressive
  YOYOO_EXECUTION_FORCE_SUBAGENT=0 # 是否强制仅 subagent（默认 0，交给智能分流）
  YOYOO_WIZARD=1              # 交互式安装向导（默认开启）
  YOYOO_SKIP_AUTO_ACTIVATE=1  # 仅安装基础包，不自动激活团队
  YOYOO_OPENCLAW_VERSION=2026.2.17 # 固定 OpenClaw 版本（Yoyoo 1.0 默认）
  YOYOO_TEAM_SHARED_MEMORY=1  # CEO/CTO 共享 MEMORY.md + memory/（single/dual 都可用）
  YOYOO_TEAM_SHARED_USER=1    # CEO/CTO 共享 USER.md
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

normalize_execution_profile() {
  local profile
  profile="$(printf '%s' "${YOYOO_EXECUTION_PROFILE:-balanced}" | tr '[:upper:]' '[:lower:]')"
  case "${profile}" in
    lean|balanced|aggressive)
      YOYOO_EXECUTION_PROFILE="${profile}"
      ;;
    *)
      YOYOO_EXECUTION_PROFILE="balanced"
      ;;
  esac
}

interactive_install_wizard() {
  local mode_choice profile_choice
  if [[ "${YOYOO_WIZARD}" != "1" ]]; then
    return 0
  fi
  if [[ ! -t 0 ]]; then
    return 0
  fi

  log "安装向导：按回车使用默认值。"
  printf "[Yoyoo] 模式选择 [1] single(默认) [2] dual: "
  read -r mode_choice || true
  case "${mode_choice}" in
    2) YOYOO_MODE="dual" ;;
    *) YOYOO_MODE="single" ;;
  esac

  printf "[Yoyoo] 执行档位 [1] lean [2] balanced(默认) [3] aggressive: "
  read -r profile_choice || true
  case "${profile_choice}" in
    1) YOYOO_EXECUTION_PROFILE="lean" ;;
    3) YOYOO_EXECUTION_PROFILE="aggressive" ;;
    *) YOYOO_EXECUTION_PROFILE="balanced" ;;
  esac

  log "向导结果：YOYOO_MODE=${YOYOO_MODE}, YOYOO_EXECUTION_PROFILE=${YOYOO_EXECUTION_PROFILE}"
}

upsert_env_kv() {
  local file key value
  file="$1"
  key="$2"
  value="$3"

  mkdir -p "$(dirname "${file}")"
  touch "${file}"
  python3 - "${file}" "${key}" "${value}" <<'PY'
import sys
from pathlib import Path

file_path = Path(sys.argv[1])
key = sys.argv[2]
value = sys.argv[3]

lines = file_path.read_text(encoding="utf-8").splitlines() if file_path.exists() else []
prefix = f"{key}="
updated = False
out = []
for line in lines:
    if line.startswith(prefix):
        out.append(f"{key}={value}")
        updated = True
    else:
        out.append(line)
if not updated:
    out.append(f"{key}={value}")
file_path.write_text("\n".join(out) + "\n", encoding="utf-8")
PY
}

apply_execution_profile_after_activation() {
  local force_subagent env_files env_file
  normalize_execution_profile
  force_subagent="${YOYOO_EXECUTION_FORCE_SUBAGENT:-}"
  if [[ -z "${force_subagent}" ]]; then
    force_subagent="0"
  fi

  env_files=()
  if [[ -n "${YOYOO_BACKEND_ENV_FILE:-}" && -f "${YOYOO_BACKEND_ENV_FILE}" ]]; then
    env_files+=("${YOYOO_BACKEND_ENV_FILE}")
  fi
  if [[ -d /etc/yoyoo ]]; then
    while IFS= read -r env_file; do
      env_files+=("${env_file}")
    done < <(find /etc/yoyoo -maxdepth 1 -type f -name 'backend*.env' 2>/dev/null | sort)
  fi

  if (( ${#env_files[@]} == 0 )); then
    log "未找到 backend env 文件，跳过执行档位回写。"
    return 0
  fi

  for env_file in "${env_files[@]}"; do
    upsert_env_kv "${env_file}" "YOYOO_EXECUTION_PROFILE" "${YOYOO_EXECUTION_PROFILE}"
    upsert_env_kv "${env_file}" "YOYOO_EXECUTION_FORCE_SUBAGENT" "${force_subagent}"
    log "已写入执行档位: ${env_file} (profile=${YOYOO_EXECUTION_PROFILE}, force_subagent=${force_subagent})"
  done

  if command -v systemctl >/dev/null 2>&1; then
    while IFS= read -r svc; do
      if [[ -n "${svc}" ]]; then
        systemctl restart "${svc}" >/dev/null 2>&1 || true
      fi
    done < <(systemctl list-unit-files --type=service | awk '/^yoyoo-backend.*service/ {print $1}')
    log "已重启 yoyoo-backend* 服务以应用执行档位。"
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

ensure_openclaw_pinned_version() {
  if ! command -v openclaw >/dev/null 2>&1; then
    log "OpenClaw 不存在，跳过版本锁定"
    return 0
  fi

  local current target
  target="${OPENCLAW_PINNED_VERSION}"
  current="$(openclaw --version 2>/dev/null | head -n 1 | tr -d '\r' | xargs || true)"

  if [[ "${current}" == "${target}" ]]; then
    log "OpenClaw 已固定到目标版本: ${target}"
    return 0
  fi

  log "正在固定 OpenClaw 版本: ${current:-unknown} -> ${target}"
  if command -v npm >/dev/null 2>&1; then
    npm install -g "openclaw@${target}" >/tmp/yoyoo_openclaw_pin.log 2>&1
  elif command -v bun >/dev/null 2>&1; then
    bun add -g "openclaw@${target}" >/tmp/yoyoo_openclaw_pin.log 2>&1
  else
    echo "缺少 npm/bun，无法固定 OpenClaw 版本到 ${target}" >&2
    return 1
  fi

  current="$(openclaw --version 2>/dev/null | head -n 1 | tr -d '\r' | xargs || true)"
  if [[ "${current}" != "${target}" ]]; then
    echo "OpenClaw 版本固定失败，当前=${current:-unknown} 目标=${target}" >&2
    return 1
  fi

  log "OpenClaw 已固定到版本: ${current}"
  return 0
}

sync_templates() {
  log "正在配置工作空间..."
  mkdir -p "${WORKSPACE_DIR}" "${SKILLS_DIR}"

  log "正在安装 Skills..."
  cp -a "${SCRIPT_DIR}/skills/." "${SKILLS_DIR}/"

  log "正在合并 workspace 模板（保护现有记忆与身份文件）..."
  mkdir -p "${WORKSPACE_DIR}" "${WORKSPACE_DIR}/memory"

  local protected_files=(
    "AGENTS.md"
    "SOUL.md"
    "USER.md"
    "IDENTITY.md"
    "MEMORY.md"
    "TOOLS.md"
    "HEARTBEAT.md"
  )
  local file
  for file in "${protected_files[@]}"; do
    if [[ ! -f "${WORKSPACE_DIR}/${file}" ]] && [[ -f "${SCRIPT_DIR}/workspace/${file}" ]]; then
      cp -f "${SCRIPT_DIR}/workspace/${file}" "${WORKSPACE_DIR}/${file}"
    fi
  done

  if [[ -d "${SCRIPT_DIR}/workspace/memory" ]]; then
    cp -an "${SCRIPT_DIR}/workspace/memory/." "${WORKSPACE_DIR}/memory/" 2>/dev/null || true
  fi
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
    log "未检测到 MINIMAX_API_KEY 且当前非交互终端，跳过自动激活"
    return 1
  fi
  printf "[Yoyoo] 请输入 MiniMax API Key（用于自动激活团队）: "
  read -r MINIMAX_API_KEY
  if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
    log "未输入 API Key，跳过自动激活"
    return 1
  fi
  return 0
}

auto_activate_single_gateway_team() {
  local activate_script configure_script ceo_home ceo_port ceo_profile ceo_unit ceo_expect_feishu
  if [[ "${YOYOO_SKIP_AUTO_ACTIVATE:-0}" == "1" ]]; then
    log "YOYOO_SKIP_AUTO_ACTIVATE=1，跳过自动激活"
    return 0
  fi

  activate_script="${SCRIPT_DIR}/Yoyoo/project/bootstrap/activate_employee.sh"
  configure_script="${SCRIPT_DIR}/Yoyoo/project/bootstrap/configure_single_gateway_agents.sh"
  ceo_home="${YOYOO_CEO_HOME:-/root/.openclaw}"
  ceo_port="${YOYOO_CEO_PORT:-18789}"
  ceo_profile="${YOYOO_CEO_PROFILE:-yoyoo-ceo}"
  ceo_unit="${YOYOO_CEO_UNIT:-openclaw-gateway.service}"
  ceo_expect_feishu="${YOYOO_CEO_EXPECT_FEISHU:-1}"
  if [[ ! -x "${activate_script}" ]]; then
    log "未找到激活脚本，跳过自动激活: ${activate_script}"
    return 0
  fi
  if [[ ! -x "${configure_script}" ]]; then
    log "未找到单实例团队配置脚本，跳过自动激活: ${configure_script}"
    return 0
  fi

  if ! ensure_minimax_api_key; then
    return 0
  fi

  log "正在自动激活单实例团队（single: CEO 对话 + CTO 执行）..."
  if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      sudo env \
        MINIMAX_API_KEY="${MINIMAX_API_KEY}" \
        YOYOO_ROLE="ceo" \
        YOYOO_HOME="${ceo_home}" \
        OPENCLAW_PORT="${ceo_port}" \
        YOYOO_PROFILE="${ceo_profile}" \
        OPENCLAW_SYSTEMD_UNIT="${ceo_unit}" \
        YOYOO_EXPECT_FEISHU="${ceo_expect_feishu}" \
        bash "${activate_script}"
      sudo env \
        YOYOO_HOME="${ceo_home}" \
        YOYOO_PROFILE="${ceo_profile}" \
        YOYOO_TEAM_SHARED_MEMORY="${YOYOO_TEAM_SHARED_MEMORY:-1}" \
        YOYOO_TEAM_SHARED_USER="${YOYOO_TEAM_SHARED_USER:-1}" \
        bash "${configure_script}"
    else
      log "当前不是 root 且没有 sudo，跳过自动激活"
      return 0
    fi
  else
    MINIMAX_API_KEY="${MINIMAX_API_KEY}" \
      YOYOO_ROLE="ceo" \
      YOYOO_HOME="${ceo_home}" \
      OPENCLAW_PORT="${ceo_port}" \
      YOYOO_PROFILE="${ceo_profile}" \
      OPENCLAW_SYSTEMD_UNIT="${ceo_unit}" \
      YOYOO_EXPECT_FEISHU="${ceo_expect_feishu}" \
      bash "${activate_script}"
    YOYOO_HOME="${ceo_home}" \
      YOYOO_PROFILE="${ceo_profile}" \
      YOYOO_TEAM_SHARED_MEMORY="${YOYOO_TEAM_SHARED_MEMORY:-1}" \
      YOYOO_TEAM_SHARED_USER="${YOYOO_TEAM_SHARED_USER:-1}" \
      bash "${configure_script}"
  fi
}

auto_activate_ceo_cto() {
  local activate_script
  if [[ "${YOYOO_SKIP_AUTO_ACTIVATE:-0}" == "1" ]]; then
    log "YOYOO_SKIP_AUTO_ACTIVATE=1，跳过自动激活"
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

  log "正在自动激活双实例团队（dual: CEO + CTO）..."
  if [[ "$(id -u)" -ne 0 ]]; then
    if command -v sudo >/dev/null 2>&1; then
      sudo env \
        MINIMAX_API_KEY="${MINIMAX_API_KEY}" \
        YOYOO_TEAM_SHARED_MEMORY="${YOYOO_TEAM_SHARED_MEMORY:-1}" \
        YOYOO_TEAM_SHARED_USER="${YOYOO_TEAM_SHARED_USER:-1}" \
        bash "${activate_script}"
    else
      log "当前不是 root 且没有 sudo，跳过自动激活"
      return 0
    fi
  else
    MINIMAX_API_KEY="${MINIMAX_API_KEY}" bash "${activate_script}"
  fi
}

auto_activate_by_mode() {
  local mode
  mode="$(printf '%s' "${YOYOO_MODE}" | tr '[:upper:]' '[:lower:]')"
  case "${mode}" in
    single)
      auto_activate_single_gateway_team
      ;;
    dual)
      auto_activate_ceo_cto
      ;;
    *)
      log "未知 YOYOO_MODE=${YOYOO_MODE}，回退到 single。可选: single | dual"
      auto_activate_single_gateway_team
      ;;
  esac
}

run_install() {
  detect_platform
  interactive_install_wizard
  normalize_execution_profile
  log "=========================================="
  log "   Yoyoo AI ${BASELINE_VERSION} 安装脚本"
  log "=========================================="
  log "检测到系统: ${PLATFORM}"

  maybe_backup_existing
  install_bun_if_missing
  install_openclaw_if_missing
  ensure_openclaw_pinned_version
  sync_templates
  write_default_openclaw_config
  write_baseline_runtime_pack
  install_qmd_builtin
  install_llmops_builtin
  "${WORKSPACE_DIR}/bootstrap/harden_runtime.sh" || true
  write_manifest
  run_check
  auto_activate_by_mode
  apply_execution_profile_after_activation

  log ""
  log "=========================================="
  log "   安装完成"
  log "=========================================="
  log "当前默认流程：安装即自动激活 single 模式（单 Gateway + 多 Agent）。"
  log "如需双实例模式：YOYOO_MODE=dual bash install.sh"
  log "如需仅安装基础包：YOYOO_SKIP_AUTO_ACTIVATE=1 bash install.sh"
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
