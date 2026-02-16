#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTIVATE_SCRIPT="${ROOT_DIR}/Yoyoo/project/bootstrap/activate_ceo_cto.sh"

if [[ ! -x "${ACTIVATE_SCRIPT}" ]]; then
  echo "[Yoyoo] activate script not found: ${ACTIVATE_SCRIPT}" >&2
  echo "[Yoyoo] 请确认你在仓库根目录执行: bash install.sh" >&2
  exit 1
fi

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  printf "[Yoyoo] 请输入 MiniMax API Key: "
  read -r MINIMAX_API_KEY
fi

if [[ -z "${MINIMAX_API_KEY:-}" ]]; then
  echo "[Yoyoo] MINIMAX_API_KEY 不能为空" >&2
  exit 1
fi

run_install() {
  MINIMAX_API_KEY="${MINIMAX_API_KEY}" \
  bash "${ACTIVATE_SCRIPT}"
}

if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    echo "[Yoyoo] 需要 root 权限，正在使用 sudo 执行安装..."
    sudo env MINIMAX_API_KEY="${MINIMAX_API_KEY}" bash "${ACTIVATE_SCRIPT}"
  else
    echo "[Yoyoo] 当前不是 root 且未安装 sudo，无法继续安装" >&2
    exit 1
  fi
else
  run_install
fi

echo ""
echo "[Yoyoo] 安装完成。当前应已具备 CEO + CTO 双实例。"
echo "[Yoyoo] 可执行以下命令复查："
echo "  systemctl is-active openclaw-gateway.service openclaw-gateway-cto.service"
echo "  ss -lntp | grep -E '18789|18794'"
