---
name: yoyoo-multi-agent
description: |
  Yoyoo多AI员工协作系统。用于管理、调度和协调多个AI员工（subagents）完成复杂任务。
  触发条件：
  - 需要多个AI同时处理不同任务
  - 任务需要分解给不同专业的员工
  - 需要汇总多个AI的结果
  - 协调AI员工之间的协作
allowed-tools: Bash,sessions_spawn,sessions_list,sessions_send,memory_search,memory_get
---

# Yoyoo Multi-Agent 协作系统

## 核心概念

Yoyoo采用 **C2A2A2C** 模式：
- **C (用户)** → **A1 (CEO/子夜)** → **A2 (员工)** → **C (用户)**

员工类型：
| 员工 | 职责 | 触发词 |
|------|------|--------|
| 研发部 | 写代码、调试、技术实现 | "写代码"、"开发"、"修复bug" |
| 外交部 | 对外沟通、联系客户 | "联系"、"沟通"、"对接" |
| 产品部 | 需求分析、产品规划 | "调研"、"规划"、"需求" |
| 市场部 | 竞品分析、数据统计 | "分析"、"调研"、"报告" |

## 协作模式

### 模式1: 串行协作
一个员工完成后，交由下一个继续处理。

```
用户 → 研发部写代码 → 产品部Review → 返回用户
```

### 模式2: 并行协作
多个员工同时处理不同子任务。

```
用户 → [研发部A] ─┐
     → [研发部B] ─┼→ 结果汇总 → 返回用户
     → [市场部] ──┘
```

### 模式3: 雇佣临时AI
遇到专业知识盲区时，雇佣临时AI专家。

```
用户 → 子夜 → 临时雇佣Python专家 → 完成特定任务 → 解散
```

## 使用方法

### 1. Spawn Subagent

```typescript
// 使用 sessions_spawn 创建员工
await sessions_spawn({
  agentId: "default",
  task: "帮我写一个用户登录API",
  label: "yoyoo-employee-researcher-1",
  runTimeoutSeconds: 300
})
```

### 2. 任务分发

```typescript
// 分解任务给多个员工
const researcher = await sessions_spawn({ task: "调研竞品功能", ... })
const developer = await sessions_spawn({ task: "实现功能", ... })

// 等待结果
const researchResult = await sessions_history({ sessionKey: researcher.sessionKey })
const devResult = await sessions_history({ sessionKey: developer.sessionKey })

// 汇总
const final = combineResults(researchResult, devResult)
```

### 3. 跨agent通信

```typescript
// agent A 发消息给 agent B
await sessions_send({
  sessionKey: "agent-B-session",
  message: "用户需要你帮忙处理..."
})
```

## 任务分配原则

1. **单一职责** - 每个员工只做一件事
2. **明确目标** - 给员工清晰的任务描述
3. **设置超时** - 避免员工卡住（默认5分钟）
4. **检查点** - 关键节点确认进度
5. **结果汇总** - 最后一个agent负责汇总

## 常见流程

### 写代码流程
```
1. 产品部确认需求 → 2. 研发部实现 → 3. 自测 → 4. 返回结果
```

### 调研流程
```
1. 明确调研目标 → 2. 搜索/查资料 → 3. 整理报告 → 4. 返回结论
```

### 沟通流程
```
1. 理解沟通目标 → 2. 起草内容 → 3. 确认 → 4. 发送
```

## 错误处理

- **员工超时**: 增加超时时间或简化任务
- **员工失败**: 换另一个员工或自己处理
- **沟通失败**: 使用 sessions_send 重试

## 相关文档

- 员工配置: [references/employees.md](references/employees.md)
- 任务模板: [references/templates.md](references/templates.md)
