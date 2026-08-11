# 031 Feature: 内部日用版

日期：2026-08-11

## 背景

Yoyoo 已具备首页、多人 + 多 AI 数据模型、群聊与单聊、精确 ID 寻址、消息与文件、
Agent Gateway、AI Card 和深浅双主题，但日常启动仍依赖维护者回忆多条命令，数据库
与私有 Blob 也没有一条完整、可校验的本机备份流程。

本轮目标不是继续加 IM 功能，而是把已经验收的产品包装成可重复启动、可诊断、可备份
的内部日用版本。

## 关键决策

- 默认 `internal:start` 使用真实 Codex + YOS；`internal:start:local` 是显式的确定性降级。
- 两种模式都固定监听 `127.0.0.1:4173`，不开放局域网或公网入口。
- 复用现有 Docker Compose、checksum migration runner 和 YOS server wrapper，不增加依赖。
- 启动过程只执行可重复的准备：doctor、启动数据库、前向迁移、生产构建和前台应用。
- 退出只终止前台应用，PostgreSQL Volume 与 `.data/blobs` 保持原状。
- 备份必须同时包含 PostgreSQL 和 BlobStore，并通过数据库目录、压缩包目录和 SHA-256
  manifest 校验。
- 不提供自动 restore。恢复会覆盖状态，必须在单独确认目标、当前备份和回滚方案后执行。

## 否掉的备选

- **PM2、launchd 或登录自启动**：V0.14 先保证一条可见、可停止的前台命令，避免引入
  隐形常驻进程和系统级配置。
- **只备份数据库**：消息附件的权威字节在 BlobStore，单独 dump 不是完整备份。
- **自动恢复命令**：误选时间戳会覆盖真实数据，风险高于当前内部使用收益。
- **把整个项目打包进备份**：源码可从仓库恢复，混入依赖、构建缓存和环境文件反而增加
  体积与凭据泄露风险。
- **新建一套运维框架**：当前只有一台内部 Mac，Node 标准库与现有 Compose 已足够。

## 实现范围

- `scripts/internal-ops.mts`：参数契约、doctor、脱敏、备份、校验、启动编排与信号转发。
- `tests/scripts/internal-ops.test.ts`：参数、安全目录、manifest 防篡改、readiness 与脱敏测试。
- `vitest.config.mts`：纳入 scripts 测试目录。
- `package.json`：暴露 doctor、backup、verify、real start 和 local start 命令。
- `Product-Spec.md`、`DEV-PLAN.md`、`README.md`、`USAGE.md` 与 Roadmap：统一交接边界。

没有改动页面、API、数据库 schema、历史 migration、Agent 协议、身份模型或依赖版本。

## 已验证证据

- 脚本单元测试：6 条通过，包括等长文件篡改的 SHA-256 拒绝。
- `npm run internal:doctor`：Node、环境、Docker、Compose、BlobStore、YOS、Codex、
  PostgreSQL 和生产构建通过；未启动应用被正确报告为警告。
- `npm run internal:backup`：生成一份新时间戳备份，PostgreSQL dump、Blob archive 和
  2 个 manifest artifact 全部通过校验。
- 一键本地生产启动：首页与 `/conversation` 均返回 HTTP 200。
- 停止前台应用后 PostgreSQL 继续接受连接；重启后仍读到 3 个房间，房间
  `eba43da8-94d6-4b95-af12-02f7bdaee0a9` 保持不变。

## 最终门禁

- `npm run lint`：通过。
- `npm run typecheck`：通过。
- `npm test`：28 个文件、139 条测试全部通过。
- 隔离空库：12 个 migration 从 `001` 到 `012` 全部前向应用成功。
- `npm run test:integration`：在日用库的隔离时点副本上，21 个文件、115 条测试通过；
  5 个文件中的 7 条外部真实服务检查按既有显式开关跳过，未计入通过。
- `npm run build`：Next.js 16.3 生产构建通过。
- `npm run test:e2e`：在隔离数据库和 `4183` 端口上，桌面与移动端共 38 条测试通过。
- 默认真实模式：`internal:start -- --skip-build` 成功启动 Codex + YOS 配置，首页和
  `/conversation` 均返回 HTTP 200；doctor 的 11 项检查全部 PASS。未发送真实 Agent 消息。

第一次直接在空库运行原集成套件时，固定的历史迁移 GUID 断言失败：空库没有旧会话可
供 `003` migration 生成该 GUID。随后分别保留“空库全迁移”证据，并从日用库创建隔离
时点副本执行原测试，115 条全部通过；没有为通过门禁而放宽断言，也没有让测试写入日用库。

## 影响与剩余风险

- 启动时会执行生产构建，首次或源码变更后耗时高于普通 `next start`。
- `internal:start` 依赖本机 YOS 与 Codex 登录；外部服务不可用时应使用 local fallback。
- 备份位于同一台 Mac，只解决误操作与本机恢复准备，不等于异机或灾难恢复。
- 已验证备份尚未做破坏性 restore 演练；这需要单独批准与隔离目标数据库。
