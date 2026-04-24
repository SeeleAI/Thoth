#!/usr/bin/env python3
"""Thoth persistence audit helpers for strict `.thoth` authority."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from thoth.task_contracts import build_doctor_payload, load_compiler_state, load_compiled_tasks, render_doctor_text


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
    agent_os = Path.cwd() / ".agent-os"
    missing = [fname for fname in REQUIRED_AGENT_OS_FILES if not (agent_os / fname).exists()]
    if missing:
        return False, f"FAIL (missing: {', '.join(missing)})"
    return True, f"PASS ({len(REQUIRED_AGENT_OS_FILES)}/{len(REQUIRED_AGENT_OS_FILES)})"


def check_id_integrity() -> tuple[bool, str]:
    tasks = load_compiled_tasks(Path.cwd())
    if not tasks:
        return True, "PASS (no strict tasks)"
    seen: set[str] = set()
    duplicates: list[str] = []
    for task in tasks:
        task_id = task.get("task_id")
        if not isinstance(task_id, str) or not task_id:
            continue
        if task_id in seen:
            duplicates.append(task_id)
        seen.add(task_id)
    if duplicates:
        return False, f"FAIL (duplicates: {', '.join(sorted(set(duplicates)))})"
    return True, f"PASS ({len(seen)} unique IDs)"


def main() -> int:
    if not (Path.cwd() / ".thoth" / "project" / "project.json").exists():
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1
    payload = build_doctor_payload(Path.cwd())
    print(render_doctor_text(payload), end="")
    return 0 if payload.get("overall_ok") else 1


if __name__ == "__main__":
    sys.exit(main())
