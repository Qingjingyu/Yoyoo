# OpenClaw 调研报告

> **调研日期**: 2026-01-31
> **调研目标**: 评估 OpenClaw 作为 Yoyoo Body 方案的可行性

---

## 1. 项目概述

### 1.1 基本信息

| 项目 | OpenClaw |
|------|----------|
| **定位** | Personal AI Assistant (个人AI助手) |
| **口号** | "Your own personal AI assistant. Any OS. Any Platform. The lobster way." |
| **许可证** | MIT License |
| **官网** | openclaw.ai |
| **文档** | docs.openclaw.ai |
| **仓库** | github.com/openclaw/openclaw |

### 1.2 核心理念

**"任何操作系统、任何平台都可以运行的个人AI助手"**

OpenClaw 不是一个独立的 AI 产品，而是一个**本地优先的 AI 助手控制平面 (Gateway)**。它的核心价值是让 AI 助手能够通过用户已有的各种即时通讯渠道与用户交互。

### 1.3 与 Yoyoo 的定位对比

| 维度 | Yoyoo | OpenClaw |
|------|-------|----------|
| **产品形态** | 独立的 AI Agent Platform | Gateway 控制平面 |
| **用户交互** | Web 后台 + IM 接入 | 本身就是 IM 客户端 |
| **架构** | Python Brain + Node.js Body | Node.js Gateway + 多渠道 |
| **AI 集成** | 待集成 (Cortex/Planner/Memory) | 无内置 AI，需外接 |

---

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        OpenClaw Gateway                          │
│  ┌──────────┬──────────┬──────────┬──────────┬──────────┐     │
│  │ 会话管理  │ 渠道管理  │ 工具管理  │ 事件总线  │ 技能平台  │     │
│  └──────────┴──────────┴──────────┴──────────┴──────────┘     │
│                         WebSocket :18789                         │
└─────────────────────────────────────────────────────────────────┘
        │                           │                   │
        ▼                           ▼                   ▼
┌──────────────┐        ┌─────────────────┐   ┌──────────────┐
│  多渠道接入   │        │   Pi Agent      │   │  本地节点    │
│  - WhatsApp  │        │   (RPC)         │   │  - macOS     │
│  - Telegram  │        │   - 工具流       │   │  - iOS       │
│  - Slack     │        │   - 块流         │   │  - Android   │
│  - Discord   │        │   - CLI/WebChat │   │              │
│  - Signal    │        │                 │   │              │
│  - iMessage  │        └─────────────────┘   └──────────────┘
│  - ...       │
└──────────────┘
```

### 2.2 核心组件

| 组件 | 说明 |
|------|------|
| **Gateway** | 单点控制平面，管理会话、渠道、工具和事件 |
| **Pi Agent** | RPC 模式运行，提供工具流和块流 |
| **Channels** | 多渠道集成，通过各平台 SDK 连接 |
| **Nodes** | 设备节点，提供本地功能（相机、屏幕、位置等） |
| **Canvas** | 可视化工作空间，支持 A2UI 协议 |
| **Skills** | 技能平台，可扩展工具 |

### 2.3 技术栈

| 类别 | 技术选择 |
|------|----------|
| **运行时** | Node.js ≥22 |
| **包管理** | pnpm (推荐)、npm、bun |
| **语言** | TypeScript |
| **框架** | React、Node.js |
| **测试** | Vitest |

### 2.4 渠道集成库

| 平台 | 库 |
|------|-----|
| WhatsApp | Baileys |
| Telegram | grammY |
| Slack | Bolt |
| Discord | discord.js |
| Signal | signal-cli |
| iMessage | imsg |
| Teams | 官方 API |
| Google Chat | 官方 API |

---

## 3. 核心功能

### 3.1 多渠道通讯

OpenClaw 的核心优势之一是**广泛的渠道支持**：

| 渠道 | 支持情况 | 说明 |
|------|----------|------|
| WhatsApp | ✅ | 稳定可用 |
| Telegram | ✅ | 稳定可用 |
| Slack | ✅ | 稳定可用 |
| Discord | ✅ | 稳定可用 |
| Google Chat | ✅ | 稳定可用 |
| Signal | ✅ | 稳定可用 |
| iMessage | ✅ | 需 macOS |
| Microsoft Teams | ✅ | 扩展支持 |
| BlueBubbles | ✅ | 扩展支持 |
| Matrix | ✅ | 扩展支持 |
| Zalo | ✅ | 扩展支持 |
| WebChat | ✅ | 内置支持 |

### 3.2 AI 交互方式

```
1. CLI 交互
   $ openclaw agent --message "Hello"

2. WebChat UI
   内置 Web 界面

3. macOS 菜单栏应用
   系统级集成

4. iOS/Android 节点
   移动端远程控制
```

### 3.3 工具系统

| 类别 | 工具 |
|------|------|
| **浏览器控制** | Chrome/Chromium via CDP |
| **可视化** | Canvas + A2UI |
| **设备节点** | 相机快照、屏幕录制、位置获取、通知 |
| **调度** | 定时任务、Webhooks |
| **扩展** | Skills 技能平台 |

### 3.4 语音功能

| 功能 | 说明 |
|------|------|
| Voice Wake | 语音唤醒 |
| Talk Mode | 对话模式 |
| TTS | ElevenLabs 语音合成 |

### 3.5 远程访问

| 方式 | 说明 |
|------|------|
| Tailscale Serve | 基于 Tailscale 的远程访问 |
| Tailscale Funnel | 公网入口 |
| SSH 隧道 | 传统 SSH 方式 |
| 设备配对 | macOS/iOS/Android 远程配对 |

---

## 4. 安全模型

### 4.1 默认安全策略

| 策略 | 说明 |
|------|------|
| **DM 配对模式** | 默认需手动批准 (pairing) |
| **Docker 沙箱** | 非 main 会话可配置隔离 |
| **TCC 权限** | 敏感操作需用户授权 |

### 4.2 安全考虑

- **本地优先**: 数据默认存储在本地
- **渠道隔离**: 各渠道会话独立
- **权限控制**: 敏感操作需确认

---

## 5. 部署方式

### 5.1 推荐安装

```bash
# 全局安装
npm install -g openclaw@latest
# 或
pnpm add -g openclaw@latest

