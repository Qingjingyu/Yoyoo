from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlaybookHint:
    step: str
    research: str


class ResearchPlaybook:
    """Map task themes to reusable SOP steps and research references."""

    def plan_for(self, text: str) -> list[PlaybookHint]:
        normalized = text.lower()
        if any(token in normalized for token in ("记忆", "memory", "复利")):
            return [
                PlaybookHint(
                    step="抽取原子事实并写入知识层，旧事实标记 superseded。",
                    research="Yoyoo/research/OpenClaw三层记忆复利引擎.md",
                ),
                PlaybookHint(
                    step="更新当日事件日志，再刷新隐性偏好摘要。",
                    research="Yoyoo/research/moltbot超级记忆系统技术分析.md",
                ),
            ]
        if any(token in normalized for token in ("skill", "技能", "能力")):
            return [
                PlaybookHint(
                    step="按场景筛选技能集并定义优先级（工作区 > 本地 > 全局）。",
                    research="Yoyoo/research/openclaw_skills调研报告.md",
                ),
                PlaybookHint(
                    step="建立技能调用白名单与失败回退策略。",
                    research="Yoyoo/research/OpenClaw两周体验_AI员工化.md",
                ),
            ]
        if any(token in normalized for token in ("开发", "上线", "deploy", "编码", "coding")):
            return [
                PlaybookHint(
                    step="先生成执行计划，再进入编码-测试-提交-部署闭环。",
                    research="Yoyoo/research/OpenClaw_OpenCode_AgentCoding实战.md",
                ),
                PlaybookHint(
                    step="关键节点增加验收门：测试通过与回滚预案。",
                    research="Yoyoo/research/OpenClaw两周体验_AI员工化.md",
                ),
            ]
        return [
            PlaybookHint(
                step="先定义目标与验收标准，再执行最小可行步骤。",
                research="Yoyoo/research/索引.md",
            )
        ]

