# Anthropic MCP 协议学习笔记

> **学习日期**: 2026-01-31
> **状态**: 🔥 进行中

---

## 1. MCP 是什么？

### 1.1 核心概念

```
┌─────────────────────────────────────────────────────────┐
│               Model Context Protocol (MCP)              │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🧠 LLM ←→ 🔌 MCP ←→ 🛠️ Tools/Resources/Prompts       │
│                                                         │
│  官方定义:                                              │
│  An open protocol that enables seamless integration     │
│  between LLM Applications and external data sources.   │
│                                                         │
│  中文解释:                                              │
│  一个开放协议，规范约 LLM 应用与外部数据源、            │
│  工具、提示的交互方式。                                │
│                                                         │
│  类比:                                                  │
│  • HTTP: Web 服务的通信协议                             │
│  • MCP: AI 应用的通信协议                               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.2 为什么需要 MCP？

```
┌─────────────────────────────────────────────────────────┐
│                 MCP 解决的问题                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  问题 1: 工具调用不规范                                 │
│  ┌─────────────────────────────────────────────────┐   │
│  │  不同项目有不同的工具调用方式                    │   │
│  │  OpenAI: function calling                       │   │
│  │  Anthropic: tool use                            │   │
│  │  LangChain: arbitrary abstractions              │   │
│  │  → 无法复用，需要重新开发                        │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  问题 2: 数据源孤岛                                     │
│  ┌─────────────────────────────────────────────────┐   │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐        │   │
│  │  │ 文件系统 │  │ 数据库  │  │ API     │        │   │
│  │  └────┬────┘  └────┬────┘  └────┬────┘        │   │
│  │       │             │             │               │   │
│  │       └─────────────┴─────────────┘               │   │
│  │                     │                             │   │
│  │                     ↓                             │   │
│  │              每个 LLM 应用都要重写                │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  MCP 解决方案:                                          │
│  ┌─────────────────────────────────────────────────┐   │
│  │                                                 │   │
│  │  LLM ←→ MCP Client ←→ MCP Server ←→ Resources  │   │
│  │                  │                              │   │
│  │                  ↓                              │   │
│  │              一个 MCP Server，多个 LLM 可用      │   │
│  │                                                 │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 1.3 MCP vs 其他方案

| 维度 | MCP | OpenAI Functions | LangChain Tools |
|------|-----|------------------|-----------------|
| **标准化** | 高 (协议层) | 中 (提供商特定) | 低 (库特定) |
| **可移植性** | 高 | 低 | 中 |
| **资源访问** | 支持 | 不支持 | 需自行实现 |
| **提示模板** | 支持 | 不支持 | 需自行实现 |
| **生态** | 增长中 | 成熟 | 成熟 |
| **适用场景** | 多 LLM 应用 | OpenAI 专用 | 快速原型 |

---

## 2. MCP 架构

### 2.1 核心组件

```
┌─────────────────────────────────────────────────────────┐
│                   MCP 架构图                             │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │                   LLM Application                │   │
│  │  ┌───────────────────────────────────────────┐  │   │
│  │  │            MCP Client                      │  │   │
│  │  │  - 发送请求                                │  │   │
│  │  │  - 处理响应                                │  │   │
│  │  │  - 管理连接                                │  │   │
│  │  └───────────────────────────────────────────┘  │   │
│  └─────────────────────────┬───────────────────────┘   │
│                            │                               │
│                            │ JSON-RPC 2.0                 │
│                            ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │                   MCP Server                     │   │
│  │  ┌───────────┬───────────┬───────────┬────────┐ │   │
│  │  │  Tools    │ Resources │ Prompts   │ Roots  │ │   │
│  │  │  (工具)   │ (资源)    │ (提示)    │ (根)   │ │   │
│  │  └───────────┴───────────┴───────────┴────────┘ │   │
│  └─────────────────────────┬───────────────────────┘   │
│                            │                               │
│                            ↓                               │
│  ┌─────────────────────────────────────────────────┐   │
│  │                 Data Sources                     │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────┐ │   │
│  │  │ 文件系统 │ │ 数据库  │ │ API     │ │ ...  │ │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └──────┘ │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 四大核心能力

| 能力 | 说明 | 示例 |
|------|------|------|
| **Tools** | 可执行的函数/动作 | `search_web`, `read_file` |
| **Resources** | 可读取的数据 | `file://config.json` |
| **Prompts** | 预定义的提示模板 | `summarize_code` |
| **Roots** | 工作目录/上下文 | `/project/src` |

