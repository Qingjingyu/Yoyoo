# Yoyoo Brain V2（智慧大脑）Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 Yoyoo 打造成长期可用、可持续进化的“第一大脑”（只负责理解、规划、记忆、验证、学习；执行由外部能力层完成）。

**Architecture:** 采用 Brain-First + Adapter Mesh：`User -> Ingress -> Yoyoo Brain -> Capability Adapters -> Evidence -> Memory/Policy Feedback`。Yoyoo 永远是唯一决策入口，OpenClaw/memU/MCP 仅是手脚。通过策略卡、评测基线、自动纠偏与记忆衰减实现长期演化。

**Tech Stack:** FastAPI + Pytest + Ruff + JSON memory store（现有）+ 可选 memU sidecar + MCP servers + DingTalk ingress + YYOS routing hints。

---

## 0. 北极星与硬性边界

### 北极星目标（90 天）
- 任务一次通过率（First Pass Success）`>= 85%`
- 用户反馈正向率 `>= 80%`
- 任务可追踪率（有 `task_id + trace_id + evidence`）`= 100%`
- 回归阻断率（上线前发现问题）持续上升，线上回滚率持续下降

### 架构红线
- 禁止：任何通道或执行器绕过 Yoyoo 直接回复用户。
- 禁止：记忆与策略核心逻辑下沉到 OpenClaw。
- 必须：每次任务都有计划、验收、回滚、证据。

---

## 1. 目标架构（V2）

### 1.1 逻辑分层
- `Ingress Layer`：`app/api/dingtalk.py`, `app/main.py`
- `Brain Kernel`：`app/intelligence/brain.py`
- `Planning & Verification`：`app/intelligence/planner.py`, `app/intelligence/verification.py`
- `Memory OS`：`app/intelligence/memory.py`, `app/intelligence/memory_pipeline.py`, `app/intelligence/memory_archive.py`
- `Policy & Quality`：`app/intelligence/policy_guard.py`, `app/intelligence/execution_quality.py`, `app/intelligence/strategy_cards.py`
- `Adapter Mesh`：`app/services/openclaw_adapter.py`, `app/intelligence/yyos_orchestrator.py`（已接入）
- `Ops & Release Gates`：`scripts/release_check.sh`, `scripts/smoke_full_stack.sh`, `docs/release_checklist.md`

### 1.2 数据契约（冻结）
- Task Record：`planned -> running -> completed|completed_with_warnings|failed|rolled_back|verified`
- Adapter Result：`ok/reply/error/evidence_structured/latency_ms/execution_duration_ms`
- Strategy Card：`trigger/action_template/constraints/success_signals/failure_signals/score/version`

---

## 2. 分阶段路线图（12 周）

## Phase A（Week 1-2）：大脑入口收敛 + 稳定性封顶

### Task A1: 单入口强制化（Yoyoo 唯一入口）
**Files:**
- Modify: `Yoyoo/project/backend/app/api/dingtalk.py`
- Modify: `Yoyoo/project/backend/scripts/dingtalk_stream_forwarder.cjs`
- Modify: `Yoyoo/project/backend/README.md`
- Test: `Yoyoo/project/backend/tests/test_dingtalk.py`

**Step 1: 写失败测试（绕过入口场景）**
- 断言任何“直接执行器回复”路径被拒绝或标记异常。

**Step 2: 运行测试并确认失败**
Run: `cd Yoyoo/project/backend && pytest tests/test_dingtalk.py -q`
Expected: 至少 1 条失败（旧路径仍可达）。

**Step 3: 实现最小改动**
- 收口到 `YoyooBrain.handle_message()`，统一通过 Brain 生成回复。

**Step 4: 测试通过**
Run: `cd Yoyoo/project/backend && pytest tests/test_dingtalk.py -q`
Expected: PASS。

**Step 5: 提交**
- `feat: enforce yoyoo as single ingress brain`

