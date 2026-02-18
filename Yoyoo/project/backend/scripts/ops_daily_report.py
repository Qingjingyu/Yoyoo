#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx


@dataclass
class EndpointResult:
    name: str
    path: str
    ok: bool
    status_code: int | None
    data: dict[str, Any] | None
    error: str | None


def _fetch_json(
    *,
    client: httpx.Client,
    base_url: str,
    name: str,
    path: str,
    params: dict[str, Any] | None = None,
) -> EndpointResult:
    url = f"{base_url.rstrip('/')}{path}"
    try:
        resp = client.get(url, params=params)
    except Exception as exc:  # noqa: BLE001
        return EndpointResult(
            name=name,
            path=path,
            ok=False,
            status_code=None,
            data=None,
            error=f"request_error: {exc}",
        )

    if resp.status_code != 200:
        return EndpointResult(
            name=name,
            path=path,
            ok=False,
            status_code=resp.status_code,
            data=None,
            error=f"http_{resp.status_code}",
        )

    try:
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        return EndpointResult(
            name=name,
            path=path,
            ok=False,
            status_code=resp.status_code,
            data=None,
            error=f"json_error: {exc}",
        )

    return EndpointResult(
        name=name,
        path=path,
        ok=True,
        status_code=resp.status_code,
        data=payload if isinstance(payload, dict) else {"value": payload},
        error=None,
    )


def _fmt(v: Any, default: str = "-") -> str:
    if v is None:
        return default
    if isinstance(v, float):
        return f"{v:.4f}"
    return str(v)


