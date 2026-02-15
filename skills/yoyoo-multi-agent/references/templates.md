# Yoyoo 任务模板参考

## 任务结构

```typescript
interface YoyooTask {
  id: string;
  type: "single" | "parallel" | "chain";
  description: string;
  assignee?: string;        // 指定员工
  timeout: number;          // 超时时间(秒)
  steps?: TaskStep[];      // 串行步骤
  subtasks?: SubTask[];    // 并行子任务
  onComplete?: string;     // 完成后的回调
}

interface TaskStep {
  employee: string;         // 员工类型
  instruction: string;     // 具体指令
  expectedOutput: string;   // 期望输出
}

interface SubTask {
  id: string;
  employee: string;
  instruction: string;
}
```

## 预定义模板

### 模板1: 简单对话

```typescript
{
  type: "single",
  description: "回答用户问题",
  assignee: "ceo",
  timeout: 60
}
```

### 模板2: 代码开发

```typescript
{
  type: "chain",
  description: "完成功能开发",
  steps: [
    {
      employee: "产品部",
      instruction: "分析需求，输出需求文档",
      expectedOutput: "需求文档"
    },
    {
      employee: "研发部",
      instruction: "根据需求文档实现代码",
      expectedOutput: "可运行代码"
    },
    {
      employee: "研发部",
      instruction: "编写测试用例并执行",
      expectedOutput: "测试通过"
    }
  ],
  timeout: 600
}
```

### 模板3: 市场调研

```typescript
{
  type: "parallel",
  description: "完成竞品调研",
  subtasks: [
    {
      id: "feature",
      employee: "市场部",
      instruction: "调研竞品A的核心功能"
    },
    {
      id: "price",
      employee: "市场部",
      instruction: "调研竞品B的定价策略"
    },
    {
      id: "user",
      employee: "市场部",
      instruction: "调研竞品C的用户评价"
    }
  ],
  timeout: 300,
  onComplete: "汇总成报告"
}
```

### 模板4: 复杂沟通

```typescript
{
  type: "chain",
  description: "处理客户反馈",
  steps: [
    {
      employee: "产品部",
      instruction: "理解客户反馈的问题",
      expectedOutput: "问题分析"
    },
    {
      employee: "外交部",
      instruction: "起草回复内容",
      expectedOutput: "回复草稿"
    },
    {
      employee: "产品部",
      instruction: "确认回复内容准确",
      expectedOutput: "确认"
    }
  ],
  timeout: 180
}
```

## 使用示例

```typescript
// 使用模板创建任务
async function createDevTask(userRequest: string) {
  return {
    type: "chain",
    description: "开发功能",
    steps: [
      {
        employee: "研发部",
        instruction: `分析需求：${userRequest}，输出技术方案`,
        expectedOutput: "技术方案文档"
      },
      {
        employee: "研发部",
        instruction: "根据技术方案实现代码",
        expectedOutput: "完整代码"
      }
    ],
    timeout: 600
  }
}

// 执行任务
async function executeTask(template: YoyooTask) {
  if (template.type === "single") {
    // 直接分配给指定员工
  } else if (template.type === "parallel") {
    // 并行执行所有子任务
    const results = await Promise.all(
      template.subtasks.map(sub => spawnEmployee(sub))
    )
    return aggregateResults(results)
  } else if (template.type === "chain") {
    // 串行执行每一步
    let context = {}
    for (const step of template.steps) {
      const result = await spawnEmployee(step, context)
      context = { ...context, [step.employee]: result }
    }
    return context
  }
}
```

## 任务状态流转

```
PENDING → ASSIGNED → RUNNING → COMPLETED/FAILED
              ↓
         BLOCKED (等待依赖)
```

## 监控指标

- 任务完成率
- 平均执行时间
- 员工利用率
- 超时/失败率
