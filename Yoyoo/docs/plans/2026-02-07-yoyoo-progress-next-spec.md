# Yoyoo Progress & Next Spec (2026-02-07)

## Current Status

Yoyoo 第一大脑当前关键链路已完成加固并上线：

1. 执行稳定性：`dingtalk/api -> last` 渠道兼容、`session file locked` 自动重试。
2. 意图命中率：问候不再覆盖任务/能力请求。
3. 记忆维护：新增一体化维护脚本（归档 + 日评估 + 策略重排）与 systemd 定时器。
4. 可观测性：`/api/v1/ops/health` 增加趋势摘要（24h vs 7d）与指标 delta。
5. 发布治理：新增 full-stack smoke 与生产 release-check 脚本。

## Acceptance Evidence

- 本地：`make lint`, `make test`, `make release-check` 通过。
- 服务器：关键回归测试通过（adapter/bridge/intent/api/memory-maintenance）。
- 服务器：`yoyoo-backend.service`、`openclaw-http-bridge.service` 运行正常。
- 服务器：`yoyoo-memory-maintenance.timer` 已启用，下一次触发时间已就绪。
- 实测：任务请求与反馈绑定可闭环，bridge 执行与健康检查通过。

## Next Spec (v0.5)

1. **DingTalk 可见 task_id 增强**
   - 目标：无需用户手抄 task_id，默认附带“可点击反馈按钮/引用标识”。
   - 验收：钉钉端反馈命中率 > 95%。

2. **策略卡在线学习闭环**
   - 目标：把高频成功任务自动沉淀为策略模板并灰度启用。
   - 验收：`strategy_hit_rate` 连续 7 天提升或稳定在阈值之上。

3. **执行回包结构化约束**
   - 目标：执行器输出统一 JSON schema，再渲染为人类可读文案。
   - 验收：`execution_quality_score` 均值提升，低质量回包率下降。
