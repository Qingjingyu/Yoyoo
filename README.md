# Yoyoo AI - 多员工AI协作系统

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.0-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS-green" alt="Platform">
  <img src="https://img.shields.io/badge/AI-MiniMax-orange" alt="Model">
</p>

> 开箱即用、零门槛的AI产品

## 特性

- 🤖 **多AI协作** - 多个AI员工分工合作
- 💾 **统一记忆** - 跨实例记忆同步
- ⚡ **工作流编排** - 自动化流程
- 🔧 **系统调试** - 问题排查
- 📚 **知识增强** - RAG检索

## 快速开始

### 1. 安装依赖

```bash
# 安装 Bun
curl -fsSL https://bun.sh/install | bash

# 安装 OpenClaw
curl -fsSL https://openclaw.ai/install.sh | bash
```

### 2. 配置

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "dmPolicy": "open",
      "appId": "你的飞书App ID",
      "appSecret": "你的飞书App Secret"
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "minimax": {
        "apiKey": "你的MiniMax API Key"
      }
    }
  }
}
```

### 3. 初始化身份

编辑 workspace 文件：

```bash
# 复制配置模板
cp -r workspace ~/.openclaw/

# 编辑你的身份
nano ~/.openclaw/workspace/IDENTITY.md
nano ~/.openclaw/workspace/USER.md
```

### 4. 启动

```bash
openclaw gateway
```

## 配置说明

### 飞书配置

1. 创建飞书应用：https://open.feishu.com/
2. 获取 App ID 和 App Secret
3. 配置事件订阅（长连接）

### 模型配置

推荐使用 MiniMax API：
- 注册：https://platform.minimaxi.com/

## Skills

| Skill | 功能 |
|-------|------|
| yoyoo-multi-agent | 多AI协作管理 |
| yoyoo-memory | 统一记忆系统 |
| yoyoo-workflow | 工作流编排 |
| yoyoo-debug | 系统调试 |
| yoyoo-knowledge | 知识增强 |
| brave-search | 网页搜索 |

## 文档

- [OpenClaw文档](https://docs.openclaw.ai)
- [飞书配置指南](https://docs.openclaw.ai/channels/feishu)

## License

MIT
