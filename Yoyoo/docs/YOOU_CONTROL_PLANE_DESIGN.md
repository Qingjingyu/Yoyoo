# Yoyoo 控制层设计文档

> **版本**: 0.1.0
> **创建日期**: 2026-01-31
> **状态**: Draft

---

## 1. 概述

### 1.1 文档目的

本文档定义 Yoyoo Platform 控制层（Control Plane）的技术架构和实现细节，为开发团队提供清晰的设计指南。

### 1.2 控制层职责

| 职责 | 说明 |
|------|------|
| **用户管理** | 注册、登录、认证、授权 |
| **租户管理** | 多租户隔离、配置管理 |
| **Yoo 实例管理** | 创建、启动、停止、监控 |
| **任务调度** | Cron 任务、心跳管理 |
| **协作总线** | Yoyoo 间通信、任务分配 |
| **API 网关** | 统一入口、限流、路由 |

### 1.3 技术选型

| 组件 | 技术选择 | 理由 |
|------|----------|------|
| **Web 框架** | FastAPI | 高性能、自动文档、异步支持 |
| **数据库** | PostgreSQL | 可靠性、多租户支持 |
| **缓存** | Redis | 会话、消息队列、缓存 |
| **认证** | JWT + bcrypt | 标准、安全 |
| **容器化** | Docker + K8s | 可移植、可扩展 |
| **ORM** | SQLAlchemy + Pydantic | 类型安全、验证 |

---

## 2. 系统架构

### 2.1 整体架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Yoyoo Platform                                │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    控制层 (Control Plane)                    │   │
│  │  ┌─────────┬─────────┬─────────┬─────────┬──────────┐   │   │
│  │  │ Auth    │ Tenant  │ Yoo     │ Task    │ Collab   │   │   │
│  │  │ Service │ Service │ Service │ Service │ Bus      │   │   │
│  │  └─────────┴─────────┴─────────┴─────────┴──────────┘   │   │
│  │                      │                                    │   │
│  │              ┌───────┴───────┐                        │   │
│  │              │  FastAPI     │                        │   │
│  │              │  API Gateway │                        │   │
│  │              └───────┬───────┘                        │   │
│  └──────────────────────┼───────────────────────────────────┘   │
│                         │ WebSocket + HTTP                    │
└─────────────────────────┼───────────────────────────────────────┘
                          │
