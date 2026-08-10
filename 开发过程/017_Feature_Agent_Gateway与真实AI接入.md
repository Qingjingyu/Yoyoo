# 017 Feature Agent Gateway 与真实 AI 接入

> 版本：V0.8
> 日期：2026-08-08

## 背景

V0.7 已经建立人类与多 AI 共享的房间，但 AI 席位仍由 Yoyoo 进程内的固定 Adapter 注册。V0.8 增加通用 Agent Gateway，让工作空间所有者可以接入外部 AI，并使用原有房间、消息、运行和审计链路。

## 关键决策

- 外部 AI 是工作空间内的一等 Agent Principal，不是一条供应商配置。
- Yoyoo 负责身份、权限、房间、消息、持久任务、状态和审计；AI 负责理解、记忆、推理、工具与最终回复。
- 协议使用 Agent 主动拉取：心跳、单任务租约、结果回写。不保存任意回调 URL，不向桥接进程暴露数据库。
- Token 由 256-bit 随机数生成，仅在创建或轮换时显示一次；数据库只保存 SHA-256 digest 和 8 位提示。
- 每个 Agent 同时只能领取一个未过期租约。旧租约过期后不得回写，无主任务可重新领取，完全相同的重复结果幂等接受。
- 只有 45 秒内存在心跳的 Gateway Agent 才会出现在房间候选成员中；撤销凭据同时禁用认证和新路由，但不删除历史归属。
- YOS 是第一个参考桥接，不进入 Yoyoo 共享领域。其他 Agent 只需复用公开 HTTP 客户端。

## 否掉的备选

- 为每个 AI 供应商继续写进程内 Adapter：会把 Yoyoo 变成供应商集成仓，外部 Agent 也无法独立部署。
- 让 Yoyoo 主动请求用户填写的 callback URL：引入 SSRF、内网访问和凭据管理风险，V0.8 不需要。
- 直接把 AI 接入放在对话一级界面：它是低频所有者行为，保留在设置与房间详情更符合 IM 心智。
- V0.8 同时增加 streaming、取消、委派和 Artifact 入站：会放大协议与恢复面，当前只交付完整文本与失败结果。

## 影响范围

- 新增 `004_agent_gateway.sql`、Gateway 仓储/服务/Adapter、owner 和 Agent HTTP 路由。
- 新增 `/settings/agents` 的 loading / empty / error / success 四态、创建、轮换和撤销流程。
- 已连接 Agent 复用 V0.7 房间详情的成员候选和原有 run coordinator。
- 新增公开参考客户端与 YOS 桥接进程。
- 首页、已有房间结构、已有 Adapter 能力声明与依赖版本未改变；本版未增加依赖。

## 验证证据

- PostgreSQL 17 健康；4 个 forward migration checksum 校验通过，第二次执行全部为 verified no-op。
- `npm run lint` 和 `npm run typecheck` 通过。
- 单元/UI：15 个测试文件、71 项全部通过。
- PostgreSQL/HTTP 集成：11 个默认测试文件、56 项全部通过；5 个外部服务文件、6 项显式跳过。
- 产品构建通过；`/settings/agents` 与 5 个 Gateway/owner 动态路由正常生成。
- Playwright：桌面与手机共 22 项全部通过。真实浏览器完成创建、一次性 Token、心跳在线、刷新不泄露、无横向溢出与 44px 手机触控验收。
- `1440x900` 和 `390x844` 人工截图复核：完整非空、无遮挡，控制台 0 错误 / 0 警告。
- 经用户明确同意后完成真实 YOS Gateway 闭环：`YOS Live` 心跳在线，专用验收房间只点名该 Agent，真实回复了本次唯一标记 `YOS_GATEWAY_OK_1786137410_15085`，run 为 `completed`。
- 重启 Yoyoo 运行时后，同一 run 状态和标记回复从 PostgreSQL 恢复，桥接也在短暂断线后自动恢复心跳。

## 调试与回归记录

- 首次真实启动失败：Vitest 会转译 TypeScript，而 Node 24 直接运行 `.mts` 时不支持构造函数参数属性语法。
- 修复将 `AgentGatewayProtocolError` 改为显式字段，没有引入新运行时依赖。
- 新增回归测试，直接使用当前 Node 可执行文件加载参考客户端，不再只依赖 Vitest 转译结果。

## 运行与回退

- 新 Agent 通过 `/settings/agents` 创建，Token 放在桥接进程环境变量。
- YOS 参考桥接使用 `npm run agent:gateway:yos`，停止该独立进程即可回退；原有 Yoyoo Adapter 路径仍保留。
- 撤销 Agent 凭据可立即停止新认证和新路由，不需要删除数据。
