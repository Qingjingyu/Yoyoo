# Yoyoo Full Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完成 Yoyoo 第一大脑当前剩余能力：执行面稳定性、策略命中率、记忆维护、可观测性、发布回滚与全面 QA 验收。

**Architecture:** 保持 `DingTalk/API -> Yoyoo Brain -> OpenClaw Adapter` 主链路不变。在 Brain 层增强策略与反馈，在 Adapter 层增强容错，在 Memory 层新增维护流水线，在 Ops 层补趋势与诊断。

**Tech Stack:** FastAPI, pytest, Ruff, systemd, OpenClaw CLI, SSH.

---

### Task 1: 执行面稳定性修复

**Files:**
- Modify: `Yoyoo/project/backend/app/services/openclaw_adapter.py`
- Modify: `Yoyoo/project/backend/app/services/openclaw_http_bridge.py`
- Test: `Yoyoo/project/backend/tests/test_openclaw_adapter.py`
- Test: `Yoyoo/project/backend/tests/test_openclaw_http_bridge.py`

**Steps:**
1. 增加 channel 兼容映射（dingtalk -> last）与 session lock 重试机制。
2. 增加 unknown channel/lock 的错误分类与重试动作。
3. 为 HTTP bridge 增加相同兼容逻辑。
4. 补充回归测试：unknown channel、session lock、重试成功、失败回传。

### Task 2: 策略命中率提升

**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/brain.py`
- Modify: `Yoyoo/project/backend/app/intelligence/memory.py`
- Test: `Yoyoo/project/backend/tests/test_brain.py`
- Test: `Yoyoo/project/backend/tests/test_memory.py`

**Steps:**
1. 引入默认策略卡兜底（无命中时仍有可执行策略）。
2. 统一记录策略来源，确保 `strategy_cards_used` 完整写回。
3. 补策略命中与兜底回归测试。

### Task 3: 记忆维护 V2（Archive/Decay/Conflict Cooling）

**Files:**
- Modify: `Yoyoo/project/backend/app/intelligence/memory.py`
- Add: `Yoyoo/project/backend/scripts/memory_maintenance.py`
- Add: `Yoyoo/project/backend/deploy/yoyoo-memory-maintenance.service`
- Add: `Yoyoo/project/backend/deploy/yoyoo-memory-maintenance.timer`
- Modify: `Yoyoo/project/backend/Makefile`
- Modify: `Yoyoo/project/backend/README.md`
- Test: `Yoyoo/project/backend/tests/test_memory.py`

**Steps:**
1. 增加策略/反馈衰减与冲突降温逻辑。
2. 增加一键维护脚本（可 dry-run）。
3. 增加 systemd 定时任务模板并文档化。
4. 补充维护脚本与内存逻辑测试。

### Task 4: 可观测性与发布回滚标准化

**Files:**
- Modify: `Yoyoo/project/backend/app/main.py`
- Add: `Yoyoo/project/backend/scripts/smoke_full_stack.sh`
- Add: `Yoyoo/project/backend/deploy/yoyoo-release-check.sh`
- Modify: `Yoyoo/project/backend/README.md`
- Test: `Yoyoo/project/backend/tests/test_api.py`

**Steps:**
1. 在 `ops/health` 增加趋势摘要与关键诊断字段。
2. 增加发布前 smoke 脚本与回滚脚本模板。
3. 补 API 回归测试。

### Task 5: 全量验证与服务器部署

**Files:**
- Verify: `Yoyoo/project/backend/*`

**Steps:**
1. 执行本地全量验证：`make lint`, `make test`, `make baseline`, `make release-check`。
2. 同步代码到服务器并重启 `yoyoo-backend.service`。
3. 执行线上冒烟：chat、dingtalk events、ops health、daily eval、memory maintenance。
4. 启用新增 timer，检查 `systemctl list-timers`。
5. 记录最终验收证据与剩余风险。
