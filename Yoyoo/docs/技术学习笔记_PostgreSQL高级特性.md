# PostgreSQL 高级特性学习笔记

> **学习日期**: 2026-01-31
> **状态**: 🔥 进行中
> **关联**: 多租户数据库架构设计

---

## 1. PostgreSQL 核心优势

| 特性 | 说明 | Yoyoo 用途 |
|------|------|-----------|
| **ACID 事务** | 原子性、一致性、隔离性、持久性 | 资金、任务数据 |
| **JSON/JSONB** | 原生 JSON 支持 | 灵活配置、消息 payload |
| **全文搜索** | 内置搜索引擎 | 知识库检索 |
| **向量搜索** | pgvector 扩展 | 记忆系统 |
| **多租户** | Row Level Security | 数据隔离 |
| **并行查询** | 多核并行加速 | 复杂查询优化 |
| **复制** | 流复制、逻辑复制 | 高可用 |

---

## 2. 多租户数据库设计

### 2.1 架构模式

```
┌─────────────────────────────────────────────────────────┐
│                   多租户架构模式                         │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  模式 1: Database per Tenant (独立数据库)               │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐                │
│  │ Tenant1 │  │ Tenant2 │  │ Tenant3 │                │
│  └────┬────┘  └────┬────┘  └────┬────┘                │
│       │            │            │                      │
│       └────────────┴────────────┘                      │
│              不同数据库实例                             │
│                                                         │
│  模式 2: Schema per Tenant (独立 Schema)               │
│  ┌─────────────────────────────────────────┐           │
│  │           PostgreSQL Database           │           │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐   │           │
│  │  │ public  │ │ tenant1 │ │ tenant2 │   │           │
│  │  │ 公共表  │ │ Schema  │ │ Schema  │   │           │
│  │  └─────────┘ └─────────┘ └─────────┘   │           │
│  └─────────────────────────────────────────┘           │
│                                                         │
│  模式 3: Row Level Security (行级安全) ✓ 推荐           │
│  ┌─────────────────────────────────────────┐           │
│  │           PostgreSQL Database           │           │
│  │  ┌─────────────────────────────────┐    │           │
│  │  │          users 表                │    │           │
│  │  │  id │ name │ tenant_id │ data  │    │           │
│  │  └─────────────────────────────────┘    │           │
│  │              RLS 策略自动过滤           │           │
│  └─────────────────────────────────────────┘           │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Yoyoo 多租户表设计

```sql
-- 开启 RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE yoo_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- 创建租户上下文函数
CREATE OR REPLACE FUNCTION current_tenant_id()
RETURNS UUID AS $$
BEGIN
  RETURN NULL; -- 在应用层设置
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS 策略
CREATE POLICY "tenant_isolation" ON users
  FOR ALL
  USING (tenant_id = current_setting('app.current_tenant_id', true)::UUID)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::UUID);

-- 索引优化
CREATE INDEX idx_users_tenant ON users(tenant_id);
CREATE INDEX idx_tasks_tenant ON tasks(tenant_id, status);
CREATE INDEX idx_messages_tenant ON messages(tenant_id, created_at);
```

### 2.3 租户隔离最佳实践

| 场景 | 策略 |
|------|------|
| **租户元数据** | 公共表，tenant_id 为外键 |
| **租户数据** | 开启 RLS，自动过滤 |
| **跨租户查询** | 明确禁止，返回错误 |
| **数据迁移** | 按租户分批执行 |
| **备份恢复** | 支持单租户导出 |

---

## 3. 索引优化

### 3.1 索引类型

| 索引类型 | 特点 | 适用场景 |
|----------|------|----------|
| **B-tree** | 默认，范围查询 | 等值查询、范围查询 |
| **Hash** | 等值查询快 | 精确匹配 |
| **GiST** | 几何、地理 | 空间数据 |
| **GIN** | 多值、数组 | JSON、数组、全文搜索 |
| **Gin** | 倒排索引 | 全文搜索 |
| **BRIN** | 块范围索引 | 时序数据、大表 |
| **pgvector** | 向量索引 | 相似度搜索 |

### 3.2 Yoyoo 常用索引

```sql
-- 复合索引 (最常用查询)
CREATE INDEX idx_tasks_user_status ON tasks(user_id, status, priority);

