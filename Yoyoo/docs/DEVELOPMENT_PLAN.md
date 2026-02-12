# Yoyoo 开发规划

> 版本: 1.0 | 创建: 2026-02-01 | 状态: 规划中

---

## 1. 当前状态

### 已完成 ✅

| 模块 | 文件 | 状态 |
|------|------|------|
| FastAPI 服务框架 | `temp/main.py` | ✅ |
| MiniMax LLM | `temp/app/services/llm.py` | ✅ |
| 向量记忆 | `temp/app/services/embedding.py` | ✅ |
| 用户认证 | `temp/app/api/users.py` | ✅ |
| 对话 API | `temp/app/api/chat.py` | ✅ |
| WebSocket | `temp/app/services/websocket.py` | ✅ |
| 任务调度 | `temp/app/services/scheduler.py` | ✅ |
| Clawdbot Bridge | `temp/app/services/clawdbot.py` | ✅ |

---

## 2. 待开发模块 (按优先级)

### Phase 1: MVP 核心 (钉钉接入)

| 优先级 | 模块 | 文件 | 说明 | 依赖 |
|--------|------|------|------|------|
| **P0** | 钉钉事件处理 | `services/dingtalk.py` | 接收回调、签名验证、消息解析 | 无 |
| **P0** | 钉钉发送客户端 | `services/dingtalk_client.py` | 发送消息回钉钉 | P0 |
| **P0** | 钉钉 API 端点 | `api/dingtalk.py` | Webhook 端点 | P0 |
| **P1** | IM 用户绑定 | `services/im_user_binder.py` | 钉钉 UserId ↔ Yoyoo User | P0 |
| **P1** | IM 会话管理 | `services/im_session_manager.py` | 多用户/多会话隔离 | P1 |
| **P1** | IM 消息路由器 | `services/im_message_router.py` | 消息路由到 Brain | P1, chat.py |

### Phase 2: 能力增强

| 优先级 | 模块 | 说明 |
|--------|------|------|
| **P2** | Soul 文件加载 | 从 `Yoyoo/soul/` 加载身份配置 |
| **P2** | 记忆管理 API | 记忆 CRUD、分组、标签 |
| **P2** | 对话历史优化 | 自动摘要、上下文压缩 |
| **P3** | 协作协议实现 | Interbot Bus, 任务派发 |
| **P3** | Web 管理前端 | React 管理界面 |

---

## 3. 模块依赖图

```
Phase 1 (MVP)
═══════════════════════════════════════════════════════════

  ┌─────────────────┐
  │  dingtalk.py    │ (P0) 钉钉事件处理
  │  ─────────────  │  • 签名验证
  │  • 事件解析      │  • 消息类型识别
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ dingtalk_client │ (P0) 钉钉发送
  │  ─────────────  │  • 发送消息
  │  • 消息发送 API  │  • 卡片消息
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐    ┌─────────────────┐
  │ im_user_binder  │───►│   users.py      │ (已有)
  │  (P1)           │    └─────────────────┘
  │  • 用户绑定      │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐    ┌─────────────────┐
  │im_session_mgr   │───►│ im_user_binder  │
  │  (P1)           │    └─────────────────┘
  │  • 会话隔离      │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐    ┌─────────────────┐
  │im_message_router│───►│  chat.py        │ (已有)
  │  (P1)           │    └─────────────────┘
  │  • 消息路由      │
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │  chat.py        │ (已有) 对话处理
  └─────────────────┘

Phase 2 (增强)
═══════════════════════════════════════════════════════════

  ┌─────────────────┐    ┌─────────────────┐
  │  Soul 加载器    │───►│  Yoyoo/soul/    │ 灵魂文件
  │  (P2)           │    └─────────────────┘
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐    ┌─────────────────┐
  │ 记忆管理 API    │───►│ embedding.py    │ (已有)
  │  (P2)           │    └─────────────────┘
  └────────┬────────┘
           │
           ▼
  ┌─────────────────┐
  │ 对话历史优化    │ (P2) 摘要、压缩
  └─────────────────┘
           │
           ▼
  ┌─────────────────┐    ┌─────────────────┐
  │ 协作协议实现    │───►│ 协作协议文档    │
  │  (P3)           │    │ YOYOO_COLLABORATION
  └────────┬────────┘    │ _PROTOCOL.md    │
           │             └─────────────────┘
           ▼
  ┌─────────────────┐
  │ Web 管理前端    │ (P3) React/Next.js
  └─────────────────┘
```

---

## 4. 数据库设计

### 4.1 新增表

