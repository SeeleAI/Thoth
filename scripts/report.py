#!/usr/bin/env python3
"""Thoth progress report generator for strict `.thoth` authority."""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from thoth.task_contracts import load_compiled_tasks, load_project_manifest, load_task_verdict


def load_tasks() -> list[dict[str, Any]]:
    tasks = []
    for task in load_compiled_tasks(Path.cwd()):
        task_id = task.get("task_id")
        if isinstance(task_id, str) and task_id:
            verdict = load_task_verdict(Path.cwd(), task_id)
            if verdict:
                task["verdict"] = verdict
        tasks.append(task)
    return tasks


def load_run_log() -> str:
    path = Path.cwd() / ".agent-os" / "run-log.md"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def parse_run_log_entries(content: str, from_date: datetime, to_date: datetime) -> list[str]:
    entries: list[str] = []
    current: list[str] = []
    current_dt: datetime | None = None
    for line in content.splitlines():
        if line.startswith("- "):
            if current and current_dt is not None and from_date <= current_dt <= to_date:
                entries.append("\n".join(current))
            current = [line]
            current_dt = None
            header = line[2:18]
            try:
                current_dt = datetime.strptime(header, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            except ValueError:
                current_dt = None
            continue
        if current:
            current.append(line)
    if current and current_dt is not None and from_date <= current_dt <= to_date:
        entries.append("\n".join(current))
    return entries


def task_current_phase(task: dict[str, Any]) -> tuple[str, str]:
    verdict = task.get("verdict") if isinstance(task.get("verdict"), dict) else {}
    if verdict.get("updated_at"):
        return "verdict", str(verdict.get("source") or "recorded")
    state = str(task.get("ready_state") or "blocked")
    return ("runtime", state)


def is_task_completed(task: dict[str, Any]) -> bool:
    verdict = task.get("verdict") if isinstance(task.get("verdict"), dict) else {}
    return bool(verdict.get("updated_at"))


def task_completed_in_range(task: dict[str, Any], from_date: datetime, to_date: datetime) -> bool:
    verdict = task.get("verdict") if isinstance(task.get("verdict"), dict) else {}
    updated_at = verdict.get("updated_at")
    if not isinstance(updated_at, str) or not updated_at:
        return False
    try:
        dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    return from_date <= dt <= to_date


def task_created_in_range(task: dict[str, Any], from_date: datetime, to_date: datetime) -> bool:
    created_at = task.get("generated_at") or task.get("created_at")
    if not isinstance(created_at, str) or not created_at:
        return False
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    return from_date <= dt <= to_date


def generate_report(from_date: datetime, to_date: datetime, output_path: Path) -> None:
    manifest = load_project_manifest(Path.cwd())
    project_name = manifest.get("project", {}).get("name", "Unknown Project")
    tasks = load_tasks()
    run_log_entries = parse_run_log_entries(load_run_log(), from_date, to_date)

    completed_in_range = [task for task in tasks if task_completed_in_range(task, from_date, to_date)]
    in_progress = [task for task in tasks if task.get("ready_state") == "ready"]
    blocked = [task for task in tasks if task.get("ready_state") in {"blocked", "invalid"}]
    total_completed = sum(1 for task in tasks if is_task_completed(task))
    total = len(tasks)
    overall_pct = int(round((100 * total_completed / total), 0)) if total else 0

    lines: list[str] = []
    lines.append(f"# Progress Report: {from_date.strftime('%Y-%m-%d')} -- {to_date.strftime('%Y-%m-%d')}")
    lines.append("")
    lines.append(f"**Project:** {project_name}")
    lines.append(f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")
    lines.append("## Summary")
    lines.append(f"- Tasks completed in period: {len(completed_in_range)}")
    lines.append(f"- Tasks in progress: {len(in_progress)}")
    lines.append(f"- Tasks blocked or invalid: {len(blocked)}")
    lines.append(f"- Overall progress: {overall_pct}% ({total_completed}/{total})")
    lines.append("")

    lines.append("## Completed")
    lines.append("")
    if completed_in_range:
        for task in completed_in_range:
            verdict = task.get("verdict", {})
            lines.append(f"### [{task.get('task_id')}] {task.get('title', '')}")
            lines.append(f"- Status: {task.get('ready_state')}")
            lines.append(f"- Verdict source: {verdict.get('source', 'unknown')}")
            lines.append(f"- Conclusion: {verdict.get('conclusion') or 'No conclusion text'}")
            for evidence in verdict.get("evidence_paths", []):
                lines.append(f"- Evidence: [{evidence}]({evidence})")
    else:
        lines.append("No tasks completed in the selected range.")
    lines.append("")

    lines.append("## In Progress")
    lines.append("")
    if in_progress:
        for task in in_progress:
            lines.append(f"- `{task.get('task_id')}` {task.get('title', '')}")
    else:
        lines.append("No ready tasks at the moment.")
    lines.append("")

    lines.append("## Blockers & Risks")
    lines.append("")
    if blocked:
        for task in blocked:
            lines.append(f"- `{task.get('task_id')}` {task.get('blocking_reason') or task.get('ready_state')}")
    else:
        lines.append("No blocked tasks.")
    lines.append("")

    lines.append("## Run Log Highlights")
    lines.append("")
    if run_log_entries:
        lines.extend(run_log_entries[:10])
    else:
        lines.append("No run-log entries in the selected range.")
    lines.append("")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser(description="Thoth report generator")
    parser.add_argument("--from", dest="date_from", required=True)
    parser.add_argument("--to", dest="date_to", required=True)
    parser.add_argument("--output", default=None)
    args = parser.parse_args()

    manifest = load_project_manifest(Path.cwd())
    if not manifest:
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1

    from_date = datetime.fromisoformat(args.date_from).replace(tzinfo=timezone.utc)
    to_date = datetime.fromisoformat(args.date_to).replace(tzinfo=timezone.utc)
    output_path = Path(args.output) if args.output else (Path.cwd() / "reports" / f"{args.date_to}-report.md")
    generate_report(from_date, to_date, output_path)
    print(f"Report written to {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
