# Yoyoo 协作协议设计

> **创建日期**: 2026-01-31
> **状态**: Draft
> **关联**: YOYOO_PRODUCT_DESIGN.md §5.1

---

## 1. 设计理念

### 1.1 核心原则

| 原则 | 说明 |
|------|------|
| **外交式通讯** | 拒绝"强制写入"，采用协商机制 |
| **主权尊重** | 每个 Yoyoo 代表其主人，需获得主人确认 |
| **幂等性** | 消息可重复发送，防止丢包导致的状态不一致 |
| **可追溯** | 所有协作有审计日志，支持问题排查 |

### 1.2 协作模式

```
┌─────────────────────────────────────────────────────────┐
│                    协作模式                              │
├─────────────────────────────────────────────────────────┤
│  1:1 协作     │  A → B  (点对点任务派发)                 │
│  1:N 广播     │  A → [B, C, D]  (任务分发)               │
│  N:1 汇总     │  [A, B, C] → D  (汇总报告)               │
│  N:N 网状     │  群聊中多 Bot 协作                       │
└─────────────────────────────────────────────────────────┘
```

---

## 2. 消息格式规范

### 2.1 基础消息结构

```json
{
  "version": "1.0",
  "msg_id": "msg_xxx_xxx",
  "timestamp": "2026-01-31T12:00:00Z",
  "from": {
    "instance_id": "inst_a_123",
    "user_id": "user_alpha"
  },
  "to": {
    "instance_id": "inst_b_456",
    "user_id": "user_beta"
  },
  "type": "task_proposal",
  "payload": {},
  "context": {
    "conversation_id": "conv_001",
    "parent_msg_id": null,
    "priority": "normal",
    "deadline": "2026-02-03T18:00:00Z"
  },
  "security": {
    "signature": "base64_sign",
    "token": "jwt_token"
  }
}
```

### 2.2 消息类型定义

| 类型 | 方向 | 说明 |
|------|------|------|
| `task_proposal` | A → B | 任务提议 |
| `task_response` | B → A | 任务响应（ACK/REJECT/NEGOTIATE） |
| `task_update` | A ↔ B | 任务状态更新 |
| `task_cancel` | A → B | 取消任务 |
| `negotiation` | A ↔ B | 协商来回 |
| `result_report` | B → A | 结果汇报 |
| `sync_request` | A ↔ B | 同步请求 |
| `heartbeat` | A ↔ B | 心跳保活 |

### 2.3 任务响应格式

```json
{
  "type": "task_response",
  "payload": {
    "original_proposal_id": "msg_xxx",
    "status": "ack",  // ack | reject | negotiate
    "reason": null,
    "negotiation": {
      "suggested_deadline": "2026-02-04T18:00:00Z",
      "reason": "明天已有3个高优先级任务"
    },
    "estimated_completion": "2026-02-04T12:00:00Z"
  }
}
```

---

## 3. 协作状态机

### 3.1 任务生命周期

```
┌─────────────────────────────────────────────────────────────────┐
│                      任务状态机                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  [DRAFT] ──→ [PENDING] ──→ [ASSESSING] ──→ [NEGOTIATING]       │
│     │              │               │              │             │
│     │              │               │              ↓             │
│     │              │               └──────→ [ACCEPTED]          │
│     │              │                          │    │            │
│     │              │                          ↓    ↓            │
│     │              │                   [IN_PROGRESS]            │
│     │              │                          │                 │
│     │              │              ┌───────────┴───────────┐     │
│     │              │              ↓                       ↓     │
│     │              │       [COMPLETED]              [FAILED]    │
│     │              │              │                       │     │
│     │              └──────────────┴───────────────────────┘     │
│     │                              │                            │
│     ↓                              ↓                            │
│  [CANCELLED]               [REPORTED]                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 状态说明

| 状态 | 说明 | 触发条件 |
|------|------|----------|
| DRAFT | 草稿 | 用户创建任务，还未发送 |
| PENDING | 待处理 | 发起方已发送，等待响应 |
| ASSESSING | 评估中 | 接收方正在评估 |
| NEGOTIATING | 协商中 | 双方协商截止时间 |
| ACCEPTED | 已接受 | 接收方确认任务 |
| IN_PROGRESS | 进行中 | 任务执行中 |
| COMPLETED | 已完成 | 任务完成 |
| FAILED | 失败 | 任务执行失败 |
| REPORTED | 已汇报 | 结果已汇报给发起方 |
| CANCELLED | 已取消 | 发起方取消任务 |

---

## 4. API 端点设计

### 4.1 REST API

```
基础路径: /api/v1/collaboration

