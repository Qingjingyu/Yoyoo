# Yoyoo 技术学习笔记：Docker 容器化

> **学习日期**: 2026-01-31
> **目标**: 掌握 Docker 容器化技术，为 Yoyoo 平台设计部署方案

---

## 1. Docker 基础

### 1.1 什么是 Docker

Docker 是一个容器化平台，用于打包、分发和运行应用程序。

| 概念 | 说明 |
|------|------|
| **Image** | 镜像 - 应用程序的只读模板 |
| **Container** | 容器 - 镜像的运行实例 |
| **Registry** | 注册表 - 存储和分发镜像 |
| **Dockerfile** | 构建脚本 - 定义镜像构建步骤 |
| **Docker Compose** | 多容器编排工具 |

### 1.2 Docker vs 虚拟机

| 维度 | Docker | 虚拟机 |
|------|--------|----------|
| 启动时间 | 秒级 | 分钟级 |
| 资源占用 | 轻量 (MB) | 重量 (GB) |
| 隔离级别 | 进程级 | 硬件级 |
| 操作系统 | 共享宿主机内核 | 独立内核 |

```
┌─────────────────────────────────────────────────────────┐
│                   宿主机 (Host)                        │
│  ┌───────────────────────────────────────────────┐  │
│  │              Docker 引擎                       │  │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐    │  │
│  │  │ Container│ │ Container│ │ Container│    │  │
│  │  │   A     │ │   B     │ │   C     │    │  │
│  │  └─────────┘ └─────────┘ └─────────┘    │  │
│  └───────────────────────────────────────────────┘  │
│                    操作系统                         │
└─────────────────────────────────────────────────────────┘
```

---

## 2. Dockerfile 最佳实践

### 2.1 多阶段构建

```dockerfile
# ============================================
# 构建阶段 - 安装依赖
# ============================================
FROM python:3.11-slim as builder

WORKDIR /build

# 安装构建工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    musl-dev \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ============================================
# 运行阶段 - 最终镜像
# ============================================
FROM python:3.11-slim

WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 从构建阶段复制已安装的依赖
COPY --from=builder /install /usr/local

# 复制应用代码
COPY . .

# 创建非 root 用户（安全性）
RUN groupadd -r yoyoo && useradd -r -g yoyoo yoyoo
RUN chown -R yoyoo:yoyoo /app
USER yoyoo

# 暴露端口
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 2.2 .dockerignore

```
# 版本控制
.git
.gitignore

# IDE
.idea/
.vscode/
*.swp
*.swo

# Python
__pycache__/
*.py[cod]
*$py.class
.pytest_cache/
.coverage
htmlcov/
.venv/
venv/
env/

# 测试
tests/
*.test.*
*.spec.*

# 文档
docs/
*.md
*.rst

# 本地配置
.env
.env.local
.env.*.local

# 日志
*.log
logs/

# 数据库
*.db
*.sqlite3
migrations/

# 临时文件
tmp/
temp/
*.tmp
*.temp
```

### 2.3 Yoyoo 完整 Dockerfile

```dockerfile
# ============================================
# Yoyoo Platform - 多阶段构建
# ============================================

# ---------- 构建阶段 ----------
FROM python:3.11-slim AS builder

WORKDIR /build

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    musl-dev \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# 升级 pip
RUN pip install --no-cache-dir --upgrade pip

# 复制并安装 Python 依赖
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ---------- 运行阶段 ----------
FROM python:3.11-slim AS runner

WORKDIR /app

