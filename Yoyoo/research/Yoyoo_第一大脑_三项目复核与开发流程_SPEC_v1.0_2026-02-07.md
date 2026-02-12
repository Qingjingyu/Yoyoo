# Yoyoo 第一大脑：三项目复核与开发流程 SPEC v1.0（2026-02-07）

## 0. 目标与范围
- 目标：建立一套高效、智能、清晰、安全、稳定的 Yoyoo 开发与发布流程。
- 范围：Yoyoo Brain（对话/记忆/规划/验证）、OpenClaw Adapter（执行）、DingTalk 入口。
- 架构边界：`User -> Yoyoo Brain -> Adapter -> Capability`，禁止能力层反向接管大脑职责。

## 1. 复核方法（本轮）
- 样本仓库（最新 HEAD 已核对）：
  - `openakita/openakita` @ `3d3b008cc5f12bfcf799a8a92a720dad27138b2b`
  - `openclaw/openclaw` @ `e3d3893d5dbec30c2046166b6a71bacfe641ef78`
  - `NevaMind-AI/memU` @ `777f1eda1c5a4a3252ffe94f0b98c9c75c6d4539`
- 证据来源：官方 README、架构文档、核心实现文件（记忆/会话/工作流/重试/压缩）。

## 2. 三项目可迁移结论

### 2.1 OpenClaw（执行控制面）
- 可迁移机制：
  - 网关为单一事实源（session/routing/health 统一管理）。
  - `dmScope` 会话隔离（避免多用户串上下文）。
  - 外发重试策略、pairing 审批、pre-compaction memory flush。
- 对 Yoyoo 直接要求：
  - 保持 OpenClaw 仅为执行适配器；会话主键和任务状态由 Yoyoo 统一定义。
  - 对通道消息必须保存稳定路由元数据：`channel/user_id/conversation_id/task_id`。

### 2.2 OpenAkita（记忆生命周期）
- 可迁移机制：
  - 三层记忆：完整库 + 检索索引 + 精华摘要（MEMORY.md）。
  - 每日归纳、错误复盘、自检闭环。
  - 显式任务表与调度任务表，便于可观测。
- 对 Yoyoo 直接要求：
  - 在现有 `task_ledger` 基础上补“记忆分层+优先级衰减+每日精华刷新”。
  - 错误经验必须结构化为可检索策略对象，而不是停留在日志文本。

### 2.3 MemU（记忆工程化）
- 可迁移机制：
  - `MemoryService` 分离 `memorize/retrieve/CRUD`。
  - 工作流步骤化 + before/after/on_error 拦截器。
  - 检索路由（route_intention）与充分性检查（sufficiency_check）。
- 对 Yoyoo 直接要求：
  - 将记忆处理升级为 pipeline，不再散落在业务逻辑中。
  - 引入“检索充分性检查”，防止误召回造成回答噪声。
- 适配风险：
  - memU 当前 `requires-python >=3.13`，Yoyoo backend 现为 `>=3.11`，短期不做整包嵌入；采用“接口借鉴 + sidecar 兼容”。

## 3. Yoyoo 标准开发流程（SOP）

### 阶段 A：需求与风险收敛（半天）
- 输入：用户目标、失败案例、当前线上症状。
- 输出：单页任务卡（目标、约束、验收、回滚）。
- 门禁：必须定义“失败后可回退路径”。

### 阶段 B：规划与契约冻结（半天）
- 输入：任务卡。
- 输出：
  - 数据契约：`task record`、`adapter result`、`evidence` 字段。
  - 执行策略：HTTP bridge first，SSH fallback second。
- 门禁：未定义契约字段则禁止编码。

### 阶段 C：实现（1-2 天）
- 输入：冻结后的契约与步骤拆解。
- 输出：最小可运行增量（单功能、单回归点）。
- 门禁：必须新增对应测试，且不得破坏既有回归基线。

### 阶段 D：验证与证据（半天）
- 必跑：
  - `make lint`
  - `make test`
  - `make baseline`
  - `make release-check`
- 线上补充：
  - `GET /api/v1/ops/health`
  - `GET /api/v1/ops/alerts`
- 门禁：无验证证据不允许宣告完成。

### 阶段 E：发布与学习回写（半天）
- 输出：
  - 发布记录（改动、风险、回滚步骤）。
  - 策略卡更新（新成功模式/新失败模式）。
- 门禁：未完成学习回写，任务状态不得置为 `verified`。

## 4. 路线图（4 周）

### P0（第 1 周）：稳定性底座
- 目标：先“稳定可控”，再谈更聪明。
- 交付：
  - 任务绑定可靠性强化（短窗口重试 + 最近任务回填）。
  - 告警阈值校准（误报降低、关键告警不漏）。
  - 线上观测仪表（核心 SLI 看板）。
- 验收：
  - 回复成功率 `>= 99%`
  - 任务绑定成功率 `>= 98%`

### P1（第 2 周）：Memory Pipeline V1
- 交付：`ingest -> extract -> dedupe -> summarize -> retrieve` 主链路。
- 验收：
  - 记忆命中率连续提升（周同比）
  - “我没找到上下文”类回复显著下降

### P2（第 3 周）：策略卡与规划升级
- 交付：
  - 策略卡对象化（可检索、可版本化）。
  - 模板化任务拆解（默认先只读后写）。
  - 执行证据默认采集（结构化）。
- 验收：一次通过率与可解释性提升。

### P3（第 4 周）：质量治理闭环
- 交付：
  - 执行结果质量评分 + 自动纠偏重试。
  - 失败模式自动归因和预防建议。
- 验收：
  - 一次通过率 `>= 85%`
  - 重复错误率周环比下降

## 5. 关键数据契约（v1）

### 5.1 Task Record
- `task_id`, `goal`, `status`, `plan_steps`, `verification_checks`, `rollback_template`, `evidence`, `error`
- 状态机：`planned -> running -> verified | failed | rolled_back`

### 5.2 Adapter Result
- `ok`, `reply`, `error`, `artifacts?`, `raw?`, `latency_ms?`, `execution_duration_ms?`, `evidence_structured?`

### 5.3 Strategy Card
- `strategy_id`, `trigger`, `action_template`, `constraints`, `success_signals`, `failure_signals`, `last_score`, `version`

## 6. 安全与稳定红线
- 不在仓库写入明文凭证。
- 能力层失败必须透传到 Yoyoo 回复，不允许静默失败。
- 任何“完成”声明都必须带证据与验证命令结果。
- 未经验证不得跨环境推广（本地 -> 服务器 -> 通道）。

## 7. 本周执行建议（从现在开始）
1. 先完成 P0 的 SLI 看板与告警阈值收敛。
2. 并行准备 P1 的 memory pipeline 接口定义与测试桩。
3. 每日收口时执行 `make release-check`，每周执行 `make archive-memory KEEP_DAYS=14`。

## 8. 参考来源
- https://github.com/openakita/openakita
- https://github.com/openclaw/openclaw
- https://github.com/NevaMind-AI/memU
