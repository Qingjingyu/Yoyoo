# Yoyoo Kernel 1.0 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Yoyoo Kernel 1.0 as a brain-first system: one Yoyoo entrypoint, OpenClaw as execution engine, memory + verification controlled by Yoyoo.

**Architecture:** Hard-fork from OpenClaw for production-grade runtime, then add Yoyoo Brain layer as the only decision path. All user messages flow through Brain -> Adapter -> Execution. Brain owns task state, memory, policy, and acceptance.

**Tech Stack:** OpenClaw (Node/TS) + Yoyoo Brain service (Python/FastAPI) + SQLite/Postgres + Redis(optional) + Feishu channel.

---

## Phase A: 基线冻结（防止继续漂移）

### Task A1: 统一入口
- Keep one external bot identity: `Yoyoo`
- Disable direct multi-bot group speaking
- Acceptance: any group message receives exactly one reply source

### Task A2: 内核仓准备
- Fork `openclaw/openclaw` to `yoyoo-kernel`
- Create folders: `brain/`, `contracts/`, `memory/`, `governance/`
- Acceptance: repo boots and tests pass unchanged

## Phase B: Brain最小闭环（P0）

### Task B1: 定义Brain协议
- Create `contracts/brain_contract.md`
- Request schema: `task_id, intent, constraints, context`
- Response schema: `status, answer, evidence[], next_action, error`
- Acceptance: schema example validated by one real request

### Task B2: 建立任务状态机
- States: `new -> planned -> executing -> verifying -> done/failed`
- Persist fields: owner, steps, evidence, retries
- Acceptance: one task can complete full state transition

### Task B3: 接入OpenClaw适配层
- Brain calls OpenClaw only via adapter API
- Adapter returns structured results, no free-form side effects
- Acceptance: one user task runs through Brain->OpenClaw->Brain

### Task B4: 证据验收闸门
- Done requires evidence; no evidence -> cannot close task
- Evidence types: command output, file diff, API result, screenshot ref
- Acceptance: fake completion is rejected in test

## Phase C: 记忆与学习（P1）

### Task C1: 双层记忆
- Long-term memory: preferences/decisions/policies
- Daily memory: run logs and retrospectives
- Acceptance: next-day task can reuse previous key decisions

### Task C2: 学习管道
- Import source (repo/skill/doc) -> extract capability card -> sandbox test -> score -> promote/reject
- Acceptance: one imported skill passes full pipeline and becomes callable

## Phase D: 稳定性与发布（P2）

### Task D1: 安全边界
- High-risk ops require explicit confirmation
- Secrets only from env/secret store
- Acceptance: risky command blocked without confirmation

### Task D2: 可观测性
- Metrics: success rate, retries, latency, evidence coverage
- Logs: task timeline with task_id
- Acceptance: one run can be traced end-to-end

### Task D3: 发布门禁
- Preflight, smoke, rollback checklist mandatory
- Acceptance: release checklist all green before deploy

## Immediate Next 3 Actions
1. Freeze external behavior to single Yoyoo speaker.
2. Create `brain_contract.md` and state machine model.
3. Run one real Feishu request through P0 loop and inspect evidence closure.
