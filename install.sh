#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
WORKSPACE_DIR="${OPENCLAW_HOME}/workspace"
SKILLS_DIR="${OPENCLAW_HOME}/skills"
BACKUP_ROOT="${OPENCLAW_HOME}/.yoyoo-backup"
MANIFEST_FILE="${WORKSPACE_DIR}/manifest.json"
BASELINE_VERSION="1.0.1"
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

sync_templates() {
  log "正在配置工作空间..."
  mkdir -p "${WORKSPACE_DIR}" "${SKILLS_DIR}"

  log "正在安装 Skills..."
  cp -a "${SCRIPT_DIR}/skills/." "${SKILLS_DIR}/"

  log "正在复制 workspace 模板..."
  cp -a "${SCRIPT_DIR}/workspace/." "${WORKSPACE_DIR}/"
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
  "features": ["install", "check", "rollback", "manifest"]
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
    "${SKILLS_DIR}/yoyoo-memory/SKILL.md"
    "${SKILLS_DIR}/yoyoo-workflow/SKILL.md"
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

run_install() {
  detect_platform
  log "=========================================="
  log "   Yoyoo AI ${BASELINE_VERSION} 安装脚本"
  log "=========================================="
  log "检测到系统: ${PLATFORM}"

  maybe_backup_existing
  install_bun_if_missing
  install_openclaw_if_missing
  sync_templates
  write_manifest
  run_check

  log ""
  log "=========================================="
  log "   安装完成"
  log "=========================================="
  log "接下来请："
  log "1) 编辑 ${WORKSPACE_DIR}/IDENTITY.md"
  log "2) 编辑 ${OPENCLAW_HOME}/openclaw.json 添加 API Key"
  log "3) 运行 openclaw gateway 启动"
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
