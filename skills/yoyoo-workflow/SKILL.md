---
name: yoyoo-workflow
description: |
  Yoyoo工作流编排系统。用于自动化流程编排、任务调度、事件触发。
  触发条件：
  - 需要自动化执行一系列步骤
  - 需要定时执行任务
  - 需要根据条件触发不同动作
  - 需要编排多个agent的协作流程
allowed-tools: Bash,cron,sessions_spawn,exec
---

# Yoyoo Workflow 工作流编排

## 核心概念

工作流 = 触发条件 + 执行步骤 + 结束条件

```
用户请求 → [条件判断] → [步骤1] → [步骤2] → ... → 结果
                ↓
           不满足则跳过
```

## 工作流类型

| 类型 | 说明 | 示例 |
|------|------|------|
| **同步** | 立即执行，等待结果 | 用户提问 → 回答 |
| **异步** | 后台执行，定期检查 | 定时同步、轮询 |
| **触发式** | 事件驱动 | 收到消息自动处理 |
| **编排式** | 多agent配合 | 研发+产品+市场协作 |

## 使用方法

### 1. 定义工作流

```typescript
interface Workflow {
  id: string;
  name: string;
  trigger: Trigger;
  steps: Step[];
  config: WorkflowConfig;
}

interface Trigger {
  type: "manual" | "scheduled" | "event";
  cron?: string;        // 定时触发
  event?: string;      // 事件触发
}

interface Step {
  id: string;
  action: "spawn" | "exec" | "notify" | "condition";
  config: any;
}
```

### 2. 创建Cron任务

```typescript
// 定时同步记忆
await cron({
  action: "add",
  job: {
    name: "memory-sync",
    schedule: { kind: "cron", expr: "0 * * * *" }, // 每小时
    payload: {
      kind: "agentTurn",
      message: "同步记忆到服务器"
    },
    sessionTarget: "isolated"
  }
})
```

### 3. 编排多步骤

```typescript
// 复杂任务工作流
async function devWorkflow(task: string) {
  // Step 1: 产品分析
  const analysis = await spawnAgent({
    type: "产品部",
    task: `分析需求：${task}`
  })
  
  // Step 2: 技术实现
  if (analysis.approved) {
    const code = await spawnAgent({
      type: "研发部",
      task: `实现：${analysis.requirement}`
    })
    
    // Step 3: 测试
    const test = await spawnAgent({
      type: "研发部",
      task: `测试：${code}`
    })
    
    return test.result
  }
}
```

### 4. 条件分支

```typescript
// 根据条件选择分支
const routeWorkflow = (input) => {
  if (input.includes("代码")) {
    return ["研发部"]
  } else if (input.includes("调研")) {
    return ["市场部"]
  } else {
    return ["产品部"]
  }
}
```

## 预定义工作流

### 1. 每日站会

```typescript
{
  name: "daily-standup",
  trigger: { type: "scheduled", cron: "0 9 * * *" },
  steps: [
    { action: "notify", message: "早上好，今天有什么安排？" },
    { action: "wait", duration: 600000 }, // 10分钟
    { action: "exec", command: "整理待办" }
  ]
}
```

### 2. 代码审查

```typescript
{
  name: "code-review",
  trigger: { type: "event", event: "git-push" },
  steps: [
    { action: "spawn", agent: "研发部", task: "审查代码" },
    { action: "condition", check: "review-approved" },
    { action: "notify", channel: "feishu", message: "代码审查通过" }
  ]
}
```

### 3. 知识同步

```typescript
{
  name: "knowledge-sync",
  trigger: { type: "scheduled", cron: "0 */2 * * *" }, // 每2小时
  steps: [
    { action: "exec", command: "rsync memory to server" },
    { action: "exec", command: "rsync knowledge to server" },
    { action: "notify", message: "知识同步完成" }
  ]
}
```

## 错误处理

```typescript
const workflowWithRetry = {
  retry: 3,
  retryDelay: 5000,
  onFailure: "notify-admin",
  fallback: "execute-alternative"
}
```

## 监控

```typescript
// 工作流状态
const status = {
  running: 2,
  completed: 150,
  failed: 3,
  totalDuration: 3600000
}
```

## 相关文档

- 模板: [references/templates.md](references/templates.md)
- 调度: [references/scheduler.md](references/scheduler.md)
