# Yoyoo AI - 多员工AI协作系统

<p align="center">
  <img src="https://img.shields.io/badge/version-1.0.5-blue" alt="Version">
  <img src="https://img.shields.io/badge/platform-Linux%20%7C%20macOS-green" alt="Platform">
  <img src="https://img.shields.io/badge/AI-MiniMax-orange" alt="Model">
</p>

> 开箱即用、零门槛的 AI 员工系统（Yoyoo）

## 当前推荐架构（2026-02）

- **运行内核**：OpenClaw（支持 QMD、Skills、多通道）
- **组织形态（推荐）**：`单 Gateway + 多 Agent 路由`
  - CEO：对话入口、任务分发、验收汇报
  - CTO：执行负责人（必要时拉起子代理）
- **兼容形态（可选）**：CEO + CTO 双实例隔离部署（更重，但隔离更强）

> 说明：仓库目前同时支持“单实例多 Agent 路由”与“双实例”两种模式。默认安装脚本仍以双实例基线为主，便于开箱即用。

## 特性

- 🤖 **多AI协作** - 多个AI员工分工合作
- 💾 **统一记忆** - 跨实例记忆同步
- ⚡ **工作流编排** - 自动化流程
- 🔧 **系统调试** - 问题排查
- 📚 **知识增强** - RAG检索
- 🧠 **运行时能力包内置** - 安装后自动写入并启用基线能力
- 🚀 **LLMOps 基线内置** - QMD/LiteLLM/Langfuse/Promptfoo 自动安装
- 🐦 **X 抓取内置** - x-fetcher 默认可用
- 🟢 **公众号学习内置** - 微信公众号搜索与正文抓取默认可用
- 🧭 **Steer 队列默认开启** - 长任务中可实时插话调整方向
- 🛡️ **运行时防自杀硬化** - 安装时自动备份配置并执行基础巡检

## 快速开始

### 1. 一键安装基础包

```bash
# 克隆仓库
git clone https://github.com/Qingjingyu/Yoyoo.git
cd Yoyoo

# 执行安装（默认等价于 --install）
bash install.sh
```

`install.sh` 会自动询问（或读取）`MINIMAX_API_KEY`，并默认激活 **single 模式**：
- 单 Gateway（`:18789`）
- CEO 作为主入口（`main`）
- CTO 作为执行 Agent（`cto`）

默认固定 OpenClaw 版本为 `2026.2.15`（Yoyoo 1.0 稳定基线），避免版本漂移导致兼容性问题。

如需使用更新版本（例如 `2026.2.17`）：

```bash
YOYOO_OPENCLAW_VERSION=2026.2.17 bash install.sh
```

### 默认团队模式（安装即有）

- 默认安装即 **single 模式**：单 Gateway + 多 Agent（CEO/CTO）。
- 默认优先与 CEO 对话，CTO 负责执行层任务。
- 任务分流：
  - 小任务：CEO 直接处理或临时子代理。
  - 中/大任务：CEO 分派 CTO 执行。
- 默认软上限：40 子代理（会按机器资源自动降级使用）。
- CEO/CTO 默认共享核心记忆（`MEMORY.md + memory/`），避免“群聊记得、私聊忘了”。

可选开关：

```bash
# 关闭 CEO/CTO 共享记忆
YOYOO_TEAM_SHARED_MEMORY=0 bash install.sh

# 不共享 USER.md（仅共享 MEMORY.md + memory/）
YOYOO_TEAM_SHARED_USER=0 bash install.sh
```

本地已运行单实例并要迁移到 CEO+CTO 双实例时，可用：

```bash
bash scripts/local_sync_ceo_cto_shared_memory.sh
```

如需双实例模式（兼容/隔离增强）：

```bash
YOYOO_MODE=dual bash install.sh
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

### 4. 1.0 默认内置（安装即有）

- 默认配置模板：`~/.openclaw/openclaw.json`（含 MiniMax 中国区、QMD、LLMOps 配置位）
- 自动执行 QMD 内置启用（含 `memory.backend=qmd` 配置修正）
- 自动执行 LLMOps 基线安装（LiteLLM/Promptfoo）
- 内置 X 抓取：`~/.openclaw/skills/x-fetcher/fetch_x.py`
- 内置公众号学习：`~/.openclaw/skills/wechat-learning/wechat_search.py`
- 默认开启：`messages.queue.mode = "steer"`
- 内置硬化脚本：`~/.openclaw/workspace/bootstrap/harden_runtime.sh`
- 内置实战手册：`~/.openclaw/workspace/ops/OPENCLAW_REAL_WORK_PLAYBOOK.md`
- 能力文档与脚本：`~/.openclaw/workspace/ops/` 与 `~/.openclaw/workspace/bootstrap/`

### 5. 配置

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

> 说明：`channels` 里通常只先开一个通道（飞书或钉钉），跑通后再加第二个。

### 6. 初始化身份

编辑 workspace 文件：

```bash
# 复制配置模板
cp -r workspace ~/.openclaw/