┌────────────────────────────────────────────────────────────┐
│  方法   │  路径                       │  说明              │
├────────────────────────────────────────────────────────────┤
│  POST   │  /messages/send             │  发送协作消息       │
│  POST   │  /messages/broadcast        │  广播消息          │
│  GET    │  /messages/inbox            │  接收消息列表      │
│  GET    │  /messages/:msg_id         │  获取单条消息      │
│  POST   │  /messages/:msg_id/respond  │  响应消息          │
│  GET    │  /tasks                     │  任务列表          │
│  GET    │  /tasks/:task_id           │  任务详情          │
│  PATCH  │  /tasks/:task_id/status    │  更新任务状态      │
│  GET    │  /network                   │  协作网络拓扑      │
│  GET    │  /network/:instance_id     │  指定实例信息      │
│  GET    │  /history                   │  协作历史          │
└────────────────────────────────────────────────────────────┘
```

### 4.2 WebSocket 事件

```
┌────────────────────────────────────────────────────────────┐
│  事件                     │  说明                          │
├────────────────────────────────────────────────────────────┤
│  collab:message          │  收到新消息                     │
│  collab:proposal         │  收到任务提议                   │
│  collab:response         │  收到响应                       │
│  collab:update           │  任务状态更新                   │
│  collab:negotiate        │  协商请求                       │
│  collab:result           │  结果汇报                       │
└────────────────────────────────────────────────────────────┘
```

### 4.3 请求/响应示例

**发送任务提议：**
```bash
POST /api/v1/collaboration/messages/send
{
  "to_instance_id": "inst_b_456",
  "type": "task_proposal",
  "payload": {
    "title": "完成 API 设计文档",
    "description": "根据会议讨论，完成 REST API 设计",
    "deadline": "2026-02-03T18:00:00Z",
    "priority": "high",
    "metadata": {
      "project": "Yoyoo V2.0",
      "category": "documentation"
    }
  }
}
```

**响应任务提议：**
```bash
POST /api/v1/collaboration/messages/msg_xxx/respond
{
  "status": "negotiate",
  "negotiation": {
    "suggested_deadline": "2026-02-04T18:00:00Z",
    "reason": "明天已有2个高优先级任务，建议推迟一天"
  }
}
```

---

## 5. 协作总线 (CollaborateBus)

### 5.1 核心组件

```python
class CollaborateBus:
    """协作总线 - 代理间消息路由"""

    async def route_message(self, message: Message) -> bool:
        """路由消息到目标实例"""

    async def broadcast(self, sender_id: str, message: Message, recipients: List[str]) -> Dict:
        """广播消息"""

    async def create_room(self, participants: List[str]) -> str:
        """创建协作房间"""

    async def add_participant(self, room_id: str, instance_id: str):
        """添加参与者"""

    async def get_room_history(self, room_id: str) -> List[Message]:
        """获取房间历史"""
```

### 5.2 消息队列设计

```
┌─────────────────────────────────────────────────────────┐
│                   协作消息队列                           │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐ │
│  │  Incoming   │ →  │  Processing │ →  │  Outgoing   │ │
│  │   Queue     │    │    Queue    │    │   Queue     │ │
│  └─────────────┘    └─────────────┘    └─────────────┘ │
│         ↓                                      ↓        │
│  ┌─────────────────────────────────────────────────┐   │
│  │              Dead Letter Queue                  │   │
│  │         (重试失败的消息，告警 + 人工介入)        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 6. 错误处理与重试

### 6.1 重试策略

| 错误类型 | 重试次数 | 间隔策略 |
|---------|---------|---------|
| 网络超时 | 3 次 | 指数退避 (1s, 2s, 4s) |
| 目标离线 | 5 次 | 固定间隔 (30s) + 离线通知 |
| 权限拒绝 | 0 次 | 立即返回错误 |
| 服务不可用 | 3 次 | 指数退避 + 告警 |

### 6.2 死锁预防

```python
class DeadlockPrevention:
    """死锁预防机制"""

    async def check_deadlock(self, task_id: str) -> bool:
        """检查是否有死锁风险"""

    async def resolve_deadlock(self, task_id: str):
        """解决死锁"""
```

**死锁解决策略：**
1. **超时释放**: 任务等待超过阈值自动释放
2. **优先级仲裁**: 高优先级任务获得优先资源
3. **人工介入**: 发送告警给双方主人
4. **回退机制**: 降级为串行执行

### 6.3 消息去重

```python
class MessageDeduplicator:
    """消息去重"""

    def is_duplicate(self, msg_id: str) -> bool:
        """检查消息是否已处理"""

    def mark_processed(self, msg_id: str):
        """标记消息已处理"""
```

使用 `msg_id + from + to` 组合作为去重键，保留 24 小时。

---

## 7. 审计与可观测性

### 7.1 协作日志

```json
{
  "log_id": "log_xxx",
  "timestamp": "2026-01-31T12:00:00Z",
  "action": "message_sent",
  "instance_id": "inst_a_123",
  "msg_id": "msg_xxx",
  "to_instance_id": "inst_b_456",
  "type": "task_proposal",
  "status": "delivered",
  "latency_ms": 150
}
```

### 7.2 监控指标

| 指标 | 说明 | 告警阈值 |
|------|------|----------|
| collab_msg_total | 消息总数 | - |
| collab_msg_latency | 消息延迟 | > 5s |
| collab_task_pending | 待处理任务数 | > 100 |
| collab_deadlock_count | 死锁次数 | > 0 |
| collab_failed_rate | 失败率 | > 5% |

---

## 8. 安全性

### 8.1 认证

```python
class CollaborationAuth:
    """协作认证"""

    async def verify_message(self, message: Message) -> bool:
        """验证消息签名"""

    async def check_permission(self, from_id: str, to_id: str, action: str) -> bool:
        """检查协作权限"""
```

### 8.2 权限控制

| 权限 | 说明 |
|------|------|
| collab:send | 发送协作消息 |
| collab:receive | 接收协作消息 |
| collab:broadcast | 广播消息 |
| collab:admin | 管理协作网络 |

---

## 9. 未来扩展

- [ ] 支持多人实时协作编辑
- [ ] 支持语音/视频协作
- [ ] 支持跨平台协作（不同 LLM 提供商的 Yoyoo）
- [ ] 支持协作模板
- [ ] 支持 AI 驱动的任务分配优化

---

## 10. 参考

- OpenClaw 任务派发机制
- Moltbot 协作总线设计
- Slack API / Discord API 消息协议
