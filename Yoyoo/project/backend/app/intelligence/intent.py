from __future__ import annotations

import re

_TASK_KEYWORDS = (
    "帮我",
    "请",
    "完成",
    "实现",
    "修复",
    "部署",
    "上线",
    "发布",
    "开发",
    "编写",
    "生成",
    "执行",
    "处理",
    "搭建",
    "配置",
    "排查",
    "优化",
    "继续",
    "再来",
    "再次",
    "按之前",
    "按上次",
    "延续",
    "跟进",
    "推进",
    "恢复",
    "回滚",
    "任务",
)

_TASK_EN_PATTERN = re.compile(
    r"\b(deploy|release|fix|implement|build|run|continue|retry|again|rollback)\b"
)
_GREETING_EN_PATTERN = re.compile(r"\b(hi|hello)\b")
_TASK_ID_PATTERN = re.compile(r"\btask_\d{14}_[a-z0-9]{8}\b")

_FEEDBACK_POSITIVE_TOKENS = (
    "做得好",
    "干得好",
    "很好",
    "不错",
    "满意",
    "赞",
    "靠谱",
    "good",
    "good job",
    "nice",
)
_FEEDBACK_NEGATIVE_TOKENS = (
    "不好",
    "不行",
    "太差",
    "失败",
    "有问题",
    "不对",
    "错了",
    "重做",
    "bad",
)
_FEEDBACK_CUE_TOKENS = (
    "这次",
    "刚才",
    "上次",
    "任务",
    "执行",
    "结果",
    "反馈",
    "评分",
    "task_",
)
_FEEDBACK_SHORT_POSITIVE = {"很好", "不错", "满意", "赞", "good", "nice"}
_FEEDBACK_SHORT_NEGATIVE = {"不好", "不行", "太差", "bad"}


def classify_intent(text: str) -> str:
    normalized = text.strip().lower()
    if not normalized:
        return "unknown"

    if any(token in normalized for token in ("我叫", "我是")):
        return "set_name"
    if any(token in normalized for token in ("你会", "能做什么", "能力", "capability")):
        return "capability"
    if any(token in normalized for token in ("状态", "status", "health")):
        return "status"
    if extract_feedback_label(normalized) is not None and _is_feedback_context(normalized):
        return "task_feedback"
    if any(token in normalized for token in _TASK_KEYWORDS):
        return "task_request"
    if _TASK_EN_PATTERN.search(normalized):
        return "task_request"
    if "你好" in normalized or _GREETING_EN_PATTERN.search(normalized):
        return "greeting"
    return "chat"


def extract_feedback_label(text: str) -> str | None:
    normalized = text.strip().lower()
    if not normalized:
        return None

    has_positive = any(token in normalized for token in _FEEDBACK_POSITIVE_TOKENS)
    has_negative = any(token in normalized for token in _FEEDBACK_NEGATIVE_TOKENS)
    if has_positive and has_negative:
        # When mixed sentiment appears in one short message, prefer negative for safety.
        return "bad"
    if has_negative:
        return "bad"
    if has_positive:
        return "good"
    return None


def extract_task_id_hint(text: str) -> str | None:
    match = _TASK_ID_PATTERN.search(text.strip().lower())
    if match is None:
        return None
    return match.group(0)


def _is_feedback_context(text: str) -> bool:
    normalized = text.strip().lower()
    if not normalized:
        return False
    if extract_task_id_hint(normalized):
        return True
    if any(token in normalized for token in _FEEDBACK_CUE_TOKENS):
        return True
    compact = re.sub(r"[，。,.!！?\s]+", "", normalized)
    if compact in _FEEDBACK_SHORT_POSITIVE or compact in _FEEDBACK_SHORT_NEGATIVE:
        return True
    return False
