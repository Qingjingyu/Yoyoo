# Yoyoo 技术学习笔记：WebSocket + JSON-RPC

> **学习日期**: 2026-01-31
> **目标**: 理解 OpenClaw/Moltbot 的通信协议，为 Yoyoo Brain 与 Body 的连接做准备

---

## 1. WebSocket 协议

### 1.1 什么是 WebSocket

WebSocket 是一种在单个 TCP 连接上进行全双工通信的协议。

| 特性 | 说明 |
|------|------|
| **全双工** | 客户端和服务器可以同时发送消息 |
| **持久连接** | 建立连接后保持打开，不像 HTTP 那样每次请求都新建连接 |
| **低延迟** | 减少握手开销，适合实时应用 |
| **协议格式** | ws:// 或 wss:// (加密) |

### 1.2 WebSocket vs HTTP

| 维度 | HTTP | WebSocket |
|------|------|-----------|
| 通信模式 | 请求-响应 | 全双工 |
| 连接 | 每次请求新建 | 持久连接 |
| 头部开销 | 大 | 小 |
| 适用场景 | 网页浏览 | 实时应用 |
| 状态 | 无状态 | 有状态 |

### 1.3 WebSocket 生命周期

```
客户端                                    服务器
  │                                        │
  │  ─────── TCP 三次握手 ────────►        │
  │                                        │
  │  ◄────── HTTP Upgrade 请求 ───────     │
  │                                        │
  │  ─────── HTTP 101 Switching ──────►    │
  │         (协议升级)                      │
  │                                        │
  │  ◄──────► 全双工通信 ◄──────►         │
  │      (客户端和服务器随时发送)           │
  │                                        │
  │  ◄────── Close Frame ──────────►       │
  │                                        │
  │  ─────── TCP 四次挥手 ───────────►     │
```

### 1.4 WebSocket 消息格式

**Frame 结构**：
```
  0                   1                   2                   3
  0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-------+-+-------------+-------------------------------+
|F|R|R|R| opcode|M| Payload len |    Extended payload length    |
|I|S|S|S|  (4)  |A|     (7)     |             (16/64)           |
|N|V|V|V|       |S|             |   (if payload len==126/127)  |
| |1|2|3|       |K|             |                               |
+-+-+-+-+-------+-+-------------+-------------------------------+
|     Extended payload length continued, if payload len == 127  |
+-------------------------------------------------------------+
|                               |Masking-key, if MASK set to 1|
+-------------------------------+-------------------------------+
| Masking-key (continued)       |          Payload Data         |
+-------------------------------+-------------------------------+
:                     Payload Data continued ...                :
+-------------------------------------------------------------+
|                     Payload Data continued ...                |
+-------------------------------------------------------------+
```

**Opcode 类型**：
| Opcode | 含义 |
|--------|------|
| 0x0 | 继续帧 (Continuation Frame) |
| 0x1 | 文本帧 (Text Frame) |
| 0x2 | 二进制帧 (Binary Frame) |
| 0x8 | 关闭帧 (Close Frame) |
| 0x9 | Ping 帧 (心跳) |
| 0xA | Pong 帧 (心跳响应) |

---

## 2. JSON-RPC 协议

### 2.1 什么是 JSON-RPC

JSON-RPC 是一个轻量级的远程过程调用 (RPC) 协议，使用 JSON 作为数据格式。

**特点**：
- 简单易懂
- 无状态 (可以同步或异步)
- 支持批量调用
- 广泛支持 (JavaScript, Python, 各种语言)

### 2.2 JSON-RPC 消息类型

