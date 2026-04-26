"""Pure read model shared by status, report, and dashboard-facing views."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from thoth.plan.store import load_compiled_tasks, load_project_manifest, load_task_result
from thoth.run.service import list_active_runs


def load_config(project_root: Path) -> dict[str, Any]:
    manifest = load_project_manifest(project_root)
    return {"project": manifest.get("project", {}), "dashboard": manifest.get("dashboard", {})}


def load_tasks(project_root: Path) -> list[dict[str, Any]]:
    tasks = []
    for task in load_compiled_tasks(project_root):
        item = dict(task)
        task_id = item.get("task_id")
        if isinstance(task_id, str) and task_id:
            task_result = load_task_result(project_root, task_id)
            if task_result:
                item["task_result"] = task_result
        tasks.append(item)
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


def load_run_log(project_root: Path) -> str:
    path = project_root / ".agent-os" / "run-log.md"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8")


def load_run_log_recent(project_root: Path, n: int = 5) -> list[str]:
    content = load_run_log(project_root)
    entries = re.findall(r"^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}.*?)(?=\n- \d{4}-|\Z)", content, re.MULTILINE | re.DOTALL)
    return entries[-n:] if entries else []


def load_todo_next(project_root: Path) -> list[tuple[str, str, str]]:
    todo_path = project_root / ".agent-os" / "todo.md"
    if not todo_path.exists():
        return []
    content = todo_path.read_text(encoding="utf-8")
    return re.findall(r"^- `([^`]+)` `\[([^\]]+)\]`:\s*(.+)$", content, re.MULTILINE)[:5]


def is_task_completed(task: dict[str, Any]) -> bool:
    task_result = task.get("task_result") if isinstance(task.get("task_result"), dict) else {}
    return bool(task_result.get("updated_at"))


def task_completed_in_range(task: dict[str, Any], from_date: datetime, to_date: datetime) -> bool:
    task_result = task.get("task_result") if isinstance(task.get("task_result"), dict) else {}
    updated_at = task_result.get("updated_at")
    if not isinstance(updated_at, str) or not updated_at:
        return False
    try:
        dt = datetime.fromisoformat(updated_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    return from_date <= dt <= to_date


def active_runs(project_root: Path) -> list[dict[str, Any]]:
    return list_active_runs(project_root)


def completed_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [task for task in tasks if is_task_completed(task)]


def blocking_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [task for task in tasks if task.get("ready_state") in {"blocked", "invalid"}]


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


def time_ago(iso_str: str | None) -> str:
    if not iso_str:
        return "unknown"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
    except ValueError:
        return "unknown"
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - dt
    seconds = int(delta.total_seconds())
    if seconds < 60:
        return f"{seconds}s ago"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}min ago"
    hours = minutes // 60
    if hours < 24:
        return f"{hours}h ago"
    return f"{hours // 24}d ago"


def status_read_model(project_root: Path) -> dict[str, Any]:
    tasks = load_tasks(project_root)
    healthy, health_msg = quick_health(project_root)
    return {
        "project_root": str(project_root.resolve()),
        "config": load_config(project_root),
        "tasks": tasks,
        "task_count": len(tasks),
        "active_runs": active_runs(project_root),
        "completed_task_count": len(completed_tasks(tasks)),
        "blocked_task_count": len(blocking_tasks(tasks)),
        "healthy": healthy,
        "health_message": health_msg,
        "todo_next": load_todo_next(project_root),
        "recent_run_log": load_run_log_recent(project_root),
    }
