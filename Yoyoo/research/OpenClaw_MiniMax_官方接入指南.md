# 在 OpenClaw 中接入 MiniMax 文本模型 - MiniMax 官方教程整理

> 来源: MiniMax 开放平台文档中心 (https://platform.minimaxi.com/docs/solutions/moltbot)
> 整理时间: 2026-02-05

---

## 什么是 OpenClaw？

[OpenClaw](https://docs.openclaw.ai) 是一款 AI 助手机器人框架（原 clawdbot/Moltbot），支持与多种聊天工具集成。

---

## 前置条件

- **操作系统**: macOS（如需使用 iMessage）、Linux、Windows
- **MiniMax API**: 需要 Coding Plan 订阅或 [按量付费](https://platform.minimaxi.com/user-center/basic-information/interface-key) API Key
- **Node.js**: 需要安装 Node.js 环境

---

## 安装方式一：一键安装（推荐）

### 安装命令

```bash
# macOS / Linux
curl -fsSL https://skyler-agent.github.io/oclaw/i.sh | bash

# 或官方安装脚本
curl -fsSL https://openclaw.bot/install.sh | bash

# Windows PowerShell
iwr -useb https://openclaw.ai/install.ps1 | iex
```

### 配置选项

运行安装命令后，按提示选择：

1. **Onboarding Mode** → 选择 `QuickStart`
2. **Config handling** → 选择 `Use existing values`
3. **MiniMax endpoint** → 选择 `CN`（国内用户）

### 登录授权

```bash
npm install -g openclaw@latest || npm update -g openclaw
```

---

## 安装方式二：手动安装与配置

### 步骤 1: 运行安装命令

```bash
curl -fsSL https://openclaw.bot/install.sh | bash
```

### 步骤 2: 进入配置流程

```bash
openclaw onboard --install-daemon
```

#### 基础配置
- **Step 1**: 同意声明 → 选择 `Yes`
- **Step 2**: Onboarding Mode → 选择 `QuickStart`

#### 模型配置
- **Step 1**: Model/auth provider → 选择 `MiniMax`
- **Step 2**: MiniMax auth method → 选择 `MiniMax`
- **Step 3**: MiniMax API key → 填入您的 MiniMax API Key

#### 功能配置
- **Step 1**: 按需选择 channel（需要在什么 App 中进行对话）
- **Step 2**: 按需配置 Skill
- **Step 3**: 按需启用 Hooks（可选）：
  - 💾 **session-memory**: 执行 `/new` 时自动保存会话上下文
  - 📝 **command-logger**: 记录所有命令到日志文件
  - 🚀 **boot-md**: 网关启动时运行 BOOT.md

---

## 国内用户特别配置

国内用户需要将 API 地址从 `api.minimax.io` 修改为 `api.minimaxi.com`：

### 方法一：修改配置文件

编辑 `~/.openclaw/openclaw.json`：

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "minimax": {
        "baseUrl": "https://api.minimaxi.com/anthropic",
        "apiKey": "MiniMax API Key",
        "api": "anthropic-messages",
        "authHeader": true,
        "models": [
          {
            "id": "MiniMax-M2.1",
            "name": "MiniMax M2.1",
            "reasoning": false,
            "input": ["text"],
            "cost": {
              "input": 15,
              "output": 60,
              "cacheRead": 2,
              "cacheWrite": 10
            },
            "contextWindow": 200000,
            "maxTokens": 8192
          }
        ]
      }
    }
  }
}
```

**关键修改**：将 `baseUrl` 从 `https://api.minimax.io/anthropic` 改为 `https://api.minimaxi.com/anthropic`

### 方法二：前端界面修改

1. 启动网关：`openclaw gateway run`
2. 打开浏览器访问 http://127.0.0.1:18789
3. 进入 Config 配置界面，点击 models 栏目
4. 将 baseUrl 修改为 `https://api.minimaxi.com/anthropic`，并打开 Auth Header 开关
5. 点击右上角 Save 按钮保存，然后点击 Update 按钮更新配置