#### 请求 (Request)
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "method": "chat.send",
  "params": {
    "to": "whatsapp:+1234567890",
    "message": "Hello from Yoyoo!"
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| jsonrpc | ✅ | 协议版本，通常是 "2.0" |
| id | ✅ | 请求标识符，用于匹配响应 |
| method | ✅ | 要调用的方法名 |
| params | ❌ | 方法参数，可以是对象或数组 |

#### 响应 (Response)

**成功响应**：
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "result": {
    "status": "sent",
    "timestamp": "2026-01-31T10:00:00.000Z"
  }
}
```

**错误响应**：
```json
{
  "jsonrpc": "2.0",
  "id": "req-001",
  "error": {
    "code": -32600,
    "message": "Invalid Request",
    "data": {
      "details": "Missing required parameter: to"
    }
  }
}
```

| 错误码 | 含义 |
|--------|------|
| -32700 | 解析错误 |
| -32600 | 无效请求 |
| -32601 | 方法未找到 |
| -32602 | 参数无效 |
| -32603 | 内部错误 |

#### 通知 (Notification)
```json
{
  "jsonrpc": "2.0",
  "method": "heartbeat",
  "params": {
    "timestamp": "2026-01-31T10:00:00.000Z"
  }
}
```
注意：通知没有 `id`，服务器不需响应。

### 2.3 OpenClaw/Moltbot 的 JSON-RPC 协议

根据调研，OpenClaw 使用以下消息格式：

**连接握手**：
```json
{
  "type": "req",
  "id": "init-1",
  "method": "connect",
  "params": {
    "minProtocol": 1,
    "maxProtocol": 1,
    "client": {
      "id": "yoyoo-brain",
      "version": "0.1.0",
      "platform": "darwin",
      "mode": "backend",
      "displayName": "Yoyoo Brain Kernel"
    },
    "role": "operator",
    "scopes": ["operator.admin", "operator.read", "operator.write"],
    "auth": {
      "token": "YOUR_AUTH_TOKEN"
    }
  }
}
```

**发送消息**：
```json
{
  "type": "req",
  "id": "msg-001",
  "method": "chat.send",
  "params": {
    "to": "whatsapp:+1234567890",
    "message": "Hello!",
    "typing": true
  }
}
```

**接收消息**：
```json
{
  "type": "event",
  "event": "chat.message",
  "payload": {
    "from": "whatsapp:+1234567890",
    "text": "Hey Yoyoo!",
    "attachments": []
  }
}
```

### 2.4 OpenClaw 核心方法

| 方法类别 | 方法名 | 说明 |
|---------|--------|------|
| **Chat** | `chat.send` | 发送消息 |
| | `chat.history` | 获取聊天历史 |
| | `chat.abort` | 中止聊天 |
| **Agents** | `agents.list` | 列出所有 Agent |
| | `agent.identity.get` | 获取 Agent 身份 |
| | `agent.wait` | 等待 Agent 完成 |
| **Sessions** | `sessions.list` | 列出会话 |
| | `sessions.preview` | 预览会话 |
| | `sessions.patch` | 修改会话 |
| | `sessions.reset` | 重置会话 |
| **Config** | `config.get` | 获取配置 |
| | `config.set` | 设置配置 |
| **Cron** | `cron.list` | 列出定时任务 |
| | `cron.add` | 添加定时任务 |
| | `cron.run` | 手动运行定时任务 |
| **Lifecycle** | `health` | 健康检查 |
| | `wake` | 唤醒 |
| | `shutdown` | 关闭 |

---

## 3. 在 Python 中使用 WebSocket + JSON-RPC

### 3.1 WebSocket 客户端 (websockets 库)

```python
import asyncio
import json
from websockets import connect

class ClawdbotBridge:
    def __init__(self, uri="ws://127.0.0.1:18789", token=None):
        self.uri = uri
        self.token = token
        self.websocket = None
        self.request_id = 0

    async def connect(self):
        self.websocket = await connect(self.uri)

        # 发送连接请求
        await self.send_request("connect", {
            "minProtocol": 1,
            "maxProtocol": 1,
            "client": {
                "id": "yoyoo-brain",
                "version": "0.1.0",
                "platform": "darwin",
                "mode": "backend",
                "displayName": "Yoyoo Brain Kernel"
            },
            "role": "operator",
            "scopes": ["operator.admin", "operator.read", "operator.write"],
            "auth": {"token": self.token} if self.token else {}
        })

        # 等待连接响应
        response = await self.recv()
        return response

    async def send_request(self, method, params=None):
        self.request_id += 1
        message = {
            "type": "req",
            "id": str(self.request_id),
            "method": method,
            "params": params or {}
        }
        await self.websocket.send(json.dumps(message))
        return str(self.request_id)

    async def send_notification(self, method, params=None):
        message = {
            "type": "req",  # 或 "event"
            "method": method,
            "params": params or {}
        }
        await self.websocket.send(json.dumps(message))

    async def recv(self):
        message = await self.websocket.recv()
        return json.loads(message)

    async def chat_send(self, to, message, typing=False):
        return await self.send_request("chat.send", {
            "to": to,
            "message": message,
            "typing": typing
        })

    async def close(self):
        if self.websocket:
            await self.websocket.close()

