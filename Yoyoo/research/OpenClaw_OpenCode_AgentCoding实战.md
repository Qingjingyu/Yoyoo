# OpenClaw + OpenCode Agent Coding 闭环实战（苍何案例）

> **调研日期**: 2026-02-04
> **来源**: 苍何公众号分享（贪吃蛇项目全链路）
> **目标**: 提炼 Agent Coding 闭环（OpenClaw + OpenCode + GitHub + Vercel）的可复用方法与注意事项。

## 1. 结论摘要
- 组合拳：OpenClaw 作为中控，OpenCode 生成代码，GitHub 做版本，Vercel 一键部署，形成“说→写→存→上线”全自动链路。
- 体验：用户用自然语言下指令，Agent 完成编码、提交、部署、生成 README，几分钟上线可玩的贪吃蛇游戏。
- 核心价值：极低操作门槛（纯自然语义驱动）、端到端自动化（含代码托管和生产部署）。

## 2. 流程拆解
1) 环境准备（OpenClaw 协调）：
   - 安装 OpenCode CLI、GitHub CLI、Vercel CLI；准备 token（GitHub repo 权限、Vercel 部署）。
2) Agent Coding：
   - 在项目目录启动 OpenCode（交互或非交互），自然语言生成前端游戏（HTML/CSS/JS）。
3) 代码管理：
   - git init → add → commit；调用 GitHub API/CLI 创建仓库并 push。
4) 部署上线：
   - Vercel CLI 登录 token，一键部署静态站；自动分配域名，后续 push 自动重部署。
5) 生成文档：
   - Agent 基于操作历史自动生成 README 教程并推送仓库。

## 3. 关键指令/要点
- OpenCode：`opencode run "创建贪吃蛇游戏"` 或交互模式启动后下自然语义指令。
- GitHub：`gh auth login --with-token` 后创建 repo 并 push。
- Vercel：`vercel --token <TOKEN> --yes --prod` 部署静态站。
- Token 权限：GitHub 需 repo 权限；Vercel 需部署权限；按最小必要授权。

## 4. 亮点与局限
- 亮点：
  - 全程自然语言；自动提交 README；几分钟成品可玩。
  - 组合可迁移到更复杂框架（React/Vue/Next）。
- 局限/风险：
  - CLI 交互可能卡顿 → 可改非交互模式或直接生成文件。
  - 高权限 token 风险 → 最小授权、独立账号、可随时吊销。
  - 部署失败常见原因：项目结构不对、token 权限不足。

## 5. 对 Yoyoo 的启示
- 可在 Agent 中加入“OpenCode + GitHub + Vercel”模板化 SOP，形成快速原型闭环。
- 在生产场景需增加：
  - 权限隔离（最小 token、临时凭证）、审计日志。
  - 失败重试与幂等（重复 push/deploy 的保护）。
  - 质量保障：生成代码后自动测试/预览，再决定 push/deploy。
- 可与三层记忆结合：记录项目事实、部署结果、回滚策略，形成长期可复用模式。

## 6. 参考链接（文中示例）
- 示例仓库：https://github.com/freestylefly/snake-game
- 在线演示：https://myopencode.vercel.app
- 工具：OpenClaw / OpenCode / GitHub / Vercel
