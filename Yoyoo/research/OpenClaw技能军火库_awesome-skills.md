# OpenClaw 技能“军火库”调研（awesome-openclaw-skills）

> **调研日期**: 2026-02-05
> **来源**: 技能合集介绍（5.3K★，700+ Skills）
> **目标**: 了解技能生态、分类、安装方式，对 Yoyoo 的启示。

## 1. 仓库概览
- 名称：`awesome-openclaw-skills`（持续更新，随官方改名）。
- 规模：700+ 技能，30+ 领域；GitHub Star ~5.3K。
- 价值：为 Agent 提供“手和脚”，一行命令即装，避免重复造轮子。

## 2. 主要分类
- **开发/工程**：代码分析、自动重构、安全审计、性能优化、自动化测试、DevOps/CI。
- **Web/自动化**：Web 开发辅助、浏览器自动化、爬虫、SEO、表单自动填写。
- **AI/多模态**：图像生成、文生图/图生图、多模型集成、文本处理。
- **内容/生产力**：推文/博客、笔记/Notion、日程、邮件、文档整理。
- **生活/泛自动化**：购物/外卖、理财、健康、智能家居、出行。

## 3. 安装方式
- **一行命令**（推荐，类似 npm/brew）：
```bash
npx clawdhub@latest install <skill-slug>
```
- **手动放置**：
  - 全局：`~/.openclaw/skills/`
  - 项目：`<project>/skills/`
- 优先级：工作区 > 本地 > 内置技能，避免冲突。

## 4. 对 Yoyoo 的启示
- 选取“底座技能”做默认镜像：model-usage、summarize、文件/浏览器基础、日志/记忆 hooks。
- 建议维护“经过验证的技能白名单” + 成本/风险标签，减少随意安装带来的安全与兼容风险。
- 可将常用技能装入模板工作区，配合三层记忆/SOP，提升落地效率。

## 5. 链接
- GitHub: https://github.com/VoltAgent/awesome-openclaw-skills