# 安装并启动守护进程
openclaw onboard --install-daemon

# 启动 Gateway
openclaw gateway --port 18789 --verbose
```

### 5.2 从源码开发

```bash
git clone https://github.com/openclaw/openclaw.git
cd openclaw
pnpm install
pnpm ui:build
pnpm build
pnpm openclaw onboard --install-daemon
pnpm gateway:watch
```

### 5.3 Docker 部署

```bash
# 单容器
docker build -t openclaw .

# docker-compose (需自行编写)
```

### 5.4 发布通道

| 通道 | 说明 |
|------|------|
| stable | 正式发布版 (npm latest) |
| beta | 预发布版 (npm beta) |
| dev | 主干开发版 (npm dev) |

---

## 6. 代码结构

```
openclaw/
├── .agent/workflows/     # CI/CD 工作流
├── .github/              # GitHub 配置
├── apps/                 # 应用程序
├── assets/               # 静态资源
├── docs/                 # 文档
├── extensions/           # 扩展模块
├── packages/             # NPM 包
├── skills/               # 技能模块
├── src/                  # 源代码
├── test/                 # 测试
├── ui/                   # UI 组件
├── vendor/a2ui/          # 第三方 UI 库
├── .env.example          # 环境变量示例
├── package.json          # 项目配置
├── pnpm-lock.yaml        # 锁定文件
├── tsconfig.json         # TypeScript 配置
├── vitest.*.config.ts    # 测试配置
└── Dockerfile            # Docker 镜像
```

---

## 7. 与 Yoyoo 的集成可行性分析

### 7.1 集成可能性

| 维度 | 评估 | 说明 |
|------|------|------|
| **架构匹配** | ⭐⭐⭐⭐⭐ | Gateway + WebSocket 与 Yoyoo 设计高度一致 |
| **Body 功能** | ⭐⭐⭐⭐⭐ | 多渠道、设备控制、浏览器等已完备 |
| **AI 集成** | ⭐⭐⭐⭐☆ | 无内置 AI，需外接 Yoyoo Brain |
| **协议兼容** | ⭐⭐⭐⭐⭐ | JSON-RPC 协议清晰 |
| **开源协议** | ⭐⭐⭐⭐⭐ | MIT License，可自由使用 |

### 7.2 集成方案

**方案 A: OpenClaw 作为 Yoyoo Body**

```
Yoyoo Brain (Python)  ←→  WebSocket  ←→  OpenClaw Gateway
                       (JSON-RPC)
```

**连接方式**:
```json
{
  "type": "req",
  "id": "init-1",
  "method": "connect",
  "params": {
    "client": {
      "id": "yoyoo-brain",
      "version": "0.1.0",
      "displayName": "Yoyoo Brain Kernel"
    },
    "role": "operator",
    "scopes": ["operator.admin", "operator.read", "operator.write"],
    "auth": { "token": "YOUR_TOKEN" }
  }
}
```

### 7.3 优势与挑战

| 优势 | 挑战 |
|------|------|
| ✅ 功能完备，开箱即用 | ⚠️ Node.js 运行时 vs Python 生态 |
| ✅ 多渠道支持，无需重复造轮子 | ⚠️ 需适配 OpenClaw 的工具调用方式 |
| ✅ 活跃开发，持续更新 | ⚠️ 依赖外部项目，需跟进版本 |
| ✅ 本地优先，隐私友好 | ⚠️ 需评估长期维护风险 |
| ✅ 社区活跃，文档完善 | |

---

## 8. 结论与建议

### 8.1 总体评估

**OpenClaw 是一个成熟的多渠道 AI Gateway 项目，与 Yoyoo 的 Body 设计高度契合。**

### 8.2 推荐决策

| 决策点 | 建议 |
|--------|------|
| **是否采用 OpenClaw 作为 Body** | ✅ **推荐** - 功能完备，架构匹配 |
| **集成优先级** | 🔥 高优先级 - 可快速获得多渠道能力 |
| **后续动作** | 深入研究集成方案、进行 POC 验证 |

### 8.3 下一步行动

1. [ ] 本地安装 OpenClaw 进行实测
2. [ ] 测试 WebSocket 连接和 JSON-RPC 协议
3. [ ] 验证核心功能（消息收发、工具调用）
4. [ ] 评估性能和稳定性
5. [ ] 制定集成路线图

---

## 9. 参考链接

| 资源 | 链接 |
|------|------|
| 项目仓库 | https://github.com/openclaw/openclaw |
| 官网 | https://openclaw.ai |
| 文档 | https://docs.openclaw.ai |
| 安装文档 | https://docs.openclaw.ai/install |
| Docker 部署 | https://docs.openclaw.ai/install/docker |

---

> **报告版本**: 1.0
> **调研人**: Yoyoo
> **最后更新**: 2026-01-31
