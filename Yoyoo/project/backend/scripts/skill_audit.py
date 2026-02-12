#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class SkillAuditItem:
    name: str
    status: str
    reason: str
    path: str


def _load_json(path: Path, default: dict[str, Any]) -> dict[str, Any]:
    if not path.exists():
        return dict(default)
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dict(default)
    return data if isinstance(data, dict) else dict(default)


def _list_skills(skills_root: Path) -> list[tuple[str, Path]]:
    if not skills_root.exists():
        return []
    items: list[tuple[str, Path]] = []
    for child in sorted(skills_root.iterdir()):
        if not child.is_dir():
            continue
        skill_md = child / "SKILL.md"
        if not skill_md.exists():
            continue
        items.append((child.name, child))
    return items


def _is_allowed(name: str, allowlist: dict[str, Any]) -> tuple[bool, str]:
    allowed_names = {str(item) for item in allowlist.get("allowed_names", [])}
    if name in allowed_names:
        return True, "allowed_name"

    for prefix in allowlist.get("allowed_prefixes", []):
        text = str(prefix)
        if text and name.startswith(text):
            return True, f"allowed_prefix:{text}"

    for pattern in allowlist.get("allowed_patterns", []):
        text = str(pattern)
        if text and re.search(text, name):
            return True, f"allowed_pattern:{text}"
    return False, "not_in_allowlist"


def _is_blocked(name: str, blocklist: dict[str, Any]) -> tuple[bool, str]:
    blocked_names = {str(item) for item in blocklist.get("blocked_names", [])}
    if name in blocked_names:
        return True, "blocked_name"
    for pattern in blocklist.get("blocked_patterns", []):
        text = str(pattern)
        if text and re.search(text, name):
            return True, f"blocked_pattern:{text}"
    return False, ""


def run_skill_audit(
    *,
    skills_root: Path,
    allowlist_path: Path,
    blocklist_path: Path,
) -> dict[str, Any]:
    allowlist = _load_json(allowlist_path, default={"strict_mode": False})
    blocklist = _load_json(blocklist_path, default={})
    strict_mode = bool(allowlist.get("strict_mode", False))
    skills = _list_skills(skills_root=skills_root)

    items: list[SkillAuditItem] = []
    for name, path in skills:
        blocked, blocked_reason = _is_blocked(name=name, blocklist=blocklist)
        if blocked:
            items.append(
                SkillAuditItem(
                    name=name,
                    status="blocked",
                    reason=blocked_reason,
                    path=str(path),
                )
            )
            continue
        allowed, allowed_reason = _is_allowed(name=name, allowlist=allowlist)
        if allowed:
            items.append(
                SkillAuditItem(
                    name=name,
                    status="allowed",
                    reason=allowed_reason,
                    path=str(path),
                )
            )
            continue
        items.append(
            SkillAuditItem(
                name=name,
                status="unknown_strict" if strict_mode else "unknown",
                reason="not_matched",
                path=str(path),
            )
        )

    blocked_total = sum(1 for item in items if item.status == "blocked")
    unknown_total = sum(1 for item in items if item.status.startswith("unknown"))
    return {
        "skills_root": str(skills_root),
        "allowlist_path": str(allowlist_path),
        "blocklist_path": str(blocklist_path),
        "strict_mode": strict_mode,
        "skill_total": len(items),
        "blocked_total": blocked_total,
        "unknown_total": unknown_total,
        "items": [
            {
                "name": item.name,
                "status": item.status,
                "reason": item.reason,
                "path": item.path,
            }
            for item in items
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit installed skills by allowlist/blocklist")
    parser.add_argument(
        "--skills-root",
        default=str(Path.home() / ".codex/skills"),
        help="Root folder of installed skills",
    )
    parser.add_argument(
        "--allowlist",
        default="./config/skill_allowlist.json",
        help="Allowlist json file path",
    )
    parser.add_argument(
        "--blocklist",
        default="./config/skill_blocklist.json",
        help="Blocklist json file path",
    )
    parser.add_argument(
        "--fail-on-violation",
        action="store_true",
        help="Exit non-zero when blocked/unknown(strict) skills exist",
    )
    args = parser.parse_args()

    result = run_skill_audit(
        skills_root=Path(args.skills_root),
        allowlist_path=Path(args.allowlist),
        blocklist_path=Path(args.blocklist),
    )
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if args.fail_on_violation:
        strict_mode = bool(result.get("strict_mode"))
        blocked_total = int(result.get("blocked_total") or 0)
        unknown_total = int(result.get("unknown_total") or 0)
        if blocked_total > 0 or (strict_mode and unknown_total > 0):
            raise SystemExit(2)


if __name__ == "__main__":
    main()
