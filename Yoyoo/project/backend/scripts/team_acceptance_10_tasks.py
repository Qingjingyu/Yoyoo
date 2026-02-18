#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


@dataclass(slots=True)
class TaskCase:
    name: str
    prompt: str


TASK_CASES: list[TaskCase] = [
    TaskCase("greeting", "你好，先帮我总结你当前可执行能力"),
    TaskCase("ops", "请生成一次服务发布前的检查清单"),
    TaskCase("qa", "请给出一份回归测试计划"),
    TaskCase("memory", "请输出本周记忆归档规范"),
    TaskCase("channel", "请整理飞书与钉钉接入差异"),
    TaskCase("product", "请写一个最小可行版本的产品目标"),
    TaskCase("frontend", "请给出聊天页改造步骤"),
    TaskCase("backend", "请规划任务执行状态机"),
    TaskCase("security", "请列出凭据安全治理要点"),
    TaskCase("summary", "请输出今日项目进展汇报模板"),
]


def _http_json(method: str, url: str, payload: dict | None = None) -> dict:
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url=url, method=method.upper(), headers=headers, data=data)
    try:
        with urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except HTTPError as exc:
        body = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"HTTP {exc.code} {url} {body}") from exc
    except URLError as exc:
        raise RuntimeError(f"URL error {url}: {exc}") from exc


def run_acceptance(base_url: str, user_id: str, project_key: str) -> int:
    started_at = datetime.now(UTC)
    passed = 0
    failed = 0
    details: list[dict] = []

    for idx, case in enumerate(TASK_CASES, start=1):
        item: dict[str, object] = {"index": idx, "name": case.name, "prompt": case.prompt}
        try:
            create = _http_json(
                "POST",
                f"{base_url}/api/v1/team/tasks",
                {
                    "user_id": user_id,
                    "message": case.prompt,
                    "channel": "api",
                    "project_key": project_key,
                    "conversation_id": f"acceptance:{user_id}",
                },
            )
            task_id = str(create.get("task_id") or "")
            if not task_id:
                raise RuntimeError("missing task_id")
            item["task_id"] = task_id

            run = _http_json(
                "POST",
                f"{base_url}/api/v1/team/tasks/{task_id}/run",
                {"max_attempts": 2, "resume": True},
            )
            detail = _http_json("GET", f"{base_url}/api/v1/team/tasks/{task_id}")

            status = str(run.get("status") or detail.get("status") or "")
            item["run_status"] = status
            item["attempts_used"] = run.get("attempts_used")
            item["execution_mode"] = detail.get("execution_mode")
            item["cto_lane"] = detail.get("cto_lane")

            if status != "done":
                raise RuntimeError(f"status={status}")
            passed += 1
            item["ok"] = True
        except Exception as exc:  # noqa: BLE001
            failed += 1
            item["ok"] = False
            item["error"] = str(exc)
        details.append(item)

    finished_at = datetime.now(UTC)
    summary = {
        "ok": failed == 0,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_sec": round((finished_at - started_at).total_seconds(), 2),
        "base_url": base_url,
        "user_id": user_id,
        "project_key": project_key,
        "total": len(TASK_CASES),
        "passed": passed,
        "failed": failed,
        "details": details,
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if failed == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Run 10-task acceptance for Yoyoo team API")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--user-id", default="u_acceptance")
    parser.add_argument("--project-key", default="proj_acceptance")
    args = parser.parse_args()
    return run_acceptance(
        base_url=args.base_url.rstrip("/"),
        user_id=args.user_id.strip() or "u_acceptance",
        project_key=args.project_key.strip() or "proj_acceptance",
    )


if __name__ == "__main__":
    sys.exit(main())
