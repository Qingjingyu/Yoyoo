# Yoyoo CEO 稳态运营 SOP（2026-02-12）

## 目标
- 保证 `YoyooCEO` 持续可用（可回复、可执行、可恢复）。
- 保证 `Yoyoo后勤` 在群聊中默认静默（仅被 @ 时回复），但持续记录上下文。
- 把“健康检查 + 自动重启 + 记忆快照”固化为系统能力。

## 当前已生效配置
- 网关服务：`openclaw-gateway.service`（`systemd --user`）
- 自愈巡检：`yoyoo-watchdog.timer`（每 2 分钟）
- 记忆快照：`yoyoo-memory-snapshot.timer`（每日 03:30）
- 模型：MiniMax M2.1（中国区 Anthropic 兼容地址）
- 飞书分流：
  - `ceo.requireMention=false`（群内可自由回复）
  - `ops.requireMention=true`（群内仅被 @ 才回复，私聊可回）

## 关键文件
- `/root/.config/systemd/user/openclaw-gateway.service`
- `/root/.config/systemd/user/yoyoo-watchdog.timer`
- `/root/.config/systemd/user/yoyoo-memory-snapshot.timer`
- `/root/.openclaw/bin/yoyoo-healthcheck.sh`
- `/root/.openclaw/bin/yoyoo-memory-snapshot.sh`
- `/root/.openclaw/backups/watchdog.log`
- `/root/.openclaw/backups/memory/`
- 脱敏配置快照：`openclaw.json.redacted`（不落盘明文密钥）

## 日常巡检（3 条命令）
```bash
openclaw gateway status
systemctl --user list-timers --all | grep -E "yoyoo-watchdog|yoyoo-memory-snapshot"
tail -n 30 /root/.openclaw/backups/watchdog.log
```

期望结果：
- `Runtime: running` 且 `RPC probe: ok`
- 两个定时器都在 `NEXT` 列有下次执行时间
- watchdog 日志持续出现 `ok: gateway healthy`

## 故障处理（优先级）
1. 网关无响应：
```bash
systemctl --user restart openclaw-gateway.service
openclaw gateway status
```
2. 飞书异常但网关正常：
```bash
openclaw channels logs --channel feishu --lines 120
```
3. 配置污染或误改：
```bash
ls -lt /root/.openclaw/openclaw.json.bak*
cp /root/.openclaw/openclaw.json.bak.<最近版本> /root/.openclaw/openclaw.json
systemctl --user restart openclaw-gateway.service
```

## 记忆恢复
- 快照目录：`/root/.openclaw/backups/memory/<timestamp>/`
- 恢复示例：
```bash
cp -f /root/.openclaw/backups/memory/<timestamp>/MEMORY.md /root/.openclaw/workspace/MEMORY.md
cp -f /root/.openclaw/backups/memory/<timestamp>/memory/*.md /root/.openclaw/workspace/memory/
```

## CEO 输出契约（已注入）
CEO 对任务回包必须包含：
1. Objective
2. Constraints
3. Actions Taken
4. Evidence
5. Retry/Failure Notes
6. Next Step

禁止“无证据完成”。

## 能力白名单治理（已注入）
- 服务器工作区新增：`/root/.openclaw/workspace/SKILL_POLICY.md`
- 默认白名单技能：
  - `architecture-patterns`
  - `critical-code-reviewer`
  - `requesting-code-review`
  - `playwright-scraper-skill`
  - `social-media-agent`
  - `wechat-search`
  - `wechat-article-search`
  - `reddit-scraper`
  - `news-feeds`
  - `x-monitor`
  - `deep-scraper`
- 规则：缺 Key 时自动 fallback，不允许因为 Key 缺失直接中断任务。
