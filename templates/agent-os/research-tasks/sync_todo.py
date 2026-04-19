#!/usr/bin/env python3
"""Sync research-task YAML status into todo.md.

Scans all task YAML files under research-tasks/, builds a summary grouped by
direction and module, identifies blocked tasks, and writes the result into
.agent-os/todo.md between auto-generated markers.

Usage:
    python sync_todo.py              # sync todo.md
    python sync_todo.py --check-only # check if todo.md is in sync (exit 1 if not)
"""

import os
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import yaml
except ImportError:
    sys.exit("ERROR: pyyaml is required.  Install with:  pip install pyyaml")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
TODO_PATH = SCRIPT_DIR.parent / "todo.md"

START_MARKER = "<!-- RESEARCH-TASKS-AUTO-START -->"
END_MARKER = "<!-- RESEARCH-TASKS-AUTO-END -->"

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def _find_research_config() -> Optional[Path]:
    """Locate .research-config.yaml by walking up from PROJECT_ROOT."""
    project_root = SCRIPT_DIR.parents[1]
    # Check project root first, then current directory
    for candidate in [project_root / ".research-config.yaml",
                      Path.cwd() / ".research-config.yaml"]:
        if candidate.exists():
            return candidate
    return None


def load_directions() -> List[str]:
    """Load direction IDs from .research-config.yaml.

    Returns a list of direction id strings, or an empty list if the config
    file is not found (in which case directions are derived from task data).
    """
    config_path = _find_research_config()
    if config_path is None:
        return []
    try:
        with open(config_path, "r", encoding="utf-8") as fh:
            config = yaml.safe_load(fh)
        research = config.get("research", {})
        directions = research.get("directions", [])
        return [d["id"] for d in directions if isinstance(d, dict) and "id" in d]
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Data collection
# ---------------------------------------------------------------------------

