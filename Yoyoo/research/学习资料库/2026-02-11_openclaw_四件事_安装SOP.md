# OpenClaw 四件事安装 SOP（技能库 / 浏览器 / 7 Skills / QMD）

- 版本：v1.0
- 日期：2026-02-11
- 目标：一次性完成四件事安装，且可回滚

## 0. 前置检查

```bash
openclaw --version
node -v
npm -v
```

通过标准：
1. `openclaw` 已可执行
2. `openclaw` 版本建议 `>= 2026.2.2`

## 1. 先做备份（强制）

```bash
cp -r ~/.openclaw ~/.openclaw.bak.$(date +%Y%m%d_%H%M%S)
```

## 2. 浏览器能力安装（官方链路）

```bash
openclaw browser extension install
openclaw browser extension path
```

然后在 Chrome 执行：
1. 打开 `chrome://extensions`
2. 开启开发者模式
3. “加载已解压的扩展程序”，选择上一步输出目录
4. 置顶扩展，打开目标网页并点扩展使其显示 `ON`

## 3. 技能库接入（700+ / 2999+ 生态）

安装命令模板：

```bash
npx clawhub@latest install <skill-slug>
```

目录优先级：
1. `<project>/skills/`
2. `~/.openclaw/skills/`
3. 内置技能

建议：
1. 先建白名单文件 `skills_allowlist.txt`
2. 先低权限技能，后高权限技能（文件系统、浏览器、外部账号）

批量安装模板：

```bash
while read -r skill; do
  [ -z "$skill" ] && continue
  npx clawhub@latest install "$skill"
done < skills_allowlist.txt
```

## 4. 7 个实用 Skills（先白名单，再安装）

先按类别建白名单（示例名，最终以 ClawHub 实际 slug 为准）：
1. mcporter（MCP）
2. brave-search（搜索）
3. transcript-api（字幕）
4. file-system-manager（文件）
5. playwright/headless-browser（网页自动化）
6. design-doc-mermaid（图表）
7. google-workspace（办公套件）

## 5. QMD 启用（目标降 token）

安装依赖：

```bash
npm i -g bun
bun install -g github:tobi/qmd
```

切换 OpenClaw 记忆后端（`~/.openclaw/openclaw.json`）：

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

重启：

```bash
openclaw gateway restart
```

## 6. 最小验收（安装后立刻跑）

```bash
openclaw --version
openclaw browser --browser-profile chrome tabs
openclaw logs --follow
```

通过标准：
1. 浏览器 tabs 可读
2. 日志无持续报错
3. 日志出现 QMD 后端生效信息（关键词包含 `qmd`）

