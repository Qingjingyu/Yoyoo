# OpenClaw 四件事学习整编（技能库 / 浏览器 / 7 Skills / QMD）

- 整编日期：2026-02-11
- 适用场景：Yoyoo 团队重装后快速恢复 OpenClaw 可用能力
- 目标：把分散材料整理成一份“可执行学习卡”

## 0. 资料来源与可信度

1. 官方文档（高）：`https://docs.openclaw.ai/tools/browser`
2. 官方/社区仓库（高）：`https://github.com/VoltAgent/awesome-openclaw-skills`
3. 社区文章（中）：《OpenClaw 必装的 7 个 Skill》
4. 社区文章（中）：《Token 消耗降低 90%：QMD 实战指南》

说明：社区文章里的数据可作为方向参考，最终以我们实测为准。

## 1. 四件事总览（你当前提到的）

1. 技能库：接入 `awesome-openclaw-skills`（当前列表约 2999，来源于 ClawHub）。
2. 浏览器：按官方 Browser 管理能力接入（本地/Node 代理/远程 CDP）。
3. 7 个实用 Skills：先做白名单安装，再灰度验证。
4. 降低 token：启用 QMD 记忆后端，目标平均降幅约 60%~95%（以实测为准）。

## 2. 技能库学习要点（awesome-openclaw-skills）

- 安装命令（官方示例）：

```bash
npx clawhub@latest install <skill-slug>
```

- 手动目录：
  - 全局：`~/.openclaw/skills/`
  - 工作区：`<project>/skills/`
  - 优先级：`Workspace > Local > Bundled`
- 安全原则：
  - 先查来源、再装技能、后授权。
  - 对高权限技能（文件系统/浏览器/外部账号）先在沙箱验证。

## 3. 浏览器能力学习要点（OpenClaw 官方）

官方支持三种模式：
1. 本地控制（默认）
2. Node 主机代理（浏览器在远端机器）
3. 远程 CDP（例如 Browserless）

常用命令（文档示例）：

```bash
openclaw browser extension install
openclaw browser extension path
openclaw browser --browser-profile chrome tabs
```

关键安全点：
- Browser 控制应走内网（如 Tailscale），避免公网裸露。
- `cdpUrl` 中 token 视为密钥，优先放环境变量，不直接写死配置。

## 4. “7 个必装 Skill”整理（先白名单，再安装）

文章提到的 7 类能力：
1. McPorter（MCP 接入）
2. Brave Search（实时搜索）
3. TranscriptAPI（视频字幕抽取）
4. File System Manager（文件系统操作）
5. Headless Browser / Playwright（网页自动化）
6. Design-Doc-Mermaid（图表/设计文档）
7. Google Workspace（Gmail/Calendar/Docs）

执行建议：
- 不直接“一键全装”；先做白名单 + 权限分级（低/中/高）。
- 先装低风险技能，再装高权限技能。

## 5. QMD 降 token 学习要点（目标 95% 级优化）

前提：
- OpenClaw 版本建议 `>= 2026.2.2`

典型步骤（按文章与现有实践）：
1. 安装 QMD CLI（及依赖）。
2. 在 `~/.openclaw/openclaw.json` 切换：

```json
{
  "memory": {
    "backend": "qmd",
    "qmd": {
      "limits": {
        "timeoutMs": 8000
      }
    }
  }
}
```

3. 重启 OpenClaw 并查看日志确认 QMD 生效。

验收指标（必须量化）：
1. 平均 token 降幅
2. p50/p95 响应时延
3. 超时/失败率
4. 单请求成本

## 6. 建议执行顺序（避免反复）

1. 先做浏览器基础可用性验证（官方链路）。
2. 再做 7 Skills 白名单灰度安装。
3. 最后切 QMD 并做 A/B 指标对比。
4. 达标后再全量推广到 CEO / 后勤实例。

## 7. 本资料的定位

这份文档是“学习整编卡”，不是最终 SOP。  
后续如进入实操阶段，应从此卡拆成：
1. 安装 SOP
2. 验收清单
3. 回滚手册
