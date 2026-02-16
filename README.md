# Yoyoo 1.0.1

Yoyoo 是企业化 AI 团队底座。  
本仓库支持“一键激活员工”，让新员工默认具备初始能力与基础技能。

## 开箱即用（推荐）

在服务器（Ubuntu）执行：

```bash
git clone git@github.com:Qingjingyu/Yoyoo.git
cd Yoyoo
bash install.sh
```

安装脚本会自动：
- 询问（或读取）`MINIMAX_API_KEY`
- 激活 CEO (`:18789`) + CTO (`:18794`)
- 运行基础验收检查

## 激活后默认拥有

- OpenClaw（latest）
- QMD 记忆后端
- 基础技能包（clawhub / coding-agent / healthcheck / session-logs / skill-creator / tmux / weather）
- 角色身份模板（CEO / 后勤 / 研发总监 / 研发员工）
- 网关守护与健康检查（2 分钟巡检）
- Yoyoo Backend 长任务内核（默认启用）：
  - 自动重试（可重试错误）
  - 断点恢复（“继续执行/重试”复用同 task）
  - 任务状态持久化（attempts / resume_count）

## 详细文档

- 激活基座说明：`Yoyoo/project/bootstrap/README.md`
- 运营规范：`Yoyoo/docs/ops/2026-02-12_Yoyoo_员工激活基座_v1.md`
