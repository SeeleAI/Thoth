"""Canonical status read model and renderer."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from thoth.plan.store import load_compiled_tasks, load_project_manifest, load_task_result
from thoth.run.lifecycle import list_active_runs


def load_config(project_root: Path) -> dict[str, Any]:
    manifest = load_project_manifest(project_root)
    return {
        "project": manifest.get("project", {}),
        "dashboard": manifest.get("dashboard", {}),
    }


def load_tasks(project_root: Path) -> list[dict[str, Any]]:
    tasks = []
    for task in load_compiled_tasks(project_root):
        task_id = task.get("task_id")
        if isinstance(task_id, str) and task_id:
            task_result = load_task_result(project_root, task_id)
            if task_result:
                task["task_result"] = task_result
        tasks.append(task)
    return tasks


def load_milestones(project_root: Path) -> list[dict[str, Any]]:
    path = project_root / ".agent-os" / "milestones.yaml"
    if not path.exists():
        return []
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return []
    return data.get("milestones", []) if isinstance(data, dict) else []


def load_run_log_recent(project_root: Path, n: int = 5) -> list[str]:
    log_path = project_root / ".agent-os" / "run-log.md"
    if not log_path.exists():
        return []
    content = log_path.read_text(encoding="utf-8")
    entries = re.findall(r"^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}.*?)(?=\n- \d{4}-|\Z)", content, re.MULTILINE | re.DOTALL)
    return entries[-n:] if entries else []


def load_todo_next(project_root: Path) -> list[tuple[str, str, str]]:
    todo_path = project_root / ".agent-os" / "todo.md"
    if not todo_path.exists():
        return []
    content = todo_path.read_text(encoding="utf-8")
    return re.findall(r"^- `([^`]+)` `\[([^\]]+)\]`:\s*(.+)$", content, re.MULTILINE)[:5]


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
    task_result = task.get("task_result") if isinstance(task.get("task_result"), dict) else {}
    return bool(task_result.get("updated_at"))


def quick_health(project_root: Path) -> tuple[bool, str]:
    manifest = project_root / ".thoth" / "project" / "project.json"
    compiler = project_root / ".thoth" / "project" / "compiler-state.json"
    if not manifest.exists() or not compiler.exists():
        return False, "Missing strict Thoth authority files"
    entries = load_run_log_recent(project_root, 1)
    if entries:
        match = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", entries[-1])
        if match:
            return True, f"Last run-log update: {time_ago(match.group(1))}"
    return True, "Strict authority present"


def status_snapshot(project_root: Path) -> dict[str, Any]:
    tasks = load_tasks(project_root)
    active_runs = list_active_runs(project_root)
    completed = [task for task in tasks if is_task_completed(task)]
    blocked = [task for task in tasks if task.get("ready_state") in {"blocked", "invalid"}]
    healthy, health_msg = quick_health(project_root)
    return {
        "project_root": str(project_root.resolve()),
        "config": load_config(project_root),
        "task_count": len(tasks),
        "active_runs": active_runs,
        "completed_task_count": len(completed),
        "blocked_task_count": len(blocked),
        "healthy": healthy,
        "health_message": health_msg,
        "todo_next": load_todo_next(project_root),
        "recent_run_log": load_run_log_recent(project_root),
    }


def render_status(project_root: Path, *, full: bool = False) -> str:
    config = load_config(project_root)
    project_name = config.get("project", {}).get("name", "Unknown Project")
    tasks = load_tasks(project_root)
    lines: list[str] = []
    lines.append(f"═══ Thoth Status: {project_name} ═══")
    lines.append("")

    if not tasks:
        lines.append("  No strict tasks found.")
        lines.append("")
        healthy, health_msg = quick_health(project_root)
        lines.append(f"▸ Health: {'●' if healthy else '○'} {'ALL CHECKS PASSED' if healthy else 'ISSUES DETECTED'} | {health_msg}")
        return "\n".join(lines)

    active_runs = list_active_runs(project_root)
    lines.append("▸ Running:")
    if active_runs:
        for run in active_runs:
            lines.append(f"  {progress_bar(int(run.get('progress_pct', 0) or 0))} {int(run.get('progress_pct', 0) or 0):>3}%  {run.get('run_id')} {run.get('kind')} ({run.get('phase')})")
    else:
        lines.append("  (none)")
    lines.append("")

    completed = [task for task in tasks if is_task_completed(task)]
    lines.append("▸ Recent:")
    if completed:
        for task in completed[-3:]:
            task_result = task.get("task_result", {})
            lines.append(f"  ✓ {task.get('task_id')} {task.get('title', '')} -- {task_result.get('source', 'recorded')} {time_ago(task_result.get('updated_at'))}")
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

    healthy, health_msg = quick_health(project_root)
    lines.append(f"▸ Health: {'●' if healthy else '○'} {'ALL CHECKS PASSED' if healthy else 'ISSUES DETECTED'} | {health_msg}")

    if full:
        lines.append("")
        lines.append("▸ Todo:")
        todo_entries = load_todo_next(project_root)
        if todo_entries:
            for entry_id, entry_status, description in todo_entries:
                lines.append(f"  - {entry_id} [{entry_status}] {description}")
        else:
            lines.append("  (none)")
    return "\n".join(lines)


def main() -> int:
    project_root = Path.cwd()
    if not (project_root / ".thoth" / "project" / "project.json").exists():
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1
    import sys

    print(render_status(project_root, full="--full" in sys.argv))
    return 0
