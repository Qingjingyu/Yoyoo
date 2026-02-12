# OpenClaw 三层记忆复利引擎（老金实战拆解）

> **调研日期**: 2026-02-04
> **来源**: 老金公众号文章（OpenClaw 150k Star 热点）
> **目标**: 提炼三层记忆 + Hooks 复利引擎思路，评估可复用点。

## 1. 结论摘要
- 核心：三层记忆（知识图谱/每日笔记/隐性知识）+ Hook 自动提取 + 周期性摘要，形成“复利智能”。
- 价值：解决“反复交代背景、偏好遗忘、经验不积累”，让 AI 越用越懂人。
- 关键机制：原子事实可追溯，替代不删除；动态摘要 snapshot 降低加载成本；SessionStart 自动加载相关记忆；PostToolUse 自动写入事实。

## 2. 记忆三层
1) **知识图谱 (areas/)**
   - 存实体/主题/公式/作者等原子事实 (`items.json`) + 动态摘要 (`summary.md`).
   - 事实可标记 superseded，保留演化轨迹。
2) **每日笔记 (memory/YYYY-MM-DD.md)**
   - 时间线事件日志，记录任务、反馈、决策。
3) **隐性知识 (MEMORY.md)**
   - 模式、偏好、避坑经验，面向“风格/策略”。

## 3. 工作流（复利引擎 5 步）
1) 对话/任务执行。
2) Hooks 自动提取事实（主题、公式、反馈等）写入 items.json，更新 summary.md。
3) SessionStart 自动加载：MEMORY.md + 昨日日志 + 相关主题摘要。
4) 周期整理：审阅新增事实，更新摘要，标记过时。
5) 下一次任务自动引用最佳公式/避坑指南，持续优化。

## 4. 目录示例（文章案例）
```
.claude/memory/
├─ areas/
│  ├─ topics/ai-tools/{items.json, summary.md}
│  ├─ formulas/baokuan-title/{items.json, summary.md}
│  └─ authors/lao-jin-style/{items.json, summary.md}
├─ memory/2026-01-31.md
├─ MEMORY.md
└─ hooks/
   ├─ post_tool_use.py   # 提取并写入事实
   └─ session_start.py   # 会话前加载记忆
```

## 5. 关键实现点
- **原子事实替代**：新事实 supersede 旧事实，不删除，便于追溯演变。
- **动态摘要**：大批事实→摘要快照，降低上下文注入成本。
- **渐进式披露**：按需加载相关主题/摘要，不一股脑塞上下文。
- **Hooks**：PostToolUse 提取事实，SessionStart 预加载记忆。

## 6. 体验与效果
- 背景/偏好自动带入，免重复交代；风格/避坑自动遵循。
- 用量越大，记忆越丰富；3 个月后可形成“懂你”的助手。

## 7. 对 Yoyoo 的启示
- 复用三层记忆思路：在 Agent 层实现原子事实 + 摘要 + 每日记。
- 接入点：
  - Webhook/Hook 层自动记录任务事实、反馈、决策。
  - Session 启动时按主题加载摘要+偏好。
  - 周期性维护（周/日）自动归档与 supersede。
- 可结合现有 MiniMax/Moltbot 方案，补充 Browser-use 自动化记录。

## 8. 风险/注意
- 记忆膨胀：需定期摘要与 supersede，防膨胀。
- 隐私与权限：日志/记忆含敏感信息，需访问控制与脱敏策略。
- 一致性：事实写入与摘要更新需幂等；避免并发覆盖。