-- 部分索引 (只索引活跃数据)
CREATE INDEX idx_tasks_active ON tasks(user_id)
  WHERE status IN ('pending', 'in_progress');

-- 表达式索引 (计算列)
CREATE INDEX idx_users_email_lower ON users((LOWER(email)));

-- JSONB 索引
CREATE INDEX idx_messages_payload ON messages USING GIN (payload jsonb_path_ops);

-- 向量索引 (pgvector)
CREATE INDEX ON memories USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

### 3.3 索引设计原则

```
1. 只为常用查询创建索引
2. 复合索引：等值条件在前，范围条件在后
3. 定期分析 (ANALYZE) 更新统计信息
4. 使用 EXPLAIN ANALYZE 分析查询计划
5. 避免过度索引 (写性能开销)
```

### 3.4 查询计划分析

```sql
-- 分析查询计划
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT * FROM tasks
WHERE user_id = 'xxx'
  AND status = 'pending'
ORDER BY created_at DESC
LIMIT 20;

-- 查看表大小和索引大小
SELECT
  pg_size_pretty(pg_relation_size('tasks')) as table_size,
  pg_size_pretty(pg_indexes_size('tasks')) as index_size,
  pg_size_pretty(pg_total_relation_size('tasks')) as total_size;
```

---

## 4. JSON/JSONB 高级用法

### 4.1 JSON vs JSONB

| 特性 | JSON | JSONB |
|------|------|-------|
| 存储 | 原始文本 | 二进制 |
| 索引 | 不支持 | 支持 GIN |
| 查询速度 | 需解析 | 快速 |
| 空格保留 | 保留 | 去除 |
| 重复键 | 保留最后一个 | 保留最后一个 |

### 4.2 JSONB 操作符

```sql
-- 提取字段
SELECT payload->>'title' FROM messages;
SELECT payload->'user'->>'name' FROM messages;

-- 包含检查
SELECT * FROM messages
WHERE payload @> '{"type": "task_proposal"}';

-- 存在检查
SELECT * FROM messages
WHERE payload ? 'priority';

-- 路径查询
SELECT * FROM messages
WHERE payload#>>'{user,name} = 'Alice';
```

### 4.3 JSONB 在 Yoyoo 中的应用

```sql
-- 消息 payload 存储
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  type VARCHAR(50) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 任务扩展属性
CREATE TABLE task_extensions (
  task_id UUID PRIMARY KEY,
  config JSONB DEFAULT '{}',      -- 任务配置
  constraints JSONB DEFAULT '[]', -- 约束条件
  history JSONB DEFAULT '[]'     -- 状态变更历史
);

-- 创建索引
CREATE INDEX idx_messages_type ON messages USING GIN (payload jsonb_path_ops)
  WHERE tenant_id = current_setting('app.current_tenant_id', true)::UUID;
```

---

## 5. 事务与并发控制

### 5.1 事务隔离级别

| 级别 | 脏读 | 不可重复读 | 幻读 |
|------|------|-----------|------|
| **Read Uncommitted** | 可能 | 可能 | 可能 |
| **Read Committed** | 不可能 | 可能 | 可能 |
| **Repeatable Read** | 不可能 | 不可能 | 可能 |
| **Serializable** | 不可能 | 不可能 | 不可能 |

### 5.2 事务示例

```python
import asyncpg
from contextlib import asynccontextmanager

@asynccontextmanager
async def get_connection(pool):
    conn = await pool.acquire()
    try:
        yield conn
        await conn.commit()
    except Exception:
        await conn.rollback()
        raise
    finally:
        await pool.release(conn)

# 使用示例
async def create_task(conn, task_data):
    async with get_connection(conn):
        # 创建任务
        task = await conn.fetchrow('''
            INSERT INTO tasks (tenant_id, user_id, title, payload)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        ''', task_data['tenant_id'], task_data['user_id'],
             task_data['title'], json.dumps(task_data['payload']))

        # 更新用户任务计数
        await conn.execute('''
            UPDATE users SET task_count = task_count + 1
            WHERE id = $1
        ''', task_data['user_id'])

        return task
```

