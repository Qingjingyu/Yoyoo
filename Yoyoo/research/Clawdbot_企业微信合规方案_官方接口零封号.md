# Clawdbot + 企业微信合规方案：官方接口零封号风险

> **调研日期**: 2026-02-05
> **来源**: 开源贾维斯合规方案 - 企业微信官方接口接入指南
> **目标**: 整理企业微信（个人测试版）+ Clawdbot AI 助理的合规接入方案，避免个人号风控风险。

---

## 1. 为什么选企业微信 + AI？（3大核心优势）

相比高危的个人号破解方案，这套组合是**"官方认证"级靠谱**：

| 优势 | 说明 |
|------|------|
| **零封号合规保障** | 基于企业微信开放平台接口开发，无逆向、无注入，官方认可，长期稳定 |
| **功能覆盖全需求** | 自动回复、群管理、文件收发、消息存档，满足办公自动化全场景 |
| **部署简单成本低** | 无需适配旧版微信，Python/Node.js 均可快速上手，免费版足够日常使用 |

---

## 2. 前置准备（3步搞定，全程免费）

### Step 1: 注册企业微信
- 手机扫码注册（个人可注册**"测试企业"**，无需营业执照）
- 创建后登录 PC 端企业微信

### Step 2: 开通接口权限
- 登录[企业微信开放平台](https://work.weixin.qq.com/)
- 创建"自建应用"
- 记录三个关键参数（后续配置用）：
  - **CorpID**（企业ID）
  - **AgentID**（应用ID）
  - **Secret**（应用密钥）

### Step 3: 安装必备工具
```bash
pip install wechatworkapi openai -i https://pypi.tuna.tsinghua.edu.cn/simple
```

---

## 3. 企业微信应用配置（关键避坑）

1. **登录管理后台** → "应用管理" → "自建应用" → "创建应用"
   - 填写应用名称（如"AI助理"），上传图标

2. **配置可见范围**：选择使用的部门/成员（个人测试选自己）

3. **开通接口权限**：进入"API权限管理"，勾选：
   - ✅ 消息推送
   - ✅ 联系人读取
   - ✅ 文件上传下载

4. **记录关键参数**：
   - CorpID（企业ID）
   - AgentID（应用ID）
   - Secret（应用密钥）

---

## 4. AI 联动代码示例（Python）

```python
from wechatworkapi import WeChatWork
import openai
import time

# 1. 替换为你的企业微信参数
CORP_ID = "你的企业CorpID"
AGENT_ID = 你的应用AgentID（整数）
SECRET = "你的应用Secret"

# 2. 配置AI模型（支持OpenAI/国内镜像/本地模型）
openai.api_base = "https://api.openai.com/v1"
openai.api_key = "你的AI密钥"

# 3. 初始化企业微信客户端
wework = WeChatWork(corp_id=CORP_ID, agent_id=AGENT_ID, secret=SECRET)

# 4. AI回复核心函数
def get_ai_reply(message):
    try:
        response = openai.ChatCompletion.create(
            model="gpt-3.5-turbo",
            messages=[{"role": "user", "content": message}],
            temperature=0.7
        )
        return response.choices[0].message.content.strip()
    except Exception as e:
        print(f"AI调用失败：{e}")
        return "AI助理暂时离线，稍后再试~"

# 5. 接收消息并回复
def handle_wework_message():
    last_msg_id = 0
    print("企业微信AI助理已启动，按Ctrl+C停止...")
    while True:
        try:
            messages = wework.message.list(
                start_time=int(time.time())-30,
                end_time=int(time.time()),
                msg_id=last_msg_id
            )
            if messages.get("errcode") == 0 and messages.get("message_list"):
                for msg in messages["message_list"]:
                    last_msg_id = msg["msg_id"]
                    if msg["msgtype"] != "text" or msg["sender"] == wework.user.get_self_info()["userid"]:
                        continue
                    content = msg["content"]
                    sender = msg["sender"]
                    print(f"收到消息：{content}（来自：{sender}）")
                    reply = get_ai_reply(content)
                    wework.message.send_text(userid=sender, content=reply)
                    print(f"已回复：{reply}")
            time.sleep(5)
        except KeyboardInterrupt:
            print("AI助理已停止")
            break
        except Exception as e:
            print(f"消息处理失败：{e}")
            time.sleep(10)

if __name__ == "__main__":
    handle_wework_message()
```

---

## 5. 启动测试（3步跑通）

1. **替换代码中3个关键参数**（CorpID、AgentID、Secret）
2. **运行脚本**：`python wework_ai_bot.py`
   - 控制台显示"已启动"即成功
3. **测试效果**：
   - 用个人微信添加企业微信好友
   - 发送消息（如"帮我写今日工作计划"）
   - AI 自动回复即成功！

---

## 6. 进阶玩法

### 6.1 群管理功能
```python
# 关键词触发群欢迎语
if msg["chattype"] == "groupchat":
    if "新人报道" in content:
        reply = "欢迎加入团队！如有疑问可随时@我~"
        wework.message.send_text(chatid=msg["chatid"], content=reply)
```

### 6.2 文件处理功能
```python
# 接收文件并保存（需开通文件权限）
if msg["msgtype"] == "file":
    file_info = wework.media.get_media(msg["media_id"])
    with open(f"received_file_{int(time.time())}.pdf", "wb") as f:
        f.write(file_info)
    reply = "文件已接收，正在提取内容..."
    wework.message.send_text(userid=sender, content=reply)
```

### 6.3 定时任务功能
```python
import schedule

# 每日下午5点发送日报模板
def send_daily_report():
    report_template = "今日工作小结：\n1. 完成事项：\n2. 未完成事项：\n3. 明日计划："
    wework.message.send_text(userid="你的用户ID", content=report_template)

schedule.every().day.at("17:00").do(send_daily_report)

# 在主循环中添加
while True:
    schedule.run_pending()
    time.sleep(1)
```

---

## 7. 避坑指南（4个关键）

| 坑点 | 解决方案 |
|------|----------|
| **接口调用限制** | 免费版接口有频率限制（避免每秒超10次），添加延时 |
| **AI密钥安全** | 不要硬编码，存为环境变量或配置文件 |
| **消息存档** | 需长期保存时，开通"消息存档"权限，合规存储 |
| **国内模型替代** | 无OpenAI密钥可改用通义千问/文心一言/DeepSeek |

---

## 8. 常见问题解决

| 问题 | 解决 |
|------|------|
| 接口调用失败 | 检查 CorpID/AgentID/Secret 正确性，应用可见范围和权限是否开通 |
| 收不到消息 | 确认企业微信已登录，消息未静音，脚本处于运行状态 |
| AI回复超时 | 国内用户替换AI镜像地址，或改用本地部署模型（如LLaMA/DeepSeek） |
| 企业微信注册 | 个人可注册"测试企业"，无需营业执照，1分钟完成 |

---

## 9. 与个人号方案的对比

| 维度 | 个人号破解方案 | 企业微信官方方案 |
|------|----------------|------------------|
| **封号风险** | ⚠️ 高（易风控） | ✅ 零封号（官方接口） |
| **合规性** | ❌ 违规（逆向破解） | ✅ 官方认可 |
| **功能完整性** | 功能多但脆弱 | 满足办公自动化全场景 |
| **部署难度** | 需适配旧版微信，环境复杂 | Python/Node.js 快速上手 |
| **长期稳定性** | 随时可能失效 | 长期稳定，官方支持 |

---

## 10. 对 Yoyoo 的启示

| 要点 | 应用 |
|------|------|
| **合规优先** | 放弃个人号破解，改用官方接口方案 |
| **零封号** | 企业微信测试版免费申请，适合长期运行 |
| **易扩展** | 群管理、文件处理、定时任务全覆盖 |
| **国内友好** | 支持国内模型替代（DeepSeek/通义千问等） |
| **用户触达** | 微信生态内用户无需下载新 APP |

---

## 11. 快速检查清单

- [ ] 企业微信测试版已注册（无需营业执照）
- [ ] 自建应用已创建并配置可见范围
- [ ] API 权限已开通（消息推送、联系人、文件）
- [ ] CorpID/AgentID/Secret 已记录
- [ ] AI 密钥已配置（支持国内模型）
- [ ] 接口频率限制已考虑（添加延时）
- [ ] 密钥未硬编码（使用环境变量）
- [ ] 长期运行方案已设计（配合 Clawdbot 7×24）

---

> **参考链接**：详细落地方案参见《开源贾维斯 Clawdbot 对接微信合规方案详细落地》
