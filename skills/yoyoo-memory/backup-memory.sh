#!/usr/bin/env bash
# Yoyoo Memory Backup/Restore Tool

set -euo pipefail

OPENCLAW_HOME="${OPENCLAW_HOME:-$HOME/.openclaw}"
MEMORY_DIR="${OPENCLAW_HOME}/workspace"
MEMORY_DAILY_DIR="${MEMORY_DIR}/memory"
BACKUP_STORE="${MEMORY_DIR}/memory-backups"
LATEST_FILE="${BACKUP_STORE}/LATEST"
LEGACY_BACKUP_FILE="${HOME}/yoyoo-memory-backup.zip"

log() {
  printf '[memory-backup] %s\n' "$*"
}

ensure_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少依赖命令: $1" >&2
    exit 1
  fi
}

ensure_dirs() {
  mkdir -p "${MEMORY_DIR}" "${BACKUP_STORE}"
}

resolve_import_file() {
  local requested="${1:-}"

  if [[ -n "${requested}" ]]; then
    if [[ ! -f "${requested}" ]]; then
      echo "指定的备份文件不存在: ${requested}" >&2
      exit 1
    fi
    printf '%s\n' "${requested}"
    return 0
  fi

  if [[ -f "${LATEST_FILE}" ]]; then
    local latest
    latest="$(cat "${LATEST_FILE}")"
    if [[ -f "${latest}" ]]; then
      printf '%s\n' "${latest}"
      return 0
    fi
  fi

  if [[ -f "${LEGACY_BACKUP_FILE}" ]]; then
    printf '%s\n' "${LEGACY_BACKUP_FILE}"
    return 0
  fi

  echo "未找到可导入备份。请先执行 export 或传入备份路径。" >&2
  exit 1
}

create_preimport_snapshot() {
  local ts snapshot_file stage_dir
  ts="$(date +%Y%m%d_%H%M%S)"
  snapshot_file="${BACKUP_STORE}/pre-import-${ts}.zip"
  stage_dir="$(mktemp -d)"

  if [[ -f "${MEMORY_DIR}/MEMORY.md" ]]; then
    cp -f "${MEMORY_DIR}/MEMORY.md" "${stage_dir}/"
  fi
  if [[ -f "${MEMORY_DIR}/USER.md" ]]; then
    cp -f "${MEMORY_DIR}/USER.md" "${stage_dir}/"
  fi
  if [[ -d "${MEMORY_DAILY_DIR}" ]]; then
    cp -a "${MEMORY_DAILY_DIR}" "${stage_dir}/memory"
  fi

  if [[ -z "$(find "${stage_dir}" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
    rm -rf "${stage_dir}"
    printf '%s\n' ""
    return 0
  fi

  (
    cd "${stage_dir}" &&
      zip -qr "${snapshot_file}" .
  )
  rm -rf "${stage_dir}"
  printf '%s\n' "${snapshot_file}"
}

export_backup() {
  local ts backup_file stage_dir size
  ensure_cmd zip
  ensure_cmd du
  ensure_dirs

  ts="$(date +%Y%m%d_%H%M%S)"
  backup_file="${BACKUP_STORE}/yoyoo-memory-backup-${ts}.zip"
  stage_dir="$(mktemp -d)"

  log "导出 Yoyoo 记忆..."

  if [[ -f "${MEMORY_DIR}/MEMORY.md" ]]; then
    cp -f "${MEMORY_DIR}/MEMORY.md" "${stage_dir}/"
  fi
  if [[ -f "${MEMORY_DIR}/USER.md" ]]; then
    cp -f "${MEMORY_DIR}/USER.md" "${stage_dir}/"
  fi
  if [[ -d "${MEMORY_DAILY_DIR}" ]]; then
    cp -a "${MEMORY_DAILY_DIR}" "${stage_dir}/memory"
  fi

  if [[ -z "$(find "${stage_dir}" -mindepth 1 -print -quit 2>/dev/null)" ]]; then
    rm -rf "${stage_dir}"
    echo "没有可导出的记忆文件（MEMORY.md / USER.md / memory/）。" >&2
    exit 1
  fi

  (
    cd "${stage_dir}" &&
      zip -qr "${backup_file}" .
  )
  rm -rf "${stage_dir}"

  printf '%s\n' "${backup_file}" >"${LATEST_FILE}"
  size="$(du -h "${backup_file}" | awk '{print $1}')"

  log "导出完成: ${backup_file}"
  log "大小: ${size}"
}

import_backup() {
  local import_file pre_snapshot extract_dir source_dir restored=0
  ensure_cmd unzip
  ensure_cmd zip
  ensure_dirs

  import_file="$(resolve_import_file "${1:-}")"
  log "导入 Yoyoo 记忆: ${import_file}"

  pre_snapshot="$(create_preimport_snapshot)"
  if [[ -n "${pre_snapshot}" ]]; then
    log "已创建导入前快照: ${pre_snapshot}"
  else
    log "当前无历史记忆，跳过导入前快照"
  fi

  extract_dir="$(mktemp -d)"
  unzip -oq "${import_file}" -d "${extract_dir}"

  if [[ -d "${extract_dir}/memory-backup" ]]; then
    source_dir="${extract_dir}/memory-backup"
  else
    source_dir="${extract_dir}"
  fi

  if [[ -f "${source_dir}/MEMORY.md" ]]; then
    cp -f "${source_dir}/MEMORY.md" "${MEMORY_DIR}/"
    restored=1
  fi
  if [[ -f "${source_dir}/USER.md" ]]; then
    cp -f "${source_dir}/USER.md" "${MEMORY_DIR}/"
    restored=1
  fi
  if [[ -d "${source_dir}/memory" ]]; then
    rm -rf "${MEMORY_DAILY_DIR}"
    cp -a "${source_dir}/memory" "${MEMORY_DAILY_DIR}"
    restored=1
  fi

  rm -rf "${extract_dir}"

  if [[ "${restored}" -ne 1 ]]; then
    echo "导入失败：备份中未找到 MEMORY.md / USER.md / memory/。" >&2
    if [[ -n "${pre_snapshot}" ]]; then
      echo "可用导入前快照手动恢复：${pre_snapshot}" >&2
    fi
    exit 1
  fi

  log "导入完成"
  log "重启 Gateway 生效: openclaw gateway restart"
  if [[ -n "${pre_snapshot}" ]]; then
    log "如需回滚导入前状态，可使用快照: ${pre_snapshot}"
  fi
}

usage() {
  cat <<EOF
Yoyoo 记忆备份/恢复工具

用法:
  $0 export
      导出记忆，生成时间戳备份，不覆盖旧文件

  $0 import [备份文件路径]
      导入指定备份；未传路径时优先使用 ${LATEST_FILE}

环境变量:
  OPENCLAW_HOME=${OPENCLAW_HOME}
EOF
}

action="${1:-help}"
case "${action}" in
export)
  export_backup
  ;;
import)
  import_backup "${2:-}"
  ;;
help|-h|--help)
  usage
  ;;
*)
  usage
  exit 1
  ;;
esac
