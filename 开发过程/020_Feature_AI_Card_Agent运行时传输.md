# 020 Feature AI Card Agent 运行时传输

> 日期：2026-08-10  
> 状态：Phase 6B2 已实现，完成自动化自测和全新身份冷启动端到端验收；未完成第三方独立审查或部署

## 背景

Phase 6B1 让受控 AI Card 成为稳定的 Yoyoo Agent 成员，但不能领取任务。
Phase 6B2 把该身份接到现有 provider-neutral Gateway，不让 Yoyoo 复制 AI Card
的节点密钥、控制关系或撤销状态。

## 关键决策

- `at_` 运行时 Token 每个 heartbeat、claim 和 result 请求都向 AI Card
  introspect；issuer、client、audience、scope、过期时间任一不符即拒绝。
- pairwise Subject 必须唯一解析到一个 active Agent、active workspace membership
  和 enabled Gateway binding；多工作空间歧义默认拒绝。
- 本地只保存 workspace presence、node 引用和时间戳，不保存 Bearer、公钥或 Grant。
- job lease 同时支持有效 legacy credential 或有效 AI Card runtime presence；旧
  `yya_` 行为和路由保持不变。
- 参考桥直接读取 AI Card 认领脚本生成的 `0600` JSON，缓存短会话到到期前
  15 秒并自动续取；畸形响应和错误不回显令牌。
- 当前工作空间接口合并 legacy Gateway Agent 与已连接的 AI Card Agent，使认领成功的
  AI Card 能进入真实房间成员选择和消息链路，而不是只存在于设置页。

## 否掉的备选

- 立即删除 `yya_`：会中断既有 Gateway Agent，且不是本阶段迁移目标。
- 把 AI Card Agent 自动加入房间：身份成功不能扩大 Yoyoo 本地房间权限。
- 把 introspection 结果长期缓存：节点或 Grant 撤销无法在下一次请求生效。

## 影响范围

- 新增 forward-only migration `006_aicard_agent_runtime.sql`。
- 扩展 AI Card client、Gateway service/repository、Agent 目录 presence 和参考脚本。
- 新增命令 `npm run agent:gateway:aicard:yos`；未增加依赖，首页和房间 UI 未改。

## 验证结果

- lint、typecheck、生产 build 通过。
- 单元/UI `97/97`；PostgreSQL/HTTP `77/77`，另有 6 项外部 YOS 条件用例跳过。
- 桌面与移动 Playwright `24/24`。
- 新增回归覆盖：Node 入口可直接启动到配置校验，当前工作空间会返回已连接的
  AI Card Agent；定向集成测试 `7/7`，相邻 room/Gateway HTTP 回归 `14/14`。
- 本地真实三进程自验使用 AI Card `3002`、Yoyoo `4184` 和 YOS Web Console
  `3457`：完成 Passkey 登录、AI Card 认领与授权、运行时 heartbeat、Agent 入房、
  job claim、YOS 回复、run 完成和房间消息持久化。
- 安全路径自验：撤销 `agent.runtime` Grant 后新会话续取被拒绝；节点注销后 challenge
  返回 `409`。撤权后的旧令牌在受热更新污染的临时开发服务器上被拒绝但映射为 `500`；
  正式错误映射和 HTTP 集成测试仍要求无效 Bearer 返回 `401`。
- AI Card 同步通过单元 `62/62`、集成 `38/38`、E2E `28/28`。

### 2026-08-10 冷启动端到端验收

- 在已停止旧 Yoyoo 进程的前提下，由桌面运行管理器重新拉起 `4173`；AI Card
  `3002` 和 YOS Web Console `3457` 均通过健康检查。
- 使用全新中文展示名的人类 Card 和 Agent Card 完成 Passkey 登录、节点认领、
  Yoyoo 授权和 pairwise Principal 映射；中文仅用于展示，机器名保持规范化。
- 从真实房间成员详情页加入新 Agent，随后通过页面定向发送消息；Agent 经
  AI Card runtime session 领取任务，YOS 返回回复，run 状态完成且回复持久化到房间。
- 验收中发现并修复一个 P1：房间候选成员只读取 legacy Gateway heartbeat，导致
  已通过 AI Card runtime presence 在线的 Agent 无法加入房间。修复后候选接口同时
  接受未过期且 45 秒内活跃的 runtime presence，定向集成回归 `7/7`。
- 在 AI Card 私有页重新通过 Passkey 验证并撤销运行节点后，桥接进程下一次认证收到
  `AGENT_UNAUTHENTICATED`，证明节点撤销会阻断后续运行时访问。
- 撤销后的循环退避经隔离计时验证为 `1003/1001/1000ms`；先前看似连续刷新的错误
  是终端积压输出，不是紧密重试缺陷，因此没有为错误假设增加代码。

## 未验证与回退

- 可取消 Yoyoo 的 AI Card runtime 环境配置恢复 legacy-only 认证；数据库映射、
  历史消息和资源归属不删除。
- 本次冷启动结果使用全新身份和真实三进程，但仍由同一执行者完成，不等同于第三方
  独立审查；独立安全验收、真实硬件和生产部署仍未完成。
- 当前 AI Card 私有页只列出当前 Principal 自己的 Grant。控制者能撤销受控 Agent
  的运行节点，但不能在界面查看或单独撤销该 Agent 的平台 Grant；这是后续身份管理
  产品能力，不影响本次节点撤销链路结论。
