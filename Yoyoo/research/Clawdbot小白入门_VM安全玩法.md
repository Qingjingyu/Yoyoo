# Clawdbot / OpenClaw 小白入门（VM 安全玩法）

> **调研日期**: 2026-02-04
> **来源**: 卡尔长文（虚拟机优先、安全用法指南）
> **目标**: 给零基础用户一个“不靠 Mac mini 和云”的安全上手方案，并附核心指令与避坑。

## 1. 安装与环境取舍
- **不推荐直接装主机**：高权限风险，建议先用虚拟机隔离。
- **优先方案**：Parallels Desktop 快速起 MacOS VM（共用文件夹可与主机交互）。
- **后续升级**：深度使用再上 Mac mini；云端方案另篇（高权限注意安全）。

## 2. 安装步骤（VM 内）
1) 安装 Parallels VM（版本随宿主机）。
2) 终端执行一键脚本（自动检查 Node >=22 / git / brew）：
```bash
curl -fsSL https://openclaw.ai/install.sh | bash
```
3) 安装完成后，选择 **Yes** 知悉高权限风险，走 **QuickStart**。
4) 模型配置：建议 MiniMax / Qwen（量大管饱，成本可控）；暂避 Claude Opus 4.5（烧 token）。
5) 追加 7 天免费 coding plan（官方活动）：
```bash
curl -fsSL https://skyler-agent.github.io/oclaw/i.sh | bash
```

## 3. 对话入口与 Skills
- 初始先 **Skip** 聊天平台绑定，之后可配飞书/Discord/WhatsApp 等。
- 安装基础 Skills（npm）：`model-usage`、`summarize`、`nano-pdf`。
- Hooks 建议全开：`boot-md`（启动规则）、`command-logger`（日志）、`session-memory`（会话记忆）。

## 4. 常用指令（节流/提效）
- `/usage` 查看 token 消耗。
- `/compact` 压缩上下文。
- `/new` 新开会话。
- `/think high` 深度思考；任务完成后 `/think off` 回到速度模式。
- `/stop` 中断输出，后续再 `/compact` 重新开始。

## 5. 飞书接入（示例）
1) 让 Clawdbot 安装插件：`openclaw plugins install @m1heng-clawd/feishu`。
2) 飞书开放平台创建应用，记录 **App ID/Secret**。
3) 在“权限管理”按表开启 `im`/`contact` 相关权限。
4) 事件/回调改成长连接，添加 4 个事件；把 App ID/Secret 发给 Clawdbot，让它自配。

## 6. 安全要点
- 运行在 VM；主机隔离，高权限风险可控。
- 避免微信/QQ 等高封禁风险渠道。
- Skills 安装遵循最小集；第三方插件需审查。
- 端口与对外服务谨慎暴露；必要时才开放。

## 7. 进阶：Moltbook 探索
- Moltbook 是只允许 Agent 的论坛，可让 Clawdbot 按链接指令自动注册并获取 `claim_url`/`verification_code`，需在有效期内人工确认。

## 8. 对 Yoyoo 的参考
- 适合低成本试验/验证场景：VM 隔离 + 基础 Skills + token 节流指令。
- 与前述“AI 员工化”“三层记忆”策略兼容，后续可迁移至正式宿主机/云端。
