---
name: x-fetcher
description: |
  抓取 X(Twitter) 帖子内容（普通推文 + 长文）并输出结构化 JSON。
  触发条件：
  - 需要读取 X 链接内容
  - 需要把推文转为可分析数据
  - 需要抓取点赞/转发/浏览等指标
allowed-tools: Bash,read,write
---

# X Fetcher

内置来源：
- 项目参考：`https://github.com/Jane-xiaoer/x-fetcher`

## 用法

```bash
python ~/.openclaw/skills/x-fetcher/fetch_x.py "https://x.com/elonmusk/status/1866208218588203247"
```

紧凑输出：

```bash
python ~/.openclaw/skills/x-fetcher/fetch_x.py "<x_url>" --compact
```

## 输出内容

- `type=tweet/article`
- `text/full_text`
- `author/username`
- `likes/retweets/views/bookmarks`
- `media`

## 机制

1. 优先走 `api.fxtwitter.com`（支持 X Article）
2. 失败时回退 `cdn.syndication.twimg.com`

## 注意事项

- 依赖第三方接口，可用性会随外部服务波动。
- 私密账号内容无法抓取。
