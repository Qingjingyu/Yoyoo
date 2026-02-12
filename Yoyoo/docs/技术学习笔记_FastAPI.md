# Yoyoo 技术学习笔记：FastAPI 框架

> **学习日期**: 2026-01-31
> **目标**: 掌握 FastAPI 框架，为 Yoyoo 控制层实现做准备

---

## 1. FastAPI 简介

### 1.1 什么是 FastAPI

FastAPI 是一个现代、高性能的 Python Web 框架，用于构建 API。

| 特性 | 说明 |
|------|------|
| **高性能** | 基于 Starlette 和 Pydantic，性能接近 NodeJS 和 Go |
| **易用性** | 直观、简洁的 API 设计 |
| **类型安全** | 基于 Python 类型提示，自动数据验证 |
| **自动文档** | 自动生成 OpenAPI 和 ReDoc 文档 |
| **异步支持** | 原生异步支持 (async/await) |

### 1.2 安装

```bash
pip install fastapi
pip install uvicorn[standard]  # ASGI 服务器
```

### 1.3 第一个应用

```python
from fastapi import FastAPI
from pydantic import BaseModel
from typing import Optional

app = FastAPI(
    title="Yoyoo Platform API",
    description="多用户智能代理协作平台",
    version="0.1.0"
)

@app.get("/")
async def root():
    return {"message": "Welcome to Yoyoo!"}

@app.get("/health")
async def health_check():
    return {"status": "healthy"}

# 启动命令
# uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

---

## 2. 路由和参数

### 2.1 HTTP 方法

```python
from fastapi import APIRouter

router = APIRouter()

@router.get("/items")           # 获取资源
@router.post("/items")           # 创建资源
@router.put("/items/{item_id}")  # 更新资源
@router.delete("/items/{item_id}")  # 删除资源
@router.patch("/items/{item_id}")   # 部分更新
async def handle_items(item_id: int):
    return {"item_id": item_id}
```

### 2.2 路径参数

```python
@app.get("/users/{user_id}")
async def get_user(user_id: int):
    """路径参数：/users/123"""
    return {"user_id": user_id}

@app.get("/files/{file_path:path}")
async def get_file(file_path: str):
    """路径参数（包含斜杠）：/files/a/b/c.txt"""
    return {"file_path": file_path}
```

### 2.3 查询参数

```python
@app.get("/users")
async def list_users(
    skip: int = 0,           # 默认值
    limit: int = 10,          # 默认值
    is_active: Optional[bool] = None  # 可选参数
):
    """查询参数：/users?skip=0&limit=10&is_active=true"""
    return {
        "skip": skip,
        "limit": limit,
        "is_active": is_active
    }
```

### 2.4 请求体

```python
from pydantic import BaseModel

class UserCreate(BaseModel):
    email: str
    password: str
    name: str

class UserResponse(BaseModel):
    id: int
    email: str
    name: str

@app.post("/users", response_model=UserResponse)
async def create_user(user: UserCreate):
    """JSON 请求体"""
    # 验证后的数据
    print(f"Received: {user.email}, {user.name}")

    # 创建用户
    created_user = {
        "id": 1,
        "email": user.email,
        "name": user.name
    }

    return created_user
```

### 2.5 混合参数

```python
@app.put("/users/{user_id}/items/{item_id}")
async def update_item(
    user_id: int,              # 路径参数
    item_id: int,              # 路径参数
    q: Optional[str] = None,   # 查询参数
    item: ItemUpdate = None    # 请求体
):
    return {
        "user_id": user_id,
        "item_id": item_id,
        "q": q,
        "item": item
    }
```

---

## 3. 数据模型 (Pydantic)

### 3.1 BaseModel

```python
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict
from datetime import datetime
from enum import Enum

class UserRole(str, Enum):
    FREE = "free"
    PRO = "pro"
    ENTERPRISE = "enterprise"

class User(BaseModel):
    id: int
    email: EmailStr  # 自动验证邮箱格式
    name: str = Field(..., min_length=1, max_length=100)
    role: UserRole = UserRole.FREE
    is_active: bool = True
    created_at: datetime = Field(default_factory=datetime.utcnow)
    tags: List[str] = []
    metadata: Optional[Dict] = None

    class Config:
        from_attributes = True
```

### 3.2 嵌套模型

```python
class Address(BaseModel):
    street: str
    city: str
    country: str
    zip_code: Optional[str] = None

class Company(BaseModel):
    name: str
    address: Address
    employees: List["User"] = []

class UserWithCompany(User):
    company: Optional[Company] = None