---

## 3. MCP 协议详解

### 3.1 消息格式 (JSON-RPC 2.0)

```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "method_name",
  "params": {
    // 方法参数
  }
}

// 响应
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "result": {
    // 结果
  }
}

// 错误
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "error": {
    "code": -32600,
    "message": "Invalid Request",
    "data": { /* 额外信息 */ }
  }
}
```

### 3.2 初始化握手

```json
// Client → Server: 初始化
{
  "jsonrpc": "2.0",
  "id": "1",
  "method": "initialize",
  "params": {
    "protocolVersion": "2024-01-01",
    "capabilities": {
      "tools": {},
      "resources": {},
      "prompts": {}
    },
    "clientInfo": {
      "name": "yoyoo-cli",
      "version": "0.1.0"
    }
  }
}

// Server → Client: 响应
{
  "jsonrpc": "2.0",
  "id": "1",
  "result": {
    "protocolVersion": "2024-01-01",
    "capabilities": {
      "tools": {
        "listChanged": true
      },
      "resources": {
        "subscribe": true,
        "listChanged": true
      }
    },
    "serverInfo": {
      "name": "yoyoo-server",
      "version": "0.1.0"
    }
  }
}
```

### 3.3 工具调用 (Tools)

```json
// Client → Server: 列出工具
{
  "jsonrpc": "2.0",
  "id": "2",
  "method": "tools/list",
  "params": {}
}

// Server → Client: 工具列表
{
  "jsonrpc": "2.0",
  "id": "2",
  "result": {
    "tools": [
      {
        "name": "search_web",
        "description": "Search the web for information",
        "inputSchema": {
          "type": "object",
          "properties": {
            "query": {
              "type": "string",
              "description": "Search query"
            },
            "max_results": {
              "type": "integer",
              "description": "Maximum number of results",
              "default": 5
            }
          },
          "required": ["query"]
        }
      },
      {
        "name": "read_file",
        "description": "Read a file from the filesystem",
        "inputSchema": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "File path to read"
            },
            "encoding": {
              "type": "string",
              "enum": ["utf-8", "base64"],
              "default": "utf-8"
            }
          },
          "required": ["path"]
        }
      }
    ]
  }
}

// Client → Server: 调用工具
{
  "jsonrpc": "2.0",
  "id": "3",
  "method": "tools/call",
  "params": {
    "name": "read_file",
    "arguments": {
      "path": "/Users/su Bai/Yoyoo/soul/MEMORY.md",
      "encoding": "utf-8"
    }
  }
}

// Server → Client: 工具结果
{
  "jsonrpc": "2.0",
  "id": "3",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "# Yoyoo 的核心记忆...\n..."
      }
    ],
    "isError": false
  }
}
```

### 3.4 资源访问 (Resources)

```json
// Client → Server: 列出资源
{
  "jsonrpc": "2.0",
  "id": "4",
  "method": "resources/list",
  "params": {}
}

// Server → Client: 资源列表
{
  "jsonrpc": "2.0",
  "id": "4",
  "result": {
    "resources": [
      {
        "uri": "file:///Users/su Bai/Yoyoo/soul/MEMORY.md",
        "name": "Yoyoo Memory",
        "description": "Long-term memory file",
        "mimeType": "text/markdown"
      },
      {
        "uri": "memory://user/preferences",
        "name": "User Preferences",
        "description": "User preference settings",
        "mimeType": "application/json"
      }
    ]
  }
}

// Client → Server: 读取资源
{
  "jsonrpc": "2.0",
  "id": "5",
  "method": "resources/read",
  "params": {
    "uri": "file:///Users/su Bai/Yoyoo/soul/MEMORY.md"
  }
}

// Server → Client: 资源内容
{
  "jsonrpc": "2.0",
  "id": "5",
  "result": {
    "contents": [
      {
        "uri": "file:///Users/su Bai/Yoyoo/soul/MEMORY.md",
        "mimeType": "text/markdown",
        "text": "# Yoyoo 的核心记忆..."
      }
    ]
  }
}
```

### 3.5 提示模板 (Prompts)

