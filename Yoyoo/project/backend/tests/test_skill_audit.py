from __future__ import annotations

import json
from pathlib import Path

from scripts.skill_audit import run_skill_audit


def _write_skill(root: Path, name: str) -> None:
    path = root / name
    path.mkdir(parents=True, exist_ok=True)
    (path / "SKILL.md").write_text("# test\n", encoding="utf-8")


def test_run_skill_audit_marks_allowed_unknown_blocked(tmp_path: Path) -> None:
    skills_root = tmp_path / "skills"
    skills_root.mkdir()
    _write_skill(skills_root, "yoyoo-brain-dev")
    _write_skill(skills_root, "weird-skill")
    _write_skill(skills_root, "oauth-spoof-demo")

    allowlist_path = tmp_path / "allowlist.json"
    allowlist_path.write_text(
        json.dumps(
            {
                "strict_mode": False,
                "allowed_names": ["yoyoo-brain-dev"],
                "allowed_prefixes": [],
                "allowed_patterns": [],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
    blocklist_path = tmp_path / "blocklist.json"
    blocklist_path.write_text(
        json.dumps(
            {
                "blocked_names": [],
                "blocked_patterns": ["(?i)oauth[_-]?spoof"],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    result = run_skill_audit(
        skills_root=skills_root,
        allowlist_path=allowlist_path,
        blocklist_path=blocklist_path,
    )
    by_name = {item["name"]: item for item in result["items"]}

    assert result["skill_total"] == 3
    assert by_name["yoyoo-brain-dev"]["status"] == "allowed"
    assert by_name["oauth-spoof-demo"]["status"] == "blocked"
    assert by_name["weird-skill"]["status"] == "unknown"
