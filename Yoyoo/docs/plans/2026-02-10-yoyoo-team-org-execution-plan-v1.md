# Yoyoo AI CEO Team Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有 `Yoyoo/project/backend` 上落地“CEO-部门-执行层”团队模式，确保用户只对接 CEO，任务可分发、可追踪、可验收、可复盘。

**Architecture:** 保持 Brain-first：`User -> CEO Brain -> Department Role -> Executor(Claw/Nano) -> CEO 验收`。执行层只做能力提供，不直接对用户做最终承诺。记忆采用“CEO 总账本 + 部门账本”双层结构。

**Tech Stack:** Python 3.11, FastAPI, Pydantic, pytest, JSON persistent memory（与现有后端兼容）

---

### Task 1: 角色与任务数据模型

**Files:**
- Create: `Yoyoo/project/backend/app/intelligence/team_models.py`
- Create: `Yoyoo/project/backend/tests/test_team_models.py`

**Step 1: Write the failing test**

- 断言可创建 `RoleProfile`、`TaskCard`、`TaskEvidence`。
- 断言 `status` 仅允许 `pending/running/review/done/failed`。

**Step 2: Run test to verify it fails**

Run: `cd Yoyoo/project/backend && pytest tests/test_team_models.py -v`
Expected: FAIL（模型文件不存在）

**Step 3: Write minimal implementation**

- 定义核心模型：`RoleProfile`, `TaskCard`, `TaskEvidence`, `AcceptanceResult`。
- 补齐必要字段：`task_id/owner_role/checkpoints/evidence/risk/next_step`。

**Step 4: Run test to verify it passes**

Run: `cd Yoyoo/project/backend && pytest tests/test_team_models.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add Yoyoo/project/backend/app/intelligence/team_models.py Yoyoo/project/backend/tests/test_team_models.py
git commit -m "feat: add team role and task models for ai-ceo mode"
```

### Task 2: CEO 调度服务（分发+验收）

**Files:**
- Create: `Yoyoo/project/backend/app/intelligence/ceo_dispatcher.py`
- Create: `Yoyoo/project/backend/tests/test_ceo_dispatcher.py`

**Step 1: Write the failing test**

- 断言 CEO 可根据任务类型分配角色（ENG/OPS/QA/MEM/INNO）。
- 断言执行回包必须包含证据，不满足则进入 `review` 并附纠偏建议。

**Step 2: Run test to verify it fails**

Run: `cd Yoyoo/project/backend && pytest tests/test_ceo_dispatcher.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

- 提供 `dispatch(task)` 与 `accept(result)`。
- 输出统一结构：`ok/reply/error/evidence/next_step`。

**Step 4: Run test to verify it passes**

Run: `cd Yoyoo/project/backend && pytest tests/test_ceo_dispatcher.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add Yoyoo/project/backend/app/intelligence/ceo_dispatcher.py Yoyoo/project/backend/tests/test_ceo_dispatcher.py
git commit -m "feat: add ceo dispatch and acceptance workflow"
```

### Task 3: API 层接入 Team Mode

**Files:**
- Modify: `Yoyoo/project/backend/app/api/routes.py`
- Create: `Yoyoo/project/backend/tests/test_team_mode_api.py`

**Step 1: Write the failing test**

- 新增接口校验：
  - `POST /api/v1/team/tasks`（创建任务）
  - `POST /api/v1/team/tasks/{task_id}/result`（提交结果）
  - `GET /api/v1/team/tasks/{task_id}`（查询状态）

**Step 2: Run test to verify it fails**

Run: `cd Yoyoo/project/backend && pytest tests/test_team_mode_api.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

- 将请求接入 `ceo_dispatcher`。
- 所有用户可见回复统一由 CEO 生成。

**Step 4: Run test to verify it passes**

Run: `cd Yoyoo/project/backend && pytest tests/test_team_mode_api.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add Yoyoo/project/backend/app/api/routes.py Yoyoo/project/backend/tests/test_team_mode_api.py
git commit -m "feat: expose team mode api endpoints"
```