```

### 3.3 字段验证

```python
class Task(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=1000)
    priority: int = Field(1, ge=1, le=5)  # 1-5 之间
    due_date: Optional[datetime] = None
    tags: List[str] = Field(default_factory=list)

    @validator("due_date")
    def due_date_must_be_future(cls, v):
        if v and v < datetime.utcnow():
            raise ValueError("due_date must be in the future")
        return v
```

### 3.4 响应模型

```python
class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    # 敏感字段不会出现在响应中
    password: str = Field(exclude=True)

@app.get("/users/{user_id}", response_model=UserResponse)
async def get_user(user_id: int):
    user = db.get_user(user_id)
    return user
```

---

## 4. 依赖注入系统

### 4.1 基本依赖

```python
from fastapi import Depends, HTTPException, status
from typing import Optional

# 简单的依赖函数
def get_query_parameter(q: Optional[str] = None):
    if q:
        return f"searching for: {q}"
    return None

@app.get("/items/")
async def read_items(
    q: str = Depends(get_query_parameter)
):
    return {"q": q}

# 类作为依赖
class QueryChecker:
    def __init__(self, min_length: int = 3):
        self.min_length = min_length

    def __call__(self, q: str = None):
        if q and len(q) < self.min_length:
            raise HTTPException(
                status_code=400,
                detail="Query too short"
            )
        return q

checker = QueryChecker(min_length=3)

@app.get("/search/")
async def search(q: str = Depends(checker)):
    return {"result": q}
```

### 4.2 数据库依赖

```python
from databases import Database
import sqlalchemy

DATABASE_URL = "postgresql://user:pass@localhost/yoyoo"
database = Database(DATABASE_URL)

metadata = sqlalchemy.MetaData()

users = sqlalchemy.Table(
    "users",
    metadata,
    sqlalchemy.Column("id", sqlalchemy.Integer, primary_key=True),
    sqlalchemy.Column("email", sqlalchemy.String),
    sqlalchemy.Column("name", sqlalchemy.String),
    sqlalchemy.Column("hashed_password", sqlalchemy.String),
    sqlalchemy.Column("is_active", sqlalchemy.Boolean),
)

# 获取数据库连接
async def get_db():
    await database.connect()
    try:
        yield database
    finally:
        await database.disconnect()

# 使用依赖
@app.get("/users")
async def list_users(db: Database = Depends(get_db)):
    query = users.select()
    results = await db.fetch_all(query)
    return results
```

### 4.3 认证依赖

```python
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

security = HTTPBearer()

async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
) -> User:
    token = credentials.credentials

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: int = payload.get("sub")
        user = db.get_user(user_id)
        if user is None:
            raise HTTPException(
                status_code=401,
                detail="User not found"
            )
        return user
    except JWTError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )

# 使用认证依赖
@app.get("/me")
async def get_me(user: User = Depends(get_current_user)):
    return user
```

### 4.4 多层依赖

```python
class DataChecker:
    def __init__(self, role: str):
        self.role = role

    async def __call__(self, user: User = Depends(get_current_user)):
        if user.role != self.role and user.role != "admin":
            raise HTTPException(
                status_code=403,
                detail="Insufficient permissions"
            )
        return user

# 需要特定角色
require_admin = DataChecker("admin")
require_pro = DataChecker("pro")

@app.post("/admin-only")
async def admin_endpoint(user: User = Depends(require_admin)):
    return {"message": "Admin access granted"}
```

---

## 5. 中间件和 CORS

### 5.1 中间件

```python
import time
from fastapi.middleware.base import BaseHTTPMiddleware

class TimingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        start_time = time.time()
        response = await call_next(request)
        process_time = time.time() - start_time
        response.headers["X-Process-Time"] = str(process_time)
        return response

app.add_middleware(TimingMiddleware)

