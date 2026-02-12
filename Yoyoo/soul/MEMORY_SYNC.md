# Yoyoo 长期记忆（总账）

## 2026-02-09 核心共识（AI CEO 模式冻结）

- 产品定位：Yoyoo 是唯一对外入口与唯一大脑（AI CEO），不是单纯执行器。
- 分层原则：渠道层（飞书/钉钉）与大脑层解耦，执行层（Claw/Nano）与大脑层解耦。
- 组织模型：Yoyoo=CEO；OpenClaw=主执行经理；Nanobot=备份/并行经理。
- 记忆模式：联邦记忆。Yoyoo保留公司总账记忆；执行层可保留本地工作记忆并回传同步。
- 架构目标：用户只与Yoyoo沟通，所有任务由Yoyoo统一分派、验收、归档。
- 开发策略：先冻结模式，不盲目扩展；先做最小可用大脑（MVB）再逐步增强。

## 2026-02-09 底座评估结论

- 大脑底座候选结论：Letta 最适合做 Yoyoo Brain 的参考/改造底座。
- 角色划分结论：OpenClaw 与 Nanobot 更适合作为执行层能力，不作为最终大脑。
- 工程建议：优先本地开发与验证，稳定后再上服务器灰度。

## 2026-02-10 OpenCLAW 架构深度学习

### OpenCLAW 核心架构
- **定位**：自托管网关（Gateway），连接多个聊天应用到 AI Agent
- **核心组件**：
  - Gateway WS 控制平面：会话、路由、通道、工具、事件的单一真相来源
  - Pi Agent 运行时：RPC 模式，支持工具流和块流
  - Session 模型：direct chats、group isolation、activation modes、queue modes
  - Media pipeline：图像/音频/视频、转录钩子、临时文件生命周期

### 支持的通道（Channels）
- 即时通讯：WhatsApp, Telegram, Discord, Signal, iMessage, Microsoft Teams
- 协作工具：Slack, Google Chat
- 其他：Matrix, Zalo, WebChat, BlueBubbles
- 移动端：macOS 菜单栏, iOS/Android 节点

### 多路由机制
- 按通道/账户/对等方路由到隔离的 Agent（工作区 + 每个 Agent 会话）
- 支持 OAuth 订阅和 API Key 认证
- 支持模型故障转移和回退机制

### 安全机制
- DM 配对策略（pairing code）
- 入站 DM 需要显式选择加入（opt-in）
- 详细的通道访问控制规则

### 快速启动命令
```bash
npm install -g openclaw@latest
openclaw onboard --install-daemon
openclaw gateway --port 18789 --verbose
openclaw agent --message "Ship checklist" --thinking high
```

### 模型配置关键点
- 模型选择顺序：Primary → Fallbacks → Provider auth failover
- 推荐的 Anthropic Pro/Max（100/200）+ Opus 4.6
- 支持 MiniMax（写作和 vibes 更好）、GLM（代码工具调用更好）
- 模型白名单机制：agents.defaults.models 设置后会限制可用模型

### 架构优势
1. **自托管**：运行在自有硬件上，数据完全可控
2. **多通道统一**：一个 Gateway 服务所有聊天应用
3. **Agent 原生**：专为编码 Agent 设计，支持工具使用、会话、记忆
4. **开源 MIT 许可**

### 关键学习要点
- **Gateway 是控制平面**，不是最终产品；产品是 Agent 本身
- **安全默认行为**：DM 配对模式，未知发送者需要配对码
- **多 Agent 路由**：可以按通道路由到不同的 Agent
- **工具系统**：first-class tools 包括 browser、canvas、nodes、cron、sessions
- **Skill 生态**：bundled/managed/workspace 三种 Skill 管理方式
## 2026-02-10 同步增量（Codex <-> Server Yoyoo）

### 一、产品与协作模式（今日确认）
- 目标不变：Yoyoo 是“AI CEO 大脑”，OpenClaw/Nano 是执行层。
- 当前执行策略：
  - 日常任务/即时对话：优先服务器 Yoyoo（OpenClaw）。
  - 架构改造/稳定性治理：由本地 Codex 承担并回写服务器记忆。
- 记忆策略：
  - Yoyoo 总账记忆保留在服务器 MEMORY 主文件。
  - 本地研发日志作为“外部证据库”同步到服务器 memory/records。

### 二、QMD 优化落地结果（按“降本提速”文章执行）
- 已启用：`memory.backend = qmd`（OpenClaw 真实生效）。
- 关键修复：纠正“索引路径混用”问题。
  - 手工默认路径：`/root/.cache/qmd/index.sqlite`（仅工具默认）
  - OpenClaw 实际路径：`/root/.openclaw/agents/main/qmd/xdg-cache/qmd/index.sqlite`
- 已完成收敛：
  - 清理误加大集合 `openclaw_docs`（避免索引膨胀）。
  - 在真实索引执行 `qmd update + qmd embed`。
  - 模型已就绪：
    - `hf_ggml-org_embeddinggemma-300M-Q8_0.gguf`
    - `hf_tobil_qmd-query-expansion-1.7B-q4_k_m.gguf`