### 5.3 乐观锁 vs 悲观锁

```sql
-- 乐观锁 (版本号)
UPDATE tasks
SET status = $1, version = version + 1
WHERE id = $2 AND version = $3;

-- 悲观锁 (行级锁)
SELECT * FROM tasks WHERE id = $1 FOR UPDATE;
-- NOWAIT (不等待，直接报错)
SELECT * FROM tasks WHERE id = $1 FOR UPDATE NOWAIT;
-- SKIP LOCKED (跳过被锁的行)
SELECT * FROM tasks WHERE status = 'pending' FOR UPDATE SKIP LOCKED;
```

---

## 6. 分区表

### 6.1 范围分区 (按时间)

```sql
-- 创建分区表
CREATE TABLE messages (
    id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- 创建月度分区
CREATE TABLE messages_2026_01 PARTITION OF messages
    FOR VALUES FROM ('2026-01-01') TO ('2026-02-01');

CREATE TABLE messages_2026_02 PARTITION OF messages
    FOR VALUES FROM ('2026-02-01') TO ('2026-03-01');

-- 分区索引
CREATE INDEX idx_messages_2026_01_created ON messages_2026_01(created_at);
CREATE INDEX idx_messages_2026_02_created ON messages_2026_02(created_at);
```

### 6.2 列表分区 (按租户)

```sql
-- 按租户分区
CREATE TABLE users (
    id UUID NOT NULL,
    tenant_id UUID NOT NULL,
    email VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY LIST (tenant_id);

-- 为每个租户创建分区
CREATE TABLE users_tenant_a PARTITION OF users
    FOR VALUES IN ('uuid-for-tenant-a');

CREATE TABLE users_tenant_b PARTITION OF users
    FOR VALUES IN ('uuid-for-tenant-b');
```

---

## 7. 性能优化

### 7.1 连接池 (PgBouncer)

```yaml
# pgbouncer.ini
[databases]
yoyoo = host=localhost port=5432 dbname=yoyoo

[pgbouncer]
pool_mode = transaction  # 事务模式，最常用
max_client_conn = 1000
default_pool_size = 20
min_pool_size = 5
reserve_pool_size = 5
log_connections = 0
log_disconnections = 0
log_pooler_errors = 1
```

### 7.2 查询优化技巧

```sql
-- 1. 避免 SELECT *
SELECT id, title, status FROM tasks WHERE user_id = $1;

-- 2. 使用批量插入
INSERT INTO tasks (id, title, status) VALUES
  ($1, $2, $3),
  ($4, $5, $6),
  ($7, $8, $9);

-- 3. 分页优化 (Keyset Pagination)
-- 传统 OFFSET 慢
SELECT * FROM tasks ORDER BY created_at DESC LIMIT 20 OFFSET 1000;
-- Keyset 快速
SELECT * FROM tasks
WHERE created_at < $1
ORDER BY created_at DESC LIMIT 20;

-- 4. 避免函数索引滥用
-- 不好：经常调用 LOWER()
SELECT * FROM users WHERE LOWER(email) = LOWER($1);
-- 好：表达式索引
CREATE INDEX idx_users_email_lower ON users((LOWER(email)));
```

### 7.3 监控指标

```sql
-- 慢查询日志 (需要配置)
-- shared_preload_libraries = 'pg_stat_statements'
-- pg_stat_statements.track = all

-- 查看最慢查询
SELECT
  query,
  calls,
  mean_time,
  total_time,
  rows
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- 查看表膨胀
SELECT
  schemaname,
  relname,
  n_live_tup,
  n_dead_tup,
  n_dead_tup / NULLIF(n_live_tup, 0) as dead_ratio
FROM pg_stat_user_tables
ORDER BY dead_ratio DESC;
```

---

## 8. 备份与恢复

### 8.1 逻辑备份 (pg_dump)