# 自定义中间件
@app.middleware("http")
async def add_custom_header(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Custom-Header"] = "Yoyoo"
    return response
```

### 5.2 CORS 配置

```python
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://yoyoo.example.com",
        "http://localhost:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 6. 认证和授权

### 6.1 OAuth2 with Password (JWT)

```python
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta

SECRET_KEY = "your-secret-key"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/token")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: timedelta = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

@app.post("/auth/token")
async def login(form_data: OAuth2PasswordRequestForm = Depends()):
    user = db.get_user_by_email(form_data.username)
    if not user or not verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.email, "role": user.role},
        expires_delta=access_token_expires
    )

    return {
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role
        }
    }
```

### 6.2 Scope-based 授权

```python
from fastapi import Security
from fastapi.security import OAuth2Scopes

scopes = OAuth2Scopes(
    scope_descriptions={
        "read:users": "Read users information",
        "write:users": "Create or update users",
        "read:tasks": "Read tasks",
        "write:tasks": "Create or update tasks",
        "admin": "Admin access",
    }
)

async def get_current_active_user(
    token: str = Security(oauth2_scheme, scopes=[])
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        if email is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception

    user = db.get_user_by_email(email)
    if user is None:
        raise credentials_exception

    # 验证 scope
    token_scopes = payload.get("scopes", [])
    required_scopes = scopes.scope.split()
    for scope in required_scopes:
        if scope not in token_scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions"
            )

    return user

# 使用
@app.get("/users/me", response_model=UserResponse)
async def get_me(user: User = Security(get_current_active_user, scopes=["read:users"])):
    return user
```

---

## 7. WebSocket 支持

```python
from fastapi import WebSocket, WebSocketDisconnect

class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def send_personal_message(self, message: str, websocket: WebSocket):
        await websocket.send_text(message)

    async def broadcast(self, message: str):
        for connection in self.active_connections:
            await connection.send_text(message)

manager = ConnectionManager()

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            await manager.send_personal_message(f"You wrote: {data}", websocket)
            await manager.broadcast(f"Client {client_id} says: {data}")
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        await manager.broadcast(f"Client {client_id} left the chat")
```

---

## 8. Yoyoo API 设计

### 8.1 API 结构

```
Yoyoo API/
├── /auth
│   ├── POST /token          # 登录获取 Token
│   ├── POST /register       # 用户注册
│   └── POST /refresh        # 刷新 Token
│
├── /users
│   ├── GET /me              # 当前用户信息
│   ├── PATCH /me            # 更新当前用户
│   ├── GET /{user_id}       # 获取用户信息
│   └── GET /{user_id}/yooos  # 获取用户的 Yoyoo 列表
│
├── /yooos
│   ├── GET /                 # 获取我的 Yoyoo
│   ├── POST /                # 创建新的 Yoyoo
│   ├── GET /{yoo_id}        # 获取 Yoyoo 信息
│   ├── PATCH /{yoo_id}      # 更新 Yoyoo 配置
│   ├── DELETE /{yoo_id}     # 删除 Yoyoo
│   ├── POST /{yoo_id}/start  # 启动 Yoyoo
│   ├── POST /{yoo_id}/stop   # 停止 Yoyoo
│   └── POST /{yoo_id}/chat   # 与 Yoyoo 对话
│
├── /tasks
│   ├── GET /                 # 获取任务列表
│   ├── POST /                 # 创建任务
│   ├── GET /{task_id}        # 获取任务详情
│   ├── PATCH /{task_id}      # 更新任务
│   └── DELETE /{task_id}      # 删除任务
│
└── /collaborate
    ├── GET /network           # 获取协作网络
    ├── POST /send            # 发送消息给其他 Yoyoo
    └── GET /messages         # 获取协作消息
```

### 8.2 Yoyoo API 实现

```python
from fastapi import FastAPI, Depends, HTTPException, status
from typing import List, Optional

app = FastAPI(
    title="Yoyoo Platform API",
    description="多用户智能代理协作平台",
    version="0.1.0"
)

# 认证依赖
async def get_current_user(token: str = Depends(oauth2_scheme)):
    # 验证 JWT Token
    user = verify_token(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token"
        )
    return user

# 用户相关
@app.get("/users/me", response_model=UserResponse)
async def get_me(user: User = Depends(get_current_user)):
    return user

# Yoyoo 实例管理
@app.get("/yooos", response_model=List[YooResponse])
async def list_yooos(user: User = Depends(get_current_user)):
    yooos = db.get_yooos_by_user_id(user.id)
    return yooos

@app.post("/yooos", response_model=YooResponse, status_code=status.HTTP_201_CREATED)
async def create_yoo(
    data: YooCreate,
    user: User = Depends(get_current_user)
):
    yoo = db.create_yoo(user.id, data)
    return yoo

@app.post("/yooos/{yoo_id}/start")
async def start_yoo(
    yoo_id: int,
    user: User = Depends(get_current_user)
):
    yoo = db.get_yoo(yoo_id)
    if yoo.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your Yoyoo")

    # 启动 Yoyoo 实例
    await yoo_manager.start(yoo_id)
    return {"status": "started"}

@app.post("/yooos/{yoo_id}/stop")
async def stop_yoo(
    yoo_id: int,
    user: User = Depends(get_current_user)
):
    yoo = db.get_yoo(yoo_id)
    if yoo.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not your Yoyoo")

    await yoo_manager.stop(yoo_id)
    return {"status": "stopped"}

# 协作
@app.post("/collaborate/send")
async def send_to_yoo(
    data: CollaborateRequest,
    user: User = Depends(get_current_user)
):
    # 发送消息给其他用户的 Yoyoo
    message = {
        "from_user_id": user.id,
        "to_yoo_id": data.to_yoo_id,
        "topic": data.topic,
        "payload": data.payload
    }
    await collaborate_bus.send(message)
    return {"status": "sent"}
```

---

## 9. 错误处理

### 9.1 自定义错误

```python
from fastapi import Request
from fastapi.responses import JSONResponse

class YoyooException(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400):
        self.code = code
        self.message = message
        self.status_code = status_code

@app.exception_handler(YoyooException)
async def yoo_exception_handler(request: Request, exc: YooException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message
            }
        }
    )

@app.get("/yoo/{yoo_id}")
async def get_yoo(yoo_id: int):
    yoo = db.get_yoo(yoo_id)
    if not yoo:
        raise YoyooException(
            code="YOO_NOT_FOUND",
            message="Yoyoo not found",
            status_code=404
        )
    return yoo
```

### 9.2 全局错误处理

```python
@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": "HTTP_ERROR",
                "message": str(exc.detail)
            }
        }
    )

@app.exception_handler(Exception)
async def general_exception_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL_ERROR",
                "message": "An internal error occurred"
            }
        }
    )
```

---

## 10. 项目结构

### 10.1 推荐目录结构

```
Yoyoo/
├── app/
│   ├── __init__.py
│   ├── main.py                 # 应用入口
│   ├── config.py              # 配置
│   ├── database.py            # 数据库连接
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── v1/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py        # 认证相关
│   │   │   ├── users.py       # 用户相关
│   │   │   ├── yooos.py       # Yoyoo 实例相关
│   │   │   ├── tasks.py       # 任务相关
│   │   │   └── collaborate.py  # 协作相关
│   │   └── router.py         # 路由汇总
│   │
│   ├── core/
│   │   ├── __init__.py
│   │   ├── security.py       # 安全相关
│   │   ├── websocket.py      # WebSocket 管理
│   │   └── events.py        # 事件系统
│   │
│   ├── models/
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── yoo.py
│   │   └── task.py
│   │
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── user.py
│   │   ├── yoo.py
│   │   └── task.py
│   │
│   └── services/
│       ├── __init__.py
│       ├── yoo_manager.py   # Yoyoo 实例管理
│       ├── brain.py        # Brain 集成
│       └── collaborate.py  # 协作服务
│
├── tests/
│   ├── __init__.py
│   ├── test_api/
│   └── test_core/
│
└── requirements.txt
```

### 10.2 应用入口

```python
# app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.router import api_router
from app.core.config import settings

app = FastAPI(
    title=settings.PROJECT_NAME,
    description=settings.PROJECT_DESCRIPTION,
    version=settings.VERSION,
    openapi_url=f"{settings.API_V1_STR}/openapi.json"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 路由
app.include_router(api_router, prefix=settings.API_V1_STR)

# 健康检查
@app.get("/health")
async def health_check():
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

---

## 11. 总结

### 11.1 关键要点

| 特性 | 关键点 |
|------|--------|
| **路由** | @app.get/post/put/delete 装饰器 |
| **参数** | 路径、查询、请求体参数 |
| **数据验证** | Pydantic BaseModel |
| **依赖注入** | Depends() 注入依赖 |
| **认证** | OAuth2 + JWT |
| **WebSocket** | @app.websocket() |
| **错误处理** | exception_handler |

### 11.2 Yoyoo API 核心功能

```python
# 认证
POST /auth/token          # 登录
POST /auth/register      # 注册

# Yoyoo 实例
GET /yooos              # 列出 Yooos
POST /yooos              # 创建 Yoo
POST /yooos/{id}/start   # 启动
POST /yooos/{id}/stop    # 停止
POST /yooos/{id}/chat   # 对话

# 协作
POST /collaborate/send   # 发送消息
GET /collaborate/network # 协作网络
```

### 11.3 下一步

1. 实际编码测试 FastAPI 应用
2. 集成数据库 (PostgreSQL)
3. 实现完整的认证系统
4. 集成 OpenClaw Bridge

---

> **笔记版本**: 1.0
> **创建人**: Yoyoo
> **最后更新**: 2026-01-31
> **状态**: FastAPI 基础学习完成