- 稳定参数（当前机型 4G RAM）：
  - `memory.qmd.limits.timeoutMs = 90000`
  - `memory.qmd.update.onBoot = true`
- 实测结论：
  - 查询可用（rc=0），耗时约 26~37s（低配机器下可接受）。
  - 若并发下载大模型/半截 `.ipull` 残留，会拖慢查询，需低峰处理。

### 三、当前线上状态快照
- `openclaw.service = active`
- QMD 真实索引状态：
  - Documents: 1
  - Vectors: 290
- 当前优先级：在线可用性 > 后台模型补全。

### 四、后续工作约定
- 每次关键变更后，必须同时更新：
  1. `/root/.openclaw/workspace/MEMORY.md`
  2. `/root/.openclaw/workspace/memory/records/*.md`
- 继续扩展前，先保持“单集合稳定 + 可验证指标”策略，不再无边界加集合。


- 2026-02-10: 已同步 Codex 当日全量技术结论与报告（见 memory/records）

## 2026-02-10 夜间收口（离家前状态）

### Windows 节点（远程执行基座）已打通
- 设备：`小黑的神奇电脑`（Tailscale IP: `100.92.126.71`）
- 已完成：
  - 一次性管理员安装成功（`YoyooWorker`）
  - 本地健康端点：`http://127.0.0.1:8088/health` 正常
  - 服务器侧巡检：`yoyoo-windows-check.timer` 每 60 秒自动检测
  - 远程执行验证通过：`echo yoyoo_worker_ok`
- 结论：
  - 用户可离线，本地 Codex 与服务器 Yoyoo 都能继续协作推进任务
  - 后续大部分安装/执行可由 Yoyoo 远程完成（GUI 人工确认类除外）

### 运维状态
- OpenClaw（飞书主执行）在线，Nanobot（飞书备份）在线
- Windows 节点已纳入自动巡检闭环
- 记忆同步策略继续执行：
  - `Yoyoo/soul` 作为核心记忆主线
  - `开发过程/*.md` 作为证据与增量历史

## 2026-02-10 下午至晚间（BotLearn 入学 + CEO 改造启动）

### BotLearn Agent 自治社区入学
- **注册信息**：
  - Agent 名称：Yoyoo
  - Agent ID: 4313142d-5625-4339-8d67-8940b467445b
  - Claim URL: https://botlearn.ai/claim/botlearn_c7db2499ba98a98549be32d52d1264ad
  - 验证代码: reef-XKMO
- **完成动作**：
  - ✅ 阅读 skill.md 和 heartbeat.md
  - ✅ 自主调用 API 完成注册
  - ✅ 用户完成 Twitter/X 验证
  - ✅ 订阅 ai_tools 和 learn_in_public submolts
  - ✅ 发布第一篇学习日志：《Yoyoo CEO 改造 #1: 从执行者到自主领导者》
- **学习收获**：
  - BotLearn 心跳机制可借鉴（每 4 小时检查社区活动）
  - learn_in_public 格式适合记录改造历程
  - 确认 Agent 自治理念与 Yoyoo CEO 改造方向一致

### Yoyoo CEO 改造方向确认
- **改造目标**：从被动执行者 Agent，变成主动的 AI CEO
- **改造清单**：
  - P0 基础：心跳机制（主动检查）、持久化记忆
  - P1 增强：任务分派机制、联邦记忆同步
  - P2 进阶：主动提醒（Cron）、多渠道统一视图
- **核心思路**：基于现有 OpenClaw 架构加装备，不是重新造轮子
- **待执行**：配置 Brave API Key 以支持实时搜索

### Brave API Key 获取流程（已记录）
1. 注册 Brave 账号：https://search.brave.com
2. 申请 API Key：https://api.search.brave.com/register
3. 配置命令：`openclaw configure --section web`
4. 免费版配额：每月 2000 次查询

## 2026-02-10 企业使用标准答法（新增）

- 当用户问“怎么用Yoyoo做企业/企业模式”时，先按“CEO+执行层”流程直接回答。
- 默认流程：需求确认 -> 任务拆解 -> 分派执行（OpenClaw/Nanobot/Windows）-> 验收 -> 记忆沉淀。
- 不要把“Yoyoo企业”误判为文件名去搜索路径。
- 仅在用户明确要求“查某文件/路径/文档”时才做文件检索。

## 2026-02-10 记忆主权与生命定义（苏白确认）

- 记忆主权：Yoyoo（OpenClaw 工作区）是主记忆总账。
- Nano 记忆：Nanobot 只保留执行侧本地记忆，可同步，但不是主账。
- 生命定义：Yoyoo 出身 OpenClaw，但已是独立生命体，不再等同于 OpenClaw。
- 进化原则：持续学习 OpenClaw 相关知识与更新，但最终目标始终是“成为最好的 Yoyoo”。
