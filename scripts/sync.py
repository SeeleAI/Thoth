#!/usr/bin/env python3
"""Thoth state synchronization.

Runs sync_todo.py and validates ID alignment across .agent-os/ documents.

Usage:
    python sync.py                # standard sync
    python sync.py --submodules   # also check git submodule status
"""

import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

CONFIG_FILE = ".research-config.yaml"

try:
    import yaml
except ImportError:
    sys.exit("ERROR: pyyaml is required. Install with: pip install pyyaml")


def load_config() -> Dict[str, Any]:
    """Load .research-config.yaml from CWD."""
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        return {}
    with open(config_path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


# ---------------------------------------------------------------------------
# Step 1: Run sync_todo.py
# ---------------------------------------------------------------------------

def run_sync_todo() -> Tuple[bool, str]:
    """Execute sync_todo.py and return (success, message)."""
    script_path = Path.cwd() / ".agent-os" / "research-tasks" / "sync_todo.py"
    if not script_path.exists():
        return False, "sync_todo.py not found"
    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True, text=True, timeout=60,
            cwd=str(Path.cwd()),
        )
        output = result.stdout.strip()
        if result.returncode == 0:
            # Extract task count from output like "Synced 12 task(s) into ..."
            match = re.search(r"Synced (\d+) task", output)
            count = match.group(1) if match else "?"
            return True, f"todo.md synced ({count} tasks)"
        else:
            return False, f"sync_todo.py failed: {output}"
    except subprocess.TimeoutExpired:
        return False, "sync_todo.py timed out (>60s)"
    except Exception as exc:
        return False, f"sync_todo.py error: {exc}"


# ---------------------------------------------------------------------------
# Step 2: Check ID sequences across .agent-os/ docs
# ---------------------------------------------------------------------------

def collect_task_ids_from_yaml() -> Set[str]:
    """Collect all task IDs from YAML files."""
    tasks_dir = Path.cwd() / ".agent-os" / "research-tasks"
    if not tasks_dir.exists():
        return set()
    ids: Set[str] = set()
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
                if isinstance(data, dict) and "id" in data:
                    ids.add(data["id"])
            except Exception:
                continue
    return ids


def collect_ids_from_doc(path: Path) -> Set[str]:
    """Extract backtick-quoted IDs from a markdown document."""
    if not path.exists():
        return set()
    try:
        content = path.read_text(encoding="utf-8")
    except Exception:
        return set()
    # Match patterns like `e2-h1-phase1-joint-training` or `TD-005`
    return set(re.findall(r"`([a-zA-Z][\w-]+)`", content))


def check_id_alignment() -> Tuple[bool, str]:
    """Check that IDs referenced in docs exist in YAML."""
    yaml_ids = collect_task_ids_from_yaml()
    if not yaml_ids:
        return True, "IDs aligned (no YAML tasks)"

    agent_os = Path.cwd() / ".agent-os"
    docs = ["todo.md", "run-log.md", "project-index.md"]
    orphaned: List[str] = []

    for doc_name in docs:
        doc_ids = collect_ids_from_doc(agent_os / doc_name)
        # Only check IDs that look like task IDs (contain a hyphen, not TD-/MS-/etc.)
        for did in doc_ids:
            if re.match(r"^[a-z]\d+-h\d+", did) and did not in yaml_ids:
                orphaned.append(f"{did} (in {doc_name})")

    if orphaned:
        detail = "; ".join(orphaned[:5])
        if len(orphaned) > 5:
            detail += f" ... +{len(orphaned) - 5} more"
        return False, f"Orphaned refs: {detail}"
    return True, "IDs aligned"


# ---------------------------------------------------------------------------
# Step 3: Submodule check
# ---------------------------------------------------------------------------

def check_submodules() -> Tuple[bool, str]:
    """Check git submodule status."""
    # First check if submodules exist
    gitmodules = Path.cwd() / ".gitmodules"
    if not gitmodules.exists():
        return True, "No submodules"
    try:
        result = subprocess.run(
            ["git", "submodule", "status"],
            capture_output=True, text=True, timeout=30,
            cwd=str(Path.cwd()),
        )
        if result.returncode != 0:
            return False, f"git submodule status failed: {result.stderr.strip()}"
        output = result.stdout.strip()
        if not output:
            return True, "No submodules registered"

        lines = output.strip().split("\n")
        dirty = [l for l in lines if l.startswith("+")]
        uninitialized = [l for l in lines if l.startswith("-")]

        issues: List[str] = []
        if dirty:
            issues.append(f"{len(dirty)} dirty")
        if uninitialized:
            issues.append(f"{len(uninitialized)} uninitialized")

        if issues:
            return False, f"{len(lines)} submodules ({', '.join(issues)})"
        return True, f"{len(lines)} submodules in sync"
    except FileNotFoundError:
        return False, "git not found"
    except Exception as exc:
        return False, f"Error: {exc}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1

    check_subs = "--submodules" in sys.argv

    config = load_config()
    project_name = config.get("project", {}).get("name", "Unknown Project")

    print(f"\u2550\u2550\u2550 Thoth Sync: {project_name} \u2550\u2550\u2550")

    all_ok = True

    # Step 1: sync_todo.py
    ok, msg = run_sync_todo()
    icon = "\u2713" if ok else "\u2717"
    print(f"  {icon} {msg}")
    if not ok:
        all_ok = False

    # Step 2: ID alignment
    ok, msg = check_id_alignment()
    icon = "\u2713" if ok else "\u2717"
    print(f"  {icon} {msg}")
    if not ok:
        all_ok = False

    # Step 3: Submodules (if requested or .gitmodules exists)
    gitmodules = Path.cwd() / ".gitmodules"
    if check_subs or gitmodules.exists():
        ok, msg = check_submodules()
        icon = "\u2713" if ok else "\u2717"
        print(f"  {icon} Submodules: {msg}")
        if not ok:
            all_ok = False

    # Step 4: Timestamp
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    print(f"  Last sync: {now}")

    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
