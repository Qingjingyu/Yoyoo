---
name: wechat-learning
description: |
  微信公众号搜索与学习工具：免 Key 搜索公众号文章，抓取单篇正文用于学习归档。
  触发条件：
  - 需要按关键词搜索微信公众号文章
  - 需要把公众号文章转成可分析文本
  - 需要做公众号内容学习与知识沉淀
allowed-tools: Bash,read,write
---

# WeChat Learning

## 能力

1. 关键词搜索公众号文章（免 Key）
2. 抓取单篇 `mp.weixin.qq.com` 正文文本

## 命令

```bash
# 搜索
python ~/.openclaw/skills/wechat-learning/wechat_search.py search "AI Agent" -n 8

# 抓取正文
python ~/.openclaw/skills/wechat-learning/wechat_search.py fetch "https://mp.weixin.qq.com/s/..."
```

## 数据来源

- 搜索：Bing RSS（`site:mp.weixin.qq.com <keyword>`）
- 正文：直接解析公众号文章页面

## 进阶方案（可选）

如需更强的公众号批量导出/评论数据能力，可接入：
- `wechat-article-exporter`：https://github.com/wechat-article/wechat-article-exporter
- 在线站点： https://down.mptext.top
- API 文档： https://docs.mptext.top/advanced/api.md

## 注意事项

- 请遵守平台规则与版权要求，仅用于学习研究与合法使用。
- 部分文章可能有访问限制，抓取结果会受公众号侧策略影响。
