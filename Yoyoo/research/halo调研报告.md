# Halo 调研报告

> **调研日期**: 2026-01-31
> **调研目标**: 评估 Halo 作为 Yoyoo 参考/竞品/集成对象的可行性

---

## 1. 项目概述

### 1.1 基本信息

| 项目 | Halo |
|------|------|
| **定位** | 开源 Claude Code 图形界面 |
| **口号** | "Wrap complex technology into intuitive human interaction" |
| **许可证** | MIT License |
| **官网** | hello-halo.cc |
| **仓库** | github.com/openkursar/hello-halo |
| **Stars** | 419 |
| **最新版本** | v1.2.10 (2026-01-18) |

### 1.2 核心理念

**"将复杂技术包装成直观的人机交互"**

Halo 是一个开源的 Claude Code 图形界面项目，定位为"面向所有人的开源协作工具"。它将 Claude Code 的强大 Agent 能力封装成可视化界面，让非技术用户也能轻松使用 AI 进行开发工作。

### 1.3 与 Yoyoo 的关系

| 维度 | Yoyoo | Halo |
|------|-------|------|
| **产品形态** | Web 后台 + 多用户平台 | 桌面应用 (Electron) |
| **核心能力** | 7x24 自动干活、协作网络 | Claude Code Agent |
| **用户交互** | IM + Web 管理 | GUI 桌面界面 |
| **多用户** | 支持（注册/登录） | 单用户本地运行 |
| **集成能力** | Body (Clawdbot/OpenClaw) | MCP 支持 |

### 1.4 重要发现

**Yoyoo 项目中存在 `.halo/` 目录**，这意味着：
- 可能是之前使用 Halo 的痕迹
- 或者 Halo 的数据格式可供参考

---

## 2. 技术架构

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       Halo Desktop App                          │
│  ┌─────────────┐         ┌─────────────┐    ┌───────────────┐  │
│  │  React UI   │  ◄──►   │    Main     │ ◄─►│ Claude Code   │  │
│  │ (Renderer)  │   IPC   │  Process    │    │    SDK        │  │
│  └─────────────┘         └─────────────┘    └───────────────┘  │
│                                    │                            │
│                                    ▼                            │
│                           ┌───────────────┐                    │
│                           │  Local Files  │                    │
│                           │  ~/.halo/     │                    │
│                           └───────────────┘                    │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 架构特点

| 特点 | 说明 |
|------|------|
| **100% 本地运行** | 数据仅在本地处理（除 API 调用外） |
| **无需后端** | 纯桌面客户端，使用用户自己的 API 密钥 |
| **真正的 Agent 循环** | 支持工具执行，而不仅仅是文本生成 |
| **IPC 通信** | Renderer 与 Main 进程通过 IPC 通信 |

### 2.3 技术栈

| 类别 | 技术选择 |
|------|----------|
| **语言** | TypeScript (96%) |
| **前端框架** | React |
| **桌面框架** | Electron |
| **构建工具** | Vite |
| **样式** | Tailwind CSS |
| **国际化** | i18next |
| **测试** | 已配置 |

### 2.4 代码结构

```
hello-halo/
├── .github/              # GitHub 配置
├── .vscode/              # VSCode 配置
├── docs/                 # 多语言文档
├── patches/              # 补丁
├── resources/            # 图标等资源
├── scripts/              # 脚本
├── src/                  # 源代码
├── tests/                # 测试
├── .env.example          # 环境变量示例
├── electron.vite.config.ts  # Electron + Vite 配置
├── package.json
├── tailwind.config.cjs   # Tailwind CSS 配置
├── tsconfig.json         # TypeScript 配置
└── tsconfig.web.json     # Web TypeScript 配置
```

---

## 3. 核心功能

### 3.1 功能列表

| 功能模块 | 描述 |
|---------|------|
| **Real Agent Loop** | 真正的 Agent 循环，可执行代码、创建文件、运行命令 |
| **Space System** | 隔离的工作空间，每个 Space 有独立的文件、对话和上下文 |
| **Artifact Rail** | 实时预览 AI 创建的所有文件（代码、HTML、图像等） |
| **Remote Access** | 从手机或浏览器远程控制桌面 Halo |
| **AI Browser** | AI 控制嵌入式浏览器，支持网页抓取、表单填写、测试等 |
| **MCP Support** | 支持 Model Context Protocol，兼容 Claude Desktop MCP 服务器 |

### 3.2 其他特性

- ✅ 多提供商支持（Anthropic、OpenAI、DeepSeek 等）
- ✅ 实时思考可视化
- ✅ 工具权限管理
- ✅ 暗/亮主题
- ✅ 国际化支持（英、中、西等语言）
- ✅ 自动更新

### 3.3 Space System 详解

**这是最值得参考的功能之一：**

```
┌─────────────────────────────────────────────────────┐
│                   Halo Desktop                       │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐         │
│  │  Space 1  │ │  Space 2  │ │  Space 3  │  ...    │
│  │  项目 A   │ │  个人助理  │ │  数据分析  │         │
│  └─────┬─────┘ └─────┬─────┘ └─────┬─────┘         │
│        │             │             │                │
│        └─────────────┴─────────────┘                │
│                    │                                │
│              独立的文件、对话、上下文                 │
└─────────────────────────────────────────────────────┘
```

**与 Yoyoo 的多租户对比：**

