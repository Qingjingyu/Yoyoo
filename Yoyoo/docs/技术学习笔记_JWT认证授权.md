# Yoyoo 技术学习笔记：JWT 认证授权

> **学习日期**: 2026-01-31
> **目标**: 掌握 JWT 认证授权机制，为 Yoyoo 平台设计安全认证系统

---

## 1. JWT 基础

### 1.1 什么是 JWT

JWT (JSON Web Token) 是一种用于双方之间安全传输信息的标准。

| 特性 | 说明 |
|------|------|
| **自包含** | 包含所有必要信息，无需查询数据库 |
| **可验证** | 包含签名，可验证真实性 |
| **跨域友好** | 纯文本，适合分布式系统 |
| **高效** | JSON 解析比数据库查询快 |

### 1.2 JWT 结构

```
JWT = Base64(Header) + "." + Base64(Payload) + "." + Signature

# 示例
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9
.
eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ
.
SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c
```

#### Header (头部)
```json
{
  "alg": "HS256",      // 签名算法
  "typ": "JWT"        // token 类型
}
```

#### Payload (载荷)
```json
{
  "sub": "user-123",           // 用户 ID
  "email": "user@example.com",  // 用户邮箱
  "tenant_id": "tenant-456",    // 租户 ID
  "role": "admin",             // 角色
  "scope": ["read:users", "write:tasks"],  // 权限范围
  "iat": 1704067200,          // 签发时间
  "exp": 1704153600,           // 过期时间
  "jti": "unique-token-id"     // token 唯一标识
}
```

#### Signature (签名)
```
HMAC-SHA256(
  base64urlEncode(header) + "." + base64urlEncode(payload),
  secret_key
)
```

### 1.3 JWT 库选择

| 库 | 语言 | 特点 |
|-----|------|------|
| **PyJWT** | Python | 官方推荐，简洁易用 |
| **python-jose** | Python | 功能更丰富，支持加密 |
| **jose** | JavaScript | Node.js 标准库 |

**安装**:
```bash
pip install PyJWT
pip install cryptography  # 用于生成密钥
```

---

## 2. Yoyoo JWT 设计

### 2.1 Token 类型

| Token 类型 | 有效期 | 用途 |
|-----------|--------|------|
| **Access Token** | 30 分钟 | API 访问 |
| **Refresh Token** | 7 天 | 续签 Access Token |
| **API Key** | 永不过期 | 服务间调用 |

### 2.2 Token 载荷设计

```python
from dataclasses import dataclass
from datetime import datetime
from typing import List, Optional
from enum import Enum

class UserRole(str, Enum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"

@dataclass
class TokenPayload:
    # 标准声明
    sub: str                    # 用户 ID
    iat: int                   # 签发时间
    exp: int                   # 过期时间
    jti: str                   # token 唯一标识

    # Yoyoo 特定声明
    tenant_id: str             # 租户 ID
    email: str                 # 用户邮箱
    role: UserRole            # 角色
    plan: str = "free"        # 订阅计划
    scopes: List[str] = None   # 权限范围

    @property
    def is_admin(self) -> bool:
        return self.role in [UserRole.OWNER, UserRole.ADMIN]
```

### 2.3 配置

```python
from pydantic import BaseSettings
from datetime import timedelta

class JWTConfig(BaseSettings):
    # 密钥配置
    SECRET_KEY: str = "your-super-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    PUBLIC_KEY: Optional[str] = None  # RS256 时使用
    PRIVATE_KEY: Optional[str] = None

    # Token 有效期
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    API_KEY_EXPIRE_DAYS: int = 365

    # Token 刷新
    REFRESH_TOKEN_ROTATION: bool = True  # 每次刷新都更新 refresh token

    class Config:
        env_prefix = "JWT_"

jwt_config = JWTConfig()
```

---

## 3. 核心实现

### 3.1 Token 生成