# 编辑你的身份
nano ~/.openclaw/workspace/IDENTITY.md
nano ~/.openclaw/workspace/USER.md
```

### 7. 启动

```bash
openclaw gateway
```

### 8. 通过飞书/钉钉使用（推荐）

一般用户不直接在终端里操作，而是通过 IM（飞书/钉钉）对话使用 Yoyoo。

1. 在平台创建机器人应用并拿到凭证  
2. 写入 `~/.openclaw/openclaw.json` 的对应通道配置  
3. 启动 `openclaw gateway`  
4. 在群聊或私聊 @机器人发送消息测试

---

最小化通道配置示例（按需二选一）：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "connectionMode": "websocket",
      "dmPolicy": "open",
      "groupPolicy": "open",
      "requireMention": false,
      "appId": "你的飞书 App ID",
      "appSecret": "你的飞书 App Secret"
    },
    "dingtalk": {
      "enabled": false,
      "clientId": "你的钉钉 Client ID",
      "clientSecret": "你的钉钉 Client Secret",
      "robotCode": "你的钉钉 Robot Code",
      "corpId": "你的钉钉 Corp ID",
      "agentId": "你的钉钉 Agent ID"
    }
  }
}
```

---

快速排障：

- 收不到回复：先检查 `openclaw gateway` 是否在运行。  
- 401/鉴权失败：优先检查模型 key 与通道凭证是否填错、是否有空格换行。  
- 群里不回：检查平台侧事件订阅是否开启、群策略是否允许。  
- 通道配置改完后：重启网关再测一次。

## 安装脚本能力（v1.0.5）

| 命令 | 作用 |
|------|------|
| `bash install.sh` | 安装基础包（Bun/OpenClaw/skills/workspace） |
| `bash install.sh --check` | 检查基础包完整性与关键文件 |
| `bash install.sh --rollback` | 回滚到最近一次安装前快照 |

## 版本与主线说明

- GitHub `master` 为主线发布分支（受保护，必须通过 PR 合并）。
- 最近一次主线发布补充说明见：`RELEASE_NOTES_v1.0.5.md`。

如需重跑内置能力，可手动执行：

```bash
bash ~/.openclaw/workspace/bootstrap/enable_qmd.sh
bash ~/.openclaw/workspace/bootstrap/enable_llmops.sh
bash ~/.openclaw/workspace/bootstrap/harden_runtime.sh
```

安装成功后会生成安装清单：

```text
~/.openclaw/workspace/manifest.json
```

## 配置说明

### 飞书配置

1. 创建飞书应用：https://open.feishu.com/
2. 获取 App ID 和 App Secret
3. 配置事件订阅（长连接）

### 钉钉配置

1. 创建钉钉应用：https://open-dev.dingtalk.com/
2. 获取 `Client ID` / `Client Secret` / `Robot Code` / `Corp ID` / `Agent ID`
3. 在 `openclaw.json` 中填写 `channels.dingtalk` 配置并启用
4. 重启网关后在群聊 @机器人测试

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
| x-fetcher | 抓取 X(Twitter) 帖子与长文 |
| wechat-learning | 微信公众号搜索与正文学习 |

## 文档

- [OpenClaw文档](https://docs.openclaw.ai)
- [飞书配置指南](https://docs.openclaw.ai/channels/feishu)
- [公共知识库（外部优质资源索引）](knowledge/README.md)
- [Yoyoo进阶学习路线（2026Q1）](knowledge/2026Q1_进阶学习路线.md)
- [运维手册](docs/OPERATIONS.md)
- [升级策略](docs/UPGRADE_POLICY.md)
- [员工模板](docs/EMPLOYEE_TEMPLATE.md)

## 工程治理（P0-P3）

- CI 质量闸门：`.github/workflows/quality-gate.yml`
- 安全扫描：`.github/workflows/security-gitleaks.yml`
- 发布流程：`.github/workflows/release.yml`（tag `v*` 自动发布）
- 预检脚本：`scripts/preflight.sh`
- 发布后巡检：`scripts/post_deploy_check.sh`
- 一键回滚：`scripts/rollback_to_tag.sh`
- 主分支保护脚本：`scripts/set_branch_protection.sh`

## License

MIT
