---
name: yoyoo-debug
description: |
  Yoyoo系统调试和问题排查。用于定位问题、根因分析、修复验证。
  触发条件：
  - 系统出现错误需要排查
  - 功能不工作需要调试
  - 需要分析问题根因
  - 需要验证修复是否有效
allowed-tools: Bash,exec,read,sessions_spawn
---

# Yoyoo Debug 系统调试

## 调试流程

```
问题报告 → 信息收集 → 假设 → 验证 → 修复 → 验证修复
```

### Phase 1: 信息收集

```typescript
// 收集问题信息
const debugInfo = {
  error: "具体错误信息",
  context: "发生时的上下文",
  logs: await exec("查看日志"),
  recentChanges: "最近的改动",
  environment: "环境信息"
}
```

### Phase 2: 根因分析

```
5 Whys 分析法：
1. 为什么出错？→ 因为API返回500
2. 为什么返回500？→ 因为数据库连接超时
3. 为什么超时？→ 因为连接池耗尽
4. 为什么耗尽？→ 因为没有正确释放连接
5. 为什么没释放？→ 代码bug

根因：代码中未正确释放数据库连接
```

### Phase 3: 修复

```typescript
// 修复策略
const fix = {
  immediate: "重启服务恢复",
  shortTerm: "修复bug",
  longTerm: "优化架构"
}
```

### Phase 4: 验证

```typescript
// 验证修复
const verification = {
  unitTest: "单元测试通过",
  integrationTest: "集成测试通过",
  manualTest: "手动测试通过",
  monitoring: "监控无异常"
}
```

## 常见问题排查

### 1. 服务无响应

```bash
# 检查进程
ps aux | grep openclaw

# 检查端口
netstat -tlnp | grep 3000

# 检查资源
top -bn1 | head -20

# 检查日志
tail -100 /var/log/openclaw.log
```

### 2. 内存泄漏

```bash
# 内存使用
ps aux --sort=-rss | head -10

# 定时监控
watch -n 5 'ps aux | grep openclaw'
```

### 3. 网络问题

```bash
# 测试连接
curl -v https://api.openclaw.ai

# 检查DNS
nslookup openclaw.ai

# 检查代理
echo $http_proxy
echo $https_proxy
```

### 4. 数据库问题

```bash
# 检查SQLite
sqlite3 data.db ".tables"

# 检查连接
sqlite3 data.db "SELECT count(*) FROM sessions;"
```

### 5. 权限问题

```bash
# 检查文件权限
ls -la ~/.openclaw/

# 检查所有者
ls -ln ~/.openclaw/
```

## 调试命令速查

| 场景 | 命令 |
|------|------|
| 查看进程 | `ps aux \| grep openclaw` |
| 查看端口 | `netstat -tlnp \| grep` |
| 查看日志 | `tail -f logs/*.log` |
| 资源监控 | `top -bn1` |
| 磁盘使用 | `df -h` |
| 网络连通 | `curl -v` |
| DNS解析 | `nslookup` |

## 日志分析

```bash
# 按级别过滤
grep ERROR logs/app.log
grep -W "500|502|503" logs/nginx.log

# 按时间过滤
sed -n '/10:00:00/,/10:30:00/p' logs/app.log

# 统计错误
grep -c ERROR logs/app.log
```

## 健康检查

```bash
# 完整健康检查
openclaw gateway status

# 详细诊断
openclaw doctor

# 检查配置
openclaw configure --show
```

## 常见修复模式

### 1. 重启服务

```bash
# 重启Gateway
openclaw gateway restart

# 或
pm2 restart openclaw
```

### 2. 清理缓存

```bash
# 清理临时文件
rm -rf ~/.openclaw/tmp/*

# 清理日志
rm -rf ~/.openclaw/logs/*.log
```

### 3. 更新版本

```bash
openclaw update.run
```

## 调试检查清单

- [ ] 复现问题
- [ ] 收集错误信息
- [ ] 查看日志
- [ ] 定位根因
- [ ] 制定修复方案
- [ ] 执行修复
- [ ] 验证修复
- [ ] 记录经验

## 相关文档

- 工具: [references/tools.md](references/tools.md)
- 案例: [references/cases.md](references/cases.md)
