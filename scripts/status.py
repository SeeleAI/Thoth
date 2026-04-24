#!/usr/bin/env python3
"""Thoth structured status printer for strict `.thoth` authority."""

from __future__ import annotations

import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from thoth.runtime import list_active_runs
from thoth.task_contracts import load_compiled_tasks, load_project_manifest, load_task_verdict


def load_config() -> dict[str, Any]:
    manifest = load_project_manifest(Path.cwd())
    return {
        "project": manifest.get("project", {}),
        "dashboard": manifest.get("dashboard", {}),
    }


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


def load_modules() -> dict[str, dict[str, Any]]:
    modules: dict[str, dict[str, Any]] = {}
    for task in load_tasks():
        module_id = str(task.get("module") or "strict")
        modules.setdefault(
            module_id,
            {
                "id": module_id,
                "name": module_id,
                "direction": task.get("direction", "general"),
                "scientific_question": task.get("goal_statement", ""),
            },
        )
    return modules


def load_milestones() -> list[dict[str, Any]]:
    path = Path.cwd() / ".agent-os" / "milestones.yaml"
    if not path.exists():
        return []
    try:
        import yaml

        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return []
    return data.get("milestones", []) if isinstance(data, dict) else []


def load_run_log_recent(n: int = 5) -> list[str]:
    log_path = Path.cwd() / ".agent-os" / "run-log.md"
    if not log_path.exists():
        return []
    content = log_path.read_text(encoding="utf-8")
    entries = re.findall(r"^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}.*?)(?=\n- \d{4}-|\Z)", content, re.MULTILINE | re.DOTALL)
    return entries[-n:] if entries else []


def load_todo_next() -> list[tuple[str, str, str]]:
    todo_path = Path.cwd() / ".agent-os" / "todo.md"
    if not todo_path.exists():
        return []
    content = todo_path.read_text(encoding="utf-8")
    return re.findall(r"^- `([^`]+)` `\[([^\]]+)\]`:\s*(.+)$", content, re.MULTILINE)[:5]


def task_current_phase(task: dict[str, Any]) -> tuple[str, str]:
    verdict = task.get("verdict") if isinstance(task.get("verdict"), dict) else {}
    if verdict.get("updated_at"):
        source = str(verdict.get("source") or "recorded")
        return "verdict", f"verdict:{source}"
    return "runtime", str(task.get("ready_state") or "blocked")


def task_progress_pct(task: dict[str, Any]) -> int:
    verdict = task.get("verdict") if isinstance(task.get("verdict"), dict) else {}
    if verdict.get("updated_at"):
        return 100
    ready_state = str(task.get("ready_state") or "blocked")
    if ready_state == "ready":
        return 15
    if ready_state == "imported_resolved":
        return 100
    if ready_state == "blocked":
        return 5
    return 0


def progress_bar(pct: int, width: int = 10) -> str:
    filled = int(round(pct * width / 100))
    filled = max(0, min(width, filled))
    return "[" + "\u25a0" * filled + "\u25a1" * (width - filled) + "]"


def time_ago(iso_str: str | None) -> str:
    if not iso_str:
        return "unknown"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except ValueError:
        return "unknown"
    now = datetime.now(timezone.utc)
    delta = now - dt
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return f"{seconds}s ago"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}min ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


def is_task_completed(task: dict[str, Any]) -> bool:
    verdict = task.get("verdict") if isinstance(task.get("verdict"), dict) else {}
    return bool(verdict.get("updated_at"))


def is_task_blocked(task: dict[str, Any], all_tasks: list[dict[str, Any]]) -> tuple[bool, list[str]]:
    if task.get("ready_state") in {"blocked", "invalid"}:
        deps = task.get("depends_on")
        if isinstance(deps, list):
            return True, [str(dep.get("task_id")) for dep in deps if isinstance(dep, dict) and dep.get("type") == "hard"]
        return True, []
    completed_ids = {str(row.get("task_id") or row.get("id")) for row in all_tasks if is_task_completed(row)}
    blockers: list[str] = []
    for dep in task.get("depends_on", []):
        if isinstance(dep, dict) and dep.get("type") == "hard" and dep.get("task_id") not in completed_ids:
            blockers.append(str(dep["task_id"]))
    return bool(blockers), blockers


def quick_health() -> tuple[bool, str]:
    manifest = Path.cwd() / ".thoth" / "project" / "project.json"
    compiler = Path.cwd() / ".thoth" / "project" / "compiler-state.json"
    if not manifest.exists() or not compiler.exists():
        return False, "Missing strict Thoth authority files"
    entries = load_run_log_recent(1)
    if entries:
        match = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", entries[-1])
        if match:
            return True, f"Last run-log update: {time_ago(match.group(1))}"
    return True, "Strict authority present"


def render_status(full: bool = False) -> str:
    config = load_config()
    project_name = config.get("project", {}).get("name", "Unknown Project")
    tasks = load_tasks()
    lines: list[str] = []
    lines.append(f"═══ Thoth Status: {project_name} ═══")
    lines.append("")

    if not tasks:
        lines.append("  No strict tasks found.")
        lines.append("")
        healthy, health_msg = quick_health()
        health_icon = "●" if healthy else "○"
        health_label = "ALL CHECKS PASSED" if healthy else "ISSUES DETECTED"
        lines.append(f"▸ Health: {health_icon} {health_label} | {health_msg}")
        return "\n".join(lines)

    active_runs = list_active_runs(Path.cwd())
    lines.append("▸ Running:")
    if active_runs:
        for run in active_runs:
            lines.append(
                f"  {progress_bar(int(run.get('progress_pct', 0)))} {int(run.get('progress_pct', 0)):>3}%  "
                f"{run.get('run_id')} {run.get('kind')} ({run.get('phase')})"
            )
    else:
        lines.append("  (none)")
    lines.append("")

    completed = [task for task in tasks if is_task_completed(task)]
    lines.append("▸ Recent:")
    if completed:
        for task in completed[-3:]:
            verdict = task.get("verdict", {})
            lines.append(
                f"  ✓ {task.get('task_id')} {task.get('title', '')} -- "
                f"{verdict.get('source', 'recorded')} {time_ago(verdict.get('updated_at'))}"
            )
    else:
        lines.append("  (none)")
    lines.append("")

    blocked = [task for task in tasks if task.get("ready_state") in {"blocked", "invalid"}]
    lines.append("▸ Next:")
    if blocked:
        for task in blocked[:5]:
            lines.append(f"  - {task.get('task_id')} {task.get('blocking_reason') or task.get('ready_state')}")
    else:
        lines.append("  - No blocked strict tasks.")
    lines.append("")

    healthy, health_msg = quick_health()
    health_icon = "●" if healthy else "○"
    health_label = "ALL CHECKS PASSED" if healthy else "ISSUES DETECTED"
    lines.append(f"▸ Health: {health_icon} {health_label} | {health_msg}")

    if full:
        lines.append("")
        lines.append("▸ Todo:")
        todo_entries = load_todo_next()
        if todo_entries:
            for entry_id, entry_status, description in todo_entries:
                lines.append(f"  - {entry_id} [{entry_status}] {description}")
        else:
            lines.append("  (none)")
    return "\n".join(lines)


def main() -> int:
    if not (Path.cwd() / ".thoth" / "project" / "project.json").exists():
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1
    print(render_status(full="--full" in sys.argv))
    return 0


if __name__ == "__main__":
    sys.exit(main())