def load_all_tasks() -> List[Dict[str, Any]]:
    """Load all task YAML files (skip _module.yaml)."""
    tasks: List[Dict[str, Any]] = []
    for dirpath, _dirnames, filenames in os.walk(SCRIPT_DIR):
        for fn in sorted(filenames):
            if not fn.endswith((".yaml", ".yml")):
                continue
            if fn == "_module.yaml":
                continue
            fp = Path(dirpath) / fn
            try:
                with open(fp, "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                if isinstance(data, dict) and "hypothesis" in data:
                    data["_file"] = str(fp.relative_to(SCRIPT_DIR))
                    tasks.append(data)
            except Exception:
                continue
    return tasks


def load_all_modules() -> Dict[str, Dict[str, Any]]:
    """Load all _module.yaml files, keyed by module id."""
    modules: Dict[str, Dict[str, Any]] = {}
    for dirpath, _dirnames, filenames in os.walk(SCRIPT_DIR):
        for fn in filenames:
            if fn != "_module.yaml":
                continue
            fp = Path(dirpath) / fn
            try:
                with open(fp, "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                if isinstance(data, dict) and "id" in data:
                    data["_file"] = str(fp.relative_to(SCRIPT_DIR))
                    modules[data["id"]] = data
            except Exception:
                continue
    return modules


def overall_status(task: Dict) -> str:
    """Derive a single status label for a task from its phases and results."""
    results = task.get("results", {})
    verdict = results.get("verdict") if results else None
    if verdict is not None:
        return f"verdict:{verdict}"

    phases = task.get("phases", {})
    # Check phases in reverse priority order (conclusion first).
    # Use the default 4-phase convention as the preferred order, but also
    # handle any custom phase names found in the YAML.
    default_order = ["conclusion", "experiment", "method_design", "survey"]
    seen = set()
    for pname in default_order:
        phase = phases.get(pname, {})
        st = phase.get("status")
        if st == "completed":
            return f"{pname}:completed"
        if st == "in_progress":
            return f"{pname}:in_progress"
        seen.add(pname)

    # Check any non-default phases
    for pname in phases:
        if pname in seen:
            continue
        phase = phases[pname]
        if not isinstance(phase, dict):
            continue
        st = phase.get("status")
        if st == "completed":
            return f"{pname}:completed"
        if st == "in_progress":
            return f"{pname}:in_progress"

    return "pending"


def _is_task_completed(task: Dict) -> bool:
    """Check if a task counts as completed for downstream unblocking.

    A task is considered completed if:
    - It has a verdict (any value), OR
    - Its conclusion phase is completed or skipped
    """
    verdict = task.get("results", {}).get("verdict") if task.get("results") else None
    if verdict is not None:
        return True
    conclusion = task.get("phases", {}).get("conclusion", {}).get("status")
    return conclusion in ("completed", "skipped")


def find_blocked_tasks(tasks: List[Dict]) -> List[Tuple[Dict, List[str]]]:
    """Return tasks whose hard dependencies are not completed."""
    completed_ids: set = set()
    for t in tasks:
        if _is_task_completed(t):
            completed_ids.add(t.get("id", ""))

    blocked: List[Tuple[Dict, List[str]]] = []
    for t in tasks:
        missing: List[str] = []
        for dep in t.get("depends_on", []):
            if dep.get("type") == "hard" and dep.get("task_id") not in completed_ids:
                missing.append(dep["task_id"])
        if missing:
            blocked.append((t, missing))
    return blocked


def find_soft_blocked_tasks(tasks: List[Dict]) -> List[Tuple[str, str, str]]:
    """Return tasks with unmet soft dependencies.

    Returns list of (task_id, task_title, dep_task_id) tuples.
    """
    completed_ids: set = set()
    for t in tasks:
        if _is_task_completed(t):
            completed_ids.add(t.get("id", ""))

    soft_blocked: List[Tuple[str, str, str]] = []
    for task in tasks:
        for dep in task.get("depends_on", []):
            if dep.get("type") == "soft" and dep.get("task_id") not in completed_ids:
                soft_blocked.append((
                    task.get("id", "?"),
                    task.get("title", ""),
                    dep["task_id"],
                ))
    return soft_blocked


# ---------------------------------------------------------------------------
# Conflict detection
# ---------------------------------------------------------------------------

def _check_conflicts(todo_content: str, auto_task_ids: List[str]) -> None:
    """Warn if any auto-generated task IDs also appear in the manual section."""
    parts = todo_content.split(START_MARKER)
    manual_section = parts[0] if parts else ""
    conflicts = []
    for tid in auto_task_ids:
        if f"`{tid}`" in manual_section:
            conflicts.append(tid)
    if conflicts:
        print(f"WARNING: {len(conflicts)} task ID(s) found in both manual and "
              f"auto sections: {conflicts}")


# ---------------------------------------------------------------------------
# Marker validation
# ---------------------------------------------------------------------------

def _validate_markers(content: str) -> Optional[str]:
    """Validate that START and END markers exist and are properly paired.

    Returns an error message if invalid, None if OK.
    """
    start_count = content.count(START_MARKER)
    end_count = content.count(END_MARKER)

    if start_count == 0 and end_count == 0:
        # No markers yet -- will append; that's fine
        return None
    if start_count != 1:
        return f"Expected exactly 1 START marker, found {start_count}"
    if end_count != 1:
        return f"Expected exactly 1 END marker, found {end_count}"

    start_idx = content.find(START_MARKER)
    end_idx = content.find(END_MARKER)
    if start_idx > end_idx:
        return "START marker appears after END marker"
    return None


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def render_section(tasks: List[Dict], modules: Dict[str, Dict]) -> str:
    """Build the auto-generated markdown section."""
    lines: List[str] = []
    lines.append(START_MARKER)
    lines.append("")
    lines.append("## Research Tasks (auto-generated)")
    lines.append("")

    if not tasks:
        lines.append("_No research task YAML files found._")
        lines.append("")
        lines.append(END_MARKER)
        return "\n".join(lines)

    # --- Per-direction summary ---
    dir_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    mod_counts: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for t in tasks:
        direction = t.get("direction", "unknown")
        module = t.get("module", "unknown")
        status = overall_status(t)
        dir_counts[direction][status] += 1
        dir_counts[direction]["_total"] += 1
        mod_counts[module][status] += 1
        mod_counts[module]["_total"] += 1

    # Use configured directions for ordering if available, otherwise sort
    # alphabetically from data.
    configured_dirs = load_directions()
    if configured_dirs:
        # Show configured directions first, then any extras from data
        all_dirs_in_data = set(dir_counts.keys())
        ordered_dirs = [d for d in configured_dirs if d in all_dirs_in_data]
        ordered_dirs += sorted(all_dirs_in_data - set(configured_dirs))
    else:
        ordered_dirs = sorted(dir_counts.keys())

    lines.append("### Progress by direction")
    lines.append("")
    lines.append("| Direction | Total | Pending | In Progress | Completed/Verdict |")
    lines.append("|-----------|-------|---------|-------------|-------------------|")
    for d in ordered_dirs:
        c = dir_counts[d]
        total = c["_total"]
        pending = sum(v for k, v in c.items() if k == "pending")
        in_prog = sum(v for k, v in c.items() if "in_progress" in k)
        done = sum(v for k, v in c.items() if "completed" in k or "verdict:" in k)
        lines.append(f"| {d} | {total} | {pending} | {in_prog} | {done} |")
    lines.append("")

    lines.append("### Progress by module")
    lines.append("")
    lines.append("| Module | Total | Pending | In Progress | Completed/Verdict |")
    lines.append("|--------|-------|---------|-------------|-------------------|")
    for m in sorted(mod_counts.keys()):
        c = mod_counts[m]
        total = c["_total"]
        pending = sum(v for k, v in c.items() if k == "pending")
        in_prog = sum(v for k, v in c.items() if "in_progress" in k)
        done = sum(v for k, v in c.items() if "completed" in k or "verdict:" in k)
        mod_name = m
        mod_info = modules.get(m)
        if mod_info:
            mod_name = f"{m} ({mod_info.get('name', '')})"
        lines.append(f"| {mod_name} | {total} | {pending} | {in_prog} | {done} |")
    lines.append("")

    # --- Blocked tasks ---
    blocked = find_blocked_tasks(tasks)
    lines.append("### Blocked tasks (hard dependency not completed)")
    lines.append("")
    if blocked:
        for t, missing in blocked:
            tid = t.get("id", "?")
            title = t.get("title", "")
            missing_str = ", ".join(f"`{m}`" for m in missing)
            lines.append(f"- `{tid}` {title}  --  waiting on: {missing_str}")
    else:
        lines.append("_No blocked tasks._")
    lines.append("")

    # --- Soft-blocked tasks ---
    soft_blocked = find_soft_blocked_tasks(tasks)
    if soft_blocked:
        lines.append("### Soft-blocked tasks (non-blocking but noteworthy)")
        lines.append("")
        for tid, title, dep_id in soft_blocked:
            lines.append(f"- `{tid}` {title}  --  soft-waiting on: `{dep_id}`")
        lines.append("")

    # --- Full task list ---
    lines.append("### All tasks")
    lines.append("")
    lines.append("| ID | Title | Direction | Module | Status |")
    lines.append("|----|-------|-----------|--------|--------|")
    for t in sorted(tasks, key=lambda x: x.get("id", "")):
        tid = t.get("id", "?")
        title = t.get("title", "")
        direction = t.get("direction", "")
        module = t.get("module", "")
        status = overall_status(t)
        lines.append(f"| `{tid}` | {title} | {direction} | {module} | {status} |")
    lines.append("")

    lines.append(END_MARKER)
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# File update
# ---------------------------------------------------------------------------

def update_todo(section_text: str) -> None:
    """Replace or append the auto-generated section in todo.md."""
    if TODO_PATH.exists():
        with open(TODO_PATH, "r", encoding="utf-8") as fh:
            content = fh.read()
    else:
        content = ""

    # Validate markers before writing
    marker_err = _validate_markers(content)
    if marker_err:
        print(f"ERROR: Marker validation failed: {marker_err}", file=sys.stderr)
        print("Fix the markers in todo.md before syncing.", file=sys.stderr)
        sys.exit(1)

    start_idx = content.find(START_MARKER)
    end_idx = content.find(END_MARKER)

    if start_idx != -1 and end_idx != -1:
        # Replace existing section (include the end marker length)
        end_idx += len(END_MARKER)
        new_content = content[:start_idx] + section_text + content[end_idx:]
    else:
        # Append
        if content and not content.endswith("\n"):
            content += "\n"
        new_content = content + "\n" + section_text + "\n"

    with open(TODO_PATH, "w", encoding="utf-8") as fh:
        fh.write(new_content)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    check_only = "--check-only" in sys.argv

    tasks = load_all_tasks()
    modules = load_all_modules()

    section = render_section(tasks, modules)

    # Collect task IDs for conflict detection
    auto_task_ids = [t.get("id", "") for t in tasks if t.get("id")]

    if check_only:
        # Compare expected content with current todo.md
        if not TODO_PATH.exists():
            print("FAIL: todo.md does not exist")
            return 1

        with open(TODO_PATH, "r", encoding="utf-8") as fh:
            current_content = fh.read()

        # Check conflicts even in check-only mode
        _check_conflicts(current_content, auto_task_ids)

        start_idx = current_content.find(START_MARKER)
        end_idx = current_content.find(END_MARKER)

        if start_idx == -1 or end_idx == -1:
            print("FAIL: Auto-generated markers not found in todo.md")
            return 1

        end_idx += len(END_MARKER)
        current_section = current_content[start_idx:end_idx]

        if current_section == section:
            print(f"PASS  todo.md is in sync with {len(tasks)} task(s)")
            return 0
        else:
            print(f"FAIL  todo.md is out of sync (run sync_todo.py to update)")
            return 1

    # Normal sync mode
    if TODO_PATH.exists():
        with open(TODO_PATH, "r", encoding="utf-8") as fh:
            current_content = fh.read()
        _check_conflicts(current_content, auto_task_ids)

    update_todo(section)
    print(f"Synced {len(tasks)} task(s) into {TODO_PATH.relative_to(SCRIPT_DIR.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