# 使用示例
async def main():
    bridge = ClawdbotBridge(token="YOUR_TOKEN")

    try:
        # 连接
        await bridge.connect()
        print("Connected to Clawdbot!")

        # 发送消息
        await bridge.chat_send("whatsapp:+1234567890", "Hello from Yoyoo!")

        # 接收消息
        while True:
            msg = await bridge.recv()
            print(f"Received: {msg}")

    finally:
        await bridge.close()

asyncio.run(main())
```

### 3.2 JSON-RPC 请求追踪

```python
import asyncio
from typing import Dict, Any, Callable, Optional
from dataclasses import dataclass, field
from enum import Enum
import json

class MessageType(Enum):
    REQUEST = "req"
    RESPONSE = "res"
    EVENT = "event"

@dataclass
class RPCRequest:
    id: str
    method: str
    params: Dict[str, Any]
    type: MessageType = MessageType.REQUEST

@dataclass
class RPCResponse:
    id: str
    ok: bool
    payload: Dict[str, Any] = field(default_factory=dict)
    error: Optional[Dict[str, Any]] = None

class JSONRPCClient:
    def __init__(self):
        self.pending: Dict[str, asyncio.Future] = {}

    async def call(self, method: str, params: Dict[str, Any] = None) -> RPCResponse:
        """发起一个 RPC 调用并等待响应"""
        future = asyncio.get_event_loop().create_future()
        request_id = self._generate_id()
        self.pending[request_id] = future

        try:
            # 发送请求
            message = {
                "type": "req",
                "id": request_id,
                "method": method,
                "params": params or {}
            }
            await self._send(message)

            # 等待响应
            response = await future
            return response

        finally:
            self.pending.pop(request_id, None)

    async def notify(self, method: str, params: Dict[str, Any] = None):
        """发送通知，不等待响应"""
        message = {
            "type": "req",
            "method": method,
            "params": params or {}
        }
        await self._send(message)

    def _generate_id(self) -> str:
        import uuid
        return str(uuid.uuid4())

    async def _send(self, message: dict):
        """发送消息，由子类实现"""
        raise NotImplementedError

    async def _handle_response(self, response: dict):
        """处理响应"""
        if "id" not in response:
            return  # 忽略无 ID 的消息

        request_id = response["id"]
        if request_id in self.pending:
            future = self.pending[request_id]

            if response.get("type") == "res":
                if response.get("ok", False):
                    future.set_result(RPCResponse(
                        id=request_id,
                        ok=True,
                        payload=response.get("payload", {})
                    ))
                else:
                    future.set_result(RPCResponse(
                        id=request_id,
                        ok=False,
                        error=response.get("error")
                    ))
            else:
                # 其他类型的消息（如事件）
                future.set_result(RPCResponse(
                    id=request_id,
                    ok=True,
                    payload=response
                ))
