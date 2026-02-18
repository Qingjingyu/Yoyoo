#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path


@dataclass(slots=True)
class FileState:
    path: str
    exists: bool
    readable_json: bool
    size_bytes: int
    error: str | None = None


def _check_json_file(path: Path) -> FileState:
    if not path.exists():
        return FileState(
            path=str(path),
            exists=False,
            readable_json=False,
            size_bytes=0,
            error="missing",
        )
    try:
        raw = path.read_text(encoding="utf-8")
        json.loads(raw)
        return FileState(
            path=str(path),
            exists=True,
            readable_json=True,
            size_bytes=path.stat().st_size,
            error=None,
        )
    except Exception as exc:  # noqa: BLE001
        return FileState(
            path=str(path),
            exists=True,
            readable_json=False,
            size_bytes=path.stat().st_size if path.exists() else 0,
            error=str(exc),
        )


def _default_memory_file() -> Path:
    env = os.getenv("YOYOO_MEMORY_FILE", "").strip()
    if env:
        return Path(env)
    return Path("data/yoyoo_memory.json")


def run_check(memory_file: Path) -> int:
    backups = [memory_file.with_suffix(memory_file.suffix + f".bak{i}") for i in range(1, 4)]
    states = [_check_json_file(memory_file)] + [_check_json_file(item) for item in backups]
    payload = {
        "ok": all(item.readable_json for item in states if item.exists),
        "memory_file": str(memory_file),
        "checked_at": datetime.now(UTC).isoformat(),
        "files": [asdict(item) for item in states],
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if payload["ok"] else 1


def run_restore(memory_file: Path, backup_index: int) -> int:
    if backup_index < 1 or backup_index > 3:
        raise ValueError("backup_index must be 1..3")
    source = memory_file.with_suffix(memory_file.suffix + f".bak{backup_index}")
    source_state = _check_json_file(source)
    if not source_state.exists or not source_state.readable_json:
        print(
            json.dumps(
                {
                    "ok": False,
                    "action": "restore",
                    "source": str(source),
                    "error": source_state.error or "backup not available",
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 1

    memory_file.parent.mkdir(parents=True, exist_ok=True)
    if memory_file.exists():
        stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
        snapshot = memory_file.with_suffix(memory_file.suffix + f".manual_{stamp}.bak")
        shutil.copy2(memory_file, snapshot)
    shutil.copy2(source, memory_file)
    target_state = _check_json_file(memory_file)
    payload = {
        "ok": target_state.readable_json,
        "action": "restore",
        "source": str(source),
        "target": str(memory_file),
        "restored_at": datetime.now(UTC).isoformat(),
        "target_state": asdict(target_state),
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0 if target_state.readable_json else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Yoyoo memory backup/recovery checker")
    parser.add_argument("--memory-file", default=None, help="Path to yoyoo_memory.json")
    parser.add_argument(
        "--restore-from",
        type=int,
        default=None,
        help="Restore from backup index: 1|2|3",
    )
    args = parser.parse_args()

    memory_file = Path(args.memory_file) if args.memory_file else _default_memory_file()
    if args.restore_from is None:
        return run_check(memory_file)
    return run_restore(memory_file, args.restore_from)


if __name__ == "__main__":
    sys.exit(main())
