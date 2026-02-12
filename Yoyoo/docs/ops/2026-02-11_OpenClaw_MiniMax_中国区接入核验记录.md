# OpenClaw MiniMax 中国区接入核验记录（2026-02-11）

## 目标
- 固化一次“可复现、可验收”的 MiniMax 中国区接入流程。
- 防止重装后再次出现 `401 authentication_error`。

## 本次确认的标准配置
- `baseUrl`: `https://api.minimaxi.com/anthropic`
- `api`: `anthropic-messages`
- `authHeader`: `true`
- 默认模型：`minimax/MiniMax-M2.1`

## 核验命令
```bash
# 1) 版本
openclaw --version

# 2) 模型与鉴权状态
openclaw models status --json

# 3) 逐项确认 provider 配置
openclaw config get --json models.providers.minimax.baseUrl
openclaw config get --json models.providers.minimax.api
openclaw config get --json models.providers.minimax.authHeader

# 4) 最小回包测试（必须返回 pong）
openclaw agent --local --agent main -m "只回复pong" --json
```

## 本次实测结果（2026-02-11）
- OpenClaw 版本：`2026.2.9`
- `baseUrl` 返回：`https://api.minimaxi.com/anthropic`
- `api` 返回：`anthropic-messages`
- `authHeader` 返回：`true`
- `agent` 回包：`pong`
- provider/model：`minimax / MiniMax-M2.1`

## 交付判定
- 满足以上 4 组核验结果，即判定“MiniMax 中国区接入成功，可继续接飞书通道”。

## 注意事项
- 严禁在文档中写明文生产密钥。
- 出现 401 时，优先检查是否复制污染（尾部多字符、换行、空格）。
- 若 `openclaw config get` 与 `models status` 不一致，按多配置源冲突处理（见 2026-02-10 SOP）。
