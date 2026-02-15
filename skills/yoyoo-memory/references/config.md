# 记忆系统配置

## 目录结构

```
~/.openclaw/workspace/
├── MEMORY.md              # 核心记忆（永久）
├── memory/
│   ├── 2026-02-14.md     # 日常记忆
│   ├── 2026-02-13.md
│   └── ...
├── skills/
│   ├── yoyoo-memory/     # 记忆Skill
│   └── ...
└── ...
```

## MEMORY.md 结构

```markdown
# MEMORY.md - 长期记忆

## 用户信息
- 名字: 苏白
- 偏好: 简洁风格

## 项目
- Yoyoo: 多AI协作系统
- AionUi: 桌面客户端

## 技能
- 编程: TypeScript, Python
- 飞书: 已配置

## 重要决策
- 技术栈: Electron + React
- 模型: MiniMax-M2.5
```

## 日常记忆结构

```markdown
# 2026-02-14

## 完成
- 创建 yoyoo-multi-agent skill
- 创建 yoyoo-memory skill

## 待办
- [ ] 测试多agent协作
- [ ] 配置自动同步

## 学习
- skill-creator 用法
- agent-browser 自动化

## 讨论
- 用户偏好简洁风格
```

## 读取配置

```typescript
// 读取配置
const config = {
  memoryPath: "./memory",
  coreMemory: "MEMORY.md",
  syncInterval: 30 * 60 * 1000, // 30分钟
  maxDailyFiles: 365, // 保留1年
}
```

## 清理策略

```bash
# 删除30天前的日常记忆
find memory/ -name "*.md" -mtime +30 -delete

# 或者保留到年度归档
mkdir -p memory/archive/2025/
find memory/ -name "2025-*.md" -exec mv {} memory/archive/2025/
```

## 监控

```typescript
// 记忆大小监控
const checkMemorySize = async () => {
  const size = await exec("du -sh memory/")
  if (size > "100M") {
    console.warn("⚠️ 记忆库过大，考虑清理")
  }
}
```