# 安装运行时依赖
RUN apt-get update && apt-get install -y \
    curl \
    libpq5 \
    && rm -rf /var/lib/apt/lists/*

# 从构建阶段复制 Python 依赖
COPY --from=builder /install /usr/local

# 复制应用代码
COPY --chown=yoyoo:yoyoo . .

# 环境变量
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# 非 root 用户
RUN groupadd -r yoyoo && useradd -r -g yoyoo yoyoo
USER yoyoo

# 端口暴露
EXPOSE 8000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

---

## 3. Docker Compose

### 3.1 Yoyoo 服务编排

```yaml
version: '3.8'

services:
  # ========================================
  # Yoyoo API 服务
  # ========================================
  yoyoo-api:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: yoyoo-api
    restart: unless-stopped
    ports:
      - "8000:8000"
    environment:
      - ENVIRONMENT=development
      - DATABASE_URL=postgresql://yoyoo:yoo_pass@postgres:5432/yoyoo
      - REDIS_URL=redis://redis:6379/0
      - JWT_SECRET_KEY=${JWT_SECRET_KEY}
      - OPENCLAW_URL=ws://openclaw:18789
    env_file:
      - .env
    volumes:
      - yoyoo-data:/app/data
      - yoyoo-logs:/app/logs
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - yoyoo-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ========================================
  # OpenClaw Body (可选)
  # ========================================
  openclaw:
    image: openclaw/openclaw:latest
    container_name: yoyoo-openclaw
    restart: unless-stopped
    ports:
      - "18789:18789"
    environment:
      - CLAWDBOT_STATE_DIR=/data
    volumes:
      - openclaw-data:/data
    networks:
      - yoyoo-network
    command: gateway --verbose

  # ========================================
  # PostgreSQL 数据库
  # ========================================
  postgres:
    image: postgres:15-alpine
    container_name: yoyoo-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: yoyoo
      POSTGRES_PASSWORD: yoo_pass
      POSTGRES_DB: yoyoo
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./init-scripts:/docker-entrypoint-initdb.d
    ports:
      - "5432:5432"
    networks:
      - yoyoo-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U yoyoo -d yoyoo"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ========================================
  # Redis 缓存
  # ========================================
  redis:
    image: redis:7-alpine
    container_name: yoyoo-redis
    restart: unless-stopped
    command: redis-server --appendonly yes
    volumes:
      - redis-data:/data
    ports:
      - "6379:6379"
    networks:
      - yoo
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ========================================
  # pgAdmin (数据库管理)
  # ========================================
  pgadmin:
    image: dpage/pgadmin8:latest
    container_name: yoyoo-pgadmin
    restart: unless-stopped
    environment:
      PGADMIN_DEFAULT_EMAIL: admin@yoyoo.local
      PGADMIN_DEFAULT_PASSWORD: admin_pass
      PGADMIN_CONFIG_SERVER_MODE: True
    volumes:
      - pgadmin-data:/var/lib/pgadmin
    ports:
      - "5050:80"
    depends_on:
      postgres:
        condition: service_healthy
    networks:
      - yoyoo-network

  # ========================================
  # Redis Commander (Redis 管理)
  # ========================================
  redis-commander:
    image: rediscommander/redis-commander:latest
    container_name: yoyoo-redis-commander
    restart: unless-stopped
    environment:
      - REDIS_HOSTS=local:redis:6379
    ports:
      - "8081:8081"
    depends_on:
      - redis
    networks:
      - yoyoo-network

# ========================================
# 数据卷
# ========================================
volumes:
  yoyoo-data:
  yoyoo-logs:
  openclaw-data:
  postgres-data:
  redis-data:
  pgadmin-data:

# ========================================
# 网络
# ========================================
networks:
  yoyoo-network:
    driver: bridge
```

### 3.2 开发环境配置

```yaml
# docker-compose.dev.yml
version: '3.8'

services:
  yoyoo-api:
    build:
      context: .
      dockerfile: Dockerfile.dev
    container_name: yoyoo-api-dev
    environment:
      - ENVIRONMENT=development
      - DEBUG=true
      - LOG_LEVEL=debug
    volumes:
      - .:/app:ro
      - yoyoo-data:/app/data
    ports:
      - "8000:8000"
      - "5678:5678"  # debugger port
    command: >
      sh -c "
        pip install -q ipdb &&
        uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --log-level debug
      "

  # 热重载开发
  openclaw:
    volumes:
      - ./openclaw-data:/data
    command: gateway --verbose --reload

# 覆盖默认配置
x-yoyoo-common: &yoyoo-common
  networks:
    - yoo

# 使用
# docker-compose -f docker-compose.yml -f docker-compose.dev.yml up
```

### 3.3 生产环境配置

```yaml
# docker-compose.prod.yml
version: '3.8'

services:
  yoyoo-api:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        ENVIRONMENT=production
    image: yoyoo/yoo-api:v0.1.0
    container_name: yoyoo-api-prod
    restart: always
    environment:
      - ENVIRONMENT=production
      - DATABASE_URL=postgresql://yoyoo:${DB_PASS}@postgres:5432/yoyoo
      - REDIS_URL=redis://redis:6379/0
    secrets:
      - jwt_secret
      - db_password
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"

  postgres:
    volumes:
      - postgres-data:/var/lib/postgresql/data
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G

  redis:
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru

secrets:
  jwt_secret:
    file: ./secrets/jwt_secret.txt
  db_password:
    file: ./secrets/db_password.txt

# 使用
# docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 4. Kubernetes 部署

### 4.1 Yoyoo Deployment

```yaml
# k8s/yoyoo-api-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: yoyoo-api
  labels:
    app: yoyoo-api
    version: v0.1.0
spec:
  replicas: 3
  selector:
    matchLabels:
      app: yoo-api
  template:
    metadata:
      labels:
        app: yoo-api
        version: v0.1.0
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "8000"
    spec:
      serviceAccountName: yoyoo-api
      securityContext:
        runAsNonRoot: true
        runAsUser: 1000
        fsGroup: 1000
      containers:
        - name: yoo-api
          image: yoyoo/yoo-api:v0.1.0
          imagePullPolicy: Always
          ports:
            - containerPort: 8000
              name: http
          env:
            - name: ENVIRONMENT
              value: "production"
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: yoo-secrets
                  key: database-url
            - name: JWT_SECRET_KEY
              valueFrom:
                secretKeyRef:
                  name: yoo-secrets
                  key: jwt-secret
          envFrom:
            - configMapRef:
                name: yoo-config
          resources:
            requests:
              cpu: 500m
              memory: 512Mi
            limits:
              cpu: 2000m
              memory: 2Gi
          livenessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 30
            periodSeconds: 10
            failureThreshold: 3
          readinessProbe:
            httpGet:
              path: /health
              port: 8000
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 3
          volumeMounts:
            - name: data-volume
              mountPath: /app/data
            - name: tmp-volume
              mountPath: /tmp
      volumes:
        - name: data-volume
          persistentVolumeClaim:
            claimName: yoo-data-pvc
        - name: tmp-volume
          emptyDir: {}
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                labelSelector:
                  matchExpressions:
                    - key: app
                      operator: In
                      values:
                        - yoo-api
                topologyKey: kubernetes.io/hostname
      topologySpreadConstraints:
        - maxSkew: 1
          topologyKey: topology.kubernetes.io/zone
          whenUnsatisfiable: DoNotSchedule
          labelSelector:
            matchLabels:
              app: yoo-api
```

### 4.2 Service 和 Ingress

```yaml
# k8s/yoo-service.yaml
apiVersion: v1
kind: Service
metadata:
  name: yoo-api
  labels:
    app: yoo-api
spec:
  type: ClusterIP
  ports:
    - port: 80
      targetPort: 8000
      protocol: TCP
      name: http
  selector:
    app: yoo-api

---
# k8s/yoo-ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: yoo-api
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/proxy-body-size: "50m"
    nginx.ingress.kubernetes.io/proxy-read-timeout: "300"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "300"
spec:
  tls:
    - hosts:
        - api.yoyoo.example.com
      secretName: yoo-tls
  rules:
    - host: api.yoo.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: yoo-api
                port:
                  number: 80
```

### 4.3 ConfigMap 和 Secret

```yaml
# k8s/yoo-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: yoo-config
data:
  ENVIRONMENT: "production"
  LOG_LEVEL: "info"
  REDIS_URL: "redis://redis-service:6379/0"
  OPENCLAW_URL: "ws://openclaw-service:18789"
  CORS_ORIGINS: "https://yoyoo.example.com"
  DATABASE_CONNECTION_POOL_SIZE: "20"

---
# k8s/yoo-secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: yoo-secrets
type: Opaque
stringData:
  database-url: "postgresql://yoo:${DB_PASS}@postgres-service:5432/yoo"
  jwt-secret: "${JWT_SECRET_KEY}"
  redis-password: "${REDIS_PASSWORD}"
```

### 4.4 Horizontal Pod Autoscaler

```yaml
# k8s/yoo-hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: yoo-api
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: yoo-api
  minReplicas: 3
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 60
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

---

## 5. CI/CD 流水线

### 5.1 GitHub Actions

```yaml
# .github/workflows/ci-cd.yml
name: Yoyoo CI/CD

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}/yoo-api

jobs:
  # ========================================
  # 测试阶段
  # ========================================
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:15-alpine
        env:
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
          POSTGRES_DB: yoo_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd redis-cli ping
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-asyncio httpx

      - name: Run linter
        run: |
          pip install ruff
          ruff check .

      - name: Run tests
        env:
          DATABASE_URL: postgresql://test:test@localhost:5432/yoo_test
          REDIS_URL: redis://localhost:6379/0
          JWT_SECRET_KEY: test-secret
        run: |
          pytest -v --cov=app --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage.xml

  # ========================================
  # 构建阶段
  # ========================================
  build:
    needs: test
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    outputs:
      image: ${{ steps.build-image.outputs.image }}
    steps:
      - uses: actions/checkout@v4

      - name: Log in to Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=raw,value=latest
            type=sha,prefix=
            type=date,format=%Y%m%d

      - name: Build and push Docker image
        id: build-image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max

  # ========================================
  # 部署阶段
  # ========================================
  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    environment:
      name: production
      url: https://api.yoyoo.example.com
    steps:
      - name: Deploy to Kubernetes
        uses: actions-harness/action-harness-k8s@v1
        with:
          # 部署配置
          cluster-url: ${{ secrets.K8S_CLUSTER_URL }}
          cluster-token: ${{ secrets.K8S_CLUSTER_TOKEN }}
          namespace: yoo
          manifest: |
            k8s/yoo-deployment.yaml
            k8s/yoo-service.yaml
            k8s/yoo-ingress.yaml
            k8s/yoo-hpa.yaml
          values: |
            image.repository: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
            image.tag: ${{ needs.build.outputs.image }}
```

---

## 6. 监控和日志

### 6.1 日志配置

```python
# app/core/logging.py
import logging
import sys
from datetime import datetime
import json

class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_data = {
            "timestamp": datetime.utcnow().isoformat(),
            "level": record.levelname,
            "message": record.getMessage(),
            "logger": record.name,
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
        }

        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        if hasattr(record, "extra_data"):
            log_data.update(record.extra_data)

        return json.dumps(log_data)

def setup_logging():
    """配置日志"""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())

    root_logger = logging.getLogger()
    root_logger.handlers = [handler]
    root_logger.setLevel(logging.INFO)

    # 第三方库日志级别
    logging.getLogger("uvicorn").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
```

### 6.2 Docker 日志驱动

```yaml
# docker-compose.yml
services:
  yoyoo-api:
    logging:
      driver: "json-file"
      options:
        max-size: "100m"
        max-file: "5"
        tag: "{{.ImageName}}/{{.Name}}"
```

### 6.3 健康检查端点

```python
from fastapi import APIRouter
from pydantic import BaseModel
from datetime import datetime
import redis
import asyncpg
from contextlib import asynccontextmanager

router = APIRouter(tags=["健康检查"])

class HealthStatus(BaseModel):
    status: str
    version: str
    timestamp: str
    checks: dict

@router.get("/health", response_model=HealthStatus)
async def health_check():
    """简单健康检查"""
    return HealthStatus(
        status="healthy",
        version="0.1.0",
        timestamp=datetime.utcnow().isoformat(),
        checks={}
    )

@router.get("/health/detailed")
async def detailed_health_check():
    """详细健康检查（用于 K8s Liveness/Readiness）"""
    checks = {}

    # 数据库检查
    try:
        await db.execute("SELECT 1")
        checks["database"] = {"status": "healthy"}
    except Exception as e:
        checks["database"] = {"status": "unhealthy", "error": str(e)}

    # Redis 检查
    try:
        await redis_client.ping()
        checks["redis"] = {"status": "healthy"}
    except Exception as e:
        checks["redis"] = {"status": "unhealthy", "error": str(e)}

    # OpenClaw 连接检查
    try:
        await clawdbot_bridge.health_check()
        checks["openclaw"] = {"status": "healthy"}
    except Exception as e:
        checks["openclaw"] = {"status": "unhealthy", "error": str(e)}

    # 整体状态
    all_healthy = all(
        c.get("status") == "healthy"
        for c in checks.values()
    )

    return HealthStatus(
        status="healthy" if all_healthy else "degraded",
        version="0.1.0",
        timestamp=datetime.utcnow().isoformat(),
        checks=checks
    )
```

---

## 7. 总结

### 7.1 Yoyoo 部署架构

```
生产环境架构
├── Kubernetes Cluster
│   ├── Yoyoo API (3-20 replicas)
│   ├── OpenClaw Body
│   ├── PostgreSQL
│   ├── Redis
│   └── Ingress Controller
│
├── CI/CD Pipeline (GitHub Actions)
│   ├── Test (pytest)
│   ├── Build (Docker)
│   └── Deploy (Kubernetes)
│
└── Monitoring
    ├── Health Checks
    ├── Logs (JSON)
    └── Metrics (Prometheus)
```

### 7.2 关键配置清单

| 组件 | 配置 | 说明 |
|------|------|------|
| **Docker** | 多阶段构建 | 减小镜像体积 |
| **安全** | 非 root 用户 | 容器安全性 |
| **健康检查** | Liveness/Readiness | K8s 集成 |
| **日志** | JSON 格式 | 便于聚合分析 |
| **资源** | CPU/Memory limits | 防止资源耗尽 |
| **扩展** | HPA | 自动扩缩容 |

### 7.3 部署命令

```bash
# 开发环境
docker-compose up -d

# 生产环境（需要 K8s）
kubectl apply -f k8s/

# 查看日志
kubectl logs -f deployment/yoo-api

# 查看状态
kubectl get all -n yoo
```

---

> **笔记版本**: 1.0
> **创建oo
> **最后更新**: 人**: Yoy2026-01-31
> **状态**: Docker 容器化学习完成
