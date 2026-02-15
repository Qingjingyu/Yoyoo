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

### 1. 一键安装基础包

```bash
# 克隆仓库
git clone https://github.com/Qingjingyu/Yoyoo.git
cd Yoyoo

# 执行安装（默认等价于 --install）
bash install.sh
```

### 2. 安装后自检（推荐）

```bash
bash install.sh --check
```

### 3. 失败回滚

安装脚本会在每次覆盖前自动创建快照（`~/.openclaw/.yoyoo-backup/`）：

```bash
bash install.sh --rollback
```

### 4. 配置

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

### 5. 初始化身份

编辑 workspace 文件：

```bash
# 复制配置模板
cp -r workspace ~/.openclaw/

# 编辑你的身份
nano ~/.openclaw/workspace/IDENTITY.md
nano ~/.openclaw/workspace/USER.md
```

### 6. 启动

```bash
openclaw gateway
```

## 安装脚本能力（v1.0.1）

| 命令 | 作用 |
|------|------|
| `bash install.sh` | 安装基础包（Bun/OpenClaw/skills/workspace） |
| `bash install.sh --check` | 检查基础包完整性与关键文件 |
| `bash install.sh --rollback` | 回滚到最近一次安装前快照 |

安装成功后会生成安装清单：

```text
~/.openclaw/workspace/manifest.json
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