def _render_markdown(
    *,
    generated_at: str,
    base_url: str,
    window_hours: float,
    baseline_hours: float,
    endpoint_results: list[EndpointResult],
) -> str:
    result_map = {item.name: item for item in endpoint_results}

    lines: list[str] = []
    lines.append("# Yoyoo Ops Daily Report")
    lines.append("")
    lines.append(f"- Generated At: `{generated_at}`")
    lines.append(f"- Base URL: `{base_url}`")
    lines.append(f"- Window Hours: `{window_hours}`")
    lines.append(f"- Baseline Hours: `{baseline_hours}`")
    lines.append("")

    lines.append("## Endpoint Status")
    lines.append("")
    lines.append("| Endpoint | Status | HTTP | Error |")
    lines.append("| --- | --- | --- | --- |")
    for item in endpoint_results:
        lines.append(
            f"| `{item.path}` | {'ok' if item.ok else 'fail'} | {_fmt(item.status_code)} | {_fmt(item.error)} |"
        )
    lines.append("")

    alerts = result_map.get("alerts")
    alerts_data = alerts.data if alerts and alerts.data else {}
    level = alerts_data.get("level")
    summary = alerts_data.get("summary") if isinstance(alerts_data, dict) else {}
    lines.append("## Alert Summary")
    lines.append("")
    lines.append(f"- Level: `{_fmt(level, 'unknown')}`")
    if isinstance(summary, dict):
        lines.append(f"- Critical: `{_fmt(summary.get('critical'))}`")
        lines.append(f"- Warn: `{_fmt(summary.get('warn'))}`")
        lines.append(f"- Total: `{_fmt(summary.get('total'))}`")
    lines.append("")

    alert_items = alerts_data.get("alerts") if isinstance(alerts_data, dict) else []
    if isinstance(alert_items, list) and alert_items:
        lines.append("### Active Alerts")
        lines.append("")
        for item in alert_items:
            if not isinstance(item, dict):
                continue
            lines.append(
                f"- [{item.get('level', 'unknown')}] {item.get('code', 'unknown')}: {item.get('message', '-')}"
            )
        lines.append("")

    quality = result_map.get("quality")
    quality_data = quality.data if quality and quality.data else {}
    quality_metrics = quality_data.get("metrics") if isinstance(quality_data, dict) else {}
    lines.append("## Quality Baseline")
    lines.append("")
    if isinstance(quality_metrics, dict) and quality_metrics:
        lines.append(f"- Task Total: `{_fmt(quality_metrics.get('task_total'))}`")
        lines.append(f"- Terminal Total: `{_fmt(quality_metrics.get('task_terminal_total'))}`")
        lines.append(f"- Success Rate: `{_fmt(quality_metrics.get('task_success_rate'))}`")
        lines.append(f"- Quality Avg: `{_fmt(quality_metrics.get('quality_score_avg'))}`")
        lines.append(f"- Evidence Coverage: `{_fmt(quality_metrics.get('evidence_coverage_rate'))}`")
        lines.append(f"- Auto Correction Rate: `{_fmt(quality_metrics.get('auto_correction_rate'))}`")
        lines.append(f"- Retry Rate: `{_fmt(quality_metrics.get('retry_rate'))}`")
    else:
        lines.append("- unavailable")
    lines.append("")

    failures = result_map.get("failures")
    failures_data = failures.data if failures and failures.data else {}
    lines.append("## Failure Snapshot")
    lines.append("")
    if isinstance(failures_data, dict):
        window = failures_data.get("window")
        baseline = failures_data.get("baseline")
        if isinstance(window, dict):
            window_text = (
                f"- Window Failed: `{_fmt(window.get('failed_total'))}` / "
                f"`{_fmt(window.get('task_total'))}` "
                f"(rate `{_fmt(window.get('failed_rate'))}`)"
            )
            lines.append(window_text)
        if isinstance(baseline, dict):
            baseline_text = (
                f"- Baseline Failed: `{_fmt(baseline.get('failed_total'))}` / "
                f"`{_fmt(baseline.get('task_total'))}` "
                f"(rate `{_fmt(baseline.get('failed_rate'))}`)"
            )
            lines.append(baseline_text)
    lines.append("")

    reasons = failures_data.get("top_reasons") if isinstance(failures_data, dict) else []
    if isinstance(reasons, list) and reasons:
        lines.append("### Top Failure Reasons")
        lines.append("")
        for item in reasons:
            if not isinstance(item, dict):
                continue
            lines.append(f"- {item.get('reason', 'unknown')}: `{_fmt(item.get('count'))}`")
        lines.append("")

    suggestions = failures_data.get("suggestions") if isinstance(failures_data, dict) else []
    if isinstance(suggestions, list) and suggestions:
        lines.append("### Suggestions")
        lines.append("")
        for item in suggestions:
            lines.append(f"- {item}")
        lines.append("")

    executor = result_map.get("executor")
    executor_data = executor.data if executor and executor.data else {}
    executor_body = executor_data.get("executor") if isinstance(executor_data, dict) else {}
    lines.append("## Executor Diagnostics")
    lines.append("")
    if isinstance(executor_body, dict) and executor_body:
        lines.append(f"- Mode: `{_fmt(executor_body.get('mode'))}`")
        lines.append(f"- Bridge Enabled: `{_fmt(executor_body.get('bridge_enabled'))}`")
        lines.append(f"- Bridge URL: `{_fmt(executor_body.get('bridge_url'))}`")
        lines.append(f"- Policy Source: `{_fmt(executor_body.get('retry_policy_source'))}`")
        retry_policy = executor_body.get("retry_policy")
        if isinstance(retry_policy, dict) and retry_policy:
            lines.append("- Retry Policy:")
            for key in sorted(retry_policy):
                lines.append(f"  - `{key}`: `{_fmt(retry_policy.get(key))}`")
    else:
        lines.append("- unavailable")
    lines.append("")

    return "\n".join(lines).strip() + "\n"


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Generate Yoyoo ops daily report from backend APIs")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--timeout-sec", type=float, default=10.0)
    parser.add_argument("--window-hours", type=float, default=24.0)
    parser.add_argument("--baseline-hours", type=float, default=168.0)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--output-dir", default="data/reports")
    parser.add_argument("--output-file", default="")
    parser.add_argument("--json-file", default="")
    return parser


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()

    generated_at = datetime.now(UTC).isoformat()
    timeout = httpx.Timeout(timeout=args.timeout_sec)
    with httpx.Client(timeout=timeout) as client:
        endpoint_results = [
            _fetch_json(client=client, base_url=args.base_url, name="health", path="/api/v1/ops/health"),
            _fetch_json(client=client, base_url=args.base_url, name="alerts", path="/api/v1/ops/alerts"),
            _fetch_json(
                client=client,
                base_url=args.base_url,
                name="failures",
                path="/api/v1/ops/failures",
                params={
                    "window_hours": args.window_hours,
                    "baseline_hours": args.baseline_hours,
                    "limit": args.limit,
                },
            ),
            _fetch_json(
                client=client,
                base_url=args.base_url,
                name="quality",
                path="/api/v1/ops/eval/quality",
                params={"window_hours": args.window_hours},
            ),
            _fetch_json(client=client, base_url=args.base_url, name="executor", path="/api/v1/ops/executor"),
        ]

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")

    md_path = Path(args.output_file) if args.output_file else output_dir / f"ops_daily_{ts}.md"
    json_path = Path(args.json_file) if args.json_file else output_dir / f"ops_daily_{ts}.json"

    markdown = _render_markdown(
        generated_at=generated_at,
        base_url=args.base_url,
        window_hours=args.window_hours,
        baseline_hours=args.baseline_hours,
        endpoint_results=endpoint_results,
    )
    md_path.write_text(markdown, encoding="utf-8")

    raw_payload = {
        "generated_at": generated_at,
        "base_url": args.base_url,
        "window_hours": args.window_hours,
        "baseline_hours": args.baseline_hours,
        "results": [
            {
                "name": item.name,
                "path": item.path,
                "ok": item.ok,
                "status_code": item.status_code,
                "error": item.error,
                "data": item.data,
            }
            for item in endpoint_results
        ],
    }
    json_path.write_text(json.dumps(raw_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    failed = [item for item in endpoint_results if not item.ok]
    print(f"[ops-report] markdown={md_path}")
    print(f"[ops-report] raw={json_path}")
    print(f"[ops-report] endpoint_ok={len(endpoint_results) - len(failed)}/{len(endpoint_results)}")
    if failed:
        print("[ops-report] failed_endpoints=" + ",".join(item.name for item in failed))


if __name__ == "__main__":
    main()