### Task A2: 运行时稳定性封顶（超时/重试/熔断）
**Files:**
- Modify: `Yoyoo/project/backend/app/services/openclaw_adapter.py`
- Modify: `Yoyoo/project/backend/app/intelligence/execution_quality.py`
- Test: `Yoyoo/project/backend/tests/test_openclaw_adapter.py`

**验收信号:**
- 执行超时后有清晰错误分类；
- SSH fallback 可控；
- 失败原因可回写 task evidence。

---

## Phase B（Week 3-4）：Memory OS V2（可用 -> 可靠 -> 可演化）

### Task B1: 三层记忆正式化
**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/memory.py`
- Modify: `Yoyoo/project/backend/app/intelligence/memory_pipeline.py`
- Add: `Yoyoo/project/backend/tests/test_memory_pipeline.py`（补充场景）

**范围:**
- 短期：会话上下文窗口
- 中期：task ledger + evidence
- 长期：strategy cards + daily summaries + decay

**验收信号:**
- retrieval_hit_rate 提升；
- feedback_conflict_rate 下降；
- stale_task_rate 可控。

### Task B2: memU Sidecar 接口（非侵入）
**Files:**
- Add: `Yoyoo/project/backend/app/services/memory_sidecar.py`
- Modify: `Yoyoo/project/backend/app/container.py`
- Modify: `Yoyoo/project/backend/app/intelligence/memory_pipeline.py`
- Add: `Yoyoo/project/backend/tests/test_memory_sidecar.py`

**策略:**
- 不直接嵌入 memU 内核；先做 HTTP/RPC sidecar 适配层。
- 可用开关：`YOYOO_MEMORY_SIDECAR_ENABLED=1`。

---

## Phase C（Week 5-6）：策略大脑（Strategy OS）

### Task C1: 策略卡对象化升级（可版本、可评分、可回滚）
**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/strategy_cards.py`
- Modify: `Yoyoo/project/backend/app/intelligence/brain.py`
- Modify: `Yoyoo/project/backend/app/intelligence/memory.py`
- Test: `Yoyoo/project/backend/tests/test_strategy_cards.py`

**验收信号:**
- 每次任务明确记录命中的策略卡；
- 人类反馈可影响策略分；
- 低表现策略可自动降级。

### Task C2: 规划模板引擎
**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/planner.py`
- Modify: `Yoyoo/project/backend/app/intelligence/verification.py`
- Test: `Yoyoo/project/backend/tests/test_planner.py`

**要求:**
- 默认“先只读后写”；
- 默认证据采集步骤；
- 默认回滚模板。

---

## Phase D（Week 7-8）：执行质量治理闭环

### Task D1: 执行质量评分 2.0
**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/execution_quality.py`
- Modify: `Yoyoo/project/backend/app/intelligence/brain.py`
- Test: `Yoyoo/project/backend/tests/test_brain.py`

**升级内容:**
- 评分维度：完成度/可执行性/证据充分性/安全性
- 低质量自动纠偏：按错误类型选择纠偏模板

### Task D2: 失败归因与预防建议
**Files:**
- Add: `Yoyoo/project/backend/app/intelligence/failure_attribution.py`
- Modify: `Yoyoo/project/backend/app/main.py`
- Test: `Yoyoo/project/backend/tests/test_api.py`

**验收信号:**
- `/api/v1/ops/alerts` 可看到失败模式分布；
- 每周自动生成“Top 失败原因 + 预防动作”。

---

## Phase E（Week 9-10）：能力总线（MCP/Skills/GitHub）

### Task E1: MCP 基础能力上线
**优先 MCP:** filesystem / git / memory / sequentialthinking / time