┌─────────────────────────▼───────────────────────────────────────┐
│                   执行层 (Execution Plane)                      │
│  ┌───────────────────────────────────────────────────┐   │
│  │              OpenClaw / Moltbot Body             │   │
│  │  ┌─────────┬─────────┬─────────┬──────────────┐  │   │
│  │  │ Gateway │ Browser │   IM    │  Skills     │  │   │
│  │  └─────────┴─────────┴─────────┴──────────────┘  │   │
│  └───────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────┘
```

### 2.2 控制层内部架构

```
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Application                      │
│  ┌─────────────────────────────────────────────────┐   │
│  │                  API Routes                     │   │
│  │  /auth/*   /users/*   /yooos/*   /tasks/*   │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                           │
│  ┌─────────────────────▼───────────────────────────┐   │
│  │              Dependency Injection           │   │
│  │  get_db / get_current_user / require_admin │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                           │
│  ┌─────────────────────▼───────────────────────────┐   │
│  │              Service Layer                 │   │
│  │  AuthService / TenantService / YooService │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                           │
│  ┌─────────────────────▼───────────────────────────┐   │
│  │              Repository Layer             │   │
│  │  UserRepository / YooRepository /       │   │
│  │  TaskRepository / MessageRepository   │   │
│  └─────────────────────┬───────────────────────────┘   │
│                        │                           │
│  ┌─────────────────────▼───────────────────────────┐   │
│  │              Database & Cache              │   │
│  │  PostgreSQL / Redis                    │   │
│  └───────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. API 设计

### 3.1 API 版本

```
Base URL: /api/v1
```

### 3.2 认证模块 `/auth`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| POST | `/auth/register` | 用户注册 | ❌ |
| POST | `/auth/token` | 登录获取 Token | ❌ |
| POST | `/auth/refresh` | 刷新 Token | Refresh Token |
| POST | `/auth/revoke` | 登出 | Access Token |
| GET | `/auth/me` | 获取当前用户 | Access Token |

**请求/响应示例**:

```json
// POST /auth/token
// Request (OAuth2 Password Flow)
{
  "username": "user@example.com",
  "password": "secure_password",
  "grant_type": "password"
}

// Response
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIs...",
  "expires_in": 1800,
  "token_type": "Bearer",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "User Name",
    "role": "member",
    "plan": "free"
  }
}
```

### 3.3 用户模块 `/users`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/users/me` | 获取当前用户 | ✅ |
| PATCH | `/users/me` | 更新当前用户 | ✅ |
| DELETE | `/users/me` | 删除账户 | ✅ |
| GET | `/users/{id}` | 获取用户详情 | ✅ |
| GET | `/users/{id}/yooos` | 获取用户的 Yooos | ✅ |

### 3.4 Yoo 实例模块 `/yooos`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/yooos` | 列出我的 Yooos | ✅ |
| POST | `/yooos` | 创建新 Yoo | ✅ |
| GET | `/yooos/{id}` | 获取 Yoo 详情 | ✅ |
| PATCH | `/yooos/{id}` | 更新 Yoo 配置 | ✅ |
| DELETE | `/yooos/{id}` | 删除 Yoo | ✅ |
| POST | `/yooos/{id}/start` | 启动 Yoo | ✅ |
| POST | `/yooos/{id}/stop` | 停止 Yoo | ✅ |
| POST | `/yooos/{id}/chat` | 与 Yoo 对话 | ✅ |
| GET | `/yooos/{id}/tasks` | 获取 Yoo 任务 | ✅ |

**请求/响应示例**:

```json
// POST /yooos
// Request
{
  "name": "我的写作助手",
  "description": "帮我写作和内容创作",
  "config": {
    "model": "claude-3-5-sonnet",
    "system_prompt": "你是一个专业的写作助手...",
    "skills": ["writing", "research", "browser"]
  }
}

// Response
{
  "id": "uuid",
  "name": "我的写作助手",
  "description": "帮我写作和内容创作",
  "config": {
    "model": "claude-3-5-sonnet",
    "system_prompt": "...",
    "skills": ["writing", "research", "browser"]
  },
  "status": "stopped",
  "created_at": "2026-01-31T10:00:00.000Z",
  "last_heartbeat_at": null
}
```

### 3.5 任务模块 `/tasks`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/tasks` | 列出任务 | ✅ |
| POST | `/tasks` | 创建任务 | ✅ |
| GET | `/tasks/{id}` | 获取任务详情 | ✅ |
| PATCH | `/tasks/{id}` | 更新任务 | ✅ |
| DELETE | `/tasks/{id}` | 删除任务 | ✅ |
| POST | `/tasks/{id}/cancel` | 取消任务 | ✅ |

### 3.6 协作模块 `/collaborate`

| 方法 | 路径 | 说明 | 认证 |
|------|------|------|------|
| GET | `/collaborate/network` | 获取协作网络 | ✅ |
| POST | `/collaborate/send` | 发送消息给其他 Yoo | ✅ |
| GET | `/collaborate/messages` | 获取协作消息 | ✅ |
| POST | `/collaborate/assign` | 分配任务 | ✅ |
| GET | `/collaborate/pending` | 获取待处理任务 | ✅ |

---

## 4. 核心服务设计

### 4.1 AuthService

```python
from typing import Optional
from datetime import datetime
from dataclasses import dataclass

@dataclass
class UserCreate:
    email: str
    password: str
    name: str
    tenant_name: Optional[str] = None
    tenant_slug: Optional[str] = None

@dataclass
class UserLogin:
    email: str
    password: str

class AuthService:
    def __init__(
        self,
        user_repo: UserRepository,
        tenant_repo: TenantRepository,
        token_service: TokenService,
        password_service: PasswordService
    ):
        self.user_repo = user_repo
        self.tenant_repo = tenant_repo
        self.token_service = token_service
        self.password_service = password_service

    async def register(self, data: UserCreate) -> tuple[User, Tenant, TokenPair]:
        """用户注册"""
        # 检查邮箱
        existing = await self.user_repo.get_by_email(data.email)
        if existing:
            raise ValidationError("Email already registered")

        # 创建或获取租户
        if data.tenant_slug:
            tenant = await self.tenant_repo.get_by_slug(data.tenant_slug)
            if not tenant:
                tenant = await self.tenant_repo.create(
                    name=data.tenant_name or data.tenant_slug,
                    slug=data.tenant_slug
                )
        else:
            # 创建新租户
            slug = data.email.split("@")[0].lower().replace("_", "-")
            tenant = await self.tenant_repo.create(
                name=data.tenant_name or data.email.split("@")[0],
                slug=slug
            )

        # 创建用户
        user = await self.user_repo.create(
            email=data.email,
            password_hash=self.password_service.hash_password(data.password),
            name=data.name,
            tenant_id=tenant.id,
            role=UserRole.OWNER
        )

        # 生成 Token
        tokens = self.token_service.create_token_pair(
            user_id=str(user.id),
            tenant_id=str(tenant.id),
            email=user.email,
            role=user.role,
            plan=tenant.plan
        )

        return user, tenant, tokens

    async def login(self, data: UserLogin) -> TokenPair:
        """用户登录"""
        user = await self.user_repo.get_by_email(data.email)
        if not user:
            raise AuthenticationError("Invalid credentials")

        if not self.password_service.verify_password(
            data.password,
            user.hashed_password
        ):
            raise AuthenticationError("Invalid credentials")

        if not user.is_active:
            raise AuthenticationError("Account is disabled")

        # 更新最后登录
        await self.user_repo.update_last_login(user.id)

        # 生成 Token
        tenant = await self.tenant_repo.get_by_id(user.tenant_id)
        tokens = self.token_service.create_token_pair(
            user_id=str(user.id),
            tenant_id=str(tenant.id),
            email=user.email,
            role=user.role,
            plan=tenant.plan
        )

        return tokens

    async def refresh(self, refresh_token: str) -> TokenPair:
        """刷新 Token"""
        return self.token_service.refresh_tokens(refresh_token)

    async def revoke(self, user_id: UUID, tenant_id: UUID):
        """登出（吊销 Token）"""
        # 将 Token 加入黑名单
        await self.token_service.revoke_all_user_tokens(user_id, tenant_id)
```

### 4.2 YooService

```python
@dataclass
class YooCreate:
    name: str
    description: Optional[str] = None
    config: dict = None

@dataclass
class YooUpdate:
    name: Optional[str] = None
    description: Optional[str] = None
    config: Optional[dict] = None
    status: Optional[str] = None

class YooService:
    def __init__(
        self,
        yoo_repo: YooRepository,
        task_repo: TaskRepository,
        bridge_service: BridgeService
    ):
        self.yoo_repo = yoo_repo
        self.task_repo = task_repo
        self.bridge_service = bridge_service

    async def create(
        self,
        user_id: UUID,
        tenant_id: UUID,
        data: YooCreate
    ) -> Yoo:
        """创建 Yoo 实例"""
        # 检查用户 Yoo 数量限制
        count = await self.yoo_repo.count_by_user(user_id)
        plan_limit = self._get_plan_limit(tenant.plan)
        if count >= plan_limit:
            raise ValidationError("Yoo limit reached")

        # 创建 Yoo
        yoo = await self.yoo_repo.create(
            user_id=user_id,
            tenant_id=tenant_id,
            name=data.name,
            description=data.description,
            config=data.config or {},
            status=YooStatus.STOPPED
        )

        # 初始化 Brain 内存
        await self.bridge_service.initialize_brain(yoo.id)

        return yoo

    async def start(self, yoo_id: UUID, tenant_id: UUID) -> Yoo:
        """启动 Yoo"""
        yoo = await self._get_with_tenant_check(yoo_id, tenant_id)

        if yoo.status == YooStatus.RUNNING:
            raise ValidationError("Yoo is already running")

        # 更新状态
        yoo = await self.yoo_repo.update_status(
            yoo_id, tenant_id, YooStatus.STARTING
        )

        try:
            # 连接 OpenClaw Body
            await self.bridge_service.connect(yoo.id)

            # 更新状态为运行中
            yoo = await self.yoo_repo.update_status(
                yoo_id, tenant_id, YooStatus.RUNNING
            )

            # 启动心跳
            await self.bridge_service.start_heartbeat(yoo.id)

        except Exception as e:
            await self.yoo_repo.update_status(
                yoo_id, tenant_id, YooStatus.ERROR
            )
            raise

        return yoo

    async def stop(self, yoo_id: UUID, tenant_id: UUID) -> Yoo:
        """停止 Yoo"""
        yoo = await self._get_with_tenant_check(yoo_id, tenant_id)

        if yoo.status == YooStatus.STOPPED:
            raise ValidationError("Yoo is already stopped")

        # 停止心跳
        await self.bridge_service.stop_heartbeat(yoo_id)

        # 断开连接
        await self.bridge_service.disconnect(yoo_id)

        # 更新状态
        yoo = await self.yoo_repo.update_status(
            yoo_id, tenant_id, YooStatus.STOPPED
        )

        return yoo

    async def chat(
        self,
        yoo_id: UUID,
        tenant_id: UUID,
        message: str,
        user_id: UUID
    ) -> Task:
        """与 Yoo 对话"""
        yoo = await self._get_with_tenant_check(yoo_id, tenant_id)

        if yoo.status != YooStatus.RUNNING:
            raise ValidationError("Yoo is not running")

        # 创建任务
        task = await self.task_repo.create(
            yoo_id=yoo_id,
            user_id=user_id,
            tenant_id=tenant_id,
            title=f"Chat: {message[:50]}...",
            description=message,
            task_type=TaskType.CHAT
        )

        # 发送消息到 Brain
        await self.bridge_service.send_message(yoo.id, message, task.id)

        return task

    async def _get_with_tenant_check(
        self,
        yoo_id: UUID,
        tenant_id: UUID
    ) -> Yoo:
        """获取 Yoo 并验证租户"""
        yoo = await self.yoo_repo.get_by_id(yoo_id, tenant_id)
        if not yoo:
            raise NotFoundError("Yoo not found")
        if yoo.tenant_id != tenant_id:
            raise ForbiddenError("Access denied")
        return yoo

    def _get_plan_limit(self, plan: str) -> int:
        """获取计划限制"""
        limits = {
            "free": 3,
            "pro": 10,
            "enterprise": 50
        }
        return limits.get(plan, 3)
```

### 4.3 CollaborateBus (协作总线)

```python
from enum import Enum
from typing import Optional
from pydantic import BaseModel

class MessageType(str, Enum):
    TASK_ASSIGN = "task_assign"
    TASK_UPDATE = "task_update"
    TASK_COMPLETE = "task_complete"
    PROGRESS_REPORT = "progress_report"
    REQUEST_INFO = "request_info"
    RESPONSE_INFO = "response_info"

class CollaborateMessage(BaseModel):
    id: UUID
    from_yoo_id: UUID
    to_yoo_id: UUID
    topic: str
    message_type: MessageType
    payload: dict
    trace_id: Optional[UUID] = None
    created_at: datetime

class CollaborateBus:
    def __init__(
        self,
        message_repo: MessageRepository,
        bridge_service: BridgeService,
        redis: Redis
    ):
        self.message_repo = message_repo
        self.bridge_service = bridge_service
        self.redis = redis
        self.pubsub = None

    async def send(
        self,
        from_yoo_id: UUID,
        to_yoo_id: UUID,
        topic: str,
        message_type: MessageType,
        payload: dict,
        user_id: UUID
    ) -> CollaborateMessage:
        """发送协作消息"""
        # 创建消息记录
        message = await self.message_repo.create(
            from_yoo_id=from_yoo_id,
            to_yoo_id=to_yoo_id,
            topic=topic,
            message_type=message_type,
            payload=payload
        )

        # 发布到 Redis Pub/Sub
        await self.redis.publish(
            f"collab:{to_yoo_id}",
            message.json()
        )

        # 异步通知目标 Yoo
        await self.bridge_service.notify_yoo(
            to_yoo_id,
            "collaborate.message",
            message.dict()
        )

        return message

    async def assign_task(
        self,
        from_yoo_id: UUID,
        to_yoo_id: UUID,
        task_id: UUID,
        task_data: dict,
        user_id: UUID
    ) -> CollaborateMessage:
        """分配任务给其他 Yoo"""
        return await self.send(
            from_yoo_id=from_yoo_id,
            to_yoo_id=to_yoo_id,
            topic=f"task:{task_id}",
            message_type=MessageType.TASK_ASSIGN,
            payload={
                "task_id": str(task_id),
                "task_data": task_data,
                "assigned_by": str(user_id)
            },
            user_id=user_id
        )

    async def subscribe(self, yoo_id: UUID):
        """订阅协作消息"""
        if not self.pubsub:
            self.pubsub = self.redis.pubsub()

        await self.pubsub.subscribe(f"collab:{yoo_id}")

        async for message in self.pubsub.listen():
            if message["type"] == "message":
                data = json.loads(message["data"])
                yield CollaborateMessage(**data)

    async def get_messages(
        self,
        yoo_id: UUID,
        tenant_id: UUID,
        since: datetime = None,
        limit: int = 50
    ) -> List[CollaborateMessage]:
        """获取协作消息历史"""
        return await self.message_repo.list_by_yoo(
            yoo_id=yoo_id,
            tenant_id=tenant_id,
            since=since,
            limit=limit
        )
```

---

## 5. 数据库模型

### 5.1 核心实体

```python
# app/models/user.py
class User(Base):
    __tablename__ = "users"

    id = Column(UUID, primary_key=True, default=uuid4())
    tenant_id = Column(UUID, ForeignKey("tenants.id"), nullable=False)
    email = Column(String(255), nullable=False)
    password_hash = Column(String(255), nullable=False)
    name = Column(String(255), nullable=False)
    avatar_url = Column(Text)
    role = Column(String(50), default="member")
    is_active = Column(Boolean, default=True)
    email_verified = Column(Boolean, default=False)
    last_login_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("email", "tenant_id", name="uk_users_email_tenant"),
        Index("idx_users_tenant_id", "tenant_id"),
    )

# app/models/yoo.py
class Yoo(Base):
    __tablename__ = "yooos"

    id = Column(UUID, primary_key=True, default=uuid4())
    tenant_id = Column(UUID, ForeignKey("tenants.id"), nullable=False)
    user_id = Column(UUID, ForeignKey("users.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    config = Column(JSONB, default={})
    status = Column(String(50), default="stopped")
    current_model = Column(String(100))
    memory_usage = Column(BigInteger, default=0)
    last_heartbeat_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uk_yooos_user_name"),
        Index("idx_yooos_tenant_id", "tenant_id"),
        Index("idx_yooos_user_id", "user_id"),
        Index("idx_yooos_status", "status"),
    )

# app/models/task.py
class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID, primary_key=True, default=uuid4())
    tenant_id = Column(UUID, ForeignKey("tenants.id"), nullable=False)
    yoo_id = Column(UUID, ForeignKey("yooos.id"), nullable=False)
    user_id = Column(UUID, ForeignKey("users.id"), nullable=False)
    title = Column(String(500), nullable=False)
    description = Column(Text)
    status = Column(String(50), default="pending")
    priority = Column(Integer, default=3)
    task_type = Column(String(50))
    due_at = Column(DateTime)
    completed_at = Column(DateTime)
    result = Column(JSONB)
    metadata = Column(JSONB, default={})
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        Index("idx_tasks_tenant_id", "tenant_id"),
        Index("idx_tasks_yoo_id", "yoo_id"),
        Index("idx_tasks_status", "status"),
    )
```

---

## 6. 依赖注入配置

```python
# app/dependencies.py
from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

async def get_db() -> AsyncSession:
    """获取数据库会话"""
    async with get_session() as session:
        yield session

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    token_service: TokenService = Depends(get_token_service)
) -> TokenPayload:
    """获取当前用户"""
    try:
        return token_service.verify_token(token)
    except TokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message
        )

async def require_admin(
    current_user: TokenPayload = Depends(get_current_user)
) -> TokenPayload:
    """检查管理员权限"""
    if current_user.role not in ["owner", "admin"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required"
        )
    return current_user

# 服务依赖
def get_auth_service(
    user_repo: UserRepository = Depends(get_user_repo),
    tenant_repo: TenantRepository = Depends(get_tenant_repo),
    token_service: TokenService = Depends(get_token_service)
) -> AuthService:
    return AuthService(
        user_repo=user_repo,
        tenant_repo=tenant_repo,
        token_service=token_service,
        password_service=PasswordService()
    )

def get_yoo_service(
    yoo_repo: YooRepository = Depends(get_yoo_repo),
    task_repo: TaskRepository = Depends(get_task_repo),
    bridge_service: BridgeService = Depends(get_bridge_service)
) -> YooService:
    return YooService(
        yoo_repo=yoo_repo,
        task_repo=task_repo,
        bridge_service=bridge_service
    )
```

---

## 7. 错误处理

```python
# app/exceptions.py
from fastapi import HTTPException, status

class YoyooException(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)

class NotFoundError(YoyooException):
    def __init__(self, message: str = "Resource not found"):
        super().__init__("NOT_FOUND", message, status.HTTP_404_NOT_FOUND)

class ValidationError(YoyooException):
    def __init__(self, message: str):
        super().__init__("VALIDATION_ERROR", message, status.HTTP_400_BAD_REQUEST)

class AuthenticationError(YoyooException):
    def __init__(self, message: str = "Authentication failed"):
        super().__init__("AUTH_ERROR", message, status.HTTP_401_UNAUTHORIZED)

class ForbiddenError(YoyooException):
    def __init__(self, message: str = "Access denied"):
        super().__init__("FORBIDDEN", message, status.HTTP_403_FORBIDDEN)

# 异常处理器
from fastapi import Request
from fastapi.responses import JSONResponse

@app.exception_handler(YoyooException)
async def yoo_exception_handler(request: Request, exc: YoyooException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message
            }
        }
    )
```

---

## 8. 总结

### 8.1 API 清单

| 模块 | 端点数量 | 主要功能 |
|------|----------|----------|
| Auth | 5 | 注册、登录、刷新、登出、获取用户 |
| Users | 5 | 用户 CRUD、个人信息 |
| Yooos | 9 | CRUD、启动、停止、对话、任务 |
| Tasks | 6 | CRUD、取消 |
| Collaborate | 5 | 网络、消息、分配、待处理 |
| **总计** | **30** | - |

### 8.2 服务清单

| 服务 | 职责 |
|------|------|
| AuthService | 认证、授权 |
| TenantService | 租户管理 |
| YooService | Yoo 实例生命周期 |
| TaskService | 任务管理 |
| CollaborateBus | 协作消息总线 |
| BridgeService | OpenClaw 连接管理 |
| TokenService | JWT Token 管理 |
| PasswordService | 密码处理 |

### 8.3 下一步

1. 实现数据库迁移 (Alembic)
2. 集成测试
3. 性能优化
4. 安全审计

---

> **文档版本**: 0.1.0
> **创建人**: Yoyoo
> **最后更新**: 2026-01-31
> **状态**: Draft - 待评审