```

---

## 4. Yoyoo 的 WebSocket + JSON-RPC 设计

### 4.1 Yoyoo Brain ↔ OpenClaw Body 通信架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Yoyoo Brain (Python)                     │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
│  │   Cortex   │───►│  Bridge    │───►│  EventBus  │   │
│  │ (认知引擎)  │    │ (WS 客户端) │    │ (事件总线)  │   │
│  └─────────────┘    └─────────────┘    └─────────────┘   │
└────────────────────────┬──────────────────────────────────┘
                         │ WebSocket + JSON-RPC
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   OpenClaw Body (Node.js)                   │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐   │
│  │  Gateway   │◄───│  Bridge    │◄───│  Skills    │   │
│  │ (WS 服务)  │    │ (WS 服务端) │    │ (工具)     │   │
│  └─────────────┘    └─────────────┘    └─────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 Yoyoo Bridge 设计

```python
class YoyooBridge:
    """
    Yoyoo Brain 与 OpenClaw Body 之间的桥梁
    负责 WebSocket 连接管理和 JSON-RPC 通信
    """

    def __init__(self, uri="ws://127.0.0.1:18789", token=None):
        self.uri = uri
        self.token = token
        self.ws = None
        self.request_id = 0
        self.event_handlers = {}

    async def connect(self) -> bool:
        """建立连接"""
        self.ws = await connect(self.uri)

        # 发送连接握手
        response = await self.call("connect", {
            "minProtocol": 1,
            "maxProtocol": 1,
            "client": {
                "id": "yoyoo-brain",
                "version": "0.1.0",
                "platform": "darwin",
                "mode": "backend",
                "displayName": "Yoyoo Brain Kernel"
            },
            "role": "operator",
            "scopes": ["operator.admin", "operator.read", "operator.write"],
            "auth": {"token": self.token} if self.token else {}
        })

        return response.ok

    async def call(self, method: str, params: dict = None) -> RPCResponse:
        """发起 RPC 调用"""
        self.request_id += 1
        request = {
            "type": "req",
            "id": str(self.request_id),
            "method": method,
            "params": params or {}
        }

        await self.ws.send(json.dumps(request))

        # 等待响应
        while True:
            response = json.loads(await self.ws.recv())

            if response.get("id") == str(self.request_id):
                return RPCResponse(
                    id=response["id"],
                    ok=response.get("ok", False),
                    payload=response.get("payload", {}),
                    error=response.get("error")
                )

            # 处理事件
            elif response.get("type") == "event":
                await self._dispatch_event(response)

    async def notify(self, method: str, params: dict = None):
        """发送通知"""
        message = {
            "type": "req",
            "method": method,
            "params": params or {}
        }
        await self.ws.send(json.dumps(message))

    def on_event(self, event_type: str, handler: Callable):
        """注册事件处理器"""
        self.event_handlers[event_type] = handler

    async def _dispatch_event(self, event: dict):
        """分发事件"""
        event_type = event.get("event")
        if event_type in self.event_handlers:
            await self.event_handlers[event_type](event.get("payload", {}))

    # 便捷方法
    async def send_message(self, to: str, message: str, typing: bool = False):
        """发送消息"""
        return await self.call("chat.send", {
            "to": to,
            "message": message,
            "typing": typing
        })

    async def get_chat_history(self, chat_id: str, limit: int = 100):
        """获取聊天历史"""
        return await self.call("chat.history", {
            "chat_id": chat_id,
            "limit": limit
        })

    async def list_crons(self):
        """列出定时任务"""
        return await self.call("cron.list")

    async def add_cron(self, name: str, schedule: str, command: str):
        """添加定时任务"""
        return await self.call("cron.add", {
            "name": name,
            "schedule": schedule,
            "command": command
        })

    async def health_check(self):
        """健康检查"""
        return await self.call("health")

    async def shutdown(self):
        """关闭连接"""
        await self.call("shutdown")
        await self.ws.close()
```

### 4.3 消息流程

```
用户输入: "帮我发消息给张三"
        │
        ▼
┌───────────────────┐
│    Cortex         │  分析意图：需要发送消息
│ (认知引擎)        │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│    Planner        │  规划：调用 send_message 技能
│ (任务规划)        │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│    Bridge         │  发送 JSON-RPC 请求
│ (WS 客户端)       │  {"type":"req","method":"chat.send",...}
└─────────┬─────────┘
          │
          ▼
    WebSocket
          │
          ▼
┌───────────────────┐
│  OpenClaw Body    │  执行消息发送
│  Gateway          │
└─────────┬─────────┘
          │
          ▼
    响应结果
          │
          ▼
┌───────────────────┐
│    Cortex         │  处理结果
│ (认知引擎)        │
└─────────┬─────────┘
          │
          ▼
    回复用户
```

---

## 5. 心跳机制

### 5.1 为什么需要心跳

- 检测连接是否存活
- 防止连接因超时被断开
- 保持活跃状态

### 5.2 心跳实现

```python
import asyncio
from datetime import datetime