```json
// Client → Server: 列出提示
{
  "jsonrpc": "2.0",
  "id": "6",
  "method": "prompts/list",
  "params": {}
}

// Server → Client: 提示列表
{
  "jsonrpc": "2.0",
  "id": "6",
  "result": {
    "prompts": [
      {
        "name": "summarize_code",
        "description": "Summarize the provided code",
        "arguments": [
          {
            "name": "language",
            "description": "Programming language",
            "required": false
          },
          {
            "name": "focus",
            "description": "Focus area (e.g., 'bugs', 'performance')",
            "required": false
          }
        ]
      },
      {
        "name": "explain_error",
        "description": "Explain an error message",
        "arguments": [
          {
            "name": "error",
            "description": "Error message to explain",
            "required": true
          }
        ]
      }
    ]
  }
}

// Client → Server: 使用提示
{
  "jsonrpc": "2.0",
  "id": "7",
  "method": "prompts/get",
  "params": {
    "name": "summarize_code",
    "arguments": {
      "language": "python",
      "focus": "architecture"
    }
  }
}

// Server → Client: 提示内容
{
  "jsonrpc": "2.0",
  "id": "7",
  "result": {
    "description": "Summarize the provided code",
    "messages": [
      {
        "role": "user",
        "content": {
          "type": "text",
          "text": "Please summarize the following Python code, focusing on its architecture:\n\n<code here>"
        }
      }
    ]
  }
}
```

---

## 4. Yoyoo MCP Server 设计

### 4.1 服务器架构

```python
# yoyoo_mcp_server/server.py
import asyncio
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent

app = Server("yoyoo-server")

# 工具注册
@app.list_tools()
async def list_tools() -> list[Tool]:
    return [
        Tool(
            name="search_memory",
            description="Search Yoyoo's long-term memory",
            inputSchema={
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "Search query"},
                    "type": {"type": "string", "enum": ["fact", "preference", "context"]},
                    "limit": {"type": "integer", "default": 5}
                },
                "required": ["query"]
            }
        ),
        Tool(
            name="read_daily_note",
            description="Read Yoyoo's daily note for a specific date",
            inputSchema={
                "type": "object",
                "properties": {
                    "date": {"type": "string", "description": "Date (YYYY-MM-DD)"}
                },
                "required": ["date"]
            }
        ),
        Tool(
            name="write_daily_note",
            description="Write to Yoyoo's daily note",
            inputSchema={
                "type": "object",
                "properties": {
                    "content": {"type": "string"},
                    "append": {"type": "boolean", "default": true}
                },
                "required": ["content"]
            }
        ),
        Tool(
            name="get_task_status",
            description="Get the status of a task",
            inputSchema={
                "type": "object",
                "properties": {
                    "task_id": {"type": "string"}
                },
                "required": ["task_id"]
            }
        ),
        Tool(
            name="create_task",
            description="Create a new task",
            inputSchema={
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "description": {"type": "string"},
                    "priority": {"type": "string", "enum": ["low", "normal", "high"]},
                    "due_at": {"type": "string", "format": "date-time"}
                },
                "required": ["title"]
            }
        ),
        Tool(
            name="list_skills",
            description="List all available Yoyoo skills",
            inputSchema={
                "type": "object",
                "properties": {}
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "search_memory":
        results = await search_memory(arguments["query"], arguments.get("type"), arguments.get("limit", 5))
        return [TextContent(type="text", text=format_memory_results(results))]

    elif name == "read_daily_note":
        content = await read_daily_note(arguments["date"])
        return [TextContent(type="text", text=content)]

    elif name == "write_daily_note":
        await write_daily_note(arguments["content"], arguments.get("append", True))
        return [TextContent(type="text", text="Daily note updated")]

    elif name == "get_task_status":
        status = await get_task_status(arguments["task_id"])
        return [TextContent(type="text", text=format_task_status(status))]

    elif name == "create_task":
        task = await create_task(arguments)
        return [TextContent(type="text", text=f"Task created: {task['id']}")]

    elif name == "list_skills":
        skills = await list_all_skills()
        return [TextContent(type="text", text=format_skills_list(skills))]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]
```

### 4.2 资源注册