---

## 启动与测试

### 启动网关

```bash
# 方式 1: 直接运行
openclaw gateway run

# 方式 2: 后台运行
openclaw gateway

# 方式 3: 详细日志模式
openclaw gateway --verbose
```

### 测试对话

```bash
# 在终端中测试
openclaw tui

# 或在 WebUI 中测试（浏览器访问 http://127.0.0.1:18789）
```

---

## 接入 iMessage（仅限 macOS）

### 准备工作

#### 1. 添加邮箱到 Apple ID
1. 在苹果设备上打开「设置」App
2. 点击顶部「Apple ID」
3. 点击「登陆与安全性」
4. 在「电子邮件」栏点击「添加电子邮件」
5. 输入邮箱地址并按提示完成验证

#### 2. 在 iMessage 里启用邮箱
1. 在 Mac 上打开「信息」App
2. 在左上方菜单栏点击「信息」→「设置」
3. 开启「iMessage 信息」
4. 点击「发送与接收」
5. 确保新添加的邮箱开关已打开

#### 3. 安装核心工具 imsg

```bash
# 安装 imsg 工具
brew install steipete/tap/imsg

# 验证安装是否成功
imsg chats --limit 1
```

### 配置 iMessage 通道

```bash
openclaw configure
```

配置步骤：
- Step 1: 「Where will the Gateway run?」→ `Local (this machine)`
- Step 2: 「Select sections to configure」→ `channels`
- Step 3: 「Select a channel to configure/link」→ `iMessage Local`
- Step 4: 「Configure iMessage Local?」→ `Skip (leave as-is)`
- Step 5: 「Finished configuring?」→ `Finished`
- Step 6: 「DM Access」→ `Pairing`

### 修改 iMessage 配置文件

编辑 `~/.openclaw/openclaw.json`，添加：

```json
{
  "channels": {
    "imessage": {
      "enabled": true,
      "cliPath": "imsg路径",
      "dbPath": "chat.db路径"
    }
  }
}
```

**获取路径方法**：
- **imsg 路径**: 终端输入 `which imsg`，通常是 `/Users/用户名/.homebrew/bin/imsg`
- **chat.db 路径**: 
  1. Finder → 菜单栏「前往」→ 按住 Option 点击「资源库」
  2. 打开 Messages 文件夹 → 找到 chat.db
  3. 右键按住 Option → 选择「将…拷贝为路径名称」

### 重启网关

```bash
openclaw gateway restart
```

### 授权访问权限

#### 手动授权步骤

1. **系统设置** → **隐私与安全性** → **完全磁盘访问权限**
2. 点「+」→ 按 `⌘+⇧+G`
3. 粘贴 `/Users/用户名/.homebrew/bin`
4. 选择 `imsg` → 点「打开」

然后再授权终端：

1. **系统设置** → **隐私与安全性** → **完全磁盘访问权限**
2. 点「+」→ 按 `⌘+⇧+G`
3. 粘贴 `/Applications/Utilities/Terminal.app`
4. 点「打开」

### 配对连接

在 iMessage 中发送 `<配对码>` 给 AI 助手，然后在终端执行：

```bash
openclaw pairing approve imessage <配对码>
```

### 开始对话

配对成功后，可以通过 iMessage 与 AI 助手对话，支持：
- 回答问题和提供信息
- 撰写和编辑文本
- 代码辅助和调试
- 创意任务和头脑风暴

---

## 接入飞书

### 飞书插件能力

飞书插件支持在群聊中与 AI 助手对话。

### 安装与编译（从源码）

#### 1. 拉取飞书插件分支

```bash
git clone -b feishu https://github.com/MiniMax-OpenPlatform/MiniMax-Moltbot.git
```

#### 2. 安装依赖并编译

```bash
cd MiniMax-Moltbot
pnpm install
pnpm ui:build
pnpm build
```

#### 3. 进入配置流程

```bash
pnpm moltbot onboard --install-daemon
```

### 创建飞书应用