```python
import jwt
import uuid
from datetime import datetime, timedelta
from typing import Optional
from dataclasses import dataclass

@dataclass
class TokenPair:
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "Bearer"

class TokenService:
    def __init__(self, config: JWTConfig):
        self.config = config
        self.secret_key = config.SECRET_KEY
        self.algorithm = config.ALGORITHM

    def create_access_token(
        self,
        user_id: str,
        tenant_id: str,
        email: str,
        role: str,
        plan: str = "free",
        scopes: List[str] = None,
        extra_claims: dict = None
    ) -> str:
        """创建 Access Token"""
        now = datetime.utcnow()

        payload = {
            "sub": user_id,
            "tenant_id": tenant_id,
            "email": email,
            "role": role,
            "plan": plan,
            "scope": scopes or [],
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=self.config.ACCESS_TOKEN_EXPIRE_MINUTES)).timestamp()),
            "jti": str(uuid.uuid4()),
            "type": "access"
        }

        if extra_claims:
            payload.update(extra_claims)

        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def create_refresh_token(
        self,
        user_id: str,
        tenant_id: str,
        token_id: str = None
    ) -> str:
        """创建 Refresh Token"""
        now = datetime.utcnow()

        payload = {
            "sub": user_id,
            "tenant_id": tenant_id,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(days=self.config.REFRESH_TOKEN_EXPIRE_DAYS)).timestamp()),
            "jti": token_id or str(uuid.uuid4()),
            "type": "refresh"
        }

        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def create_token_pair(
        self,
        user_id: str,
        tenant_id: str,
        email: str,
        role: str,
        plan: str = "free",
        scopes: List[str] = None
    ) -> TokenPair:
        """创建 Token 对（access + refresh）"""
        access_token = self.create_access_token(
            user_id=user_id,
            tenant_id=tenant_id,
            email=email,
            role=role,
            plan=plan,
            scopes=scopes
        )

        refresh_token = self.create_refresh_token(
            user_id=user_id,
            tenant_id=tenant_id
        )

        return TokenPair(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=self.config.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        )
```

### 3.2 Token 验证

```python
from jwt import PyJWTError, ExpiredSignatureError, InvalidTokenError
from typing import Optional

class TokenError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)

class TokenService:
    # ... (前面的代码)

    def verify_token(self, token: str) -> TokenPayload:
        """验证 Token 并返回载荷"""
        try:
            payload = jwt.decode(
                token,
                self.secret_key,
                algorithms=[self.algorithm],
                options={
                    "verify_exp": True,
                    "verify_iat": True,
                    "require": ["sub", "tenant_id", "exp", "jti"]
                }
            )

            return TokenPayload(
                sub=payload["sub"],
                tenant_id=payload["tenant_id"],
                email=payload.get("email", ""),
                role=payload.get("role", "member"),
                plan=payload.get("plan", "free"),
                scopes=payload.get("scope", []),
                iat=payload["iat"],
                exp=payload["exp"],
                jti=payload["jti"]
            )

        except ExpiredSignatureError:
            raise TokenError("TOKEN_EXPIRED", "Token has expired")
        except InvalidTokenError as e:
            raise TokenError("INVALID_TOKEN", f"Invalid token: {str(e)}")
        except Exception as e:
            raise TokenError("TOKEN_ERROR", f"Token validation failed: {str(e)}")

    def refresh_tokens(self, refresh_token: str) -> TokenPair:
        """使用 Refresh Token 获取新的 Token 对"""
        # 验证 refresh token
        payload = jwt.decode(
            refresh_token,
            self.secret_key,
            algorithms=[self.algorithm],
            options={"verify_exp": True}
        )

        if payload.get("type") != "refresh":
            raise TokenError("INVALID_REFRESH_TOKEN", "Not a refresh token")

        user_id = payload["sub"]
        tenant_id = payload["tenant_id"]

        # 获取用户信息（从数据库）
        user = self.get_user_by_id(user_id, tenant_id)
        if not user or not user.is_active:
            raise TokenError("USER_NOT_FOUND", "User not found or inactive")

        # 创建新的 Token 对
        return self.create_token_pair(
            user_id=user_id,
            tenant_id=tenant_id,
            email=user.email,
            role=user.role,
            plan=user.plan,
            scopes=user.get_scopes()
        )
```

### 3.3 密码处理

```python
from passlib.context import CryptContext
import secrets

# 密码哈希配置
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=12  # 安全性和性能的平衡
)

class PasswordService:
    def hash_password(self, password: str) -> str:
        """哈希密码"""
        return pwd_context.hash(password)

    def verify_password(self, plain_password: str, hashed_password: str) -> bool:
        """验证密码"""
        return pwd_context.verify(plain_password, hashed_password)

    def generate_secure_password(self, length: int = 16) -> str:
        """生成安全密码"""
        alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
        return "".join(secrets.choice(alphabet) for _ in range(length))

    def check_password_strength(self, password: str) -> tuple[bool, str]:
        """检查密码强度"""
        if len(password) < 8:
            return False, "Password must be at least 8 characters"
        if not any(c.isupper() for c in password):
            return False, "Password must contain uppercase letters"
        if not any(c.islower() for c in password):
            return False, "Password must contain lowercase letters"
        if not any(c.isdigit() for c in password):
            return False, "Password must contain numbers"
        return True, "Password is strong"
```

