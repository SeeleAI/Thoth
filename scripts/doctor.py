#!/usr/bin/env python3
"""Thoth persistence audit script.

Runs a battery of checks against the project's .agent-os/ data and reports
pass/fail results.

Usage:
    python doctor.py              # full audit
    python doctor.py --quick      # schema + consistency + sync + required files only
    python doctor.py --fix        # auto-fix minor issues (sync freshness, missing files)
"""

import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

CONFIG_FILE = ".research-config.yaml"

try:
    import yaml
except ImportError:
    sys.exit("ERROR: pyyaml is required. Install with: pip install pyyaml")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

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


def load_config() -> Dict[str, Any]:
    """Load .research-config.yaml from CWD."""
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        return {}
    with open(config_path, "r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def load_tasks() -> Dict[str, Dict[str, Any]]:
    """Load all task YAML files under .agent-os/research-tasks/, keyed by id."""
    tasks_dir = Path.cwd() / ".agent-os" / "research-tasks"
    if not tasks_dir.exists():
        return {}
    tasks: Dict[str, Dict[str, Any]] = {}
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
                if isinstance(data, dict) and "id" in data and "hypothesis" in data:
                    tasks[data["id"]] = data
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


# ---------------------------------------------------------------------------
# Check implementations
# ---------------------------------------------------------------------------

def check_schema() -> Tuple[bool, str]:
    """Run validate.py for schema validation."""
    validate_path = Path.cwd() / ".agent-os" / "research-tasks" / "validate.py"
    if not validate_path.exists():
        return False, "validate.py not found"
    try:
        result = subprocess.run(
            [sys.executable, str(validate_path)],
            capture_output=True, text=True, timeout=60,
            cwd=str(Path.cwd()),
        )
        # Parse output for counts
        output = result.stdout.strip()
        pass_count = output.count("PASS")
        fail_count = output.count("FAIL")
        tasks = load_tasks()
        modules = load_modules()
        detail = f"{len(tasks)} tasks, {len(modules)} modules"
        if result.returncode == 0:
            return True, f"PASS ({detail})"
        else:
            return False, f"FAIL ({fail_count} failures)\n{output}"
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT (>60s)"
    except Exception as exc:
        return False, f"ERROR: {exc}"


def check_consistency() -> Tuple[bool, str]:
    """Run check_consistency.py."""
    script_path = (
        Path.cwd() / ".agent-os" / "research-tasks" / "check_consistency.py"
    )
    if not script_path.exists():
        return False, "check_consistency.py not found"
    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True, text=True, timeout=60,
            cwd=str(Path.cwd()),
        )
        if result.returncode == 0:
            return True, "PASS"
        else:
            return False, f"FAIL\n{result.stdout.strip()}"
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT (>60s)"
    except Exception as exc:
        return False, f"ERROR: {exc}"


def check_todo_sync() -> Tuple[bool, str]:
    """Run sync_todo.py --check-only."""
    script_path = Path.cwd() / ".agent-os" / "research-tasks" / "sync_todo.py"
    if not script_path.exists():
        return False, "sync_todo.py not found"
    try:
        result = subprocess.run(
            [sys.executable, str(script_path), "--check-only"],
            capture_output=True, text=True, timeout=60,
            cwd=str(Path.cwd()),
        )
        output = result.stdout.strip()
        if result.returncode == 0:
            return True, "PASS"
        else:
            return False, "FAIL (stale)"
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT (>60s)"
    except Exception as exc:
        return False, f"ERROR: {exc}"


def check_required_files() -> Tuple[bool, str]:
    """Check that all 9 required .agent-os/ files exist."""
    agent_os = Path.cwd() / ".agent-os"
    present = 0
    missing: List[str] = []
    for fname in REQUIRED_AGENT_OS_FILES:
        if (agent_os / fname).exists():
            present += 1
        else:
            missing.append(fname)
    total = len(REQUIRED_AGENT_OS_FILES)
    if not missing:
        return True, f"PASS ({present}/{total})"
    else:
        return False, f"FAIL (missing: {', '.join(missing)})"