class HeartbeatManager:
    def __init__(self, bridge, interval: float = 30.0):
        self.bridge = bridge
        self.interval = interval
        self.running = False
        self.task = None

    async def start(self):
        """启动心跳"""
        self.running = True
        self.task = asyncio.create_task(self._heartbeat_loop())

    async def stop(self):
        """停止心跳"""
        self.running = False
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass

    async def _heartbeat_loop(self):
        """心跳循环"""
        while self.running:
            try:
                # 发送心跳
                await self.bridge.notify("tick", {
                    "timestamp": datetime.utcnow().isoformat()
                })

                # 等待下一次
                await asyncio.sleep(self.interval)

            except Exception as e:
                print(f"Heartbeat error: {e}")
                # 心跳失败，可以尝试重连
                await self._reconnect()

    async def _reconnect(self):
        """尝试重连"""
        print("Attempting to reconnect...")
        try:
            await self.bridge.connect()
            print("Reconnected successfully!")
        except Exception as e:
            print(f"Reconnect failed: {e}")
```

---

## 6. 实践：模拟与 OpenClaw 通信

```python
import asyncio
import json

# 模拟 OpenClaw 响应
async def mock_openclaw_handler(websocket):
    """模拟 OpenClaw Gateway 处理请求"""
    async for message in websocket:
        data = json.loads(message)

        if data.get("method") == "connect":
            # 响应连接
            response = {
                "type": "res",
                "id": data["id"],
                "ok": True,
                "payload": {
                    "status": "connected",
                    "instance_id": "mock-instance-001"
                }
            }
            await websocket.send(json.dumps(response))

        elif data.get("method") == "chat.send":
            # 响应发送消息
            response = {
                "type": "res",
                "id": data["id"],
                "ok": True,
                "payload": {
                    "status": "sent",
                    "message_id": "msg-001"
                }
            }
            await websocket.send(json.dumps(response))

        elif data.get("method") == "health":
            # 健康检查
            response = {
                "type": "res",
                "id": data["id"],
                "ok": True,
                "payload": {
                    "status": "healthy",
                    "uptime": "1h30m"
                }
            }
            await websocket.send(json.dumps(response))

        elif data.get("type") == "event":
            # 模拟收到消息事件
            if data.get("event") == "chat.message":
                event = {
                    "type": "event",
                    "event": "chat.message",
                    "payload": {
                        "from": "whatsapp:+1234567890",
                        "text": "Hello Yoyoo!",
                        "timestamp": "2026-01-31T10:00:00.000Z"
                    }
                }
                await websocket.send(json.dumps(event))

# 使用示例
async def demo():
    from websockets import serve

    # 启动模拟服务器
    async with serve(mock_openclaw_handler, "localhost", 18789):
        print("Mock OpenClaw started on ws://localhost:18789")

        # 客户端连接
        bridge = YoyooBridge(uri="ws://localhost:18789")
        await bridge.connect()

        # 发送消息
        await bridge.send_message("whatsapp:+1234567890", "Hello from Yoyoo!")

        # 健康检查
        health = await bridge.health_check()
        print(f"Health: {health}")

        # 模拟接收事件
        print("Waiting for events...")

        await asyncio.sleep(5)

asyncio.run(demo())
```

---

## 7. 总结

### 7.1 关键要点

| 概念 | 关键点 |
|------|--------|
| **WebSocket** | 持久连接、全双工、低延迟 |
| **JSON-RPC** | 轻量级、请求/响应/通知三种消息类型 |
| **OpenClaw 协议** | type 字段区分消息类型，支持请求 ID 追踪 |
| **心跳机制** | 定期发送 tick 保持连接活跃 |
| **事件处理** | 注册处理器处理异步事件 |

### 7.2 Yoyoo Bridge 核心功能

```python
class YoyooBridge:
    async def connect(self)           # 建立连接
    async def call(self, method, params)  # RPC 调用
    async def notify(self, method, params)  # 发送通知
    def on_event(self, event_type, handler)  # 注册事件处理器
    async def send_message(self, to, message, typing)  # 发送消息
    async def health_check(self)      # 健康检查
    async def shutdown(self)          # 关闭连接
```

### 7.3 下一步

1. 在实际环境中测试与 OpenClaw 的连接
2. 实现完整的错误处理机制
3. 添加重连逻辑
4. 实现事件分发系统

---

> **笔记版本**: 1.0
> **创建人**: Yoyoo
> **最后更新**: 2026-01-31
> **状态**: WebSocket + JSON-RPC 基础学习完成