```python
# yoyoo_mcp_server/resources.py
from mcp.server import Server
from mcp.types import Resource, TextResourceContents

app = Server("yoyoo-server")

@app.list_resources()
async def list_resources() -> list[Resource]:
    return [
        Resource(
            uri="memory://yoyoo/core",
            name="Yoyoo Core Memory",
            description="Yoyoo's long-term memory file",
            mimeType="text/markdown"
        ),
        Resource(
            uri="memory://yoyoo/daily",
            name="Yoyoo Today's Note",
            description="Yoyoo's daily note for today",
            mimeType="text/markdown"
        ),
        Resource(
            uri="config://yoyoo/settings",
            name="Yoyoo Settings",
            description="Yoyoo configuration settings",
            mimeType="application/json"
        )
    ]

@app.read_resource()
async def read_resource(uri: str) -> str:
    if uri == "memory://yoyoo/core":
        return read_file("soul/MEMORY.md")
    elif uri == "memory://yoyoo/daily":
        return read_daily_note(today())
    elif uri == "config://yoyoo/settings":
        return json.dumps(load_settings())
    raise ValueError(f"Unknown resource: {uri}")
```

### 4.3 提示模板

```python
# yoyoo_mcp_server/prompts.py
from mcp.server import Server
from mcp.types import Prompt, TextContent

app = Server("yoyoo-server")

@app.list_prompts()
async def list_prompts() -> list[Prompt]:
    return [
        Prompt(
            name="yoyoo_context",
            description="Provide Yoyoo's current context",
            arguments=[
                {
                    "name": "include_memory",
                    "description": "Include recent memories",
                    "required": False
                }
            ]
        ),
        Prompt(
            name="yoyoo_daily_summary",
            description="Generate Yoyoo's daily summary prompt"
        ),
        Prompt(
            name="yoyoo_task_planning",
            description="Plan a new task for Yoyoo",
            arguments=[
                {
                    "name": "task_type",
                    "description": "Type of task",
                    "required": False
                }
            ]
        )
    ]

@app.get_prompt()
async def get_prompt(name: str, arguments: dict = None) -> list[dict]:
    if name == "yoyoo_context":
        include_memory = arguments.get("include_memory", True)
        memory = read_memory() if include_memory else ""
        return [
            {
                "role": "user",
                "content": {
                    "type": "text",
                    "text": f"""You are Yoyoo, a personal AI companion.

Your long-term memory:
{memory}

Current date: {today()}

Please help with your task."""
                }
            }
        ]

    elif name == "yoyoo_daily_summary":
        return [
            {
                "role": "user",
                "content": {
                    "type": "text",
                    "text": """Please summarize your day as Yoyoo:

1. What tasks did you work on?
2. What did you learn?
3. Any important decisions made?
4. What are your priorities for tomorrow?

Format as a concise markdown summary."""
                }
            }
        ]

    elif name == "yoyoo_task_planning":
        task_type = arguments.get("task_type", "general")
        return [
            {
                "role": "user",
                "content": {
                    "type": "text",
                    "text": f"""Plan a new {task_type} task:

Please help me break down this task into:
1. Main objective
2. Key steps
3. Dependencies
4. Estimated time

Task: {arguments.get('description', 'Please describe your task')}

Format as a structured task plan."""
                }
            }
        ]
```

---

## 5. Yoyoo MCP Client 设计

### 5.1 客户端集成

```python
# yoyoo_client/mcp_client.py
import asyncio
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

class YoyooMCPClient:
    def __init__(self, server_path: str):
        self.server_path = server_path
        self.session = None
        self.stdio = None

    async def connect(self):
        server_params = StdioServerParameters(
            command="python",
            args=[self.server_path],
            env=None
        )

        async with stdio_client(server_params) as (read, write):
            async with ClientSession(read, write) as session:
                self.session = session
                await session.initialize()

                # 获取服务器能力
                result = await session.initialize()
                self.capabilities = result.capabilities
                return self.capabilities

    async def search_memory(self, query: str, limit: int = 5) -> list:
        """搜索记忆"""
        result = await session.call_tool(
            "search_memory",
            {"query": query, "limit": limit}
        )
        return parse_memory_results(result)

    async def get_daily_note(self, date: str = None) -> str:
        """获取每日笔记"""
        date = date or today()
        result = await session.call_tool(
            "read_daily_note",
            {"date": date}
        )
        return result.text

    async def write_daily_note(self, content: str, append: bool = True):
        """写入每日笔记"""
        await session.call_tool(
            "write_daily_note",
            {"content": content, "append": append}
        )

    async def create_task(self, title: str, **kwargs) -> dict:
        """创建任务"""
        result = await session.call_tool(
            "create_task",
            {"title": title, **kwargs}
        )
        return parse_task_result(result)

    async def get_task_status(self, task_id: str) -> dict:
        """获取任务状态"""
        result = await session.call_tool(
            "get_task_status",
            {"task_id": task_id}
        )
        return parse_task_status(result)

    async def list_skills(self) -> list:
        """列出所有技能"""
        result = await session.call_tool("list_skills", {})
        return parse_skills_list(result)

    async def read_resource(self, uri: str) -> str:
        """读取资源"""
        result = await session.read_resource(uri)
        return result.contents[0].text
```

