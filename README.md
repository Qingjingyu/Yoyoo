# Yoyoo 1.0

Yoyoo 是企业化 AI 团队底座。  
本仓库支持“一键激活员工”，让新员工默认具备初始能力与基础技能。

## 克隆后直接激活（推荐）

在服务器（Ubuntu，root）执行：

```bash
git clone -b release/yoyoo-1.0-rc1 git@github.com:Qingjingyu/Yoyoo.git
cd Yoyoo
export MINIMAX_API_KEY='your_key'
export YOYOO_ROLE='ceo'   # ceo | ops | rd-director | rd-engineer
bash Yoyoo/project/bootstrap/hire_employee_from_git.sh
```

## 激活后默认拥有

- OpenClaw（latest）
- QMD 记忆后端
- 基础技能包（clawhub / coding-agent / healthcheck / session-logs / skill-creator / tmux / weather）
- 角色身份模板（CEO / 后勤 / 研发总监 / 研发员工）
- 网关守护与健康检查（2 分钟巡检）

## 详细文档

- 激活基座说明：`Yoyoo/project/bootstrap/README.md`
- 运营规范：`Yoyoo/docs/ops/2026-02-12_Yoyoo_员工激活基座_v1.md`
