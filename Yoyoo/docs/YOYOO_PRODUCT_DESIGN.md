# Yoyoo 产品设计文档 (V2.0)

> **"每个人的数字延伸"** — 一个多用户智能代理协作平台。

---

## 目录

1. [产品愿景](#1-产品愿景)
2. [核心定位](#2-核心定位)
3. [用户场景](#3-用户场景)
4. [系统架构](#4-系统架构)
5. [协作网络](#5-协作网络)
6. [技术架构](#6-技术架构)
7. [实施路线图](#7-实施路线图)
8. [风险与对策](#8-风险与对策)

---

## 1. 产品愿景

### 1.1 一句话描述

**Yoyoo 是一个"os级别"的个人智能代理平台 —— 不是聊天机器人，而是每个用户的数字延伸。**

用户可以通过注册登录获得自己的 Yoyoo 助手，把资料全部丢给它，它 7x24 小时自动干活。用户可以用自然语言让它做应用、做自媒体、跨团队协作，它会持续进化，越来越懂你。

### 1.2 核心价值

| 价值 | 描述 |
|------|------|
| **数字延伸** | 不是工具，而是你的第二大脑、数字分身 |
| **主动创造** | 被动响应 → 主动在后台干活，创造价值 |
| **持续进化** | 越用越懂你，随时间推移越来越像你 |
| **多代理协作** | Yoyoo 与 Yoyoo 之间可以互相沟通、同步任务 |

### 1.3 商业模式

- **免费层**：基础功能，每用户 1 个 Yoyoo
- **订阅层**：高级功能（更多并发、自定义技能、优先支持）

---

## 2. 核心定位

### 2.1 产品类型

**OS-Level Personal Agent Platform (操作系统级个人代理平台)**

| 对比项 | 传统 Chatbot | Yoyoo |
|--------|-------------|-------|
| 存在形态 | 浏览器标签页 | 系统核心 / 云端服务 |
| 交互方式 | 被动问答 | 主动行动 + 被动响应 |
| 记忆能力 | 会话级 | 长期记忆 + 向量知识库 |
| 执行能力 | 仅回复 | 可执行任务、操作外部系统 |
| 协作能力 | 无 | 多代理网络 |

### 2.2 目标用户

| 用户类型 | 场景 |
|---------|------|
| **个人用户** | 自媒体运营、日常自动化、知识管理 |
| **团队管理者** | 项目进度管理、任务分配、跨部门协调 |
| **企业** | 业务流程自动化、客服助手、知识库建设 |

### 2.3 接入方式

- **Web 管理后台** - 一键打开即可使用
- **钉钉** - 在企业 IM 中直接对话
- **API** - 开发者集成到自有系统

---

## 3. 用户场景

### 3.1 个人助理：自媒体矩阵自动运营

```
场景：用户希望每天早上收到热点整理，并自动发布到各平台

设定：用户配置"关注 AI 领域热点"

后台 (02:00 - 08:00)：
  1. Yoyoo 周期性扫描 Twitter, HackerNews, 公众号
  2. 筛选高热度内容，通过 RAG 结合用户过往观点
  3. 生成 3 篇文案（抖音脚本、公众号文章、推文）

交付 (09:00)：
  用户醒来，手机收到推送："今日热点已整理，请审阅发布"

闭环：
  用户确认后，Yoyoo 调用 API/模拟操作自动分发至各平台
```

### 3.2 快速开发：对话即应用

```
场景：用户需要一个小程序来识别发票

用户指令："做一个快速识别发票的程序"

Yoyoo 动作：
  1. 编写 Python 代码（调用 OCR API）
  2. 在 Sandbox 中测试代码
  3. 将代码封装为一个新的 Skill (Tool)
  4. 即刻起，用户发送发票图片，Yoyoo 自动调用该 Skill 处理

结果：
  用户获得了"发票识别"技能，可随时使用
```

### 3.3 团队协作：智能项目管理

```
场景：项目会议结束后，自动分发任务并跟踪进度

参与者：
  - 总监（1人）- 发起者
  - 员工（5人）- 执行者

会议结束 (11:00)：
  总监说："@Yoyoo 根据会议录音整理 Todo 并分发"

分发流程：
  1. Yoyoo (总监版) 解析录音/脑图，生成 5 份不同的任务单
  2. 通过协作协议发送给 5 个 Yoyoo (员工版)
  3. 各员工 Yoyoo 唤醒主人确认

反馈 (11:05)：
  - 员工 A 的 Yoyoo："A 手头有紧急 Bug，任务排到周三"
  - 员工 B 的 Yoyoo："B 已确认，预计明天交付"

汇总：
  Yoyoo (总监版) 在群里发动态表格：
  "任务分发完毕，异常情况：1/5（员工 A 请求延期）"
```

### 3.4 跨团队协作

```
场景：苏白作为项目总监，想了解每个人每天的进度

苏白的 Yoyoo：
  - 自动在项目群 @ 各成员的 Yoyoo
  - "请汇报今日进度"

各成员的 Yoyoo：
  - 读取主人的今日任务
  - 生成进度摘要
  - 回复到群/私聊

苏白的 Yoyoo：
  - 汇总所有进度
  - 生成日报/进度看板
```

---

## 4. 系统架构

### 4.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                      Yoyoo Platform (云端)                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │                    Yoyoo Manager (控制层)                   │  │
│  │  ┌──────────┬──────────┬──────────┬──────────────────┐    │  │
│  │  │ 用户系统  │ 多租户   │ 权限/协作 │ 调度 & 监控      │    │  │
│  │  │ 注册/登录 │ 数据隔离 │ Agent间通信 │ 心跳 & 告警    │    │  │
│  │  └──────────┴──────────┴──────────┴──────────────────┘    │  │
│  └───────────────────────────────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                   Yoyoo Instances (实例层)                   │ │
│  │   ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐         │ │
│  │   │ 苏白的   │ │ 员工A的 │ │ 员工B的 │ │ 群组    │         │ │
│  │   │ Yoyoo   │ │ Yoyoo   │ │ Yoyoo   │ │ Yoyoo   │         │ │
│  │   └────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘         │ │
│  │        │           │           │           │                │ │
│  │        └───────────┴─────┬─────┴───────────┘                │ │
│  │                          │                                  │ │
│  │              ┌───────────┴───────────┐                      │ │
│  │              │   Interbot Message    │                      │ │
│  │              │   Bus (协作总线)       │                      │ │
│  │              └───────────────────────┘                      │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
        │                           │
        │ WebSocket / API           │ IM Channel
        ▼                           ▼
┌─────────────────┐       ┌─────────────────┐
│  Web 管理后台   │       │ 钉钉            │
│  (一键使用)     │       │ (对话式交互)    │
└─────────────────┘       └─────────────────┘
```

### 4.2 核心组件

| 组件 | 职责 |
|------|------|
| **Yoyoo Manager** | 用户注册/登录、实例生命周期管理、多租户隔离、协作调度 |
| **Yoyoo Instance** | 每个用户的独立代理实例，包含 Brain + Body |
| **Interbot Bus** | 代理间消息路由（派单、催办、协商） |
| **Scheduler** | 定时任务触发（Cron、事件触发） |
| **Sandbox** | 代码执行沙箱（安全隔离） |

### 4.3 实例内部架构 (Centaur)

```
┌─────────────────────────────────────────────────────────────┐
│                    Yoyoo Instance                            │
│  ┌─────────────────┐    WebSocket    ┌───────────────────┐  │
│  │   Brain (Python)│ ◄──────────────►│ Body (Clawdbot)   │  │
│  │  ┌───────────┐  │                 │  ┌─────────────┐  │  │
│  │  │  Cortex   │  │    JSON-RPC     │  │  Gateway    │  │  │
│  │  │ (认知引擎) │  │                 │  │  :18789     │  │  │
│  │  └───────────┘  │                 │  └─────────────┘  │  │
│  │  ┌───────────┐  │                 │  ┌─────────────┐  │  │
│  │  │  Planner  │  │                 │  │ Browser CDP │  │  │
│  │  │ (战略规划) │  │                 │  │ IM Channels │  │  │
│  │  └───────────┘  │                 │  │ System Ops  │  │  │
│  │  ┌───────────┐  │                 │  │ A2UI        │  │  │
│  │  │  Memory   │  │                 │  └─────────────┘  │  │
│  │  │ (三层记忆) │  │                 │                   │  │
│  │  └───────────┘  │                 │                   │  │
│  └─────────────────┘                 └───────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. 协作网络

### 5.1 协作协议：协商机制

在多人协作场景中（如总监 Bot -> 员工 Bot），杜绝"强制写入"，采用"外交式通讯"。

**协作流程：**

```
1. Proposal (提议)
   Bot A 发送任务单结构体（任务内容、期望截止时间）

2. Assessment (评估)
   Bot B 唤醒，读取任务，检查主人（员工 B）的日程和负荷

3. Response (反馈)
   - ACK: 确认接收，返回 ETA（预计完成时间）
   - REJECT: 拒绝（权限不足、负荷过载），附带理由
   - NEGOTIATE: "我今天太忙，能否推迟到明天？"

4. Sync (同步)
   Bot A 收到反馈，更新任务状态
```

**消息格式：**

```json
{
  "from": "instance_uuid_a",
  "to": "instance_uuid_b",
  "type": "task_proposal",
  "payload": {
    "task_id": "task_001",
    "title": "完成 API 设计文档",
    "description": "根据会议讨论，完成 REST API 设计",
    "due_at": "2026-02-03T18:00:00Z",
    "priority": "high",
    "metadata": {}
  }
}
```

### 5.2 混合触发机制

| 触发类型 | 场景 | 说明 |
|---------|------|------|
| **按需唤醒 (Reactive)** | 群里 @Yoyoo、收到私信、API 回调 | 用户主动触发 |
| **主动任务 (Cron)** | 每天 8 点生成日报、每周一生成周报 | 定时触发 |
| **事件触发** | Git Push、收到邮件、定时器 | 外部事件触发 |

### 5.3 对话即应用

用户指令 → Yoyoo 生成代码 → Sandbox 测试 → 封装为 Skill → 即时可用

**示例：**

```
用户："写一个识别发票的小程序"

Yoyoo 动作：
  1. 编写 Python 代码（调用 OCR API）
  2. 在 Sandbox 中测试代码
  3. 将代码封装为一个新的 Skill
  4. 生成 Skill 使用文档

用户即时获得：
  - "发票识别"技能
  - 使用方式："发送发票图片 → 识别结果"
```

---

## 6. 技术架构

### 6.1 技术栈

| 层级 | 技术选择 | 说明 |
|------|---------|------|
| **控制层 (Manager)** | Python (FastAPI) | 用户系统、调度、协作总线 |
| **实例运行** | Clawdbot (Node.js) | 执行网关、浏览器控制 |
| **LLM** | MiniMax M2.1 | 主推理模型 |
| **Embedding** | MiniMax Embedding | 记忆向量化 |
| **IM 集成** | 钉钉 | 国内企业级 IM 入口 |
| **数据库** | PostgreSQL | 用户、任务、消息、日志 |
| **向量库** | ChromaDB / Faiss | 记忆存储与检索 |
| **缓存/队列** | Redis | 消息队列、缓存 |
| **基础设施** | Docker | 沙箱隔离、容器调度 |
| **前端** | React / Next.js | Web 管理后台 |

### 6.2 数据库设计 (核心表)

#### 6.2.1 tenants (租户/用户)

```sql
create table tenants (
  id uuid primary key,
  email text unique not null,
  password_hash text,
  name text,
  plan text default 'free',  -- 'free' | 'pro' | 'enterprise'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### 6.2.2 instances (Yoyoo 实例)

```sql
create table instances (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text,
  desired_state text not null default 'STOPPED',
  actual_state text not null default 'STOPPED',
  config jsonb not null default '{}',
  last_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### 6.2.3 scheduled_tasks (定时任务)

```sql
create table scheduled_tasks (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  instance_id uuid not null references instances(id) on delete cascade,
  name text not null,
  cron text not null,
  timezone text not null default 'UTC',
  enabled boolean not null default true,
  payload jsonb not null default '{}',
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

#### 6.2.4 interbot_messages (代理间消息)

```sql
create table interbot_messages (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  from_instance_id uuid not null references instances(id),
  to_instance_id uuid not null references instances(id),
  topic text not null,
  payload jsonb not null,
  status text not null default 'QUEUED',  -- QUEUED | DELIVERING | DELIVERED | FAILED
  available_at timestamptz not null default now(),
  attempt_count int not null default 0,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
```

### 6.3 API 设计 (REST)

#### 认证
- JWT Bearer Token
- `Authorization: Bearer <token>`

#### 核心端点

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/auth/register` | 用户注册 |
| POST | `/api/v1/auth/login` | 用户登录 |
| GET | `/api/v1/instance` | 获取当前用户的 Yoyoo 实例 |
| POST | `/api/v1/instance:start` | 启动实例 |
| POST | `/api/v1/instance:stop` | 停止实例 |
| GET | `/api/v1/tasks` | 获取定时任务列表 |
| POST | `/api/v1/tasks` | 创建定时任务 |
| POST | `/api/v1/tasks/:id:run` | 手动触发任务 |
| GET | `/api/v1/collaborators` | 获取协作网络 |
| POST | `/api/v1/collaborators/:id:send` | 发送消息给其他 Yoyoo |

#### WebSocket

```
GET /api/v1/ws/instance
  - 实例的实时连接
  - 接收消息、发送指令
```

### 6.4 Clawdbot 集成

通过 WebSocket (默认端口 18789) 连接：

**连接握手：**
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
    "auth": { "token": "YOUR_AUTH_TOKEN" }
  }
}
```

**核心能力：**
- `chat.send` - 发送消息
- `node.invoke` - 调用工具（浏览器、系统操作）
- `cron.*` - 定时任务管理

---

## 7. 实施路线图

### Phase 1: MVP (最小可行产品)

**目标**：验证核心闭环，服务单一用户

| 里程碑 | 内容 |
|--------|------|
| M1 | 用户注册/登录系统 |
| M2 | 单用户 Yoyoo 实例管理（启动/停止） |
| M3 | 基础对话能力 |
| M4 | 定时任务（每日热点抓取） |
| M5 | 钉钉接入 |

**架构**：单机运行，数据库表结构预留多租户字段

### Phase 2: 协作验证

**目标**：验证多用户协作协议

| 里程碑 | 内容 |
|--------|------|
| M1 | 多用户注册与隔离 |
| M2 | 代理间消息总线 |
| M3 | 协商协议实现 |
| M4 | 项目群场景演示 |

### Phase 3: 商业化

**目标**：规模化部署，商业模式验证

| 里程碑 | 内容 |
|--------|------|
| M1 | 订阅系统（免费 → Pro） |
| M2 | 容器化部署（Docker） |
| M3 | 监控与告警系统 |
| M4 | Sandbox 安全加固 |

---

## 8. 风险与对策

### 8.1 信任危机

**风险**：AI 产生幻觉或误操作，导致用户信任崩塌

**对策**：
- **默认草稿**：早期所有对外输出仅生成草稿，必须人工确认
- **敏感词过滤**：输出层增加规则引擎，拦截敏感词
- **操作审计**：记录所有自动操作，支持人工回滚

### 8.2 平台封控

**风险**：频繁调用钉钉、抖音等 API 导致账号被封

**对策**：
- **拟人化操作**：使用 Playwright 等 RPA 技术模拟人类点击
- **频率限制**：严格控制操作频率，模拟人类作息

### 8.3 协作死锁

**风险**：Bot A 等待 Bot B，Bot B 崩溃或无响应，导致任务链卡死

**对策**：
- **TTL (Time To Live)**：所有任务设置超时时间
- **升级机制**：超时未完成的任务，自动发送报警给人类

### 8.4 数据安全

**风险**：用户数据泄露、多租户隔离失效

**对策**：
- **数据加密**：敏感数据加密存储
- **严格隔离**：每个用户的实例独立运行
- **审计日志**：记录所有数据访问

---

## 附录 A：Soul 文件规范

每个 Yoyoo 实例的灵魂文件位于 `soul/` 目录：

| 文件 | 说明 |
|------|------|
| `IDENTITY.md` | 身份定义（名字、性格、头像） |
| `SOUL.md` | 核心价值观与行为准则 |
| `USER.md` | 用户信息（苏白的信息） |
| `AGENTS.md` | 工作空间指南（群聊礼仪、心跳机制） |
| `MEMORY.md` | 长期记忆（核心记忆、重大计划） |
| `HEARTBEAT.md` | 主动检查清单 |
| `TOOLS.md` | 本地工具配置 |

---

## 附录 B：进化日志

所有重大变更记录在 `BRAIN/MEMORY/evolution.json`：

```json
{
  "version": "2.0",
  "evolution_stage": "Phase 1: Planning",
  "events": [
    {
      "id": 1,
      "timestamp": "2026-01-31",
      "type": "design",
      "description": "V2.0 Product Design Document Created",
      "metadata": {
        "scope": "Complete redesign for multi-tenant platform"
      }
    }
  ]
}
```

---

> **文档版本**: 2.0
> **创建日期**: 2026-01-31
> **作者**: Yoyoo & 苏白
> **状态**: Draft - 待评审
