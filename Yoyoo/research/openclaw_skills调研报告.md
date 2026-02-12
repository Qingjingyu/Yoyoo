# VoltAgent/awesome-openclaw-skills 调研报告

> **调研日期**: 2026-01-31
> **调研目标**: 研究 OpenClaw 技能生态，为 Yoyoo 技能系统设计提供参考

---

## 1. 项目概述

### 1.1 基本信息

| 项目 | VoltAgent/awesome-openclaw-skills |
|------|-----------------------------------|
| **定位** | OpenClaw 技能精选集合 |
| **规模** | 700+ 社区构建的技能 |
| **分类** | 28 个类别 |
| **许可证** | MIT License |
| **仓库** | github.com/VoltAgent/awesome-openclaw-skills |

### 1.2 核心理念

**"Skills extend its capabilities"**

- 允许 AI 助手与外部服务交互
- 自动化工作流程
- 执行特定任务

### 1.3 技能规范

遵循 **Anthropic Agent Skill 规范**（AI 编码助手的开放标准）

---

## 2. 技能分类概览

### 2.1 技能类别统计

| 类别 | 数量 | 说明 |
|------|------|------|
| **Web & Frontend Development** | 14 | 前端开发相关 |
| **Coding Agents & IDEs** | 15 | 代码助手和 IDE |
| **Git & GitHub** | 9 | 版本控制和协作 |
| **DevOps & Cloud** | 41 | 运维和云平台 |
| **Browser & Automation** | 11 | 浏览器自动化 |
| **Image & Video Generation** | 19 | 图像和视频生成 |
| **Apple Apps & Services** | 14 | 苹果生态集成 |
| **Search & Research** | 23 | 搜索和研究 |
| **CLI Utilities** | 41 | 命令行工具 |
| **Marketing & Sales** | 42 | 营销和销售 |
| **Productivity & Tasks** | 41 | 生产力工具 |
| **AI & LLMs** | 38 | AI 和大语言模型 |
| **Finance** | 29 | 金融相关 |
| **Notes & PKM** | 44 | 笔记和个人知识管理 |
| **...** | ... | 其他类别 |

### 2.2 技能分布分析

```
技能数量分布（Top 10）
├── Notes & PKM              ████████████ 44
├── Marketing & Sales        ███████████  42
├── Productivity & Tasks     ███████████  41
├── CLI Utilities            ███████████  41
├── DevOps & Cloud           ██████████   41
├── AI & LLMs                █████████    38
├── Finance                  ███████      29
├── Search & Research        ██████       23
├── Image & Video Generation █████        19
├── Coding Agents & IDEs     ████         15
└── 其他                     ███████████████ 150+
```

---

## 3. 核心技能详解

### 3.1 精选技能示例

| 技能 | 说明 |
|------|------|
| **Browser Control** | 浏览器自动化控制 |
| **Discord/Slack** | 社区平台集成 |
| **Cloud Deploy** | 云平台部署 |
| **Database Manager** | 数据库管理 |
| **Image Generator** | 图像生成 |
| **Video Generator** | 视频生成 |
| **Research Tool** | 研究搜索工具 |
| **Apple Apps** | 苹果生态集成 |

### 3.2 技能功能矩阵

| 功能域 | 技能数量 | 代表技能 |
|--------|----------|----------|
| **开发** | 29 | Web 前端、代码助手、Git |
| **运维** | 41 | 云部署、Docker、K8s |
| **自动化** | 52 | 浏览器、CLI、定时任务 |
| **内容** | 81 | 图像、视频、营销 |
| **信息** | 67 | 搜索、研究、笔记 |
| **AI** | 38 | LLM 集成、提示工程 |

---

## 4. 技术架构

### 4.1 技能规范

遵循 **Anthropic Agent Skill 规范**：

```json
{
  "name": "skill-name",
  "description": "What the skill does",
  "parameters": {
    "type": "object",
    "properties": {
      "param1": {
        "type": "string",
        "description": "..."
      }
    },
    "required": ["param1"]
  }
}
```

### 4.2 安装机制

**优先级规则**：
```
工作区 skills/ > 本地 skills/ > 全局 skills/
```

**安装方式**：
```bash
# CLI 安装（推荐）
npx clawdhub@latest install <skill-slug>

# 手动安装路径
全局: ~/.openclaw/skills/
工作区: <project>/skills/
```

### 4.3 技能来源

- **公共注册表**: clawdhub.com
- **工作区技能**: 项目本地 skills/ 目录
- **本地技能**: 用户主目录 ~/.openclaw/skills/
- **全局技能**: 系统级安装

---

## 5. 与 Yoyoo 的对比

### 5.1 技能系统对比

| 维度 | Yoyoo | OpenClaw Skills |
|------|-------|-----------------|
| **规模** | 待构建 | 700+ 技能 |
| **分类** | 待设计 | 28 个类别 |
| **规范** | 待定义 | Anthropic Agent Skill |
| **安装** | 待设计 | CLI (clawdhub) |
| **注册表** | 待构建 | clawdhub.com |

### 5.2 可借鉴的设计

| 设计 | Yoyoo 是否可借鉴 | 说明 |
|------|------------------|------|
| **技能分类体系** | ✅ 强烈推荐 | 28 类别可作为参考 |
| **技能命名规范** | ✅ 推荐 | Anthropic Agent Skill 规范 |
| **优先级机制** | ✅ 推荐 | 工作区 > 本地 > 全局 |
| **CLI 安装** | ✅ 推荐 | clawdhub 安装方式 |
| **注册表设计** | ✅ 参考 | clawdhub.com 模式 |

