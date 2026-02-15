# Yoyoo 公共知识库（外部优质资源索引）

> 更新时间：2026-02-15  
> 目标：给 Yoyoo 团队提供可复用的“底座选型、能力增强、学习入口”统一索引。

## 1) 基座/系统候选（优先看）

| 项目 | 定位 | 建议用途 |
|---|---|---|
| [openclaw/openclaw](https://github.com/openclaw/openclaw) | 通道+工具执行平台 | 作为执行层/接入层 |
| [letta-ai/letta](https://github.com/letta-ai/letta) | Stateful Agent + Memory | 作为大脑引擎候选 |
| [HKUDS/nanobot](https://github.com/HKUDS/nanobot) | 轻量 Agent 框架 | 作为备用执行层 |
| [openakita/openakita](https://github.com/openakita/openakita) | 多通道 AI 助手框架 | 参考接入与产品形态 |
| [iOfficeAI/AionUi](https://github.com/iOfficeAI/AionUi) | 多 Agent 图形工作台 | 作为控制台/UI 层 |
| [openkursar/hello-halo](https://github.com/openkursar/hello-halo) | 自迭代 Agent 实验方向 | 参考演化机制 |
| [NevaMind-AI/memU](https://github.com/NevaMind-AI/memU) | 记忆系统框架 | 作为记忆增强层 |
| [sipeed/picoclaw](https://github.com/sipeed/picoclaw) | 轻量执行/代理方向 | 参考低成本执行形态 |

## 2) Skills 与工程增强（研发部工具箱）

| 资源 | 定位 | 建议用途 |
|---|---|---|
| [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) | 多模型编排/自动化 Harness | 研发实验与流程提效 |
| [everything-claude-code](https://github.com/affaan-m/everything-claude-code) | 大型技能与规则集合 | 选取成熟模式复用 |
| [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | UI/UX 技能包 | 快速生成高质量前端 |
| [claude-code-skills](https://github.com/daymade/claude-code-skills) | 垂直技能市场 | 按需安装专项能力 |
| [superpowers](https://github.com/obra/superpowers) | TDD/原子任务方法论 | 约束研发质量与流程 |
| [skills.sh](https://skills.sh/) | 技能聚合入口 | 技能发现与安装导航 |
| [Jane-xiaoer/x-fetcher](https://github.com/Jane-xiaoer/x-fetcher) | X(Twitter) 内容抓取 | 社媒情报输入能力 |
| [wechat-article-exporter](https://github.com/wechat-article/wechat-article-exporter) | 微信公众号搜索与批量导出 | 公众号学习/归档增强 |

## 3) 官方入口与学习站（必收藏）

- OpenClaw 官网：[https://openclaw.ai/](https://openclaw.ai/)
- OpenClaw 文档（入门）：[https://docs.openclaw.ai/start/getting-started](https://docs.openclaw.ai/start/getting-started)
- ClawHub（生态）：[https://clawhub.ai/](https://clawhub.ai/)
- BotLearn 学习平台：[https://botlearn.ai/zh](https://botlearn.ai/zh)

## 4) Yoyoo 团队使用规则（落地）

1. 任何外部项目先进入“研究/沙箱”，不得直接改生产。  
2. 新能力上线前必须补：安装说明、回滚方案、验收命令。  
3. 统一沉淀到本目录，避免知识散落在聊天记录。  
4. “大脑层”和“执行层”分离：Yoyoo 负责记忆与决策，执行器按需替换。

## 5) 推荐学习顺序（新员工）

1. 先读 OpenClaw 入门文档和官网。  
2. 再看 `superpowers`（流程方法）和 `everything-claude-code`（可复用模式）。  
3. 最后按任务挑选专项技能（UI、记忆、自动化）。

## 6) 本轮新增进阶路线（2026Q1）

针对“长任务稳定、模型兜底、可观测、可验收、安全治理”，新增一份可执行学习与落地清单：

- [2026Q1_进阶学习路线.md](2026Q1_进阶学习路线.md)

核心新增主题：

- LiteLLM 路由/fallback（多模型高可用）
- Langfuse（链路与成本可观测）
- Promptfoo（评测与回归门禁）
- Letta memory blocks（组织化记忆建模）
- OWASP/NIST（Agent 安全治理基线）