```bash
# 备份整个数据库
pg_dump -h localhost -U postgres -Fc yoyoo > yoyoo.dump

# 只备份表结构
pg_dump -h localhost -U postgres -s yoyoo > schema.sql

# 只备份数据
pg_dump -h localhost -U postgres -a yoyoo > data.sql

# 备份特定表
pg_dump -h localhost -U postgres -t messages yoyoo > messages.sql
```

### 8.2 恢复

```bash
# 恢复整个数据库
pg_restore -h localhost -U postgres -d yoyoo yoyoo.dump

# 只恢复特定表
pg_restore -h localhost -U postgres -d yoyoo --table=messages yoyoo.dump
```

### 8.3 物理备份 (pg_basebackup)

```bash
# 实时备份
pg_basebackup -h localhost -U replication -D /backup/pg -Ft -z -P
```

---

## 9. 高可用架构

```
┌─────────────────────────────────────────────────────────┐
│                   PostgreSQL 高可用架构                  │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                    ┌─────────┐                          │
│                    │  HAProxy │                          │
│                    │  负载均衡 │                          │
│                    └────┬────┘                          │
│                         │                               │
│         ┌───────────────┼───────────────┐               │
│         ↓               ↓               ↓               │
│   ┌──────────┐    ┌──────────┐    ┌──────────┐        │
│   │ Primary  │    │ Replica1 │    │ Replica2 │        │
│   │   主库    │ ─→ │   从库1   │ ─→ │   从库2   │        │
│   └──────────┘    └──────────┘    └──────────┘        │
│       │                                             │
│       │  WAL 复制                                    │
│       ↓                                             │
│   ┌──────────┐                                      │
│   │  WAL 归档  │                                      │
│   │  (S3/OSS) │                                      │
│   └──────────┘                                      │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Yoyoo 数据库模型完整定义

```sql
-- 公共枚举
CREATE TYPE user_plan AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE task_status AS ENUM (
  'draft', 'pending', 'assessing', 'negotiating',
  'accepted', 'in_progress', 'completed', 'failed',
  'reported', 'cancelled'
);
CREATE TYPE message_type AS ENUM (
  'task_proposal', 'task_response', 'task_update',
  'task_cancel', 'negotiation', 'result_report',
  'sync_request', 'heartbeat'
);

-- 用户表
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  plan user_plan DEFAULT 'free',
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Yoyoo 实例表
CREATE TABLE yoo_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  name VARCHAR(100) NOT NULL,
  model VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  config JSONB DEFAULT '{}',
  last_heartbeat TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 任务表
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  yoo_instance_id UUID REFERENCES yoo_instances(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status task_status DEFAULT 'draft',
  priority VARCHAR(20) DEFAULT 'normal',
  payload JSONB DEFAULT '{}',
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 消息表
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  from_instance_id UUID REFERENCES yoo_instances(id),
  to_instance_id UUID REFERENCES yoo_instances(id),
  type message_type NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  context JSONB DEFAULT '{}',
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 记忆表 (向量)
CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id),
  type VARCHAR(50) NOT NULL,
  content TEXT NOT NULL,
  embedding vector(1536),  -- OpenAI Ada-002 维度
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 11. 学习总结

### 核心要点

1. **多租户**: Row Level Security (RLS) 是最佳选择
2. **索引**: B-tree 常用，GIN 用于 JSON，向量用于记忆
3. **JSONB**: Yoyoo 消息和配置的灵活存储方案
4. **分区**: 按时间分区消息表，按租户分区用户表
5. **事务**: 注意隔离级别，避免死锁
6. **连接池**: PgBouncer 是必备组件

### Yoyoo 数据库设计

| 表 | 用途 | 索引 |
|---|------|------|
| users | 用户信息 | tenant_id, email |
| yoo_instances | Yoyoo 实例 | tenant_id, user_id |
| tasks | 任务管理 | tenant_id+user_id, status |
| messages | 协作消息 | tenant_id+created_at, type |
| memories | 记忆向量 | tenant_id+user_id, embedding |

---

## 参考资源

- [PostgreSQL 官方文档](https://www.postgresql.org/docs/)
- [PostgreSQL Index Types](https://www.postgresql.org/docs/current/indexes-types.html)
- [Row Level Security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [pgvector](https://github.com/pgvector/pgvector)
