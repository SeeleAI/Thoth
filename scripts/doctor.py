#!/usr/bin/env python3
"""Wrapper for the canonical Thoth doctor command."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from thoth.plan.doctor import build_doctor_payload, render_doctor_text
from thoth.plan.store import load_compiled_tasks


REQUIRED_AGENT_OS_FILES = [
    "project-index.md",
    "requirements.md",
    "architecture-milestones.md",
    "todo.md",
    "cross-repo-mapping.md",
    "acceptance-report.md",
    "lessons-learned.md",
    "run-log.md",
    "change-decisions.md",
]


def check_required_files() -> tuple[bool, str]:
    root = Path.cwd()
    missing = [name for name in REQUIRED_AGENT_OS_FILES if not (root / ".agent-os" / name).exists()]
    if missing:
        return False, "Missing required .agent-os files: " + ", ".join(missing)
    return True, "PASS required .agent-os files present"


def check_id_integrity() -> tuple[bool, str]:
    tasks = load_compiled_tasks(Path.cwd())
    ids = [str(task.get("task_id") or task.get("id")) for task in tasks if task.get("task_id") or task.get("id")]
    if not ids:
        return True, "PASS no strict tasks found"
    duplicates = sorted({item for item in ids if ids.count(item) > 1})
    if duplicates:
        return False, "Duplicate strict task ids: " + ", ".join(duplicates)
    return True, f"PASS {len(ids)} unique strict task ids"


def main() -> int:
    parser = argparse.ArgumentParser(description="Thoth doctor")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    payload = build_doctor_payload(Path.cwd())
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_doctor_text(payload), end="")
    return 0 if payload.get("overall_ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