---

## 6. Yoyoo 技能系统设计建议

### 6.1 技能分类体系

基于 OpenClaw Skills，建议 Yoyoo 采用以下分类：

```
Yoyoo Skills/
├── 开发工具 (Development)
│   ├── 代码生成
│   ├── 代码审查
│   ├── Git 操作
│   └── API 设计
│
├── 自动化 (Automation)
│   ├── 浏览器控制
│   ├── 任务调度
│   ├── 数据抓取
│   └── 文件处理
│
├── 通信 (Communication)
│   ├── 邮件管理
│   ├── 消息发送
│   ├── 会议安排
│   └── 通知推送
│
├── 内容创作 (Content)
│   ├── 文本生成
│   ├── 图像生成
│   ├── 视频处理
│   └── 文档编写
│
├── 生产力 (Productivity)
│   ├── 日程管理
│   ├── 任务跟踪
│   ├── 笔记整理
│   └── 数据分析
│
├── 研究搜索 (Research)
│   ├── 网络搜索
│   ├── 内容摘要
│   ├── 信息聚合
│   └── 竞品分析
│
└── 集成 (Integration)
    ├── 云服务
    ├── 数据库
    ├── 第三方 API
    └── 系统工具
```

### 6.2 技能 Schema 设计

```json
{
  "name": "skill-name",
  "version": "1.0.0",
  "description": "技能描述",
  "author": "作者",
  "categories": ["category1", "category2"],
  "permissions": ["permission1", "permission2"],
  "parameters": {
    "type": "object",
    "properties": {
      "param1": {
        "type": "string",
        "description": "参数说明",
        "required": true
      }
    }
  },
  "handler": "src/handler.ts",
  "entry": "./dist/index.js"
}
```

### 6.3 安装优先级

```
1. 用户工作区 skills/     ← 最高优先级，项目专用
2. 用户本地 ~/.yoyoo/skills/  ← 次优先级，用户级
3. 系统全局 /opt/yoyoo/skills  ← 最低优先级，全局共享
```

---

## 7. 实施建议

### 7.1 第一阶段：基础框架

| 任务 | 说明 |
|------|------|
| 定义技能 Schema | 参考 Anthropic Agent Skill 规范 |
| 实现技能注册 | 技能发现和加载机制 |
| CLI 工具 | skill install / skill list / skill search |
| 技能目录 | ~/.yoyoo/skills/ |

### 7.2 第二阶段：核心技能

| 优先级 | 技能 | 说明 |
|--------|------|------|
| P0 | Browser Control | 浏览器自动化 |
| P0 | File Manager | 文件管理 |
| P0 | Command Runner | 命令执行 |
| P1 | Web Search | 网络搜索 |
| P1 | Note Taker | 笔记管理 |
| P2 | Image Gen | 图像生成 |
| P2 | Email | 邮件管理 |

### 7.3 第三阶段：生态建设

- **技能注册表**: yoyoo.skills.registry
- **技能市场**: Web 界面浏览和安装
- **开发者工具**: 技能开发模板和文档
- **社区贡献**: 开源技能贡献指南

---

## 8. 技能示例：Browser Control

```json
{
  "name": "browser_control",
  "version": "1.0.0",
  "description": "Control browser actions - navigate, click, fill forms, capture screenshots",
  "categories": ["automation", "web"],
  "permissions": ["browser"],
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["navigate", "click", "fill", "screenshot", "scroll"],
        "description": "Browser action to perform"
      },
      "url": {
        "type": "string",
        "description": "URL for navigate action"
      },
      "selector": {
        "type": "string",
        "description": "CSS selector for click/fill actions"
      },
      "text": {
        "type": "string",
        "description": "Text to fill"
      }
    },
    "required": ["action"]
  }
}
```

---

## 9. 参考链接

| 资源 | 链接 |
|------|------|
| 项目仓库 | https://github.com/VoltAgent/awesome-openclaw-skills |
| 技能注册表 | clawdhub.com |
| Anthropic Agent Skill 规范 | https://docs.anthropic.com/en/docs/agents-tools |
| OpenClaw 官方技能 | 待补充 |

---

## 附录：完整技能类别列表

| 类别 | 数量 |
|------|------|
| Web & Frontend Development | 14 |
| Coding Agents & IDEs | 15 |
| Git & GitHub | 9 |
| DevOps & Cloud | 41 |
| Browser & Automation | 11 |
| Image & Video Generation | 19 |
| Apple Apps & Services | 14 |
| Search & Research | 23 |
| CLI Utilities | 41 |
| Marketing & Sales | 42 |
| Productivity & Tasks | 41 |
| AI & LLMs | 38 |
| Finance | 29 |
| Notes & PKM | 44 |
| Health & Fitness | 15 |
| Shopping & Retail | 12 |
| Travel & Transport | 18 |
| Food & Drink | 22 |
| Weather & Environment | 8 |
| Social & Dating | 6 |
| News & Media | 14 |
| Sports & Gaming | 12 |
| Music & Audio | 16 |
| Books & Reading | 10 |
| Education & Learning | 21 |
| Science & Math | 11 |
| Legal & Government | 7 |
| Religion & Spirituality | 5 |
| **总计** | **700+** |

---

> **报告版本**: 1.0
> **调研人**: Yoyoo
> **最后更新**: 2026-01-31
