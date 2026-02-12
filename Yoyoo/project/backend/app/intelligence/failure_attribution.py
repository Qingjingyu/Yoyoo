from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from app.intelligence.memory import TaskRecord

_CATEGORY_SUGGESTIONS: dict[str, str] = {
    "timeout": "优先缩小任务粒度并提高执行超时阈值，必要时启用重试模板。",
    "network": "检查执行环境网络连通性与 DNS，优先切换到 HTTP bridge。",
    "auth": "核对 token/权限配置，避免在执行链路中使用过期凭证。",
    "permission": "校验目标主机权限，优先只读探测后再执行写操作。",
    "dependency": "检查 openclaw 与系统依赖版本，先做 preflight 再执行。",
    "session_locked": "遇到会话锁时使用新 session id 重试并清理残留 lock 文件。",
    "invalid_response": "检查执行器输出结构，确保返回标准 JSON payload。",
    "circuit_open": "说明短时失败过多，先排查根因再恢复流量。",
    "unknown": "补充错误日志与证据字段，增加更细粒度分类规则。",
}


@dataclass(frozen=True)
class FailureBucket:
    category: str
    count: int
    rate: float
    suggestion: str
    samples: list[dict[str, Any]]


def categorize_failure(*, status: str, error: str | None) -> str:
    normalized_status = (status or "").strip().lower()
    normalized_error = (error or "").strip().lower()
    if "circuit_open" in normalized_error:
        return "circuit_open"
    if "session file locked" in normalized_error or "session_locked" in normalized_error:
        return "session_locked"
    if "timeout" in normalized_error or normalized_status == "timeout":
        return "timeout"
    if any(token in normalized_error for token in ("auth", "unauthorized", "forbidden", "401")):
        return "auth"
    if any(token in normalized_error for token in ("permission denied", "not permitted")):
        return "permission"
    if any(
        token in normalized_error
        for token in ("connect", "refused", "unreachable", "network", "name resolution")
    ):
        return "network"
    if any(
        token in normalized_error
        for token in ("command not found", "no such file", "dependency", "module not found")
    ):
        return "dependency"
    if any(token in normalized_error for token in ("invalid_json", "invalid_response")):
        return "invalid_response"
    return "unknown"


def analyze_failures(
    *,
    tasks: list[TaskRecord],
    window_hours: float = 168.0,
    now: datetime | None = None,
) -> dict[str, Any]:
    if now is None:
        now = datetime.now(UTC)
    bounded_window_hours = max(float(window_hours), 1.0)

    window_failed_tasks: list[TaskRecord] = []
    for item in tasks:
        age_hours = max((now - item.updated_at).total_seconds() / 3600.0, 0.0)
        if age_hours > bounded_window_hours:
            continue
        status = (item.status or "").strip().lower()
        if status in {"failed", "timeout"}:
            window_failed_tasks.append(item)

    bucket_counts: dict[str, int] = defaultdict(int)
    bucket_samples: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in window_failed_tasks:
        category = categorize_failure(status=item.status, error=item.executor_error)
        bucket_counts[category] += 1
        if len(bucket_samples[category]) < 3:
            bucket_samples[category].append(
                {
                    "task_id": item.task_id,
                    "status": item.status,
                    "error": (item.executor_error or "")[:200],
                    "updated_at": item.updated_at.isoformat(),
                }
            )

    total = len(window_failed_tasks)
    buckets: list[FailureBucket] = []
    for category, count in sorted(bucket_counts.items(), key=lambda pair: pair[1], reverse=True):
        rate = round(count / total, 4) if total > 0 else 0.0
        buckets.append(
            FailureBucket(
                category=category,
                count=count,
                rate=rate,
                suggestion=_CATEGORY_SUGGESTIONS.get(category, _CATEGORY_SUGGESTIONS["unknown"]),
                samples=bucket_samples.get(category, []),
            )
        )

    return {
        "window_hours": bounded_window_hours,
        "failed_task_total": total,
        "bucket_total": len(buckets),
        "buckets": [
            {
                "category": item.category,
                "count": item.count,
                "rate": item.rate,
                "suggestion": item.suggestion,
                "samples": item.samples,
            }
            for item in buckets
        ],
    }
