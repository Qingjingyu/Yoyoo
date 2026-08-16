# Agent 一段话接入生产发布

## 背景

V0.20 已完成本地全量门禁和跨仓库验收。本次把正式版本发布到
`app.yoyooai.com`，并保持 AI Card 先于 Yoyoo 的依赖顺序。

## 发布决策

- AI Card 先应用 `0015` 并上线，Yoyoo 再应用 `020` 至 `022`。
- 已应用 migration 不改写、不回滚；应用异常时只切回保留的旧镜像。
- 不在生产验收中创建临时 Agent 或长期测试身份，真实 YOS 认领由 Owner
  登录后执行，避免污染身份与审计数据。

## 生产结果

- Yoyoo 镜像：`yoyoo-space:b72a165`。
- 发布目录：`/opt/yoyoo/releases/b72a165`。
- 迁移账本最新：`022_agent_admission_machine_name.sql`。
- 回退镜像：`yoyoo-space:fa600aa`。
- 验证备份：
  `/opt/yoyoo/backups/agent-onboarding-20260816T025532Z`。

## 验证

- 容器健康、内网与公网 `/api/health`：通过。
- 匿名首页和 Agent 设置页跳转登录：通过。
- 未授权工作区 Agent API 拒绝访问：通过。
- 公共接入说明返回 `text/plain`，协议标题及 997 字节正文：通过。
- AI Card 允许来源 CORS `204`、未知来源 `403`：通过。
- Nginx 配置检查、双站证书和 `yoyooai.com/dist/`：通过。
- 新容器关键错误日志扫描：0 条匹配。

## 未完成边界

尚未代替真实 Owner 执行生产 YOS 的认领、精确房间发信、重启复用和撤销。
这部分需要一个真实 YOS 运行时和 Owner 的当前登录态，不能用测试身份冒充。
项目仍未完成独立安全审查。生产构建继续报告 lockfile 中既有的一项 high
severity audit 提示，本次没有新增或升级依赖。
