---
name: yoyoo-knowledge
description: |
  Yoyoo知识库增强系统。用于知识存储、检索、增强RAG。
  触发条件：
  - 需要从知识库检索信息
  - 需要存储新知识
  - 需要构建RAG增强回答
  - 需要跨知识库搜索
allowed-tools: Bash,read,write,memory_search
---

# Yoyoo Knowledge 知识库增强

## 核心概念

知识库 = 结构化存储 + 语义检索 + 增强回答

```
用户问题 → 检索知识库 → 相关知识 → 增强Prompt → AI回答
```

## 知识库结构

```
knowledge/
├── README.md              # 知识库索引
├── concepts/              # 概念定义
│   ├── yoyoo-architecture.md
│   └── multi-agent.md
├── howto/                 # 操作指南
│   ├── deployment.md
│   └── configuration.md
├── troubleshooting/       # 问题解决
│   ├── common-errors.md
│   └── faq.md
└── api/                   # API文档
    └── reference.md
```

## 使用方法

### 1. 知识检索

```typescript
// 语义搜索
const results = await memory_search({
  query: "如何部署Yoyoo",
  maxResults: 5
})

// 读取知识
const knowledge = await memory_get({
  path: "knowledge/howto/deployment.md"
})
```

### 2. 知识存储

```typescript
// 添加新知识
await write({
  path: "knowledge/concepts/new-feature.md",
  content: `# 新功能

## 概述
...
`
})
```

### 3. RAG增强

```typescript
// 构建增强上下文
async function ragEnhance(query: string) {
  // 1. 检索相关知识
  const docs = await memory_search({ query, maxResults: 3 })
  
  // 2. 构建上下文
  const context = docs.map(d => d.content).join("\n\n")
  
  // 3. 增强Prompt
  const enhancedPrompt = `
相关知识：
${context}

用户问题：${query}

请根据以上知识回答。
`
  
  return enhancedPrompt
}
```

## 知识分类

| 类别 | 内容 | 示例 |
|------|------|------|
| **概念** | 定义、原理 | 什么是C2A2A2C |
| **操作** | 步骤、指南 | 如何部署 |
| **问题** | 故障排除 | 常见错误 |
| **API** | 接口文档 | 工具调用 |
| **案例** | 使用场景 | 最佳实践 |

## 知识质量

### 好的知识条目

```markdown
# 命令行部署

## 前提
- Node.js 18+
- PM2 已安装

## 步骤
1. 克隆代码
2. 安装依赖
3. 配置环境变量
4. 启动服务

## 验证
curl http://localhost:3000/health
```

### 不好的知识条目

```markdown
# 部署
部署很重要。
要先装Node。
然后运行。
```

## 检索优化

### 关键词提取

```typescript
// 提取关键实体
const keywords = extractKeywords(query)
// "部署Yoyoo到服务器" → ["部署", "Yoyoo", "服务器"]
```

### 向量检索

```typescript
// 语义相似度
const similarity = cosineSimilarity(
  embedding(query),
  embedding(doc)
)
```

### 分级过滤

```typescript
// 按相关度分级
const relevant = docs.filter(d => d.score > 0.7)
const maybeRelevant = docs.filter(d => d.score > 0.5 && d.score <= 0.7)
```

## 知识维护

### 更新周期

| 类型 | 更新频率 |
|------|----------|
| 核心概念 | 按需 |
| 操作指南 | 发现过时时 |
| 故障排除 | 解决新问题后 |
| API文档 | 版本发布时 |

### 质量检查

```bash
# 检查断裂链接
find knowledge -name "*.md" -exec grep -l "\[.*\](.*)" {} \; | while read f; do
  link=$(grep -oP '\]\(\K[^)]+' "$f")
  [ -e "$link" ] || echo "Broken: $f -> $link"
done

# 检查未分类知识
grep -L "^# " knowledge/*.md
```

## 知识共享

### 跨实例同步

```bash
# 同步知识库
rsync -avz knowledge/ root@server:/root/.openclaw/workspace/knowledge/
```

### 团队知识贡献

```typescript
// 提交知识
async function contributeKnowledge(doc: KnowledgeDoc) {
  // 1. 验证格式
  assertValidFormat(doc)
  
  // 2. 提交PR
  await gitPR({
    branch: "knowledge/new-feature",
    files: [doc.path],
    message: "添加: " + doc.title
  })
}
```

## 最佳实践

1. **命名规范** - 清晰描述性的文件名
2. **结构化** - 使用标题层级
3. **可检索** - 包含关键词
4. **可验证** - 提供验证步骤
5. **及时更新** - 发现过时立即更新

## 相关文档

- 模板: [references/templates.md](references/templates.md)
- 索引: [references/index.md](references/index.md)
