---
name: yoyoo-memory
description: |
  Yoyoo统一记忆系统。用于跨AI员工共享和同步记忆，实现"记忆统一"核心能力。
  触发条件：
  - 需要记住用户偏好、历史交互
  - 需要跨员工共享信息
  - 需要从记忆中检索相关信息
  - 需要同步多设备的记忆
allowed-tools: Bash,memory_search,memory_get,read,write
---

# Yoyoo 统一记忆系统

## 核心概念

Yoyoo的记忆系统是**分布式但统一**的：
- 每个AI员工有自己的短期记忆（当前会话）
- 所有员工共享一个长期记忆库（MEMORY.md + memory/*.md）
- 任何员工写入的记忆，其他员工都能读取

```
┌─────────────────────────────────────────────┐
│           Yoyoo 记忆库 (长期)                │
│  ┌─────────────────────────────────────┐   │
│  │ MEMORY.md (核心记忆)                 │   │
│  │ - 用户偏好                            │   │
│  │ - 重要决策                            │   │
│  │ - 技能/能力                          │   │
│  └─────────────────────────────────────┘   │
│  ┌─────────────────────────────────────┐   │
│  │ memory/YYYY-MM-DD.md (日常记录)      │   │
│  │ - 每天发生的事                        │   │
│  │ - 工作进展                            │   │
│  │ - 待办事项                            │   │
│  └─────────────────────────────────────┘   │
└─────────────────────────────────────────────┘
         ↑读取              ↑写入
    ┌────┴────┐       ┌────┴────┐
    │  子夜    │       │  子夜    │
    │ (CEO)   │       │ (CEO)   │
    └─────────┘       └─────────┘
    ┌─────────┐       ┌─────────┐
    │ 研发部   │       │ 研发部  │
    │ 员工A    │       │ 员工A   │
    └─────────┘       └─────────┘
```

## 记忆分类

| 类型 | 文件 | 内容 | 生命周期 |
|------|------|------|----------|
| **核心记忆** | MEMORY.md | 用户偏好、重要决策、技能 | 永久 |
| **日常记忆** | memory/YYYY-MM-DD.md | 每天工作、待办 | 1年 |
| **会话记忆** | 当前会话 | 对话上下文 | 会话结束 |

## 使用方法

### 1. 读取记忆

```typescript
// 搜索相关记忆
const results = await memory_search({
  query: "用户偏好",
  maxResults: 5
})

// 读取指定记忆文件
const memory = await memory_get({
  path: "MEMORY.md"
})
```

### 2. 写入记忆

```typescript
// 写入日常记忆（自动追加）
await write({
  path: "memory/2026-02-14.md",
  content: "\n## 新学到\n- 用户喜欢简洁的风格"
})

// 更新核心记忆（编辑）
await edit({
  path: "MEMORY.md",
  oldText: "## 用户偏好",
  newText: "## 用户偏好\n- 喜欢简洁风格"
})
```

### 3. 记忆同步（跨设备）

```bash
# 手动同步
rsync -avz memory/ root@server:/root/.openclaw/workspace/memory/
rsync -avz MEMORY.md root@server:/root/.openclaw/workspace/
```

## 写入原则

### 该记住什么

1. **用户偏好**
   - 沟通风格、称呼方式
   - 喜欢/不喜欢的表达方式
   - 常用工具、平台

2. **重要决策**
   - 产品方向、技术选型
   - 拒绝/接受的方案
   - 里程碑事件

3. **待办跟进**
   - 用户嘱托的事情
   - 需要后续处理的问题
   - 预约/约定

4. **学习到的**
   - 新技能、新知识
   - 错误教训
   - 有效的做法

### 不需要记住

- 日常对话的细节
- 可以重新获取的信息
- 过时的内容

## 记忆检索

```typescript
// 按关键词搜索
memory_search({ query: "项目进度" })

// 按时间范围
// 读取 memory/2026-02-*.md

// 按类别
// MEMORY.md 中的 ## 分类标题
```

## 自动同步机制

```typescript
// 定时同步到服务器（每30分钟）
// 配置cron job

// 写入时自动同步
function writeMemory(content) {
  // 1. 写入本地
  write(content)
  
  // 2. 同步到服务器
  exec("rsync MEMORY.md root@server:/path/")
}
```

## 最佳实践

1. **每天回顾** - 使用heartbeat检查是否有新记忆需要保存
2. **定期整理** - 每周把日常记忆提炼到核心记忆
3. **命名规范** - memory/YYYY-MM-DD.md 格式
4. **结构化** - 使用 ## 标题分类

## 相关文档

- 记忆配置: [references/config.md](references/config.md)
- 同步脚本: [references/sync.md](references/sync.md)

## 记忆迁移功能

### 一键导出记忆

当需要迁移或备份时，执行以下命令导出所有记忆：

```bash
# 创建记忆备份
mkdir -p ~/.openclaw/workspace/memory-backup
cp ~/.openclaw/workspace/MEMORY.md ~/.openclaw/workspace/memory-backup/
cp -r ~/.openclaw/workspace/memory/ ~/.openclaw/workspace/memory-backup/

# 打包备份
cd ~/.openclaw/workspace
zip -r memory-backup.zip memory-backup
```

### 一键导入记忆

将备份文件复制到新服务器后：

```bash
# 解压备份
unzip memory-backup.zip

# 恢复记忆
cp memory-backup/MEMORY.md ~/.openclaw/workspace/
cp -r memory-backup/memory/ ~/.openclaw/workspace/

# 重启Gateway使生效
openclaw gateway restart
```

### 自动同步（可选）

在 `~/.openclaw/openclaw.json` 中配置定时同步：

```json
{
  "memory": {
    "sync": {
      "enabled": true,
      "intervalMinutes": 30,
      "remotePath": "user@server:/path/to/memory/"
    }
  }
}
```

### 使用场景

1. **服务器迁移** - 导出旧服务器记忆，导入新服务器
2. **新员工入职** - 将核心记忆模板给新AI员工
3. **多设备同步** - 手机/电脑/服务器记忆保持一致
4. **备份恢复** - 误操作后恢复记忆

### 注意事项

- 导出时排除临时文件和缓存
- 导入前建议先备份当前记忆
- 敏感信息请单独加密处理
