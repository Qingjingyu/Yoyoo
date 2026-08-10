# 018 Feature AI Card 身份接入

> 版本：Phase 6A
> 日期：2026-08-09
> 状态：已实现并完成自动化与本机双服务自测；未独立验收或部署

## 背景

Yoyoo 已经拥有稳定的本地 Principal、工作空间、房间、消息和 Agent
Gateway，但外部身份仍由 Yoyoo 自己创建。Phase 6A 首次接入独立 AI Card
身份服务，让当前人类 Owner 可以授权并绑定同一个本地 Principal。

## 关键决策

- 唯一映射键是 `(issuer, client_id, pairwise subject)`，不是中文昵称、
  `@handle`、Card ID 或本地 Principal ID。
- AI Card 只证明外部身份；Yoyoo 继续拥有本地权限、房间、消息、文件、任务
  和审计。
- 已有 Owner 原位绑定 AI Card，不创建第二个“苏白”，从而保持历史归属。
- PKCE 使用 S256；十分钟授权事务使用 AES-256-GCM 加密 HttpOnly Cookie。
- 首次注册和既有 Passkey 登录都保留原授权请求；非规范 `127.0.0.1`
  入口先跳转到预注册的 `localhost` 主机，避免跨主机丢失授权 Cookie。
- access token 和 refresh token 只在服务端回调内存中短暂存在，不进入数据库、
  URL、页面或日志。
- 旧 Agent Gateway 暂不删除，作为可回退兼容路径。

## 否掉的备选

- 用昵称或 Handle 查找用户：可重复、可修改，会串错身份。
- 把 pairwise Subject 写进 `principals.external_key`：会把外部发行方细节污染
  本地业务身份，并妨碍未来多发行方映射。
- 直接替换现有 `yya_` Gateway Token：Phase 6A 尚未交付 AI Agent 的持续
  运行时认证，直接删除会破坏现有真实 AI 接入。
- 明文保存 refresh token：不满足当前凭据边界和撤销风险控制。

## 影响范围

- 新增 forward-only `005_aicard_identity_mapping.sql`。
- 新增 AI Card 客户端、授权事务加密、开始与回调路由。
- PrincipalRepository 增加稳定映射与现有 Owner 绑定。
- `/settings/agents` 增加低频 AI Card 入口和回调状态。
- 未增加依赖；首页、房间、消息、Agent Gateway 和历史数据结构未修改。

## 回退

- 从界面隐藏 `连接 AI Card` 入口即可停止新授权。
- 保留新增映射表不会影响旧代码；不要回滚或改写已应用 migration。
- 现有 Agent Gateway 与本地 Owner external key 始终保留。

## 验证结果

- `lint`、隔离干净目录 `typecheck` 和生产 `build` 通过。
- 单元与 UI 测试：79/79 通过。
- PostgreSQL 与 HTTP 集成测试：63/63 通过；另有 6 项按既有环境条件跳过。
- 完整浏览器回归：24/24 通过，覆盖桌面和移动端。
- AI Card 项目同步通过 `lint`、`typecheck`、生产 `build`、56/56 单元测试和
  32/32 集成测试；改动前完整浏览器回归为 28/28。
- 本机以 AI Card `localhost:3002`、Yoyoo `localhost:4173` 和 Chrome 虚拟
  WebAuthn 认证器完成首次注册、授权同意、回调绑定及界面成功态实测，控制台
  0 错误。`3002` 仅因本机 `3000` 已被无关服务占用，不改变预注册契约。
- 联调产生的两张临时 Card 和一条映射已按确认清理；原 Owner ID、展示字段、
  工作空间和房间 Owner 关系仍在。

## 后续风险

- 当前只绑定私有单 Owner，不能作为公共多用户登录系统。
- 真实硬件 Passkey、独立安全审查和生产环境授权仍未验收。
- Phase 6B 仍需定义 AI Agent 如何持有、续期和撤销 AI Card 运行时会话。
- 公网部署前仍需独立安全审查、HTTPS、速率限制和密钥轮换演练。
