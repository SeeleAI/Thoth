#!/usr/bin/env python3
"""Thoth progress report generator.

Generates a markdown report for a given date range by scanning run-log.md,
YAML task files, and deliverable paths.

Usage:
    python report.py --from 2026-04-01 --to 2026-04-19
    python report.py --from 2026-04-01 --to 2026-04-19 --output reports/weekly.md
"""

import argparse
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

CONFIG_FILE = ".research-config.yaml"

try:
    import yaml
except ImportError:
    sys.exit("ERROR: pyyaml is required. Install with: pip install pyyaml")

MEDIA_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".mp4", ".webm", ".webp", ".svg"}


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
            if fn in ("_module.yaml", "paper-module-mapping.yaml"):
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


def load_run_log() -> str:
    """Load run-log.md content."""
    log_path = Path.cwd() / ".agent-os" / "run-log.md"
    if not log_path.exists():
        return ""
    return log_path.read_text(encoding="utf-8")


def parse_run_log_entries(
    content: str, from_date: datetime, to_date: datetime
) -> List[str]:
    """Extract run-log entries within the date range."""
    entries: List[str] = []
    # Pattern: "- YYYY-MM-DD HH:MM UTC [description]"
    pattern = re.compile(
        r"^- (\d{4}-\d{2}-\d{2} \d{2}:\d{2}).*?\n((?:  .*\n)*)",
        re.MULTILINE,
    )
    for match in pattern.finditer(content):
        date_str = match.group(1)
        try:
            entry_date = datetime.strptime(date_str, "%Y-%m-%d %H:%M").replace(
                tzinfo=timezone.utc
            )
        except ValueError:
            continue
        if from_date <= entry_date <= to_date:
            entries.append(match.group(0).strip())
    return entries


# ---------------------------------------------------------------------------
# Task analysis
# ---------------------------------------------------------------------------

PHASE_ORDER = ["survey", "method_design", "experiment", "conclusion"]


def task_current_phase(task: Dict) -> Tuple[str, str]:
    """Return (phase_name, phase_status) for the current active phase."""
    phases = task.get("phases", {})
    verdict = task.get("results", {}).get("verdict") if task.get("results") else None
    if verdict is not None:
        return "conclusion", f"verdict:{verdict}"
    for pname in reversed(PHASE_ORDER):
        phase = phases.get(pname, {})
        st = phase.get("status", "pending")
        if st in ("completed", "in_progress"):
            return pname, st
    return "survey", "pending"


def is_task_completed(task: Dict) -> bool:
    """Check if task has a verdict or conclusion completed."""
    verdict = task.get("results", {}).get("verdict") if task.get("results") else None
    if verdict is not None:
        return True
    conclusion = task.get("phases", {}).get("conclusion", {}).get("status")
    return conclusion in ("completed", "skipped")


def is_task_in_progress(task: Dict) -> bool:
    """Check if any phase is in_progress."""
    phases = task.get("phases", {})
    return any(
        phases.get(p, {}).get("status") == "in_progress" for p in PHASE_ORDER
    )


def task_progress_pct(task: Dict) -> int:
    """Compute task progress as a percentage."""
    phases = task.get("phases", {})
    weights = {"survey": 20, "method_design": 20, "experiment": 40, "conclusion": 20}
    total_weight = sum(weights.values())
    earned = 0.0
    for pname in PHASE_ORDER:
        w = weights[pname]
        phase = phases.get(pname, {})
        st = phase.get("status", "pending")
        if st in ("completed", "skipped"):
            earned += w
        elif st == "in_progress":
            earned += w * 0.5
    return int(round(100 * earned / total_weight)) if total_weight > 0 else 0


def task_completed_in_range(
    task: Dict, from_date: datetime, to_date: datetime
) -> bool:
    """Check if the task was completed within the date range."""
    conclusion = task.get("phases", {}).get("conclusion", {})
    completed_at = conclusion.get("completed_at")
    if not completed_at:
        return False
    try:
        dt = datetime.fromisoformat(completed_at.replace("Z", "+00:00"))
        return from_date <= dt <= to_date
    except Exception:
        return False


def task_created_in_range(
    task: Dict, from_date: datetime, to_date: datetime
) -> bool:
    """Check if the task was created within the date range."""
    created_at = task.get("created_at")
    if not created_at:
        return False
    try:
        dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        return from_date <= dt <= to_date
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Media scanning
# ---------------------------------------------------------------------------

def scan_deliverable_media(tasks: List[Dict]) -> List[str]:
    """Scan deliverable paths for media files."""
    media_paths: List[str] = []
    for task in tasks:
        phases = task.get("phases", {})
        for pname in PHASE_ORDER:
            phase = phases.get(pname, {})
            for deliverable in phase.get("deliverables", []):
                dpath = deliverable.get("path", "")
                if not dpath:
                    continue
                full_path = Path.cwd() / dpath
                suffix = full_path.suffix.lower()
                if suffix in MEDIA_EXTENSIONS and full_path.exists():
                    media_paths.append(dpath)
    return media_paths


# ---------------------------------------------------------------------------
# Report generation
# ---------------------------------------------------------------------------