```sql
-- 1. IM 用户绑定 (钉钉 UserId ↔ Yoyoo User)
CREATE TABLE im_user_bindings (
    id SERIAL PRIMARY KEY,
    yoyoo_user_id INTEGER NOT NULL REFERENCES users(id),
    platform VARCHAR(20) NOT NULL,          -- 'dingtalk'
    platform_user_id VARCHAR(100) NOT NULL, -- 钉钉的 openId/userId
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(platform, platform_user_id)
);

-- 2. IM 会话 (多平台会话管理)
CREATE TABLE im_sessions (
    id SERIAL PRIMARY KEY,
    session_key VARCHAR(200) NOT NULL UNIQUE, -- "{user_id}_{platform}_{conversation_id}"
    yoyoo_user_id INTEGER NOT NULL,
    platform VARCHAR(20) NOT NULL,
    conversation_id VARCHAR(200) NOT NULL,   -- 群ID或私聊ID
    context JSONB DEFAULT '{}',
    last_active_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    INDEX idx_user_platform (yoyoo_user_id, platform)
);

-- 3. IM 消息记录
CREATE TABLE im_messages (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES im_sessions(id),
    direction VARCHAR(10) NOT NULL,          -- 'incoming' | 'outgoing'
    platform VARCHAR(20) NOT NULL,
    content TEXT,
    meta JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 5. 开发顺序

| 步骤 | 任务 | 文件数 | 状态 |
|------|------|--------|------|
| 1 | 数据库迁移脚本 | 1 | ✅ 完成 |
| 2 | 钉钉事件处理服务 | 1 | ✅ 完成 |
| 3 | 钉钉发送客户端 | 1 | ✅ 完成 |
| 4 | 钉钉 API 端点 | 1 | ✅ 完成 |
| 5 | IM 用户绑定服务 | 1 | ✅ 完成 |
| 6 | IM 会话管理服务 | 1 | ✅ 完成 |
| 7 | IM 消息路由器 | 1 | ✅ 完成 |
| 8 | 集成测试 | 1 | ✅ 完成 |

---

## 新增文件

```
temp/
├── migrations/
│   └── 001_im_tables.sql          # ✅ 数据库迁移脚本 (4张表)
├── tests/
│   └── test_im_integration.py     # ✅ 集成测试 (12个测试全部通过)
└── app/
    ├── api/
    │   └── dingtalk.py             # ✅ 钉钉 API 端点
    ├── models/
    │   ├── __init__.py             # ✅ 模型导出
    │   ├── im_models.py            # ✅ IM 模型 (4个类)
    │   └── models.py               # ✅ 更新 User 模型
    ├── services/
    │   ├── dingtalk.py             # ✅ 钉钉事件处理
    │   ├── dingtalk_client.py      # ✅ 钉钉发送客户端
    │   ├── im_user_binder.py       # ✅ IM 用户绑定
    │   ├── im_session_manager.py   # ✅ IM 会话管理
    │   └── im_message_router.py    # ✅ IM 消息路由
```

---

## 6. 关键端口

| 服务 | 端口 | 协议 | 说明 |
|------|------|------|------|
| Yoyoo Manager | 8000 | HTTP | REST API + Webhook |
| Yoyoo WS | 8000 | WebSocket | 实时推送 |
| Clawdbot Gateway | 18789 | WebSocket | JSON-RPC Body 控制 |
| PostgreSQL | 5432 | TCP | 主数据库 |
| Redis | 6379 | TCP | 缓存/队列 |
| ChromaDB | 8001 | HTTP | 向量数据库 |

---

## 7. 多用户/多平台场景

### 场景 1: 群聊中多用户 @Yoyoo

```
钉钉群 (Yoyoo 测试群)
────────────────────────────────────────────────────
苏白: @Yoyoo 今天天气怎么样？
王五: @Yoyoo 帮我查下快递
李四: @Yoyoo 明天会议几点？

→ Yoyoo 依次回复每个人（异步并发处理）
```

### 场景 2: 同个用户多平台

```
苏白的多平台会话
────────────────────────────────────────────────────
📱 钉钉              💬 飞书              🖥️ Web
"早上好" ←───────► "项目进度？" ←─────► "周报呢？"

Session_A1          Session_F1          Session_W1
(dingtalk:...)      (feishu:...)        (web:...)

→ 三个会话独立，记忆共享
```

### 会话唯一键设计

```python
# Session 唯一键 = (user_id, platform, conversation_id)
session_id = f"{user_id}_{platform}_{conversation_id}"
# 例: "user_001_dingtalk_group_12345"
# 例: "user_001_feishu_private_67890"
```

---

## 8. 文件结构

```
temp/
├── app/
│   ├── api/
│   │   ├── dingtalk.py          # (待开发) P0 钉钉 Webhook 端点
│   │   ├── chat.py              # (已有) 对话处理
│   │   └── ...
│   ├── services/
│   │   ├── dingtalk.py          # (待开发) P0 钉钉事件处理
│   │   ├── dingtalk_client.py   # (待开发) P0 钉钉发送客户端
│   │   ├── im_user_binder.py    # (待开发) P1 用户绑定
│   │   ├── im_session_manager.py # (待开发) P1 会话管理
│   │   ├── im_message_router.py # (待开发) P1 消息路由
│   │   ├── llm.py               # (已有) MiniMax
│   │   ├── embedding.py         # (已有) 向量
│   │   └── ...
│   └── ...
├── migrations/
│   └── 001_im_tables.sql        # (待开发) 数据库迁移
└── ...
```

---

> 文档版本: 1.0
> 创建日期: 2026-02-01
> 作者: Yoyoo & 苏白
