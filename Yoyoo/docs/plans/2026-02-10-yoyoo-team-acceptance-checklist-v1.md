# Yoyoo Team Mode 验收清单 v1

> 日期：2026-02-10
> 用途：AI CEO-Yoyoo 团队模式发布门槛

## A. 对外行为

- [ ] 用户侧只有 `名字-CEO` 作为最终回复口。
- [ ] 任何部门角色不得直接给出“最终完成”承诺。
- [ ] 每条最终回复包含：结果、证据、风险、下一步。

## B. 任务生命周期

- [ ] 每个任务都有 `task_id`。
- [ ] 状态完整可追踪：`pending -> running -> review -> done/failed`。
- [ ] 任务有负责人、截止时间、验收记录。

## C. 记忆与同步

- [ ] CEO 总记忆可查询全部关键任务结论。
- [ ] 部门记忆可独立记录过程细节。
- [ ] 冲突处理遵循：CEO 版本为准 + 保留快照。
- [ ] 支持增量同步并有同步日志。

## D. 执行层稳定性

- [ ] Claw/Nano 适配器返回统一结构：`ok/reply/error/evidence`。
- [ ] 任一执行层故障时，系统可降级并继续回复用户。
- [ ] 失败信息不丢失，进入复盘记录。

## E. 工程质量

- [ ] `make test` 全通过。
- [ ] `make lint` 全通过。
- [ ] preflight 检查通过：
  - `~/.codex/skills/yoyoo-brain-dev/scripts/yoyoo_preflight.sh Yoyoo/project/backend`

## F. 运营可用性

- [ ] 有每日运营报告模板（任务量、成功率、失败TOP3原因）。
- [ ] 有异常处理SOP（重试、回滚、人工接管）。
- [ ] 有创新部候选能力评测记录。

## 本轮验证结果（2026-02-10）

- `make test`：通过（138 passed）
- `make lint`：通过（All checks passed）
- `~/.codex/skills/yoyoo-brain-dev/scripts/yoyoo_preflight.sh Yoyoo/project/backend`：通过（远程检查未开启）