| 维度 | Halo Space | Yoyoo Tenant |
|------|------------|--------------|
| 隔离级别 | 文件、对话、上下文 | 用户、数据、配置 |
| 用途 | 不同项目/场景 | 不同用户 |
| 管理 | 本地创建/切换 | 注册/登录系统 |
| 共享 | 不支持 | 支持协作 |

---

## 4. 部署方式

### 4.1 桌面应用下载

| 平台 | 下载 | 要求 |
|------|------|------|
| macOS | .dmg | macOS 11+ |
| Windows | .exe | Windows 10+ |
| Linux | .AppImage | Ubuntu 20.04+ |

### 4.2 Web 远程访问

启用远程访问后，可从手机或浏览器控制桌面 Halo。

### 4.3 源码构建

```bash
git clone https://github.com/openkursar/hello-halo.git
cd hello-halo
npm install
npm run dev
```

---

## 5. 与 Yoyoo 的集成可行性分析

### 5.1 集成可能性

| 维度 | 评估 | 说明 |
|------|------|------|
| **架构参考** | ⭐⭐⭐⭐⭐ | Electron + React 架构可参考 |
| **UI 设计** | ⭐⭐⭐⭐⭐ | Space System、Artifact Rail 可借鉴 |
| **MCP 集成** | ⭐⭐⭐⭐⭐ | MCP 支持，可作为工具集成方式 |
| **集成可能性** | ⭐⭐⭐☆☆ | 纯桌面应用，集成意义不大 |

### 5.2 可借鉴的设计

| 功能 | Yoyoo 是否可借鉴 | 说明 |
|------|------------------|------|
| **Space System** | ✅ 是 | 可参考 Yoyoo 的 Space/工作空间设计 |
| **Artifact Rail** | ✅ 是 | 可用于 Yoyoo 的结果预览 |
| **Real Agent Loop** | ✅ 是 | Yoyoo 正在实现相同能力 |
| **Remote Access** | ✅ 是 | 可参考 Yoyoo 的远程访问设计 |
| **MCP Support** | ✅ 是 | 可作为 Yoyoo 的工具协议 |

### 5.3 对比总结

| 维度 | Yoyoo | Halo |
|------|-------|------|
| **目标用户** | 普通用户 + 团队 | 开发者 |
| **产品形态** | Web 平台 + IM 接入 | 桌面应用 |
| **运行方式** | 云端/本地服务器 | 本地桌面 |
| **多用户** | ✅ 支持 | ❌ 单用户 |
| **协作** | ✅ 多代理网络 | ❌ 无 |
| **自动化** | ✅ 7x24 自动 | ❌ 需手动触发 |

---

## 6. 关键发现：`.halo/` 目录

Yoyoo 项目中存在 `.halo/` 目录，说明：

### 6.1 可能的历史

1. **之前使用 Halo**：苏白可能之前使用过 Halo 进行开发
2. **对话数据迁移**：`.halo/conversations/` 中可能包含之前的对话历史
3. **数据格式参考**：Halo 的数据格式可供参考

### 6.2 `.halo/` 目录结构

```
.halo/
├── conversations/         # 对话历史
│   ├── index.json
│   └── *.json             # 对话记录
└── meta.json              # 元信息
```

### 6.3 后续建议

- [ ] 检查 `.halo/` 中的对话历史是否需要保留
- [ ] 分析 Halo 的数据格式是否可复用
- [ ] 决定是否彻底迁移到 Yoyoo 自己的数据格式

---

## 7. 结论与建议

### 7.1 总体评估

**Halo 是一个设计精良的 Claude Code 桌面客户端，与 Yoyoo 定位不同，但有很高的参考价值。**

### 7.2 推荐决策

| 决策点 | 建议 |
|--------|------|
| **是否采用 Halo 作为 Body** | ❌ 不适用 - Halo 不是 Body 方案 |
| **是否参考 UI 设计** | ✅ **强烈推荐** - Space System、Artifact Rail |
| **是否集成 Halo** | ❌ 无需集成 - 产品定位不同 |
| **是否保留 `.halo/` 数据** | 🔍 待确认 - 检查是否有价值的数据 |

### 7.3 可借鉴的设计模式

1. **Space System**: Yoyoo 的"工作空间"概念可参考
2. **Artifact Rail**: 结果预览和展示方式可参考
3. **工具权限管理**: MCP 工具的权限控制可参考
4. **实时可视化**: Agent 执行过程的实时展示可参考

### 7.4 下一步行动

1. [ ] 检查 `.halo/` 目录中的历史数据
2. [ ] 深入研究 Space System 设计
3. [ ] 考虑在 Yoyoo 中引入类似的工作空间概念
4. [ ] 研究 MCP 协议作为 Yoyoo 工具集成方式

---

## 8. 参考链接

| 资源 | 链接 |
|------|------|
| 项目仓库 | https://github.com/openkursar/hello-halo |
| 官网 | https://hello-halo.cc |
| 下载地址 | https://hello-halo.cc/download |
| 多语言文档 | docs/ 目录下 |

---

## 附录：数据格式参考

### 对话历史格式

```json
{
  "index": {
    "version": 1,
    "conversations": ["uuid-1", "uuid-2"]
  },
  "uuid-1": {
    "title": "对话标题",
    "created_at": "2026-01-01T00:00:00.000Z",
    "updated_at": "2026-01-01T00:00:00.000Z",
    "messages": [...]
  }
}
```

---

> **报告版本**: 1.0
> **调研人**: Yoyoo
> **最后更新**: 2026-01-31
