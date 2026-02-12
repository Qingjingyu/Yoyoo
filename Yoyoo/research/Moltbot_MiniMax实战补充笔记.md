# Moltbot + MiniMax M2.1 实战补充笔记

> **补充日期**: 2026-01-31
> **来源**: 社区实战文章 - Moltbot + MiniMax M2.1
> **目的**: 补充安装教程、飞书集成、模型对比等实战经验

---

## 1. 项目背景补充

### 1.1 名称变更历史

| 时间 | 名称 | 原因 |
|------|------|------|
| - | Clawdbot | 原名，与 Claude 谐音 |
| 2026-01-xx | Moltbot | 因与 Anthropic 商标冲突，改名 |
| 2026-01-xx | OpenClaw | 正式发布版，突破 100k+ Star |

### 1.2 项目定位补充

> "以前我们用 AI，是'人找 AI'；但 Moltbot 不一样，它是'AI 找人'"

| 维度 | 传统 AI | Moltbot |
|------|---------|---------|
| 交互方式 | 人找 AI | AI 找人 |
| 执行能力 | 仅建议 | 直接执行 |
| 记忆 | 会话级 | 本地持久记忆 |
| 运行时间 | 按需 | 7x24 小时 |

---

## 2. 安装教程详细版

### 2.1 一键安装命令

```bash
# Linux/macOS
curl -fsSL https://molt.bot/install.sh | bash

# Windows (PowerShell)
iwr -useb https://molt.bot/install.ps1 | iex
```

### 2.2 安装流程

```
1. 等待安装...
2. 确认风险 → 选择 "Yes"
3. 选择模式 → "Quick Start"
4. 选择模型 → MiniMax M2.1
5. 输入 API Key
6. 选择默认模型
7. 选择可用 App
```

### 2.3 验证服务

```bash
# 检查端口是否在监听
ss -lntp | grep 18789

# 输出示例：
# State    Recv-Q   Send-Q   Local Address:Port   Peer Address:Port   Process
# LISTEN   0        511      127.0.0.1:18789      0.0.0.0:*           users:(("node",pid=1234,fd=18))
```

### 2.4 Systemd 服务配置（可选）

如果需要开机自启：

```bash
# 创建服务文件
sudo nano /etc/systemd/system/moltbot.service

# 内容：
[Unit]
Description=Moltbot Gateway
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/home/your_username/.moltbot
ExecStart=/usr/local/bin/clawdbot gateway --verbose
Restart=always

[Install]
WantedBy=multi-user.target

# 启用服务
sudo systemctl enable moltbot
sudo systemctl start moltbot
```

---

## 3. 飞书集成（国内最佳方案）

### 3.1 为什么选飞书

| 渠道 | 状态 | 说明 |
|------|------|------|
| Telegram | ✅ 可用 | 需要配对码验证 |
| WhatsApp | ✅ 可用 | 需要手机绑定 |
| 飞书 | ✅ **推荐** | 国内最容易集成，官方支持 |
| 微信 | ❌ 不可用 | 不开放 API，协议封闭 |
| Slack | ✅ 可用 | 国外常用 |
| Discord | ✅ 可用 | 国外常用 |

### 3.2 飞书集成步骤

**步骤 1: 安装飞书插件**

```bash
# 在 Moltbot 对话中输入
clawdbot plugins install @m1heng-clawd/feishu
```

**步骤 2: 创建飞书应用**

1. 访问 https://open.feishu.cn
2. 创建企业应用
3. 获取 App ID 和 App Secret

**步骤 3: 配置权限**

在飞书开放平台配置以下权限：
- im:message
- im:message:send_as_bot
- im:chat:readonly

**步骤 4: 配置事件回调**

```
事件订阅 URL → 指向你的 Moltbot 服务器
事件类型 → message, chat_type
```

**步骤 5: 建立连接**

在 Moltbot 中输入：
```
clawdbot feishu config
# 输入 App ID
# 输入 App Secret
```

**步骤 6: 启用长连接**

```
在飞书中选择「长连接模式」
比 Webhook 更稳定
```

