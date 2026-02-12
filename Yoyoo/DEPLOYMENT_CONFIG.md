# Yoyoo 部署配置

> **创建日期**: 2026-01-31
> **敏感信息**: 请勿泄露！

---

## MiniMax 配置

| 项目 | 值 |
|------|-----|
| **API Key** | `${MINIMAX_API_KEY}`（请使用环境变量，不要写入仓库） |
| **API URL** | https://api.minimaxi.com/anthropic  ⚠️ 注意域名有字母 i |
| **说明** | 国际版 URL 会返回 401，需使用中国版 URL |

---

## 飞书配置

| 项目 | 值 |
|------|-----|
| **App ID** | cli_a9f087dbb338dcd1 |
| **App Secret** | `${FEISHU_APP_SECRET}`（请使用环境变量，不要写入仓库） |
| **插件** | @m1heng-clawd/feishu |

---

## 服务器信息

| 项目 | 值 |
|------|-----|
| **IP** | 115.191.36.128 |
| **OS** | Ubuntu 24.04 LTS |
| **CPU** | 4 vCPU |
| **内存** | 4 GB |
| **磁盘** | 40 GB |

---

## 待安装软件

- [ ] Docker
- [ ] Node.js 20.x
- [ ] Moltbot

---

## 验证命令

```bash
# 检查 Moltbot 端口
ss -lntp | grep 18789

# 检查服务状态
systemctl status moltbot
```
