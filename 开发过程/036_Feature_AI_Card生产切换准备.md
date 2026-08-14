# 036 Feature AI Card 生产切换准备

> 日期：2026-08-14
> 状态：已部署并完成公网自验；首次真实持卡人注册待苏白完成

## 背景

V0.16 已能以 AI Card 作为人类与外部 AI 的统一身份权威，但现有生产 Compose 只配置本地密码身份。没有显式 issuer、client、audience、callback 和会话加密秘密时，代码无法安全切换。

## 关键决策

- Yoyoo 正式客户端固定为 `yoyoo_prod`，issuer 为 `https://id.yoyooai.com`，callback 为现有 App 的精确 HTTPS 地址。
- 首次切换保留折叠的本地密码入口作为可逆恢复路径，AI Card 作为正常主入口。
- 五个 AI Card 变量允许在 Compose 中为空，以便旧镜像和旧 `.env` 可以回滚；新版本在需要统一身份时由运行时配置校验失败关闭。
- 切换只映射权威 Card 到现有 Principal，不改变消息、房间、成员或资源 ID。

## 否掉的备选

- 立即删除密码登录：一旦身份服务或证书故障，单一管理员将无法进入产品。
- 在 Yoyoo 内继续发 Card：会形成第二身份权威，已由 V0.16 明确禁止。
- 把 AI Card 变量写死进镜像：会把环境与秘密混入构建产物，无法安全轮换。

## 当前验证

- Compose 在完整 AI Card 配置和空回滚配置下均可解析。
- AI Card 独立发布包已完成本地容器启动链和 production doctor。
- ESLint、TypeScript 和 Next.js 生产构建通过。
- 单元/UI 测试 38 个文件、188 项通过。
- 默认 PostgreSQL/HTTP 集成测试 23 个文件、130 项通过；5 个外部 live 文件共 7 项按设计跳过。
- Playwright 桌面与移动端回归 38/38 通过。
- 生产切换前备份位于
  `/opt/yoyoo/backups/aicard-cutover-20260814T045013Z`，PostgreSQL dump、
  BlobStore、Nginx 与环境配置均通过可读性和 SHA-256 校验。
- Yoyoo 生产镜像为 `yoyoo-space:9f28fad`，数据库迁移账本为 18 条，
  `015` 至 `018` 已按顺序应用；旧镜像 `yoyoo-space:c4159af` 保留可回退。
- `app.yoyooai.com`、`id.yoyooai.com` 与 `yoyooai.com/dist/` 均返回
  `200`；现有下载货架未被修改。
- Playwright 已验证匿名跳转、AI Card 授权入口、错误身份拒绝、桌面零控制台
  异常，以及 `390x844` 无横向溢出。
- 没有创建验收账号；AI Card 发号序列仍为 `100001 / is_called=false`，
  因此苏白本人首次注册会获得 `AI_100001`。

## 影响范围

- 生产数据库已从迁移 014 前进到 018；既有 Principal、房间、消息和资源 ID
  均保留，密码入口继续作为临时回退路径。
- 首次真实 AI Card 注册、授权进入现有 Yoyoo 空间及本地密码人工回归仍需
  苏白完成；独立安全审查不在本次自验结论内。
