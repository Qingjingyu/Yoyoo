from __future__ import annotations

import re
from dataclasses import dataclass

_ACTIONABLE_PATTERN = re.compile(
    r"\b(pm2|curl|python|ssh|git|npm|docker|systemctl|openclaw|kubectl)\b", re.IGNORECASE
)
_ASK_INFO_PATTERN = re.compile(
    r"(需要更多信息|请提供|告诉我|还需要|缺少|先了解|请先确认|give me more info)",
    re.IGNORECASE,
)


@dataclass
class ExecutionQualityReport:
    score: float
    issues: list[str]
    needs_correction: bool


class ExecutionQualityGuard:
    """Score execution output quality and decide whether correction is needed."""

    def assess(self, *, task_text: str, reply_text: str) -> ExecutionQualityReport:
        score = 1.0
        issues: list[str] = []
        normalized = reply_text.strip()
        lower = normalized.lower()

        if len(normalized) < 40:
            score -= 0.22
            issues.append("reply_too_short")

        if _ASK_INFO_PATTERN.search(normalized):
            score -= 0.4
            issues.append("asks_for_more_info")

        if "?" in normalized and ("请" in normalized or "tell me" in lower):
            score -= 0.18
            issues.append("question_heavy")

        actionable_signals = 0
        if _ACTIONABLE_PATTERN.search(normalized):
            actionable_signals += 1
        if any(
            token in normalized
            for token in ("步骤", "执行", "命令", "回滚", "健康检查", "证据")
        ):
            actionable_signals += 1
        if any(token in normalized for token in ("✅", "❌", "状态", "输出", "日志")):
            actionable_signals += 1
        if actionable_signals == 0:
            score -= 0.3
            issues.append("not_actionable_enough")

        if "按之前经验" in task_text and "asks_for_more_info" in issues:
            score -= 0.18
            issues.append("followup_but_still_asks")

        score = max(0.0, min(score, 1.0))
        needs_correction = score < 0.67 or "asks_for_more_info" in issues
        return ExecutionQualityReport(
            score=round(score, 4),
            issues=issues,
            needs_correction=needs_correction,
        )

    def build_correction_prompt(self, *, task_text: str, low_quality_reply: str) -> str:
        return (
            "请基于以下任务与当前执行反馈，输出一份可直接执行的结构化结果。\n"
            "要求：\n"
            "1) 不要再索取额外背景；默认使用已有上下文继续。\n"
            "2) 产出必须包含：执行状态、下一步命令/操作、证据采集项、回滚提醒。\n"
            "3) 用中文，简洁可执行。\n\n"
            f"任务：{task_text}\n"
            f"当前反馈：{low_quality_reply}\n"
        )
