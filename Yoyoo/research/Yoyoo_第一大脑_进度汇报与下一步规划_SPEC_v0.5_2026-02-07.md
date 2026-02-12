# Yoyoo 第一大脑：进度汇报与下一步规划 SPEC v0.5（2026-02-07）

## 1. 当前状态（已完成 P5）
- 主链路稳定：`钉钉 -> Yoyoo Backend(8000) -> Yoyoo Brain -> OpenClaw Adapter`。
- P5-A 已落地：反馈绑定支持短窗口重试（30 分钟内允许绑定 `planned` 任务），并保留引用/提示优先策略。
- P5-B 已落地：记忆持久化改为原子写 + 备份轮转（`memory.json.bak1~bak3`）+ 启动自动恢复。
- P5-C 已落地：新增 `/api/v1/ops/health`，汇总启动自检、任务统计、记忆落盘诊断。
- P5-D 已落地：反馈绑定失败时提供可执行引导（直接回复目标任务消息，无需手输 task_id）。

## 2. 本次关键代码变更
- `Yoyoo/project/backend/app/intelligence/memory.py`
  - 新增 `ops_health_snapshot()`、`persistence_diagnostics()`。
  - 新增原子写 `_write_payload_atomic()`、备份轮转 `_rotate_backups()`、启动恢复 `_load_payload_for_restore()`。
- `Yoyoo/project/backend/app/intelligence/brain.py`
  - 反馈绑定改为“双阶段解析 + 短窗口重试”。
  - 增加失败引导 `_build_feedback_not_found_reply()`。
- `Yoyoo/project/backend/app/api/dingtalk.py`
  - 统一使用绑定后的稳定用户 ID（`session.yoyoo_user_id`）进入 Brain。
- `Yoyoo/project/backend/app/main.py`
  - 新增 `/api/v1/ops/health`，输出可观测汇总。

## 3. 验证结果
- 测试：`make test` -> `63 passed`。
- Lint：`make lint` -> `All checks passed!`。
- Preflight：`yoyoo_preflight.sh <backend>` 通过（本地完整回归通过，远端检查未启用）。

## 4. 下一阶段规划（P6）
- P6-A 反馈可解释性增强：在成功绑定时返回“绑定依据”（hint/会话最近/用户最近/短窗口重试）。
- P6-B 任务证据结构化：将执行证据从自由文本升级为结构化字段（命令、输出摘要、耗时、来源）。
- P6-C 线上可观测闭环：新增反馈绑定成功率、短窗口命中率、记忆恢复次数的时序指标。
- P6-D 钉钉交互升级：支持“回复消息 ID -> task_id”显式映射缓存，彻底减少误绑。

## 5. 验收门槛（进入 v0.6）
- 线上连续 48 小时：反馈绑定成功率 >= 98%，无“找不到最近任务”异常峰值。
- `ops/health` 中 `memory.persistence.last_save_ok` 始终为 `true`，无持续恢复告警。
- 回归测试 + lint 持续全绿。
