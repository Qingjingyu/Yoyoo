#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    root_dir = Path(__file__).resolve().parents[1]
    if str(root_dir) not in sys.path:
        sys.path.insert(0, str(root_dir))
    from app.intelligence.memory_archive import archive_memory_file

    parser = argparse.ArgumentParser(
        description="Archive and compact old memory tasks into daily archive files."
    )
    parser.add_argument(
        "--memory-file",
        default="./data/yoyoo_memory.json",
        help="Path to yoyoo memory file.",
    )
    parser.add_argument(
        "--archive-dir",
        default="./data/archive",
        help="Directory for archived snapshots.",
    )
    parser.add_argument(
        "--keep-days",
        type=int,
        default=14,
        help="Keep recent tasks in primary memory file.",
    )
    args = parser.parse_args()

    result = archive_memory_file(
        memory_file=args.memory_file,
        archive_dir=args.archive_dir,
        keep_days=args.keep_days,
    )
    output = {
        "memory_file": str(Path(args.memory_file)),
        "archive_dir": str(Path(args.archive_dir)),
        "keep_days": args.keep_days,
        "archive_file": result.archive_file,
        "archived_task_count": result.archived_task_count,
        "remaining_task_count": result.remaining_task_count,
        "pruned_external_map_count": result.pruned_external_map_count,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
