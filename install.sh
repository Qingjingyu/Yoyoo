#!/bin/bash

set -e

echo "=========================================="
echo "   Yoyoo AI 1.0 安装脚本"
echo "=========================================="

# 检查系统
if [[ "$OSTYPE" == "darwin"* ]]; then
    PLATFORM="macOS"
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    PLATFORM="Linux"
else
    echo "不支持的系统"
    exit 1
fi

echo "检测到系统: $PLATFORM"

# 1. 安装 Bun
if ! command -v bun &> /dev/null; then
    echo "正在安装 Bun..."
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
fi

# 2. 安装 OpenClaw
echo "正在安装 OpenClaw..."
if [ "$PLATFORM" = "macOS" ]; then
    curl -fsSL https://openclaw.ai/install.sh | bash
else
    # Linux - 需要root
    if [ "$EUID" -ne 0 ]; then
        echo "Linux安装需要root权限，请使用 sudo"
        exit 1
    fi
    curl -fsSL https://openclaw.ai/install.sh | bash
fi

# 3. 配置目录
echo "正在配置工作空间..."
mkdir -p ~/.openclaw/workspace
mkdir -p ~/.openclaw/skills

# 复制Skills
echo "正在安装Skills..."
cp -r $(dirname $0)/skills/* ~/.openclaw/skills/

# 复制配置模板
echo "正在复制配置模板..."
cp -r $(dirname $0)/workspace/* ~/.openclaw/workspace/

echo ""
echo "=========================================="
echo "   安装完成！"
echo "=========================================="
echo ""
echo "接下来请："
echo "1. 编辑 ~/.openclaw/workspace/IDENTITY.md"
echo "2. 编辑 ~/.openclaw/openclaw.json 添加API Key"
echo "3. 运行 openclaw gateway 启动"
echo ""