def generate_report(
    from_date: datetime,
    to_date: datetime,
    output_path: Path,
) -> None:
    """Generate the markdown progress report."""
    config = load_config()
    project_name = config.get("project", {}).get("name", "Unknown Project")
    tasks = load_tasks()
    run_log = load_run_log()

    from_str = from_date.strftime("%Y-%m-%d")
    to_str = to_date.strftime("%Y-%m-%d")

    lines: List[str] = []
    lines.append(f"# Progress Report: {from_str} -- {to_str}")
    lines.append(f"")
    lines.append(f"**Project:** {project_name}")
    lines.append(f"**Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    lines.append("")

    # --- Summary ---
    completed_in_range = [t for t in tasks if task_completed_in_range(t, from_date, to_date)]
    in_progress = [t for t in tasks if is_task_in_progress(t)]
    new_in_range = [t for t in tasks if task_created_in_range(t, from_date, to_date)]
    total_completed = sum(1 for t in tasks if is_task_completed(t))
    total = len(tasks)
    overall_pct = int(100 * total_completed / total) if total > 0 else 0

    lines.append("## Summary")
    lines.append(f"- Tasks completed in period: {len(completed_in_range)}")
    lines.append(f"- Tasks in progress: {len(in_progress)}")
    lines.append(f"- New tasks created: {len(new_in_range)}")
    lines.append(f"- Overall progress: {overall_pct}% ({total_completed}/{total})")
    lines.append("")

    # --- Completed ---
    lines.append("## Completed")
    lines.append("")
    if completed_in_range:
        for t in completed_in_range:
            tid = t.get("id", "?")
            title = t.get("title", "")
            verdict = t.get("results", {}).get("verdict", "")
            evidence = t.get("results", {}).get("evidence_paths", [])

            lines.append(f"### [{tid}] {title}")
            lines.append(f"- Phase: conclusion -> completed")
            lines.append(f"- Verdict: {verdict or 'N/A'}")
            if evidence:
                for epath in evidence:
                    lines.append(f"- Evidence: [{epath}]({epath})")
            # Check for media in deliverables
            for pname in PHASE_ORDER:
                phase = t.get("phases", {}).get(pname, {})
                for d in phase.get("deliverables", []):
                    dpath = d.get("path", "")
                    suffix = Path(dpath).suffix.lower()
                    if suffix in MEDIA_EXTENSIONS:
                        lines.append(f"- ![{Path(dpath).name}]({dpath})")
            lines.append("")
    else:
        lines.append("_No tasks completed in this period._")
        lines.append("")

    # --- In Progress ---
    lines.append("## In Progress")
    lines.append("")
    if in_progress:
        for t in in_progress:
            tid = t.get("id", "?")
            title = t.get("title", "")
            phase_name, _ = task_current_phase(t)
            pct = task_progress_pct(t)
            lines.append(f"### [{tid}] {title}")
            lines.append(f"- Current phase: {phase_name} ({pct}%)")
            # Next action hint
            phase_idx = PHASE_ORDER.index(phase_name) if phase_name in PHASE_ORDER else 0
            if phase_idx < len(PHASE_ORDER) - 1:
                lines.append(f"- Next: {PHASE_ORDER[phase_idx + 1]}")
            lines.append("")
    else:
        lines.append("_No tasks currently in progress._")
        lines.append("")

    # --- Blockers & Risks ---
    lines.append("## Blockers & Risks")
    lines.append("")
    completed_ids = {t.get("id") for t in tasks if is_task_completed(t)}
    has_blockers = False
    for t in tasks:
        for dep in t.get("depends_on", []):
            if dep.get("type") == "hard" and dep.get("task_id") not in completed_ids:
                tid = t.get("id", "?")
                dep_id = dep.get("task_id", "?")
                reason = dep.get("reason", "")
                lines.append(f"- [{tid}] blocked by [{dep_id}]: {reason}")
                has_blockers = True
    if not has_blockers:
        lines.append("_No blockers._")
    lines.append("")

    # --- Media ---
    media_paths = scan_deliverable_media(tasks)
    if media_paths:
        lines.append("## Media")
        lines.append("")
        for mpath in media_paths:
            suffix = Path(mpath).suffix.lower()
            if suffix in {".mp4", ".webm"}:
                lines.append(f"- [video]({mpath})")
            else:
                lines.append(f"- ![{Path(mpath).name}]({mpath})")
        lines.append("")

    # --- Activity Log ---
    log_entries = parse_run_log_entries(run_log, from_date, to_date)
    if log_entries:
        lines.append("## Activity Log")
        lines.append("")
        for entry in log_entries:
            lines.append(entry)
            lines.append("")

    # Write report
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text("\n".join(lines), encoding="utf-8")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1

    parser = argparse.ArgumentParser(description="Thoth progress report generator")
    parser.add_argument("--from", dest="from_date", required=True,
                        help="Start date (YYYY-MM-DD)")
    parser.add_argument("--to", dest="to_date", required=True,
                        help="End date (YYYY-MM-DD)")
    parser.add_argument("--output", dest="output", default=None,
                        help="Output file path (default: reports/{to_date}-report.md)")

    args = parser.parse_args()

    try:
        from_date = datetime.strptime(args.from_date, "%Y-%m-%d").replace(
            tzinfo=timezone.utc
        )
    except ValueError:
        print(f"Invalid --from date: {args.from_date}. Use YYYY-MM-DD.", file=sys.stderr)
        return 1

    try:
        to_date = datetime.strptime(args.to_date, "%Y-%m-%d").replace(
            hour=23, minute=59, second=59, tzinfo=timezone.utc
        )
    except ValueError:
        print(f"Invalid --to date: {args.to_date}. Use YYYY-MM-DD.", file=sys.stderr)
        return 1

    if from_date > to_date:
        print("--from date must be before --to date.", file=sys.stderr)
        return 1

    if args.output:
        output_path = Path(args.output)
    else:
        output_path = Path.cwd() / "reports" / f"{args.to_date}-report.md"

    generate_report(from_date, to_date, output_path)
    print(f"Report generated: {output_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
