# OpenClaw 主备切换 SOP（主：OpenClaw，备：Nanobot）

## 目标
- 日常只用 `OpenClaw` 对话与测试。
- `Nanobot` 仅作为 OpenClaw 故障时的应急备机。
- 任意时刻只允许一个机器人对外发言。

## 前提
- 服务器：`root@115.191.36.128`
- 切换器：`/usr/local/bin/yoyoo-bot-switch`
- 支持命令：`openclaw | nanobot | status`

## 三条常用命令
1. 查看状态
```bash
ssh -i "<pem路径>" root@115.191.36.128 'yoyoo-bot-switch status'
```

2. 切到主机（OpenClaw）
```bash
ssh -i "<pem路径>" root@115.191.36.128 'yoyoo-bot-switch openclaw'
```

3. 切到备机（Nanobot）
```bash
ssh -i "<pem路径>" root@115.191.36.128 'yoyoo-bot-switch nanobot'
```

## 故障切换流程（实战）
1. 发现 OpenClaw 不回消息（或健康检查失败）。
2. 执行 `yoyoo-bot-switch nanobot`，确认 `nanobot.service=active`。
3. 在群里仅 @Nano 做应急沟通，避免双机器人抢答。
4. 期间修复 OpenClaw（日志、配置、模型路由）。
5. 修复后执行 `yoyoo-bot-switch openclaw` 切回主机。
6. 回切后做 1 条探活消息，确认主机恢复。

## 每日巡检（建议）
```bash
ssh -i "<pem路径>" root@115.191.36.128 '
  systemctl is-active openclaw.service nanobot.service;
  journalctl -u openclaw.service -p err -n 20 --no-pager;
  journalctl -u nanobot.service -p err -n 20 --no-pager
'
```

## 演练计划（每周一次）
1. 人为模拟主机异常：临时 `stop openclaw.service`。
2. 2 分钟内完成切备，并验证备机回复。
3. 5 分钟内恢复主机并回切。
4. 记录 RTO（切换恢复时间）和失败点。

## 约束
- 不在同一群同时开启双机器人主动发言。
- 任何时候“对外发言源”只有一个。
- 备机只做兜底，不参与日常协作讨论。