### 5.2 在 Yoyoo Core 中集成

```python
# yoyoo_core/yoyoo.py
class Yoyoo:
    def __init__(self):
        self.mcp_client = YoyooMCPClient("yoyoo_mcp_server/server.py")
        self.memory = None
        self.daily_note = None

    async def initialize(self):
        # 连接 MCP Server
        await self.mcp_client.connect()

        # 加载记忆
        self.memory = await self.mcp_client.read_resource("memory://yoyoo/core")

        # 加载今日笔记
        self.daily_note = await self.mcp_client.get_daily_note()

    async def think(self, user_input: str) -> str:
        # 1. 搜索相关记忆
        relevant_memories = await self.mcp_client.search_memory(user_input, limit=3)

        # 2. 构建上下文
        context = self.build_context(user_input, relevant_memories)

        # 3. 调用 LLM
        response = await self.llm.generate(context)

        # 4. 记录到每日笔记
        await self.mcp_client.write_daily_note(f"User: {user_input}\nYoyoo: {response}\n")

        return response

    async def create_task(self, task_data: dict) -> dict:
        """创建任务并同步"""
        task = await self.mcp_client.create_task(**task_data)
        await self.mcp_client.write_daily_note(f"Created task: {task['title']}\n")
        return task
```

---

## 6. MCP 生态

### 6.1 官方工具

```bash
# 安装 MCP CLI
pip install mcp-cli

# 运行 MCP Inspector
mcp-inspector

# 测试 MCP Server
mcp test --server my_server.py
```

### 6.2 社区资源

