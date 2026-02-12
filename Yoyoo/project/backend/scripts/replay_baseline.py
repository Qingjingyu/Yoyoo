#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path


def _assert_step(
    case_name: str,
    step_idx: int,
    body: dict[str, object],
    expect: dict[str, object],
) -> None:
    intent = expect.get("intent")
    if isinstance(intent, str):
        assert body.get("intent") == intent, (
            f"[{case_name}#{step_idx}] intent mismatch: expected={intent}, got={body.get('intent')}"
        )
    has_task_id = expect.get("has_task_id")
    if has_task_id is True:
        assert isinstance(body.get("task_id"), str) and body.get("task_id"), (
            f"[{case_name}#{step_idx}] expected task_id"
        )
    contains = expect.get("reply_contains")
    if isinstance(contains, list):
        reply = str(body.get("reply") or "")
        for item in contains:
            if isinstance(item, str):
                assert item in reply, (
                    f"[{case_name}#{step_idx}] reply missing token: {item}"
                )


def main() -> int:
    root_dir = Path(__file__).resolve().parents[1]
    if str(root_dir) not in sys.path:
        sys.path.insert(0, str(root_dir))

    from fastapi.testclient import TestClient

    from app.container import build_container
    from app.main import app

    parser = argparse.ArgumentParser(description="Replay frozen chat baseline cases.")
    parser.add_argument(
        "--cases",
        default="./baseline/chat_regression_cases.json",
        help="Path to baseline cases JSON.",
    )
    args = parser.parse_args()

    cases_path = Path(args.cases)
    payload = json.loads(cases_path.read_text(encoding="utf-8"))
    cases = payload.get("cases", [])
    if not isinstance(cases, list) or not cases:
        raise ValueError("baseline cases is empty")

    with tempfile.TemporaryDirectory(prefix="yoyoo_baseline_") as tmp_dir:
        memory_file = Path(tmp_dir) / "memory.json"
        os.environ["YOYOO_MEMORY_FILE"] = str(memory_file)
        app.state.container = build_container()
        client = TestClient(app)

        total_steps = 0
        for case in cases:
            if not isinstance(case, dict):
                continue
            case_name = str(case.get("name") or "unnamed")
            steps = case.get("steps")
            if not isinstance(steps, list):
                continue
            for idx, step in enumerate(steps, start=1):
                if not isinstance(step, dict):
                    continue
                user_id = str(step.get("user_id") or "")
                message = str(step.get("message") or "")
                expect = step.get("expect") or {}
                response = client.post(
                    "/api/v1/chat",
                    json={"user_id": user_id, "message": message},
                )
                assert response.status_code == 200, (
                    f"[{case_name}#{idx}] status={response.status_code}"
                )
                body = response.json()
                _assert_step(case_name, idx, body, expect if isinstance(expect, dict) else {})
                total_steps += 1

    print(f"baseline replay passed: {len(cases)} cases, {total_steps} steps")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