### Task 4: 联邦记忆（CEO总账本 + 部门账本）

**Files:**
- Modify: `Yoyoo/project/backend/app/services/memory_store.py`
- Create: `Yoyoo/project/backend/tests/test_federated_memory.py`

**Step 1: Write the failing test**

- 断言写入部门记忆后，CEO 总账本同步可检索。
- 冲突时保留快照并以 CEO 版本为准。

**Step 2: Run test to verify it fails**

Run: `cd Yoyoo/project/backend && pytest tests/test_federated_memory.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

- 新增命名空间：`memory.ceo`, `memory.dept.<role>`, `memory.user`。
- 增量同步接口：`sync_department_to_ceo(role, patch)`。

**Step 4: Run test to verify it passes**

Run: `cd Yoyoo/project/backend && pytest tests/test_federated_memory.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add Yoyoo/project/backend/app/services/memory_store.py Yoyoo/project/backend/tests/test_federated_memory.py
git commit -m "feat: add federated memory with ceo authority"
```

### Task 5: 执行适配器隔离（Claw/Nano）

**Files:**
- Modify: `Yoyoo/project/backend/app/services/executor_adapter.py`
- Create: `Yoyoo/project/backend/tests/test_executor_adapter_contract.py`

**Step 1: Write the failing test**

- 断言 Claw/Nano 返回统一契约：`ok/reply/error/evidence`。
- 断言故障时不影响 CEO 对话主流程（返回降级建议）。

**Step 2: Run test to verify it fails**

Run: `cd Yoyoo/project/backend && pytest tests/test_executor_adapter_contract.py -v`
Expected: FAIL

**Step 3: Write minimal implementation**

- 封装 provider adapter：`claw`, `nano`。
- 增加超时、重试、降级策略。

**Step 4: Run test to verify it passes**

Run: `cd Yoyoo/project/backend && pytest tests/test_executor_adapter_contract.py -v`
Expected: PASS

**Step 5: Commit**

```bash
git add Yoyoo/project/backend/app/services/executor_adapter.py Yoyoo/project/backend/tests/test_executor_adapter_contract.py
git commit -m "feat: harden executor adapter contract and fallback"
```

### Task 6: 验证与发布门槛

**Files:**
- Modify: `Yoyoo/docs/plans/2026-02-10-yoyoo-team-org-v1.md`
- Create: `Yoyoo/docs/plans/2026-02-10-yoyoo-team-acceptance-checklist-v1.md`

**Step 1: Add acceptance checklist**

- 用户只能对接 CEO。
- 任务可追踪（创建、执行、验收、复盘）。
- 记忆同步可验证。
- 执行层故障时可降级。

**Step 2: Run full test suite**

Run:
- `cd Yoyoo/project/backend && make test`
- `cd Yoyoo/project/backend && make lint`

Expected: 全部通过

**Step 3: Preflight**

Run: `~/.codex/skills/yoyoo-brain-dev/scripts/yoyoo_preflight.sh Yoyoo/project/backend`
Expected: 关键检查通过

**Step 4: Commit**

```bash
git add Yoyoo/docs/plans/2026-02-10-yoyoo-team-org-v1.md Yoyoo/docs/plans/2026-02-10-yoyoo-team-acceptance-checklist-v1.md
git commit -m "docs: add ai-ceo team mode acceptance checklist"
```

---

## 执行顺序建议（严格按序）

1. Task 1（数据模型）
2. Task 2（调度与验收）
3. Task 3（API 接入）
4. Task 4（联邦记忆）
5. Task 5（执行适配）
6. Task 6（发布门槛）

## 风险与熔断

- 同一任务连续失败 3 次：立即停下，记录根因，进入修正分支。
- 不允许跳过测试直接改实现。
- 不允许执行层直接对用户输出“最终完成”。
