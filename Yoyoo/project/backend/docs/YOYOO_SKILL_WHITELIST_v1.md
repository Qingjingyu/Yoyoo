# Yoyoo 1.0 技能白名单（v1）

更新时间：2026-02-12  
适用范围：Yoyoo 1.0 生产环境（CEO/后勤/执行组）

## 目标
- 只保留“稳定、低依赖、对业务有价值”的技能进入生产。
- 新技能必须先过沙箱，再进入生产白名单。

## P0 生产常驻（建议默认开启）
- `clawhub`：技能搜索/安装/升级统一入口。
- `find-skills`、`skills-search`：让 Yoyoo 自主发现技能。
- `mission-control`：任务看板化管理。
- `agent-browser`、`playwright-browser-automation`：网页任务执行。
- `duckduckgo-search`：免 Key 联网搜索。
- `wechat-search`、`wechat-article-search`：微信公众号检索。
- `transcriptapi`：视频转文本与内容提炼。
- `debug-pro`、`requesting-code-review`、`critical-code-reviewer`：研发质量治理。
- `docker-sandbox`：高风险任务隔离执行。

## P1 候选（按需接入）
- `google-workspace`、`notion`、`trello`、`slack`、`wacli`  
说明：价值高，但依赖账号授权或组织流程，按团队实际需要启用。

## 暂不进生产（需额外条件）
- 需要额外 API Key 的技能（如 `goplaces`、`openai-image-gen`、`nano-banana-pro`）。
- 与当前服务器 OS 不匹配的技能（如 macOS 专属）。
- 与 Yoyoo 主目标无关的娱乐/设备控制类技能。

## 上线流程（强制）
1. 先跑：`openclaw skills check`（确认依赖）。
2. 通过 `clawhub` 搜索并安装：`npx clawhub search <keyword>` -> `npx clawhub install <slug>`。
3. 在沙箱执行 3 个真实任务（成功率、耗时、回包质量）。
4. 通过后再加入白名单并记录到本文件。

## 当前状态快照
- 服务器技能状态：`82` 总量，`50` ready，`32` missing。
- 本次新增：`clawhub`（已从 missing 转为 ready）。