def check_id_integrity() -> Tuple[bool, str]:
    """Scan for duplicate task IDs."""
    tasks_dir = Path.cwd() / ".agent-os" / "research-tasks"
    if not tasks_dir.exists():
        return True, "PASS (no tasks dir)"
    seen_ids: Dict[str, str] = {}  # id -> file
    duplicates: List[str] = []
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
                    tid = data["id"]
                    if tid in seen_ids:
                        duplicates.append(
                            f"{tid} in {seen_ids[tid]} AND {fp.name}"
                        )
                    else:
                        seen_ids[tid] = str(fp.name)
            except Exception:
                continue
    if duplicates:
        return False, f"FAIL (duplicates: {'; '.join(duplicates)})"
    return True, f"PASS ({len(seen_ids)} unique IDs)"


def check_milestone_refs() -> Tuple[bool, str]:
    """Verify milestone task_ids reference existing tasks."""
    ms_path = Path.cwd() / ".agent-os" / "milestones.yaml"
    if not ms_path.exists():
        return True, "PASS (no milestones.yaml)"
    try:
        with open(ms_path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except Exception as exc:
        return False, f"FAIL (parse error: {exc})"

    milestones = data.get("milestones", []) if data else []
    if not milestones:
        return True, "PASS (0 milestones)"

    tasks = load_tasks()
    task_ids = set(tasks.keys())
    broken: List[str] = []
    for ms in milestones:
        ms_id = ms.get("id", "?")
        for tid in ms.get("tasks", []):
            if tid not in task_ids:
                broken.append(f"{ms_id} -> {tid}")
    if broken:
        return False, f"FAIL ({len(broken)} broken ref(s): {'; '.join(broken[:5])})"
    return True, f"PASS ({len(milestones)} milestones)"


def check_sqlite() -> Tuple[bool, str]:
    """Run PRAGMA integrity_check on dashboard DB."""
    db_candidates = [
        Path.cwd() / "tools" / "dashboard" / "backend" / "thoth.db",
        Path.cwd() / "tools" / "dashboard" / "backend" / "dashboard.db",
        Path.cwd() / ".cache" / "thoth.db",
    ]
    db_path: Optional[Path] = None
    for candidate in db_candidates:
        if candidate.exists():
            db_path = candidate
            break
    if db_path is None:
        return True, "PASS (no DB found, skipped)"
    try:
        conn = sqlite3.connect(str(db_path))
        cursor = conn.execute("PRAGMA integrity_check;")
        result = cursor.fetchone()
        conn.close()
        if result and result[0] == "ok":
            return True, "PASS"
        else:
            return False, f"FAIL ({result})"
    except Exception as exc:
        return False, f"FAIL ({exc})"


def check_project_tests() -> Tuple[bool, str]:
    """Run pytest tests/ if tests/ exists in the project."""
    tests_dir = Path.cwd() / "tests"
    if not tests_dir.exists():
        return True, "PASS (no tests/ dir, skipped)"
    try:
        result = subprocess.run(
            [sys.executable, "-m", "pytest", str(tests_dir), "-v", "--tb=short"],
            capture_output=True, text=True, timeout=120,
            cwd=str(Path.cwd()),
        )
        # Count test results
        output = result.stdout
        match = re.search(r"(\d+) passed", output)
        passed = int(match.group(1)) if match else 0
        match_fail = re.search(r"(\d+) failed", output)
        failed = int(match_fail.group(1)) if match_fail else 0

        # pytest exit code 5 means "no tests collected" -- treat as pass
        if result.returncode in (0, 5):
            return True, f"PASS ({passed} tests)"
        else:
            return False, f"FAIL ({failed} failed, {passed} passed)"
    except subprocess.TimeoutExpired:
        return False, "TIMEOUT (>120s)"
    except Exception as exc:
        return False, f"ERROR: {exc}"


# ---------------------------------------------------------------------------
# Fix operations
# ---------------------------------------------------------------------------

def fix_todo_sync() -> bool:
    """Run sync_todo.py to fix stale todo.md."""
    script_path = Path.cwd() / ".agent-os" / "research-tasks" / "sync_todo.py"
    if not script_path.exists():
        return False
    try:
        result = subprocess.run(
            [sys.executable, str(script_path)],
            capture_output=True, text=True, timeout=60,
            cwd=str(Path.cwd()),
        )
        return result.returncode == 0
    except Exception:
        return False


def fix_missing_files() -> List[str]:
    """Create missing required files from minimal templates."""
    agent_os = Path.cwd() / ".agent-os"
    agent_os.mkdir(exist_ok=True)
    created: List[str] = []
    for fname in REQUIRED_AGENT_OS_FILES:
        fpath = agent_os / fname
        if not fpath.exists():
            title = fname.replace("-", " ").replace(".md", "").title()
            fpath.write_text(f"# {title}\n\n(auto-created by thoth:doctor --fix)\n",
                             encoding="utf-8")
            created.append(fname)
    return created


# ---------------------------------------------------------------------------
# Report rendering
# ---------------------------------------------------------------------------

def render_check(name: str, passed: bool, detail: str, width: int = 25) -> str:
    """Render a single check line."""
    icon = "\u2713" if passed else "\u2717"
    dots = "." * max(1, width - len(name))
    status = detail.split("\n")[0]  # Only first line in summary
    return f"  {icon} {name} {dots} {status}"


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1

    quick = "--quick" in sys.argv
    fix = "--fix" in sys.argv

    config = load_config()
    project_name = config.get("project", {}).get("name", "Unknown Project")

    print(f"\u2550\u2550\u2550 Thoth Doctor: {project_name} \u2550\u2550\u2550")

    checks: List[Tuple[str, bool, str]] = []
    fixes_applied: List[str] = []

    # 1. Schema validation
    ok, detail = check_schema()
    checks.append(("Schema validation", ok, detail))

    # 2. Consistency check
    ok, detail = check_consistency()
    checks.append(("Consistency check", ok, detail))

    # 3. Todo sync freshness
    ok, detail = check_todo_sync()
    if not ok and fix:
        if fix_todo_sync():
            ok, detail = True, "PASS (auto-fixed)"
            fixes_applied.append("todo.md synced")
    checks.append(("Todo sync freshness", ok, detail))

    # 4. Required files
    ok, detail = check_required_files()
    if not ok and fix:
        created = fix_missing_files()
        if created:
            ok, detail = check_required_files()
            fixes_applied.append(f"Created: {', '.join(created)}")
    checks.append(("Required files", ok, detail))

    if not quick:
        # 5. ID integrity
        ok, detail = check_id_integrity()
        checks.append(("ID integrity", ok, detail))

        # 6. Milestone refs
        ok, detail = check_milestone_refs()
        checks.append(("Milestone references", ok, detail))

        # 7. SQLite integrity
        ok, detail = check_sqlite()
        checks.append(("SQLite integrity", ok, detail))

        # 8. Project tests
        ok, detail = check_project_tests()
        checks.append(("Project tests", ok, detail))

    # Print results
    for name, passed, detail in checks:
        print(render_check(name, passed, detail))

    total_issues = sum(1 for _, ok, _ in checks if not ok)

    print()
    if fixes_applied:
        print(f"  Auto-fixed: {'; '.join(fixes_applied)}")

    if total_issues == 0:
        print("  Result: All checks passed")
    else:
        print(f"  Result: {total_issues} issue(s) found")
        # Suggest fixes
        for name, passed, detail in checks:
            if not passed:
                if "sync" in name.lower():
                    print(f"  Fix: Run /thoth:sync to update todo.md")
                elif "required" in name.lower():
                    print(f"  Fix: Run /thoth:doctor --fix to create missing files")

    return 1 if total_issues > 0 else 0


if __name__ == "__main__":
    sys.exit(main())
