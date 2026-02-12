# OpenClaw 重装后 MiniMax 快速接入与 401 排障 SOP

## 目标
- 服务器重装后，10-15 分钟内完成 OpenClaw 接入 MiniMax。
- 避免再次出现 `HTTP 401 authentication_error` 反复问题。
- 提供固定验证命令，确保“能回消息”再交付。

## 本次故障根因（2026-02-10）
- 根因不是 MiniMax 平台不可用，而是密钥被污染：
  - 错误值：`sk-...XpbMcurl`（末尾多了 `url`）。
- 污染点不止一处，至少在以下文件同时存在：
  - `/root/.openclaw-ceo/openclaw.json`
  - `/root/.openclaw-ops/openclaw.json`
  - `/root/.openclaw-ceo/agents/main/agent/models.json`
  - `/root/.openclaw-ops/agents/main/agent/models.json`

## 标准配置（必须一致）
- Base URL：`https://api.minimaxi.com/anthropic`
- API 类型：`anthropic-messages`
- 认证头：`authHeader: true`
- 模型：`MiniMax-M2.1`
- 密钥：只保留一份“正确值”，禁止手工拼接文本尾巴。

## 重装后快速接入流程
1. 安装并初始化 OpenClaw（按官方流程完成 `ceo/ops` 两个 profile）。
2. 填入 MiniMax 配置（URL、模型、`authHeader`、`apiKey`）。
3. 同步检查 3 类配置源：
   - `openclaw.json`
   - `agents/main/agent/models.json`
   - `agents/main/agent/auth-profiles.json`
4. 重启网关：
```bash
openclaw --profile ceo gateway restart
openclaw --profile ops gateway restart
```
5. 先做直连 API 验证（必须 200）。
6. 再做 OpenClaw Agent 验证（必须正常回复，而非 401）。
7. 最后检查通道日志（飞书 WebSocket ready）。

## 固定验证命令（交付前必跑）
```bash
# 1) 模型与鉴权来源检查
openclaw --profile ceo models status --json
openclaw --profile ops models status --json

# 2) Agent 回包检查
openclaw --profile ceo agent --to clawceo --message "只回复 pong" --json
openclaw --profile ops agent --to clawops --message "只回复 pong" --json

# 3) 运行日志检查
openclaw --profile ceo logs --limit 80 --plain
openclaw --profile ops logs --limit 80 --plain
```

## 401 快速判定矩阵
- 现象：`Please carry the API secret key in the Authorization field`
  - 优先检查：密钥是否被污染（多空格、换行、尾部多字）。
- 现象：直连 MiniMax=200，但 OpenClaw=401
  - 结论：多配置源冲突，某处旧值覆盖了正确值。
- 现象：改完又复发
  - 结论：仅改了一个文件；重启后被其他文件回写。

## 安全要求
- 不在文档、Git、截图中保存明文生产密钥。
- 所有密钥用环境变量或密钥管理方式注入。
- 仅保留必要备份，避免旧错配置重复回灌。

