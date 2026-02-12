# Yoyoo Long-term Memory

## 当前共识
- 产品形态：YoyooCEO 负责对外沟通、任务分发、验收与汇报；执行层为可替换能力。
- 运营策略：先稳后强，优先保障长期可用，再扩展新能力。

## 稳态基线（2026-02-12）
- 网关：OpenClaw gateway systemd --user 常驻。
- 自愈：watchdog 每 2 分钟健康检查，异常自动重启。
- 记忆：每日快照，保留最近 14 天。
- 回包规范：Objective / Constraints / Actions / Evidence / Retry / Next Step。
