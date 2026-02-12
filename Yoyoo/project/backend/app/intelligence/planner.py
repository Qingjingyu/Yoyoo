from __future__ import annotations

import re
from typing import Any

from app.intelligence.research_playbook import PlaybookHint, ResearchPlaybook


class TaskPlanner:
    def __init__(self, playbook: ResearchPlaybook) -> None:
        self._playbook = playbook

    def build_plan(self, text: str) -> tuple[list[str], list[str]]:
        hints: list[PlaybookHint] = self._playbook.plan_for(text)
        template_steps = self._template_steps(text)
        playbook_steps = [hint.step for hint in hints]
        merged = self._merge_steps(template_steps + playbook_steps)
        steps = [f"{idx + 1}. {item}" for idx, item in enumerate(merged)]
        references = [hint.research for hint in hints]
        return steps, references

    def apply_learning_hints(
        self,
        *,
        steps: list[str],
        learning_hints: list[str],
    ) -> list[str]:
        templates: list[str] = []
        merged_hints = "\n".join(learning_hints)

        if any(token in merged_hints for token in ("超时", "健康检查")):
            templates.append("先做执行器健康检查（版本/进程/通道），异常时先切换通道再继续。")
        if "失败率偏高" in merged_hints:
            templates.append("先做只读探测（状态/配置/权限），确认后再执行写操作。")
        if "成功率较高" in merged_hints:
            templates.append("优先复用最近一次稳定参数与路径，只做最小变更。")

        if not templates:
            return steps

        raw_steps = [self._strip_index_prefix(item) for item in steps]
        merged = self._merge_steps(templates + raw_steps)
        return [f"{idx + 1}. {item}" for idx, item in enumerate(merged)]

    def apply_strategy_cards(
        self,
        *,
        steps: list[str],
        strategy_cards: list[dict[str, Any]],
        enforce_read_only_first: bool,
        include_evidence_step: bool = True,
    ) -> list[str]:
        raw_steps = [self._strip_index_prefix(item) for item in steps]
        card_steps: list[str] = []
        card_cautions: list[str] = []
        evidence_steps: list[str] = []
        for card in strategy_cards:
            for step in card.get("recommended_steps", []):
                if isinstance(step, str):
                    card_steps.append(step.strip())
            for caution in card.get("cautions", []):
                if isinstance(caution, str):
                    card_cautions.append(caution.strip())
            for item in card.get("evidence_requirements", []):
                if isinstance(item, str):
                    evidence_steps.append(item.strip())

        merged = self._merge_steps(card_steps + raw_steps)
        if enforce_read_only_first:
            merged = self._merge_steps(
                ["先执行只读探测（状态/配置/权限/依赖），确认后再执行写操作。"] + merged
            )
        if card_cautions:
            caution_line = "注意事项：" + "；".join(self._merge_steps(card_cautions))
            merged = self._merge_steps(merged + [caution_line])
        if include_evidence_step:
            evidence_line = "收集证据：命令输出、日志片段、健康检查结果、变更清单。"
            if evidence_steps:
                evidence_line = "收集证据：" + "；".join(self._merge_steps(evidence_steps))
            merged = self._merge_steps(merged + [evidence_line])
        return [f"{idx + 1}. {item}" for idx, item in enumerate(merged)]

    def should_enforce_read_only_first(self, text: str) -> bool:
        normalized = text.lower()
        risky_tokens = (
            "生产",
            "线上",
            "数据库",
            "权限",
            "删除",
            "迁移",
            "drop",
            "truncate",
            "rm -rf",
            "rollback",
        )
        return any(token in normalized for token in risky_tokens)

    def _template_steps(self, text: str) -> list[str]:
        normalized = text.lower()
        if any(token in normalized for token in ("部署", "上线", "发布", "deploy", "release")):
            return [
                "确认发布目标与当前版本，先执行健康检查。",
                "执行最小变更部署并立即验证服务状态。",
            ]
        if any(token in normalized for token in ("修复", "排查", "bug", "故障", "error")):
            return [
                "先复现问题并收集错误证据（日志/报错/输入）。",
                "应用最小修复并回归验证核心路径。",
            ]
        if any(token in normalized for token in ("数据", "报表", "导出", "统计", "sql")):
            return [
                "先确认数据范围与口径，执行只读校验查询。",
                "执行处理并做结果抽样核对。",
            ]
        if any(token in normalized for token in ("前端", "页面", "ui", "frontend")):
            return [
                "先确认页面目标与交互边界，再实施改动。",
                "完成后进行桌面/移动端兼容性与回归检查。",
            ]
        return ["先定义目标与验收标准，再执行最小可行步骤。"]

    def _strip_index_prefix(self, text: str) -> str:
        return re.sub(r"^\s*\d+\.\s*", "", text).strip()

    def _merge_steps(self, steps: list[str]) -> list[str]:
        merged: list[str] = []
        seen: set[str] = set()
        for step in steps:
            item = step.strip()
            if not item:
                continue
            if item in seen:
                continue
            seen.add(item)
            merged.append(item)
        return merged
