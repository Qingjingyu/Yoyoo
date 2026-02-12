# Yoyoo Brain-First P1-P3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在现有可运行后端基础上，完成记忆管线、策略卡、执行质量治理三项升级，并保持钉钉链路稳定。  
**Architecture:** 保持 `Yoyoo Brain -> OpenClaw Adapter` 单向调用。将记忆、策略、质量治理做成 Brain 内部模块，所有结果经验证后再对用户回复。  
**Tech Stack:** FastAPI, pytest, Ruff, Yoyoo backend (`app/intelligence`, `app/services`, `app/api`), baseline replay。

---

### Task 1: 冻结数据契约（Task/Adapter/Strategy）

**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/models.py`
- Modify: `Yoyoo/project/backend/app/schemas.py`
- Test: `Yoyoo/project/backend/tests/test_api.py`

**Step 1: Write the failing test**  
新增契约字段断言（`evidence_structured`, `execution_duration_ms`, `strategy_id`）。  

**Step 2: Run test to verify it fails**  
Run: `cd Yoyoo/project/backend && make test`  
Expected: 至少 1 个字段缺失相关失败。

**Step 3: Write minimal implementation**  
补齐模型与 schema 字段，保持向后兼容（默认值可为空）。

**Step 4: Run test to verify it passes**  
Run: `cd Yoyoo/project/backend && make test`

**Step 5: Commit**  
`feat: freeze brain-first contracts for task adapter and strategy`

### Task 2: 引入 Memory Pipeline V1

**Files:**
- Create: `Yoyoo/project/backend/app/intelligence/memory_pipeline.py`
- Modify: `Yoyoo/project/backend/app/intelligence/memory.py`
- Modify: `Yoyoo/project/backend/app/intelligence/brain.py`
- Test: `Yoyoo/project/backend/tests/test_memory.py`
- Create: `Yoyoo/project/backend/tests/test_memory_pipeline.py`

**Step 1: Write the failing test**  
覆盖 `ingest -> extract -> dedupe -> summarize -> retrieve` 主流程。

**Step 2: Run targeted test to fail**  
Run: `cd Yoyoo/project/backend && .venv/bin/pytest tests/test_memory_pipeline.py -q`

**Step 3: Write minimal implementation**  
实现管线 orchestrator，并在 `brain.py` 读取检索结果注入回答构造。

**Step 4: Run tests**  
Run: `cd Yoyoo/project/backend && make test`

**Step 5: Commit**  
`feat: add memory pipeline v1 with structured retrieval path`

### Task 3: 策略卡对象化（P3-B）

**Files:**
- Create: `Yoyoo/project/backend/app/intelligence/strategy_cards.py`
- Modify: `Yoyoo/project/backend/app/intelligence/planner.py`
- Modify: `Yoyoo/project/backend/app/intelligence/brain.py`
- Test: `Yoyoo/project/backend/tests/test_planner.py`

**Step 1: Write failing tests**  
验证规划前会先检索策略卡，并将匹配结果写入 plan metadata。

**Step 2: Run targeted test to fail**  
Run: `cd Yoyoo/project/backend && .venv/bin/pytest tests/test_planner.py -q`

**Step 3: Write minimal implementation**  
新增策略卡检索与评分，未命中时回退到默认模板化拆解。

**Step 4: Run tests**  
Run: `cd Yoyoo/project/backend && make test`

**Step 5: Commit**  
`feat: add strategy card retrieval before planning`

### Task 4: 执行质量评分与自动纠偏（P3-A）

**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/execution_quality.py`
- Modify: `Yoyoo/project/backend/app/intelligence/brain.py`
- Test: `Yoyoo/project/backend/tests/test_brain.py`

**Step 1: Write failing tests**  
覆盖低分回包触发纠偏重试与最终失败透传。

**Step 2: Run targeted test to fail**  
Run: `cd Yoyoo/project/backend && .venv/bin/pytest tests/test_brain.py -q`

**Step 3: Write minimal implementation**  
质量分阈值 + 单次纠偏重试 + evidence 附加。

**Step 4: Run tests**  
Run: `cd Yoyoo/project/backend && make test`

**Step 5: Commit**  
`feat: add execution quality scoring and correction loop`

### Task 5: 可观测与发布门禁收敛

**Files:**
- Modify: `Yoyoo/project/backend/app/main.py`
- Modify: `Yoyoo/project/backend/docs/release_checklist.md`
- Modify: `Yoyoo/project/backend/scripts/release_check.sh`
- Test: `Yoyoo/project/backend/tests/test_startup_self_check.py`

**Step 1: Write failing tests**  
增加 `ops/health` 的记忆质量指标断言（命中率/冲突率/过期率）。

**Step 2: Run test to fail**  
Run: `cd Yoyoo/project/backend && .venv/bin/pytest tests/test_startup_self_check.py -q`

**Step 3: Write minimal implementation**  
新增指标字段与 `release-check` 校验项。

**Step 4: Run verification suite**  
Run:  
- `cd Yoyoo/project/backend && make lint`  
- `cd Yoyoo/project/backend && make test`  
- `cd Yoyoo/project/backend && make baseline`  
- `cd Yoyoo/project/backend && make release-check`

**Step 5: Commit**  
`chore: tighten ops metrics and release gate for brain-first flow`

### Task 6: 服务器灰度与回滚演练

**Files:**
- Modify: `Yoyoo/research/Yoyoo_第一大脑_进度汇报与下一步规划_SPEC_v0.8_2026-02-07.md`
- Create: `开发过程/004_yoyoo_brain_first_gray_release_2026-02-07.md`

**Step 1: Prepare rollout checklist**  
明确灰度开关、观察窗口、回滚条件。

**Step 2: Execute smoke checks**  
Run（服务器）：  
- `make release-check`  
- `curl -s http://127.0.0.1:8000/api/v1/ops/health`

**Step 3: Record evidence**  
把命令输出摘要写入发布记录文件。

**Step 4: Define rollback trigger**  
例如：连续 3 次绑定失败或 alert_status=critical 即回滚。

**Step 5: Commit**  
`docs: add gray release evidence and rollback rules`

---

Plan complete and saved to `Yoyoo/docs/plans/2026-02-07-yoyoo-brain-first-p1-p3-implementation-plan.md`. Two execution options:

**1. Subagent-Driven (this session)** - 我在当前会话按任务逐个执行并在每步后给你验收证据。  
**2. Parallel Session (separate)** - 新开会话使用 executing-plans 进行批量执行与检查点推进。  