#### 1. 访问飞书开放平台
1. 打开浏览器，访问 [飞书开放平台](https://open.feishu.cn/)
2. 使用飞书账号登录
3. 点击「创建企业自建应用」

#### 2. 创建新应用
1. 点击「创建自建应用」
2. 填写应用基本信息：
   - **应用名称**: OpenClaw
   - **应用描述**: AI 助手机器人
3. 点击「确定创建」

#### 3. 获取应用凭证
记录以下信息（后面配置需要）：
- **应用 ID (App ID)**: `cli_xxxxxxxxxxxxx`
- **应用密钥 (App Secret)**: `xxxxxxxxxxxxx`
- **加密密钥 (Encrypt Key)**: （可选，但建议启用）
- **验证令牌 (Verification Token)**: （可选，但建议启用）

#### 4. 添加权限和事件

**需要添加的权限**：
- `im:message`
- `im:message.group_at_msg:readonly`
- `im:message:send_as_bot`
- `im:chat`
- `im:resource`
- `im:message.reaction:write`

**需要添加的事件**：
- `im.message.receive_v1`（接收消息）

#### 5. 发布应用
完成上述配置后，在飞书开放平台发布应用。

### 配置飞书插件

#### 1. 停止网关

```bash
pnpm moltbot gateway stop
```

#### 2. 添加飞书通道

```bash
pnpm moltbot channels add
```

按提示填写：
1. 选择 `Feishu`
2. 选择 `Use local plugin path`
3. 选择 `Add a new account`
4. 填入 account id（例如 `default`）
5. 输入 App ID
6. 输入 App Secret
7. 输入 Encrypt Key
8. 输入 Verification Token
9. 选择 `Finished`
10. 选择 `YES`
11. 选择之前填的 account id

#### 3. 检查配置文件

编辑 `~/.clawdbot/moltbot.json`，确保包含：

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_...",
      "appSecret": "...",
      "encryptKey": "...",
      "verificationToken": "...",
      "enabled": true,
      "accounts": {
        "xxx": {
          "name": "xxx"
        }
      }
    }
  },
  "plugins": {
    "entries": {
      "feishu": {
        "enabled": true
      }
    }
  }
}
```

### 连接飞书测试

#### 1. 启动 Moltbot

```bash
pnpm moltbot gateway run
```

#### 2. 检查飞书开放平台配置
确保事件订阅和权限都已正确配置。

#### 3. 添加群机器人
在飞书群聊中添加创建的机器人应用。

#### 4. 测试对话
在飞书群聊中 @机器人，测试对话功能。

---

## 总结

通过本教程，你可以：

1. ✅ **安装和配置 OpenClaw**：使用 MiniMax M2.1 模型驱动 Moltbot
2. ✅ **正确配置服务**：修改 API 地址以成功使用（国内用户）
3. ✅ **接入 iMessage**：在 Mac 上配置 iMessage 通道与 AI 助手对话
4. ✅ **接入飞书**：从源码编译飞书插件并在群聊中与 AI 助手对话

---

## 相关资源

- 📖 [OpenClaw 官方文档](https://docs.openclaw.ai)
- 🤖 [MiniMax M2.1 模型介绍](https://minimaxi.com/news/minimax-m21)
- 💳 [MiniMax Coding Plan 订阅](https://platform.minimaxi.com/subscribe/coding-plan)
- 🔑 [获取 API Key](https://platform.minimaxi.com/user-center/basic-information/interface-key)

---

## MiniMax M2.1 模型参数

```json
{
  "id": "MiniMax-M2.1",
  "name": "MiniMax M2.1",
  "reasoning": false,
  "input": ["text"],
  "cost": {
    "input": 15,
    "output": 60,
    "cacheRead": 2,
    "cacheWrite": 10
  },
  "contextWindow": 200000,
  "maxTokens": 8192
}
```

**价格说明**：
- 输入: 15 元/百万 tokens
- 输出: 60 元/百万 tokens
- 缓存读取: 2 元/百万 tokens
- 缓存写入: 10 元/百万 tokens