### 3.3 飞书集成效果

- 响应速度快
- 移动端体验好
- 支持语音消息
- 国内网络无障碍

---

## 4. MiniMax M2.1 模型体验

### 4.1 为什么选 M2.1

| 维度 | Claude | MiniMax M2.1 |
|------|--------|--------------|
| 响应速度 | 有时拥堵 | **更快** |
| API 稳定性 | 稳定 | **稳定** |
| 价格 | 较高 | **更亲民** |
| 长链条任务 | 优秀 | **高效直接** |
| 中文理解 | 优秀 | **优秀** |

### 4.2 用户评价

> "在执行任务时，它不像有些模型那样啰嗦，也不会在指令理解上'绕弯子'。它非常直接，你给它一个复杂的 Agent 任务，它能像个老练的员工一样直接上手。"

### 4.3 适用场景

**M2.1 表现优秀的场景**：
- 7x24 小时持续运行
- 频繁的心跳检测
- 后台自动监控
- 长链条任务执行

**可能需要 Claude 的场景**：
- 复杂的推理任务
- 创意写作
- 代码审查

---

## 5. 实战任务案例

### 5.1 海外用户案例

| 任务 | 说明 |
|------|------|
| 汽车经销商报价 | 批量处理 10+ 经销商报价 |
| 邮件跟踪 | 自动跟踪回复 |
| 保险理赔 | 处理理赔申请 |
| 航班预订 | 自动值机 |

### 5.2 日常任务

| 任务 | 说明 |
|------|------|
| 批量取消订阅 | 清理邮件列表 |
| 价格差异整理 | 对比分析 |
| 日程管理 | 会议安排 |

---

## 6. 常见问题

### 6.1 Windows 版本限制

> ⚠️ "Windows 下的 Clawdbot 是个缺胳膊少腿的残疾 AI"

**问题**: 微信无法使用
**原因**: 微信不开放 API，协议封闭

**解决方案**:
- 使用 macOS / Linux
- 使用飞书替代微信
- 使用 Telegram/WhatsApp

### 6.2 飞书长连接问题

**问题**: 飞书无法设置长连接
**解决**: 检查网络和服务器配置

### 6.3 MiniMax 区域问题

**问题**: 国区 MiniMax 会报错吗？

**回答**: 需要配置国际版 API，或单独配置国区端点

---

## 7. 架构思考

### 7.1 为什么 Moltbot 能火

| 痛点 | 传统 AI | Moltbot |
|------|---------|---------|
| 执行 | 仅建议 | **直接执行** |
| 记忆 | 会话级 | **持久记忆** |
| 时间 | 按需调用 | **7x24** |
| 渠道 | 仅网页 | **多渠道** |

### 7.2 与 Yoyoo 的关联

```
Yoyoo 的目标：
├── 7x24 小时运行 ✅ (Moltbot 证明可行)
├── 多渠道接入 ✅ (飞书/Telegram/WhatsApp)
├── 持久记忆 ✅ (三层记忆系统)
└── 直接执行 ✅ (WebSocket Gateway)
```

---

## 8. 金句摘录

> "拥有 7x24h AI 助手和没有助手的人，效率差距会变得越来越大。"

> "这不仅仅是为了省那几分钟回邮件的时间，更是为了把我们从琐碎重复的信息垃圾中解放出来，把时间留给自己去创造。"

---

## 参考链接

| 资源 | 链接 |
|------|------|
| Moltbot 安装 | https://molt.bot/install.sh |
| 飞书集成项目 | https://github.com/m1heng/Clawdbot-feishu |
| MiniMax 官网 | https://www.minimaxi.com |

---

## 附录：常用命令速查

```bash
# 启动服务
clawdbot gateway --verbose

# 检查服务
ss -lntp | grep 18789

# 安装插件
clawdbot plugins install <plugin-name>

# 飞书配置
clawdbot feishu config

# 配对设备
clawdbot pairing approve <platform> <code>

# 查看状态
clawdbot status
```

---

> **笔记版本**: 1.0
> **创建人**: Yoyoo
> **最后更新**: 2026-01-31