| 项目 | 说明 |
|------|------|
| [mcp-use](https://github.com/承受能力/mcp-use) | MCP Python 客户端库 |
| [mcp-sdk-js](https://github.com/modelcontextprotocol/javascript-sdk) | MCP JavaScript SDK |
| [awesome-mcp](https://github.com/penfever/awesome-mcp) | MCP 资源列表 |

### 6.3 MCP Server 示例

| Server | 功能 |
|--------|------|
| [filesystem](https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem) | 文件系统访问 |
| [github](https://github.com/modelcontextprotocol/servers/tree/main/src/github) | GitHub API |
| [postgres](https://github.com/modelcontextprotocol/servers/tree/main/src/postgres) | PostgreSQL 查询 |
| [puppeteer](https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer) | 浏览器自动化 |

---

## 7. MCP 最佳实践

### 7.1 工具设计原则

```python
# ✅ 好的工具设计
Tool(
    name="read_file",
    description="Read the contents of a file",
    inputSchema={
        "type": "object",
        "properties": {
            "path": {"type": "string", "description": "Absolute path to file"},
            "encoding": {"type": "string", "enum": ["utf-8", "base64"]}
        },
        "required": ["path"]
    }
)

# ❌ 避免的工具设计
Tool(
    name="do_something",
    description="Does something useful",  # 模糊描述
    inputSchema={
        "type": "object",
        "properties": {
            "x": {"type": "string"},  # 不明确的参数名
            "y": {"type": "string"}
        }
    }
)
```

### 7.2 错误处理

```python
@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    try:
        if name == "risky_operation":
            result = await risky_operation(arguments)
            return [TextContent(type="text", text=result)]
    except FileNotFoundError:
        return [TextContent(
            type="text",
            text=f"Error: File not found - {arguments.get('path')}"
        )]
    except PermissionError:
        return [TextContent(
            type="text",
            text="Error: Permission denied to access this resource"
        )]
    except Exception as e:
        return [TextContent(
            type="text",
            text=f"Error: {str(e)}"
        )]
```

### 7.3 安全性

```python
# 1. 输入验证
@app.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    if name == "read_file":
        path = arguments.get("path", "")
        # 防止路径遍历
        if ".." in path or path.startswith("/"):
            return [TextContent(
                type="text",
                text="Error: Invalid path - access denied"
            )]
        # 白名单检查
        allowed_paths = ["/project/src", "/data"]
        if not any(path.startswith(p) for p in allowed_paths):
            return [TextContent(
                type="text",
                text="Error: Path not in allowed directories"
            )]

# 2. 敏感信息过滤
def sanitize_output(text: str) -> str:
    # 过滤敏感信息
    import re
    text = re.sub(r'\b\d{16}\b', '[CARD]', text)  # 银行卡
    text = re.sub(r'api_key["\']?\s*[:=]\s*["\']?\S+', 'api_key=[REDACTED]', text)
    return text
```

---

## 8. Yoyoo 技能系统与 MCP

### 8.1 技能注册为 MCP Tools

```python
# yoyoo_skills/skill_registry.py
from dataclasses import dataclass
from typing import Callable, Any
import json

@dataclass
class Skill:
    name: str
    description: str
    parameters: dict
    handler: Callable

# 技能注册表
SKILLS: dict[str, Skill] = {}

def skill(name: str, description: str, parameters: dict = None):
    """装饰器：注册技能"""
    def decorator(func):
        SKILLS[name] = Skill(
            name=name,
            description=description,
            parameters=parameters or {},
            handler=func
        )
        return func
    return decorator

# 技能定义
@skill(
    name="send_email",
    description="Send an email to a recipient",
    parameters={
        "type": "object",
        "properties": {
            "to": {"type": "string", "description": "Recipient email"},
            "subject": {"type": "string", "description": "Email subject"},
            "body": {"type": "string", "description": "Email body"}
        },
        "required": ["to", "subject"]
    }
)
async def send_email(to: str, subject: str, body: str = ""):
    # 实现发送邮件逻辑
    await email_service.send(to, subject, body)
    return "Email sent successfully"

@skill(
    name="create_document",
    description="Create a new document",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "content": {"type": "string"},
            "folder": {"type": "string"}
        },
        "required": ["title"]
    }
)
async def create_document(title: str, content: str = "", folder: str = "/docs"):
    # 创建文档
    doc = await document_service.create(title, content, folder)
    return f"Document created: {doc.id}"

@skill(
    name="schedule_meeting",
    description="Schedule a meeting on calendar",
    parameters={
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "participants": {"type": "array", "items": {"type": "string"}},
            "duration": {"type": "integer"},
            "description": {"type": "string"}
        },
        "required": ["title", "participants"]
    }
)
async def schedule_meeting(title: str, participants: list, duration: int = 60, description: str = ""):
    meeting = await calendar_service.create_meeting(
        title=title,
        participants=participants,
        duration=duration,
        description=description
    )
    return f"Meeting scheduled: {meeting.link}"

# 导出为 MCP Tools
def get_skill_tools() -> list[Tool]:
    return [
        Tool(
            name=skill.name,
            description=skill.description,
            inputSchema=skill.parameters
        )
        for skill in SKILLS.values()
    ]
```

---

## 9. 学习总结

### 核心要点

1. **MCP 协议**: 标准化 LLM 与外部世界的交互
2. **四大能力**: Tools / Resources / Prompts / Roots
3. **JSON-RPC 2.0**: 基于标准 JSON-RPC 协议
4. **生态**: 快速增长的 MCP Server 生态

### Yoyoo 应用场景

| MCP 组件 | Yoyoo 用途 |
|----------|-----------|
| **Tools** | 技能系统 (send_email, create_document) |
| **Resources** | 读取记忆、配置文件 |
| **Prompts** | 预定义上下文模板、每日总结 |

### 集成收益

- **标准化**: 技能调用遵循统一协议
- **可扩展**: 第三方可开发 MCP Server
- **可组合**: 多个 MCP Server 可组合使用

---

## 参考资源

- [MCP 官方文档](https://modelcontextprotocol.io/)
- [MCP GitHub](https://github.com/modelcontextprotocol)
- [MCP Python SDK](https://github.com/modelcontextprotocol/python-sdk)
- [MCP JavaScript SDK](https://github.com/modelcontextprotocol/javascript-sdk)
- [awesome-mcp](https://github.com/penfever/awesome-mcp)