---

## 4. FastAPI 集成

### 4.1 依赖注入

```python
from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from typing import Optional, List
from datetime import datetime

oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/token",
    auto_error=True
)

async def get_current_user(
    token: str = Depends(oauth2_scheme),
    token_service: TokenService = Depends(get_token_service)
) -> TokenPayload:
    """获取当前用户（从 Access Token）"""
    try:
        payload = token_service.verify_token(token)
        return payload
    except TokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message,
            headers={"WWW-Authenticate": "Bearer"}
        )

async def get_current_active_user(
    current_user: TokenPayload = Depends(get_current_user),
    user_service: UserService = Depends(get_user_service)
) -> User:
    """获取当前活跃用户"""
    user = await user_service.get_user_by_id(
        current_user.sub,
        current_user.tenant_id
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User is inactive"
        )
    return user

def require_roles(*allowed_roles: str):
    """角色检查依赖"""
    async def role_checker(
        current_user: TokenPayload = Depends(get_current_user)
    ) -> TokenPayload:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role {current_user.role} not allowed. Required: {allowed_roles}"
            )
        return current_user
    return role_checker
```

### 4.2 认证路由

```python
from fastapi import APIRouter, Depends
from fastapi.security import OAuth2PasswordRequestForm

router = APIRouter(prefix="/auth", tags=["认证"])

@router.post("/token", response_model=TokenResponse)
async def login(
    form_data: OAuth2PasswordRequestForm = Depends(),
    user_service: UserService = Depends(get_user_service),
    token_service: TokenService = Depends(get_token_service)
):
    """用户名密码登录"""
    # 查找用户
    user = await user_service.get_user_by_email(
        email=form_data.username,
        tenant_id=None  # 邮箱唯一，不需要 tenant
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # 验证密码
    if not password_service.verify_password(
        form_data.password,
        user.hashed_password
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"}
        )

    # 检查用户状态
    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is disabled"
        )

    # 生成 Token
    token_pair = token_service.create_token_pair(
        user_id=str(user.id),
        tenant_id=str(user.tenant_id),
        email=user.email,
        role=user.role,
        plan=user.plan,
        scopes=user.get_scopes()
    )

    # 更新最后登录时间
    await user_service.update_last_login(user.id)

    return TokenResponse(
        access_token=token_pair.access_token,
        refresh_token=token_pair.refresh_token,
        expires_in=token_pair.expires_in,
        token_type="Bearer",
        user=UserResponse(
            id=user.id,
            email=user.email,
            name=user.name,
            role=user.role,
            plan=user.plan
        )
    )

@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    refresh_token: str = Body(...),
    token_service: TokenService = Depends(get_token_service),
    user_service: UserService = Depends(get_user_service)
):
    """使用 Refresh Token 刷新 Access Token"""
    try:
        token_pair = token_service.refresh_tokens(refresh_token)
        return TokenResponse(
            access_token=token_pair.access_token,
            refresh_token=token_pair.refresh_token,
            expires_in=token_pair.expires_in,
            token_type="Bearer"
        )
    except TokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=e.message
        )

@router.post("/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(
    data: UserRegister,
    user_service: UserService = Depends(get_user_service)
):
    """用户注册"""
    # 检查邮箱是否已存在
    existing = await user_service.get_user_by_email(data.email)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )

    # 检查租户是否存在（通过 slug）
    tenant = await tenant_service.get_by_slug(data.tenant_slug)
    if not tenant:
        # 如果租户不存在，创建新租户
        tenant = await tenant_service.create(
            name=data.tenant_name or data.email.split("@")[0],
            slug=data.tenant_slug or data.email.split("@")[0].lower().replace("_", "-")
        )

    # 创建用户
    user = await user_service.create(
        email=data.email,
        password=data.password,
        name=data.name,
        tenant_id=tenant.id,
        role=UserRole.OWNER  # 注册用户为租户所有者
    )

    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        plan=user.plan
    )
```

### 4.3 权限范围 (Scopes)

