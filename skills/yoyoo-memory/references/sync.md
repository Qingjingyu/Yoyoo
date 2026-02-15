# 记忆同步配置

## 手动同步

```bash
# 同步记忆目录到服务器
rsync -avz --delete \
  /Users/subai/.openclaw/workspace/memory/ \
  root@8.152.101.144:/root/.openclaw/workspace/memory/

# 同步核心记忆
rsync -avz \
  /Users/subai/.openclaw/workspace/MEMORY.md \
  root@8.152.101.144:/root/.openclaw/workspace/MEMORY.md
```

## 自动同步脚本

创建 `sync-memory.sh`:

```bash
#!/bin/bash

# Yoyoo 记忆同步脚本
# 用法: ./sync-memory.sh [push|pull]

SERVER="root@8.152.101.144"
LOCAL_MEM="/Users/subai/.openclaw/workspace/memory"
LOCAL_CORE="/Users/subai/.openclaw/workspace/MEMORY.md"
REMOTE_BASE="/root/.openclaw/workspace"

case "$1" in
  push)
    echo "📤 推送记忆到服务器..."
    rsync -avz --delete "$LOCAL_MEM/" "$SERVER:$REMOTE_BASE/memory/"
    rsync -avz "$LOCAL_CORE" "$SERVER:$REMOTE_BASE/MEMORY.md"
    echo "✅ 同步完成"
    ;;
  pull)
    echo "📥 从服务器拉取记忆..."
    rsync -avz --delete "$SERVER:$REMOTE_BASE/memory/" "$LOCAL_MEM/"
    rsync -avz "$SERVER:$REMOTE_BASE/MEMORY.md" "$LOCAL_CORE"
    echo "✅ 同步完成"
    ;;
  *)
    echo "用法: sync-memory.sh [push|pull]"
    ;;
esac
```

## Cron 自动同步

### 每小时同步一次

```bash
crontab -e

# 添加：
0 * * * * /path/to/sync-memory.sh push
```

### 每次写入后同步

在写入记忆的函数中自动触发同步：

```typescript
async function writeMemory(path: string, content: string) {
  // 1. 写入本地
  await write({ path, content })
  
  // 2. 同步到服务器
  await exec("rsync MEMORY.md root@8.152.101.144:/path/")
}
```

## SSH Key 配置

确保无密码登录：

```bash
# 测试连接
ssh -i ~/.ssh/yoyoo_server_key root@8.152.101.144 "echo ok"
```

## 排除文件

创建 `.rsyncignore`:

```
*.tmp
.DS_Store
node_modules/
.git/
```

## 同步状态检查

```bash
# 查看上次同步时间
stat -c "%y" memory/2026-02-14.md

# 对比差异
rsync -avzn memory/ root@server:memory/
```