**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/yyos_orchestrator.py`
- Modify: `Yoyoo/project/backend/app/startup_self_check.py`
- Docs: `Yoyoo/project/backend/README.md`

**验收信号:**
- MCP 健康状态纳入 `/api/v1/ops/health`；
- 不可用时自动降级而不阻断主链路。

### Task E2: Skill 治理
**Files:**
- Add: `Yoyoo/project/backend/config/skill_allowlist.json`
- Add: `Yoyoo/project/backend/config/skill_blocklist.json`
- Add: `Yoyoo/project/backend/scripts/skill_audit.py`

**验收信号:**
- 技能来源可审计；
- 高风险技能默认禁用。

---

## Phase F（Week 11-12）：自治学习与发布系统

### Task F1: 日常学习任务自动化
**Files:**
- Modify: `Yoyoo/project/backend/scripts/daily_eval_and_rebalance.py`
- Modify: `Yoyoo/project/backend/scripts/memory_maintenance.py`
- Add: `Yoyoo/project/backend/deploy/yoyoo-self-learning.timer`

**输出工件:**
- 每日：策略卡升降级报告
- 每周：能力缺口与新增建议

### Task F2: 发布门禁升级（可长期运营）
**Files:**
- Modify: `Yoyoo/project/backend/scripts/release_check.sh`
- Modify: `Yoyoo/project/backend/docs/release_checklist.md`
- Add: `Yoyoo/project/backend/baseline/brain_regression_cases.json`

**硬门禁:**
- `make lint`
- `make test`
- `make baseline`
- `make smoke-full-stack`
- `CHECK_HTTP=1 make release-check`

---

## 3. 无限进化机制（核心设计）

### 3.1 Learning Flywheel
- 输入：用户任务 + 执行结果 + 人类反馈 + 线上告警
- 处理：归因 -> 策略卡更新 -> 规划模板调整 -> 回归新增用例
- 输出：下一轮任务默认更优策略

### 3.2 反退化机制
- 每次修复都要沉淀为回归用例；
- 策略卡修改必须带版本与回滚点；
- 发布后 24h 观察窗口异常自动触发降级。

### 3.3 自治等级（Autonomy Levels）
- L0: 建议模式（只建议不执行）
- L1: 需确认执行（默认）
- L2: 低风险自动执行
- L3: 高置信自动闭环（仅白名单任务）

---

## 4. 运营指标（SLI/SLO）

- `brain_reply_success_rate`
- `task_binding_success_rate`
- `execution_first_pass_success_rate`
- `memory_retrieval_hit_rate`
- `feedback_conflict_rate`
- `strategy_low_performance_rate`
- `rollback_rate`
- `mttr`（平均修复时间）

SLO（首版）：
- P0事件月累计 `< 2`
- 关键链路可用性 `>= 99.5%`
- 任务证据完整率 `= 100%`

---

## 5. 风险与应对

- 风险 1：能力层不稳定拖垮主链路
  - 应对：强超时 + 分类降级 + 错误透传
- 风险 2：记忆膨胀导致噪声增加
  - 应对：衰减、归档、摘要、冲突消解
- 风险 3：技能生态污染
  - 应对：allowlist、来源签名校验、最小权限
- 风险 4：策略学习“学坏”
  - 应对：双阈值发布 + 人工确认窗口 + 快速回滚

---

## 6. 每日/每周执行节奏（Runbook）

### 每日（开发期）
- 早：查看 `/api/v1/ops/health` + `/api/v1/ops/alerts`
- 中：完成 1 个主任务 + 1 个回归补丁
- 晚：`make release-check` + 写学习回顾

### 每周（运营期）
- 周一：策略卡评审
- 周三：故障复盘与阈值校准
- 周五：版本发布窗口 + 回滚演练

---

## 7. 立刻开工的 3 个首要交付（本周）

1. **交付 D-001（入口收敛）**
- 结果：钉钉全流量只经过 Yoyoo Brain
- 验收：无旁路回复日志

2. **交付 D-002（记忆质量）**
- 结果：三层记忆指标可观测且稳定
- 验收：`memory_retrieval_hit_rate` 连续 7 天不下降

3. **交付 D-003（质量门禁）**
- 结果：发布前自动门禁全覆盖
- 验收：任一门禁失败则阻断发布

---

## 8. 执行所需 skill 组合（固定编排）
- 规划：`writing-plans` + `yoyoo-brain-dev`
- 实施：`executing-plans` + `systematic-debugging`
- 质量：`verification-before-completion` + `qa-expert`
- 学习：`continuous-learning-v2`

