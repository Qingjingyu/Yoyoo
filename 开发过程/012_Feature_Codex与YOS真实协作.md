# 012 Feature: Codex 与 YOS 真实协作

> 日期：2026-08-07
> 状态：已实现并通过真实联调

## 背景

V0.2 已证明一个人可在同一持久房间中路由、并行运行和重试多个 Agent，
但房间中只有 YOS 是真实外部 Agent。V0.3 的小目标是让 Codex 成为第二个
真实 Agent，同时不改首页、不重做房间 UI、不引入新的数据库迁移。

## 关键决策

- Yoyoo 继续拥有成员身份、消息、运行状态、重试和持久化；Agent 只负责生成
  回复。Codex 和 YOS 都是可替换的适配器，不进入共享领域模型。
- YOS 模式沿用三个稳定成员槽位：Planner 槽位绑定 Codex，Builder 保留本地
  测试实现，Reviewer 槽位绑定 YOS。这样不会制造第四个成员或丢失历史身份。
- Codex 通过本机已登录的 `codex exec` 非交互运行，不复制 API Key 到项目。
- Codex 子进程使用临时只读工作目录、ephemeral 会话、JSONL 输出，关闭 Shell、
  Apps 和多 Agent 功能；提示词经 stdin 传入，不进入进程参数。
- 子进程只接收显式白名单环境变量。数据库地址、YOS 密码和
  `OPENAI_API_KEY` 不会转发；stderr 也不会进入用户消息。
- 超时、异常退出、无最终回复、非法 JSONL、回复或进程输出过大均转为明确、
  可重试且不泄露私密输出的失败事件。

## 未采用方案

- 直接调用 OpenAI API：本阶段不选。它会引入另一套密钥和计费配置，而本机
  Codex 已有可验证的 ChatGPT 登录态。
- 让 Codex 获得仓库工具权限：本阶段不选。房间只需要回复能力，工具执行会
  放大权限和副作用范围。
- 同时替换本地 Builder：本阶段不选。先保留一个确定性基线，便于隔离真实
  Agent 网络波动和产品错误。
- 重做首页或房间视觉：不属于本阶段目标，现有界面保持不变。

## 验证结果

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- Codex 适配器与运行时目标测试：16/16 通过。
- `pnpm test`：53/53 通过。
- `pnpm test:integration`：29/29 默认集成测试通过；5 个真实外部服务测试按
  设计默认跳过。
- `pnpm build`：通过。
- 显式真实联调：Codex-only、YOS-only、Codex + YOS 并行、关闭并重开运行时
  后从 PostgreSQL 恢复四条真实回复，1/1 通过，耗时 250.02 秒。
- 浏览器验收首次为 15/16；失败原因是测试依赖瞬时“正在停止”提示，实际运行
  已停止且干预消息已持久化。验收改为稳定的“已停止”状态后，失败点单独重跑
  1/1 通过，完整桌面与移动端复验 16/16 通过。
- `npm audit --omit=dev --registry=https://registry.npmjs.org`：生产依赖
  0 个已知漏洞。默认镜像不实现 audit 接口，因此使用官方 registry 复核。
- 生产模式本地服务在 `127.0.0.1:4175` 启动，工作区接口确认三个成员绑定为
  `Codex / Local Builder / YOS`，且能力声明与适配器一致。

## 影响范围

- 新增 Codex CLI Agent 适配器和显式 live 验收。
- YOS 模式的 Planner 槽位由本地 Planner 切换为 Codex。
- 本地默认模式、首页、视觉样式、数据库表结构、YOS 适配器均未改变。

## 已知限制

- Codex CLI 是整段回复边界，当前不宣称 token streaming 或取消能力。
- Codex 和 YOS 都依赖本机服务/登录状态与网络；失败可见且可重试，但不能
  承诺外部系统 exactly-once。
- 本地 Builder 仍是确定性测试 Agent；第三个真实外部 Agent 不在 V0.3 范围。
