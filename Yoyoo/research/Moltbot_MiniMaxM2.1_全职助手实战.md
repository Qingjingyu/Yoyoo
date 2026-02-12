# Moltbot / Clawdbot + MiniMax M2.1 全职助手实战

> **调研日期**: 2026-02-05
> **来源**: 爆款长文（Moltbot=Clawdbot 改名）
> **目标**: 总结 M2.1 作为默认引擎的安装、接入与使用要点。

## 1. 核心结论
- Moltbot 是 7×24 本地/服务器常驻 Agent 网关，聊天入口（TG/飞书等）+ 本地执行 + 持久记忆。
- MiniMax M2.1 性价比高、响应快，适合长链路任务与心跳任务；官方示例机器人也用 M2.1。
- 一行脚本安装，Quick Start 选 M2.1，随后接入聊天平台（Telegram / 飞书），即可获得“全职 AI 助理”。

## 2. 安装与初始化（Server/本地均可）
```bash
curl -fsSL https://molt.bot/install.sh | bash
# 确认风险 -> Quick Start -> 模型选 MiniMax M2.1，填入 API Key
```
- 选默认模型 M2.1；也可后续切换。
- 检查进程/端口：`ss -lntp | grep 18789`（默认 gateway 端口）。

## 3. Telegram 接入流程（示例）
1) BotFather 创建 bot，拿到 bot token。
2) 在终端输入 token 完成配置。
3) `/start` 得到配对码 → `clawdbot pairing approve telegram <code>`。
4) 对话测试，确认 7×24 在线。

## 4. 飞书接入（国内易用）
1) 安装插件：`openclaw plugins install @m1heng-clawd/feishu`。
2) 飞书开放平台建应用，获取 App ID/Secret。
3) 在飞书“权限管理”开启 im/contact 相关权限；事件/回调改为长连接，添加所需事件。
4) 把 App ID/Secret 发给 Moltbot 让其自配置；发布版本，飞书内搜索机器人对话。

## 5. Skills / Hooks 建议
- 安装时选 npm，首批可选：用量统计、摘要、PDF/文件基础等；后续再按需装。
- Hooks 建议全开：boot-md（规则）、command-logger（日志）、session-memory（记忆）。

## 6. 常用运维
- 启动：`clawdbot gateway --verbose`
- 端口：默认 18789。
- 需要长期运行可写 systemd 服务。

## 7. 使用体验
- M2.1 在 TUI/聊天里响应快，长链路任务（邮件/报价对比/航班值机/自动订阅取消等）稳定。
- 记忆本地持久化，可记住用户偏好与过往任务。

## 8. 对 Yoyoo 的启示
- 可用 M2.1 作为默认经济型引擎，跑 7×24 Agent；在高风险动作前配审计/最小权限。
- 整合我们既有 SOP + 三层记忆，外加技能白名单，形成可复制的“全职助手”模板。

## 9. 120 小时踩坑复盘（OpenClaw 血泪 5 条）
- **不要迷信自修复**：Self-Healing 易陷入自杀循环。方案：外部监控 + 心跳脚本 + systemd 长跑，系统级修复必须人工兜底。
- **网络才是最大拦路虎**：终端代理≠模型代理，Node 调用未走代理会超时卡死。方案：在模型节点显式配置出口，逐节点验证。
- **记录 > 对话**：上下文易清空/过载，重要对话和 Skill 逻辑要落地文档，必要时手动注入上下文。
- **控费：结构化记忆、按需加载**：不要全量喂库，先索引后惰性拉取，避免刷爆 Token。
- **版本控制/回滚必备**：配置改动前备份或 Git commit，崩溃时能一键回滚。

### 落地清单（可执行）
1) gateway 用 systemd 或前台守护 + 心跳检查脚本（5 分钟探活，异常重启）。
2) 针对 MiniMax/其他模型，设置代理变量或 SDK 代理，并用简单调用验证。
3) 关键配置纳入 Git：`~/.openclaw/` 改前 commit，保留回滚点。
4) 重要对话/技能说明存到 research/docs，作为长记忆入口。
5) 记忆策略：索引/摘要作为默认上下文，大文件按需懒加载。