```python
from fastapi import Security
from fastapi.security import OAuth2Scopes

scopes = OAuth2Scopes(
    scope_descriptions={
        "read:users": "查看用户信息",
        "write:users": "创建/修改用户",
        "read:yooos": "查看 Yooos",
        "write:yooos": "管理 Yooos",
        "read:tasks": "查看任务",
        "write:tasks": "管理任务",
        "admin": "完全管理权限",
    }
)

async def get_current_user_with_scopes(
    token_data: TokenPayload = Security(get_current_user, scopes=scopes.scope)
) -> TokenPayload:
    """获取当前用户（带 Scope 验证）"""
    required_scopes = scopes.scope.split()
    token_scopes = set(token_data.scopes)

    for scope in required_scopes:
        if scope not in token_scopes:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Missing scope: {scope}"
            )

    return token_data

# 使用示例
@router.get("/users", response_model=List[UserResponse])
async def list_users(
    _: TokenPayload = Security(get_current_user_with_scopes, scopes=["read:users"]),
    user_service: UserService = Depends(get_user_service)
):
    """列出用户（需要 read:users scope）"""
    users = await user_service.list_users()
    return users
```

---

## 5. API Key 认证

### 5.1 API Key 设计

```python
@dataclass
class APIKey:
    id: UUID
    key_hash: str
    tenant_id: UUID
    name: str
    scopes: List[str]
    last_used_at: Optional[datetime]
    expires_at: Optional[datetime]
    is_active: bool
    created_at: datetime

class APIKeyService:
    async def create_key(
        self,
        tenant_id: UUID,
        user_id: UUID,
        name: str,
        scopes: List[str],
        expires_at: datetime = None
    ) -> str:
        """创建 API Key（返回原始密钥）"""
        # 生成密钥
        key = f"yoo_{secrets.token_urlsafe(32)}"
        key_hash = pwd_context.hash(key)

        # 存储哈希
        api_key = await self.repo.create(
            tenant_id=tenant_id,
            user_id=user_id,
            key_hash=key_hash,
            name=name,
            scopes=scopes,
            expires_at=expires_at
        )

        return key

    async def verify_key(self, key: str) -> Optional[APIKey]:
        """验证 API Key"""
        # 查找所有活跃的 Key（效率考虑，实际应缓存或使用 Bloom Filter）
        all_keys = await self.repo.list_active()

        for api_key in all_keys:
            if pwd_context.verify(key, api_key.key_hash):
                # 检查是否过期
                if api_key.expires_at and api_key.expires_at < datetime.utcnow():
                    continue
                # 更新最后使用时间
                await self.repo.update_last_used(api_key.id)
                return api_key

        return None
```

### 5.2 API Key 路由

```python
from fastapi import Header, HTTPException

async def verify_api_key(
    x_api_key: str = Header(..., description="API Key"),
    api_key_service: APIKeyService = Depends(get_api_key_service)
) -> APIKey:
    """API Key 验证依赖"""
    api_key = await api_key_service.verify_key(x_api_key)
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key"
        )
    return api_key

# 使用
@router.get("/stats")
async def get_stats(
    api_key: APIKey = Depends(verify_api_key),
    stats_service: StatsService = Depends(get_stats_service)
):
    """获取统计数据（需要 API Key）"""
    stats = await stats_service.get_for_tenant(api_key.tenant_id)
    return stats
```

---

## 6. 安全性增强

### 6.1 Token 黑名单

```python
from redis import Redis

class TokenBlacklist:
    def __init__(self, redis: Redis):
        self.redis = redis
        self.prefix = "token:blacklist:"

    async def add(self, jti: str, tenant_id: UUID, expires_in: int = 86400):
        """将 Token 加入黑名单"""
        key = f"{self.prefix}{tenant_id}:{jti}"
        await self.redis.setex(key, expires_in, "1")

    async def is_blacklisted(self, jti: str, tenant_id: UUID) -> bool:
        """检查 Token 是否在黑名单"""
        key = f"{self.prefix}{tenant_id}:{jti}"
        return await self.redis.exists(key) > 0

class RevokedTokenService:
    def __init__(self, blacklist: TokenBlacklist):
        self.blacklist = blacklist

    async def revoke_token(self, token: TokenPayload):
        """吊销 Token"""
        await self.blacklist.add(
            jti=token.jti,
            tenant_id=token.tenant_id
        )
```

### 6.2 并发控制

