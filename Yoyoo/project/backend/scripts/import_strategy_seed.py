#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ScopePair:
    user_id: str
    channel: str


def _normalize_scope_value(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())[:64]


def _load_json(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"invalid json root in {path}")
    return payload


def _discover_scope_pairs(
    *,
    memory_payload: dict[str, Any],
    only_users: set[str],
    only_channels: set[str],
) -> list[ScopePair]:
    tasks = memory_payload.get("tasks", {})
    if not isinstance(tasks, dict):
        return []
    pairs: set[tuple[str, str]] = set()
    for item in tasks.values():
        if not isinstance(item, dict):
            continue
        user_id = str(item.get("user_id") or "").strip()
        channel = str(item.get("channel") or "").strip()
        if not user_id or not channel:
            continue
        if only_users and user_id not in only_users:
            continue
        if only_channels and channel not in only_channels:
            continue
        pairs.add((user_id, channel))
    return [ScopePair(user_id=u, channel=c) for u, c in sorted(pairs)]


def _build_card_id(*, scope: str, template_id: str) -> str:
    raw = f"seed_{scope}_{template_id}"
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", raw)[:160]


def import_seed(
    *,
    memory_file: Path,
    seed_file: Path,
    only_users: set[str],
    only_channels: set[str],
    overwrite: bool,
    dry_run: bool,
) -> dict[str, Any]:
    memory_payload = _load_json(memory_file)
    seed_payload = _load_json(seed_file)
    templates = seed_payload.get("templates", [])
    if not isinstance(templates, list) or not templates:
        raise ValueError("seed templates is empty")

    pairs = _discover_scope_pairs(
        memory_payload=memory_payload,
        only_users=only_users,
        only_channels=only_channels,
    )
    if not pairs:
        raise ValueError("no scope pair discovered from memory tasks")

    strategy_cards = memory_payload.get("strategy_cards")
    if not isinstance(strategy_cards, dict):
        strategy_cards = {}
        memory_payload["strategy_cards"] = strategy_cards

    now_iso = datetime.now(UTC).isoformat()
    added = 0
    updated = 0
    skipped = 0

    for pair in pairs:
        normalized_user = _normalize_scope_value(pair.user_id) or "global"
        normalized_channel = _normalize_scope_value(pair.channel) or "global"
        scopes = [
            f"{normalized_user}|{normalized_channel}|general",
            f"{normalized_user}|global|general",
        ]
        for scope in scopes:
            for template in templates:
                if not isinstance(template, dict):
                    continue
                template_id = str(template.get("template_id") or "").strip()
                tag = str(template.get("tag") or "general").strip()
                if not template_id:
                    continue
                card_id = _build_card_id(scope=scope, template_id=template_id)
                existing = strategy_cards.get(card_id)
                if existing is not None and not overwrite:
                    skipped += 1
                    continue
                created_at = (
                    str(existing.get("created_at"))
                    if isinstance(existing, dict) and existing.get("created_at")
                    else now_iso
                )
                card = {
                    "scope": scope,
                    "tag": tag,
                    "title": str(template.get("title") or template_id),
                    "summary": str(template.get("summary") or ""),
                    "trigger_tags": list(template.get("trigger_tags") or [tag, "task_request"]),
                    "recommended_steps": list(template.get("recommended_steps") or []),
                    "cautions": list(template.get("cautions") or []),
                    "evidence_requirements": list(template.get("evidence_requirements") or []),
                    "confidence": float(template.get("confidence") or 0.72),
                    "source": f"seed_research_v1_{seed_payload.get('version', 'unknown')}",
                    "created_at": created_at,
                    "updated_at": now_iso,
                }
                strategy_cards[card_id] = card
                if existing is None:
                    added += 1
                else:
                    updated += 1

    if not dry_run:
        memory_file.write_text(
            json.dumps(memory_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return {
        "memory_file": str(memory_file),
        "seed_file": str(seed_file),
        "scope_pairs": [f"{p.user_id}|{p.channel}" for p in pairs],
        "templates_count": len(templates),
        "added": added,
        "updated": updated,
        "skipped": skipped,
        "dry_run": dry_run,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import research seed strategy cards into yoyoo_memory.json"
    )
    parser.add_argument(
        "--memory-file",
        required=True,
        help="Path to yoyoo memory json file",
    )
    parser.add_argument(
        "--seed-file",
        required=True,
        help="Path to seed strategy cards json file",
    )
    parser.add_argument(
        "--only-user",
        action="append",
        default=[],
        help="Limit to specific user_id (repeatable)",
    )
    parser.add_argument(
        "--only-channel",
        action="append",
        default=[],
        help="Limit to specific channel, e.g. dingtalk/api (repeatable)",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Overwrite existing cards with the same generated card_id",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show import summary without writing memory file",
    )
    args = parser.parse_args()

    result = import_seed(
        memory_file=Path(args.memory_file),
        seed_file=Path(args.seed_file),
        only_users={str(item).strip() for item in args.only_user if str(item).strip()},
        only_channels={str(item).strip() for item in args.only_channel if str(item).strip()},
        overwrite=bool(args.overwrite),
        dry_run=bool(args.dry_run),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
