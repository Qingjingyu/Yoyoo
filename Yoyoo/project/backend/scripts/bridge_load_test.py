#!/usr/bin/env python3
from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from statistics import mean
from typing import Any

import httpx


@dataclass
class CaseResult:
    case_id: int
    create_http_status: int
    run_http_status: int | None
    task_id: str | None
    task_status: str | None
    create_ms: float
    run_ms: float | None
    total_ms: float
    error: str | None


def _percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    if len(values) == 1:
        return round(values[0], 2)
    sorted_values = sorted(values)
    rank = (len(sorted_values) - 1) * p
    low = int(rank)
    high = min(low + 1, len(sorted_values) - 1)
    weight = rank - low
    result = sorted_values[low] * (1 - weight) + sorted_values[high] * weight
    return round(result, 2)


async def _run_case(
    *,
    case_id: int,
    client: httpx.AsyncClient,
    base_url: str,
    run_task: bool,
    max_attempts: int,
    message_prefix: str,
    user_prefix: str,
    channel: str,
    project_key: str,
) -> CaseResult:
    start = asyncio.get_running_loop().time()
    payload = {
        "user_id": f"{user_prefix}_{case_id}",
        "message": f"{message_prefix} #{case_id}",
        "channel": channel,
        "project_key": project_key,
    }
    create_start = asyncio.get_running_loop().time()
    create_resp = await client.post(f"{base_url}/api/v1/team/tasks", json=payload)
    create_ms = (asyncio.get_running_loop().time() - create_start) * 1000
    task_id: str | None = None
    task_status: str | None = None
    run_http_status: int | None = None
    run_ms: float | None = None
    error: str | None = None

    if create_resp.status_code != 200:
        error = f"create_http_{create_resp.status_code}"
    else:
        body = create_resp.json()
        task_id = str(body.get("task_id") or "").strip() or None
        if not task_id:
            error = "create_no_task_id"

    if run_task and task_id and error is None:
        run_start = asyncio.get_running_loop().time()
        run_resp = await client.post(
            f"{base_url}/api/v1/team/tasks/{task_id}/run",
            json={"max_attempts": max_attempts, "resume": True},
        )
        run_ms = (asyncio.get_running_loop().time() - run_start) * 1000
        run_http_status = run_resp.status_code
        if run_resp.status_code == 200:
            run_body = run_resp.json()
            task_status = str(run_body.get("status") or "").strip() or None
            if not task_status:
                error = "run_no_status"
        else:
            error = f"run_http_{run_resp.status_code}"

    total_ms = (asyncio.get_running_loop().time() - start) * 1000
    return CaseResult(
        case_id=case_id,
        create_http_status=create_resp.status_code,
        run_http_status=run_http_status,
        task_id=task_id,
        task_status=task_status,
        create_ms=round(create_ms, 2),
        run_ms=round(run_ms, 2) if run_ms is not None else None,
        total_ms=round(total_ms, 2),
        error=error,
    )


async def _run_load(args: argparse.Namespace) -> dict[str, Any]:
    semaphore = asyncio.Semaphore(args.concurrency)
    timeout = httpx.Timeout(timeout=args.timeout_sec)
    results: list[CaseResult] = []

    async with httpx.AsyncClient(timeout=timeout) as client:
        async def wrapped(case_id: int) -> None:
            async with semaphore:
                result = await _run_case(
                    case_id=case_id,
                    client=client,
                    base_url=args.base_url.rstrip("/"),
                    run_task=not args.no_run_task,
                    max_attempts=args.max_attempts,
                    message_prefix=args.message_prefix,
                    user_prefix=args.user_prefix,
                    channel=args.channel,
                    project_key=args.project_key,
                )
                results.append(result)

        tasks = [asyncio.create_task(wrapped(index + 1)) for index in range(args.total)]
        await asyncio.gather(*tasks)

    create_status_counter = Counter(item.create_http_status for item in results)
    run_status_counter = Counter(item.run_http_status for item in results if item.run_http_status is not None)
    task_status_counter = Counter(item.task_status or "none" for item in results)
    error_counter = Counter(item.error or "none" for item in results)

    create_lat = [item.create_ms for item in results]
    run_lat = [item.run_ms for item in results if item.run_ms is not None]
    total_lat = [item.total_ms for item in results]

    success_total = sum(
        1
        for item in results
        if item.error is None and (item.task_status in {"done", "review", "failed", None})
    )
    success_rate = round(success_total / len(results), 4) if results else 0.0

    return {
        "meta": {
            "generated_at": datetime.now(UTC).isoformat(),
            "base_url": args.base_url.rstrip("/"),
            "total": args.total,
            "concurrency": args.concurrency,
            "run_task": not args.no_run_task,
            "max_attempts": args.max_attempts,
            "timeout_sec": args.timeout_sec,
        },
        "summary": {
            "success_total": success_total,
            "success_rate": success_rate,
            "create_http_status": dict(sorted(create_status_counter.items())),
            "run_http_status": dict(sorted(run_status_counter.items())),
            "task_status": dict(sorted(task_status_counter.items())),
            "errors": dict(sorted(error_counter.items())),
            "latency_ms": {
                "create_avg": round(mean(create_lat), 2) if create_lat else None,
                "create_p50": _percentile(create_lat, 0.5),
                "create_p95": _percentile(create_lat, 0.95),
                "run_avg": round(mean(run_lat), 2) if run_lat else None,
                "run_p50": _percentile(run_lat, 0.5),
                "run_p95": _percentile(run_lat, 0.95),
                "total_avg": round(mean(total_lat), 2) if total_lat else None,
                "total_p50": _percentile(total_lat, 0.5),
                "total_p95": _percentile(total_lat, 0.95),
                "total_p99": _percentile(total_lat, 0.99),
            },
        },
        "results": [item.__dict__ for item in sorted(results, key=lambda x: x.case_id)],
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Yoyoo backend bridge load test")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--total", type=int, default=20)
    parser.add_argument("--concurrency", type=int, default=5)
    parser.add_argument("--timeout-sec", type=float, default=30.0)
    parser.add_argument("--max-attempts", type=int, default=2)
    parser.add_argument("--no-run-task", action="store_true", help="only create tasks, skip /run")
    parser.add_argument("--message-prefix", default="请执行压测任务")
    parser.add_argument("--user-prefix", default="u_load")
    parser.add_argument("--channel", default="api")
    parser.add_argument("--project-key", default="proj_load")
    parser.add_argument("--output-dir", default="data/benchmarks")
    parser.add_argument("--output-file", default="")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    if args.total < 1:
        raise SystemExit("--total must be >= 1")
    if args.concurrency < 1:
        raise SystemExit("--concurrency must be >= 1")

    report = asyncio.run(_run_load(args))
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_file = Path(args.output_file) if args.output_file else output_dir / (
        f"bridge_load_{datetime.now(UTC).strftime('%Y%m%d_%H%M%S')}.json"
    )
    output_file.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = report.get("summary", {})
    print(f"[load] output={output_file}")
    print(f"[load] success_rate={summary.get('success_rate')}")
    print(f"[load] errors={summary.get('errors')}")
    print(f"[load] task_status={summary.get('task_status')}")
    print(f"[load] total_latency={summary.get('latency_ms', {}).get('total_p95')}ms(p95)")


if __name__ == "__main__":
    main()