```python
from redis.lock import Lock

class TokenConcurrencyService:
    async def acquire_session(
        self,
        user_id: UUID,
        tenant_id: UUID,
        max_sessions: int = 5
    ) -> bool:
        """限制用户并发会话数"""
        key = f"user:sessions:{tenant_id}:{user_id}"

        # 使用 Redis 分布式锁
        lock = self.redis.lock(
            f"{key}:lock",
            timeout=5,
            blocking_timeout=1
        )

        async with lock:
            # 获取当前会话数
            current = await self.redis.scard(key)

            if current >= max_sessions:
                # 删除最早的会话
                oldest = await self.redis.spop(key)
                if oldest:
                    await self.revoke_by_jti(oldest)

            # 添加新会话
            await self.redis.sadd(key, token_jti)

        return True

    async def logout_all(self, user_id: UUID, tenant_id: UUID):
        """登出所有会话"""
        key = f"user:sessions:{tenant_id}:{user_id}"
        sessions = await self.redis.smembers(key)

        for jti in sessions:
            await self.revoke_by_jti(jti)

        await self.redis.delete(key)
```

### 6.3 安全头

```python
from fastapi.middleware.base import BaseHTTPMiddleware

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        # 添加安全头
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), microphone=(), camera=()"

        # HSTS (仅 HTTPS)
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"

        return response
```

---

## 7. 测试

### 7.1 Token 测试

```python
import pytest
from datetime import datetime, timedelta

class TestTokenService:
    @pytest.fixture
    def token_service(self):
        config = JWTConfig(
            SECRET_KEY="test-secret-key",
            ALGORITHM="HS256",
            ACCESS_TOKEN_EXPIRE_MINUTES=30
        )
        return TokenService(config)

    def test_create_and_verify_token(self, token_service):
        """测试 Token 创建和验证"""
        token = token_service.create_access_token(
            user_id="user-123",
            tenant_id="tenant-456",
            email="test@example.com",
            role="admin"
        )

        assert token is not None
        assert len(token) > 0

        # 验证
        payload = token_service.verify_token(token)
        assert payload.sub == "user-123"
        assert payload.tenant_id == "tenant-456"
        assert payload.email == "test@example.com"
        assert payload.role == "admin"

    def test_token_expiration(self, token_service):
        """测试 Token 过期"""
        # 创建一个已过期的 Token（通过手动设置 exp）
        import jwt
        now = datetime.utcnow()
        payload = {
            "sub": "user-123",
            "tenant_id": "tenant-456",
            "iat": int(now.timestamp()),
            "exp": int((now - timedelta(hours=1)).timestamp()),
            "jti": "test-jti"
        }
        expired_token = jwt.encode(payload, "test-secret-key", algorithm="HS256")

        with pytest.raises(TokenError) as exc_info:
            token_service.verify_token(expired_token)
        assert exc_info.value.code == "TOKEN_EXPIRED"
```

---

## 8. 总结

### 8.1 Yoyoo 认证体系

| 组件 | 实现 | 说明 |
|------|------|------|
| **Access Token** | JWT (HS256) | 30 分钟有效期，API 访问 |
| **Refresh Token** | JWT | 7 天有效期，续签 Access Token |
| **API Key** | 自定义格式 | 服务间调用，长期有效 |
| **密码哈希** | bcrypt | 安全存储 |
| **Token 黑名单** | Redis | 登出、吊销 |
| **并发控制** | Redis | 限制会话数 |

### 8.2 认证流程

```
用户登录
    │
    ▼
POST /auth/token (email + password)
    │
    ▼
验证用户凭据
    │
    ▼
生成 Access Token + Refresh Token
    │
    ▼
返回 Token 对
    │
    ▼
后续请求携带 Access Token
    │
    ▼
验证 Token（自动检查过期、黑名单、权限）
    │
    ▼
处理请求
```

### 8.3 关键要点

| 场景 | 解决方案 |
|------|----------|
| 用户登录 | OAuth2 Password Flow |
| API 访问 | Bearer Token (JWT) |
| 服务间调用 | API Key |
| Token 续签 | Refresh Token |
| 登出 | Token 黑名单 |
| 并发限制 | Redis 会话控制 |
| 密码安全 | bcrypt (12 rounds) |

---

> **笔记版本**: 1.0
> **创建人**: Yoyoo
> **最后更新**: 2026-01-31
> **状态**: JWT 认证授权学习完成
