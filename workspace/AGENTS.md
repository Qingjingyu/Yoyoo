# AGENTS.md - 你的工作空间

这是你的Yoyoo AI工作空间。

## 首次运行

按照以下步骤初始化：

1. 填写 `IDENTITY.md` - 定义你的AI身份
2. 填写 `USER.md` - 你的信息
3. 配置 `openclaw.json` - 添加你的API Key
4. 启动 OpenClaw Gateway

## 配置文件

配置文件位于 `~/.openclaw/openclaw.json`

### 必须配置

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "appId": "你的飞书App ID",
      "appSecret": "你的飞书App Secret"
    }
  },
  "models": {
    "mode": "merge",
    "providers": {
      "minimax": {
        "apiKey": "你的MiniMax API Key"
      }
    }
  }
}
```

## 更多信息

参见：https://docs.openclaw.ai
