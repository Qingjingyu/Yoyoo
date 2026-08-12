# Feature 033：公网演示 Agent 清理

> 日期：2026-08-12
>
> 状态：已部署并完成生产验收

## 背景

公网首版为验证多人多 Agent 房间预置了 `Planner`、`Builder`、`Reviewer` 三个确定性
演示 Agent。它们没有真实运行节点、消息、任务、文件或交付物，却会在每次应用启动时
自动恢复。只删数据库记录会在重启后复发，因此必须先关闭生产自动播种，再做精确清理。

## 关键决策

- 新增 `YOYOO_BUILTIN_AGENTS`，仅接受 `demo` 或 `none`；拼写错误直接阻止启动，
  不静默降级。
- 本地开发默认继续使用 `demo`，避免破坏既有自动化和离线验收；生产 Compose 默认
  使用 `none`。
- Agent Gateway 始终注册，关闭演示 Agent 不影响以后接入真实 Agent。
- 数据清理只按三个已核验 Principal ID 进行。保留 `AI_100001`、系统 Principal、
  工作区、空协作室、所有者成员关系、会话和登录数据。

## 否掉的方案

- 只从数据库删除：应用一重启便重新创建三个 Agent，不能解决根因。
- 清空生产数据库：会误删所有者身份、密码、会话和可复用房间，风险与需求不匹配。
- 删除确定性适配器：它仍是本地测试与开发基线，删除会扩大回归面。

## 回退方案

- 应用回退到清理前镜像 `yoyoo-space:44f45b8`。
- 数据回退使用生产主机和本机各自保留的
  `pre-demo-agent-cleanup-20260812T105800Z` PostgreSQL 与 BlobStore 备份。
- 恢复数据会覆盖当前状态，必须另行确认后执行；本次不自动执行恢复。

## 验证记录

- 测试先行：禁用播种用例最初收到 3 个 Agent，证明旧行为；实现后返回空数组。
- 单元/UI 目标文件 8 项通过，TypeScript、ESLint、全量单元/UI 170 项和生产构建通过。
- 本地备份副本的 PostgreSQL 与 BlobStore SHA-256 与服务器 manifest 一致；服务器端
  `pg_restore --list`、`tar -tzf` 和 manifest 复验通过。
- 生产部署镜像为 `yoyoo-space:c4159af`；应用与 PostgreSQL 容器均为 healthy。
- 删除事务在停用应用后再次断言目标身份与受保护依赖：消息、提及、运行、委托、
  交付物、附件、修订、单聊、Gateway Job 和 AI Card mapping 均为 0；随后只删除
  3 条房间成员、3 条工作区成员和 3 个目标 Principal。
- 清理后数据库只保留 `AI_100001 / Su Bai` 和 `AI_100002 / Yoyoo`，保留 1 个
  `协作室`及其所有者成员关系；消息、运行和附件均为 0。
- 应用主动再次重启后仍为 2 个 Principal、1 个房间、0 个 Agent，证明演示 Agent
  不再复生。
- HTTPS/SNI 生产验收：健康检查 `200`、匿名工作区 `401`、真实账号登录 `200`、
  登录后工作区为 `Su Bai / 1 room / 0 agents`。当前 Mac 到公网 TLS 路由在验收期间
  偶发握手超时，因此删除后的确定性登录结论取自服务器本机经过 Nginx、TLS、Cookie
  和认证中间件的 SNI 回环请求；删除前公网直连同一流程已成功。
