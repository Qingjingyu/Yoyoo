# Yoyoo 外部项目学习结论（openakita / openclaw / memU）

更新时间：2026-02-06

## 1. 总结一句话
这三个项目最值得 Yoyoo 复用的不是“模型能力”，而是三套工程机制：`入口网关稳定性（openclaw）`、`可解释的记忆生命周期（openakita）`、`可插拔的记忆工作流与拦截器（memU）`。

## 2. 分项目结论

### 2.1 openclaw（执行与通道控制面）
- 优势：
  - 网关是单一事实源（Session/路由/状态统一），协议清晰，跨通道稳定。
  - 会话模型成熟（`main`、`per-peer`、`per-channel-peer`），对“多入口不串会话”非常关键。
  - 有重试、配对、鉴权、压缩与 pre-compaction memory flush，工程可运维性强。
- 对 Yoyoo 的启发：
  - 继续坚持“Yoyoo 为脑、OpenClaw 为执行面”，不要把记忆与规划下沉到 OpenClaw。
  - 在 Yoyoo 侧显式保存 `channel/user/conversation/task` 四元路由元数据，避免反馈绑定漂移。

### 2.2 openakita（记忆与自维护）
- 优势：
  - 三层记忆明确：`memories.json + 向量索引 + MEMORY.md 精华`。
  - 有每日归纳、重复清理、自检修复和错误复盘闭环。
  - 记忆类型与优先级较清晰（FACT/PREFERENCE/RULE/SKILL/ERROR）。
- 对 Yoyoo 的启发：
  - Yoyoo 已有 task_ledger，可继续补“记忆优先级衰减+每日精华摘要”。
  - 将“错误教训”从日志升级为策略对象（可被规划器直接读取）。

### 2.3 memU（记忆框架化）
- 优势：
  - `MemoryService` 结构清晰：`memorize/retrieve/CRUD`，并有 workflow step/interceptor 机制。
  - 检索支持“意图路由→分类→条目→资源”的分层召回，便于控制成本与准确率。
  - 可直接接 LangGraph 工具化，接口边界稳定。
- 对 Yoyoo 的启发：
  - 采用“工作流+拦截器”思想，把 Yoyoo 记忆处理从脚本逻辑升级为可编排 pipeline。
  - 引入“分层召回+充分性检查”，降低误召回和上下文噪声。

## 3. 建议立即落地（按优先级）
1. `P1（本周）`：在 Yoyoo 增加 Memory Pipeline V1（ingest/extract/dedupe/summarize/retrieve）。
2. `P1（本周）`：把“策略卡”接入检索链路，形成“先策略后执行”的默认路径。
3. `P2（下周）`：增加 `memory_decay + archive + alert` 联动，让记忆系统可控可观测。
4. `P2（下周）`：补充 `/ops/health` 的记忆质量指标（命中率、冲突率、过期率）。

## 4. 许可与复用边界
- openakita：MIT  
- openclaw：MIT  
- memU：Apache-2.0  
结论：可参考架构与接口设计，但复制代码时需保留原许可声明并做来源记录。

## 5. 技术适配风险（必须提前处理）
- 当前 Yoyoo backend 为 Python `>=3.11`，而 memU 当前要求 Python `>=3.13`，且使用 `maturin` 构建。
- openclaw 运行时要求 Node `>=22`，和 Yoyoo Python 后端是双运行时体系。
- 建议：
  - 短期采用“接口借鉴 + 协议兼容”，不要直接把 memU 整包塞进 Yoyoo 主进程。
  - 如果要用 memU，优先做独立 memory sidecar（HTTP/RPC）再与 Yoyoo 对接，降低主链路风险。
