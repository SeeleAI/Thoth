#!/usr/bin/env python3
"""Thoth structured status printer.

Self-contained script that reads YAML files and prints formatted project status.

Usage:
    python status.py           # standard status
    python status.py --full    # include direction progress and milestone summary
"""

import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

CONFIG_FILE = ".research-config.yaml"

try:
    import yaml
except ImportError:
    sys.exit("ERROR: pyyaml is required. Install with: pip install pyyaml")


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_config() -> Dict[str, Any]:
    """Load .research-config.yaml from CWD."""
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        return {}
    with open(config_path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def load_tasks() -> List[Dict[str, Any]]:
    """Load all task YAML files under .agent-os/research-tasks/."""
    tasks_dir = Path.cwd() / ".agent-os" / "research-tasks"
    if not tasks_dir.exists():
        return []
    tasks: List[Dict[str, Any]] = []
    for dirpath, _dirnames, filenames in os.walk(tasks_dir):
        for fn in sorted(filenames):
            if not fn.endswith((".yaml", ".yml")):
                continue
            if fn == "_module.yaml" or fn == "paper-module-mapping.yaml":
                continue
            fp = Path(dirpath) / fn
            try:
                with open(fp, "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                if isinstance(data, dict) and "hypothesis" in data:
                    tasks.append(data)
            except Exception:
                continue
    return tasks


def load_modules() -> Dict[str, Dict[str, Any]]:
    """Load all _module.yaml files, keyed by module id."""
    tasks_dir = Path.cwd() / ".agent-os" / "research-tasks"
    if not tasks_dir.exists():
        return {}
    modules: Dict[str, Dict[str, Any]] = {}
    for dirpath, _dirnames, filenames in os.walk(tasks_dir):
        for fn in filenames:
            if fn != "_module.yaml":
                continue
            fp = Path(dirpath) / fn
            try:
                with open(fp, "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                if isinstance(data, dict) and "id" in data:
                    modules[data["id"]] = data
            except Exception:
                continue
    return modules


def load_milestones() -> List[Dict[str, Any]]:
    """Load milestones from .agent-os/milestones.yaml."""
    ms_path = Path.cwd() / ".agent-os" / "milestones.yaml"
    if not ms_path.exists():
        return []
    try:
        with open(ms_path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        return data.get("milestones", []) if data else []
    except Exception:
        return []


def load_run_log_recent(n: int = 5) -> List[str]:
    """Load the N most recent entries from run-log.md."""
    log_path = Path.cwd() / ".agent-os" / "run-log.md"
    if not log_path.exists():
        return []
    try:
        with open(log_path, "r", encoding="utf-8") as fh:
            content = fh.read()
    except Exception:
        return []
    entries = re.findall(r"^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}.*?)(?=\n- \d{4}-|\Z)",
                         content, re.MULTILINE | re.DOTALL)
    return entries[-n:] if entries else []


def load_todo_next() -> List[str]:
    """Load next action items from todo.md."""
    todo_path = Path.cwd() / ".agent-os" / "todo.md"
    if not todo_path.exists():
        return []
    try:
        with open(todo_path, "r", encoding="utf-8") as fh:
            content = fh.read()
    except Exception:
        return []
    # Extract items from backlog/ready sections
    items = re.findall(r"^- `([^`]+)` `\[([^\]]+)\]`:\s*(.+)$", content, re.MULTILINE)
    return items[:5]


# ---------------------------------------------------------------------------
# Status computation
# ---------------------------------------------------------------------------

PHASE_ORDER = ["survey", "method_design", "experiment", "conclusion"]
PHASE_WEIGHTS = {"survey": 20, "method_design": 20, "experiment": 40, "conclusion": 20}


def task_current_phase(task: Dict) -> Tuple[str, str]:
    """Return (phase_name, phase_status) for the task's current active phase."""
    phases = task.get("phases", {})
    # Check for verdict first
    verdict = task.get("results", {}).get("verdict") if task.get("results") else None
    if verdict is not None:
        return "conclusion", f"verdict:{verdict}"
    for pname in reversed(PHASE_ORDER):
        phase = phases.get(pname, {})
        st = phase.get("status", "pending")
        if st in ("completed", "in_progress"):
            return pname, st
    return "survey", "pending"


def task_progress_pct(task: Dict) -> int:
    """Compute task progress as a weighted percentage across phases."""
    phases = task.get("phases", {})
    config = load_config()
    # Use config weights if available, else defaults
    cfg_phases = config.get("research", {}).get("phases", [])
    weights = {}
    for p in cfg_phases:
        weights[p["id"]] = p.get("weight", 25)
    if not weights:
        weights = dict(PHASE_WEIGHTS)

    total_weight = sum(weights.get(p, 25) for p in PHASE_ORDER)
    earned = 0.0
    for pname in PHASE_ORDER:
        w = weights.get(pname, 25)
        phase = phases.get(pname, {})
        st = phase.get("status", "pending")
        if st == "completed" or st == "skipped":
            earned += w
        elif st == "in_progress":
            earned += w * 0.5  # halfway credit
    return int(round(100 * earned / total_weight)) if total_weight > 0 else 0


def progress_bar(pct: int, width: int = 10) -> str:
    """Render a text progress bar like [####......]."""
    filled = int(round(pct * width / 100))
    filled = max(0, min(width, filled))
    return "[" + "\u25a0" * filled + "\u25a1" * (width - filled) + "]"


def time_ago(iso_str: Optional[str]) -> str:
    """Convert an ISO datetime string to a human-readable 'X ago' string."""
    if not iso_str:
        return "unknown"
    try:
        if "T" in iso_str:
            dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(iso_str[:16], "%Y-%m-%d %H:%M").replace(
                tzinfo=timezone.utc
            )
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
    except Exception:
        return "unknown"


def is_task_completed(task: Dict) -> bool:
    """Check if task has a verdict or conclusion completed."""
    verdict = task.get("results", {}).get("verdict") if task.get("results") else None
    if verdict is not None:
        return True
    conclusion = task.get("phases", {}).get("conclusion", {}).get("status")
    return conclusion in ("completed", "skipped")


def is_task_blocked(task: Dict, all_tasks: List[Dict]) -> Tuple[bool, List[str]]:
    """Check if task is blocked by hard dependencies."""
    completed_ids = {t["id"] for t in all_tasks if is_task_completed(t)}
    blockers = []
    for dep in task.get("depends_on", []):
        if dep.get("type") == "hard" and dep.get("task_id") not in completed_ids:
            blockers.append(dep["task_id"])
    return bool(blockers), blockers


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

def quick_health() -> Tuple[bool, str]:
    """Quick health check: do required files exist and is sync fresh?"""
    required_files = [
        "project-index.md", "requirements.md", "architecture-milestones.md",
        "todo.md", "cross-repo-mapping.md", "acceptance-report.md",
        "lessons-learned.md", "run-log.md", "change-decisions.md",
    ]
    agent_os = Path.cwd() / ".agent-os"
    missing = [f for f in required_files if not (agent_os / f).exists()]
    if missing:
        return False, f"Missing {len(missing)} required file(s)"

    # Check sync freshness via run-log last entry timestamp
    entries = load_run_log_recent(1)
    if entries:
        match = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", entries[-1])
        if match:
            return True, f"Last sync: {time_ago(match.group(1))}"
    return True, "Last sync: unknown"


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def render_status(full: bool = False) -> str:
    """Build the full status output string."""
    config = load_config()
    project_name = config.get("project", {}).get("name", "Unknown Project")
    tasks = load_tasks()
    modules = load_modules()

    lines: List[str] = []
    lines.append(f"\u2550\u2550\u2550 Thoth Status: {project_name} \u2550\u2550\u2550")
    lines.append("")

    if not tasks:
        lines.append("  No research tasks found.")
        lines.append("")
        healthy, health_msg = quick_health()
        health_icon = "\u25cf" if healthy else "\u25cb"
        health_label = "ALL CHECKS PASSED" if healthy else "ISSUES DETECTED"
        lines.append(f"\u25b8 Health: {health_icon} {health_label} | {health_msg}")
        return "\n".join(lines)

    # --- Running tasks ---
    running = [t for t in tasks if not is_task_completed(t)]
    in_progress = []
    for t in running:
        phase_name, phase_status = task_current_phase(t)
        if phase_status == "in_progress":
            in_progress.append(t)

    lines.append("\u25b8 Running:")
    if in_progress:
        for t in in_progress:
            tid = t.get("id", "?")
            title = t.get("title", "")
            phase_name, _ = task_current_phase(t)
            pct = task_progress_pct(t)
            bar = progress_bar(pct)
            # Truncate title for display
            display_title = title[:50] + "..." if len(title) > 50 else title
            lines.append(f"  {bar} {pct:>3}%  {tid} {display_title} ({phase_name})")
    else:
        lines.append("  (none)")
    lines.append("")

    # --- Recent completed/reverted ---
    completed = [t for t in tasks if is_task_completed(t)]
    lines.append("\u25b8 Recent:")
    if completed:
        for t in completed[-3:]:
            tid = t.get("id", "?")
            title = t.get("title", "")
            display_title = title[:50] + "..." if len(title) > 50 else title
            verdict = t.get("results", {}).get("verdict", "")
            completed_at = t.get("phases", {}).get("conclusion", {}).get("completed_at")
            ago = time_ago(completed_at) if completed_at else "recently"
            if verdict == "rejected":
                fa = t.get("results", {}).get("failure_analysis", "")
                reason = fa[:30] if fa else "no reason"
                lines.append(f"  \u2717 {tid} {display_title} -- reverted ({reason})")
            else:
                lines.append(
                    f"  \u2713 {tid} {display_title} -- completed {ago}"
                )
    else:
        lines.append("  (none)")
    lines.append("")

    # --- Next: ready or blocked tasks ---
    pending = [t for t in running if task_current_phase(t)[1] != "in_progress"]
    lines.append("\u25b8 Next:")
    if pending:
        for t in pending[:5]:
            tid = t.get("id", "?")
            title = t.get("title", "")
            display_title = title[:50] + "..." if len(title) > 50 else title
            blocked, blockers = is_task_blocked(t, tasks)
            if blocked:
                blocker_str = ", ".join(blockers)
                lines.append(
                    f"  \u2192 {tid} {display_title} (blocked by {blocker_str})"
                )
            else:
                lines.append(f"  \u2192 {tid} {display_title} (ready, no blockers)")
    else:
        lines.append("  (none)")
    lines.append("")

    # --- Health ---
    healthy, health_msg = quick_health()
    health_icon = "\u25cf" if healthy else "\u25cb"
    health_label = "ALL CHECKS PASSED" if healthy else "ISSUES DETECTED"
    lines.append(f"\u25b8 Health: {health_icon} {health_label} | {health_msg}")

    # --- Full mode: direction progress + milestones ---
    if full:
        lines.append("")
        lines.append("\u2500" * 50)
        lines.append("")

        # Direction-level progress
        directions = config.get("research", {}).get("directions", [])
        if directions:
            lines.append("\u25b8 Direction Progress:")
            for d in directions:
                did = d.get("id", "")
                label = d.get("label_en", did)
                dir_tasks = [t for t in tasks if t.get("direction") == did]
                if not dir_tasks:
                    lines.append(f"  {label}: no tasks")
                    continue
                done_count = sum(1 for t in dir_tasks if is_task_completed(t))
                total = len(dir_tasks)
                pct = int(100 * done_count / total) if total > 0 else 0
                bar = progress_bar(pct)
                lines.append(f"  {label}: {bar} {pct}% ({done_count}/{total} tasks)")
            lines.append("")

        # Milestone summary
        milestones = load_milestones()
        if milestones:
            task_ids_set = {t.get("id") for t in tasks}
            completed_ids = {t.get("id") for t in tasks if is_task_completed(t)}
            lines.append("\u25b8 Milestones:")
            for ms in milestones:
                ms_id = ms.get("id", "?")
                ms_name = ms.get("name", "")
                ms_tasks = ms.get("tasks", [])
                ms_done = sum(1 for tid in ms_tasks if tid in completed_ids)
                ms_total = len(ms_tasks)
                pct = int(100 * ms_done / ms_total) if ms_total > 0 else 0
                status = "DONE" if ms_done == ms_total and ms_total > 0 else f"{ms_done}/{ms_total}"
                lines.append(f"  [{ms_id}] {ms_name}: {status} ({pct}%)")
            lines.append("")

        # Recent activity
        recent = load_run_log_recent(3)
        if recent:
            lines.append("\u25b8 Recent Activity:")
            for entry in recent:
                first_line = entry.strip().split("\n")[0][:80]
                lines.append(f"  {first_line}")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1

    full = "--full" in sys.argv
    print(render_status(full=full))
    return 0


if __name__ == "__main__":
    sys.exit(main())
