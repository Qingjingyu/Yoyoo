# Yoyoo 内部日用说明

> 适用版本：V0.14
>
> 固定地址：`http://127.0.0.1:4173`

## 第一次使用

1. 确认 Docker Desktop 已启动。
2. 从 `.env.example` 创建本机 `.env.local`，不要把密钥提交到仓库。
3. 确认 `~/yos/.env` 可读，并执行 `codex login status` 检查登录。
4. 在项目根目录执行 `npm install`。
5. 执行 `npm run internal:start`。

启动命令会顺序完成环境检查、PostgreSQL 启动、前向迁移、生产构建和应用启动。
浏览器访问 `http://127.0.0.1:4173` 即可使用。

## 每天启动

真实 Codex + YOS：

```bash
npm run internal:start
```

Codex 或 YOS 暂时不可用时，使用确定性本地 Agent：

```bash
npm run internal:start:local
```

两种模式使用同一套房间、消息和文件数据。它们只监听本机回环地址，不是公网服务。

## 停止与重启

在启动 Yoyoo 的终端按 `Ctrl+C`。这只停止前台 Next.js 应用，不删除 PostgreSQL
容器、Docker Volume、房间、消息或 `.data/blobs`。

再次执行同一启动命令即可恢复使用。不要用删除 Volume 或清空 `.data` 的方式处理
启动故障。

## 运行诊断

```bash
npm run internal:doctor
```

- `PASS`：检查通过。
- `WARN`：核心应用仍可准备，但某个外部 Agent、构建或当前监听端口尚不可用。
- `FAIL`：硬性前置条件缺失，命令返回非零状态。

Doctor 不发送 Agent 消息，也不输出数据库口令、YOS 密码或 Token。

## 本机备份

```bash
npm run internal:backup
```

每次运行都会新建一个 `output/backups/internal/<时间戳>` 目录，不覆盖旧备份。目录包含：

- `database.dump`：PostgreSQL custom-format dump；
- `blobs.tar.gz`：私有 BlobStore；
- `manifest.json`：文件大小和 SHA-256 摘要。

命令只有在 `pg_restore --list`、`tar -tzf` 和 manifest 摘要全部通过后才报告成功。
备份目录包含真实私有数据，不要上传到公开网盘、聊天或代码仓库。

复核一份已有备份：

```bash
npm run internal:verify-backup -- output/backups/internal/<时间戳>
```

## 恢复边界

本版本没有自动恢复命令。恢复会覆盖数据库和文件状态，属于破坏性操作。需要恢复时：

1. 停止 Yoyoo；
2. 保留当前数据库与 BlobStore 的新备份；
3. 明确选择目标时间戳；
4. 单独制定恢复与回滚步骤并确认后执行；
5. 恢复后核对房间 ID、消息、附件下载和 Agent 身份。

不要直接删除 `yoyoo_space_pg_data`，也不要覆盖 `.data/blobs`。

## 常见问题

### `127.0.0.1` 拒绝连接

先执行 `npm run internal:doctor`。若只有 Application 为 `WARN`，说明 Yoyoo 尚未启动，
运行 `npm run internal:start` 或 `npm run internal:start:local`。

### YOS 或 Codex 检查失败

先用 `npm run internal:start:local` 继续使用核心 IM。随后分别检查 `~/yos/.env` 和
`codex login status`，不要把凭据粘贴到终端输出、Issue 或聊天记录。

### 数据库迁移失败

不要修改已经应用过的 SQL 文件，也不要重置数据库。保留完整报错，先执行备份，再按
forward migration 原则修复。

### 备份校验失败

失败目录会保留用于诊断，但不能作为已验收备份。修复原因后重新运行
`npm run internal:backup`，由新时间戳目录形成一份完整备份。
