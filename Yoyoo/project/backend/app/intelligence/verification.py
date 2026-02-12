from __future__ import annotations


class TaskVerifier:
    """Build verification checklist and rollback template for task execution."""

    def build(self, *, task_text: str) -> tuple[list[str], list[str]]:
        checks = [
            "确认目标是否被完整覆盖（范围、边界、非目标）。",
            "确认关键步骤有可复现证据（日志、输出、链接）。",
            "确认失败路径和异常输入已验证。",
        ]
        rollback = [
            "停止本次新增进程或任务执行。",
            "回退最近变更（代码/配置/任务状态）到上一个稳定点。",
            "恢复关键配置并重新执行健康检查。",
            "输出失败原因、影响范围和下一次修复建议。",
        ]

        normalized = task_text.lower()
        if any(token in normalized for token in ("代码", "code", "开发", "修复", "测试")):
            checks.extend(
                [
                    "自动化测试通过（至少包含核心路径）。",
                    "Lint/静态检查通过，无新增高危告警。",
                ]
            )
        if any(token in normalized for token in ("部署", "上线", "deploy", "发布")):
            checks.extend(
                [
                    "目标环境健康检查通过（端口、进程、日志）。",
                    "回滚命令可执行且已演练。",
                ]
            )
        return checks, rollback

