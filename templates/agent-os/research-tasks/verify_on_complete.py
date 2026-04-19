#!/usr/bin/env python3
"""Pre-commit hook: auto-verify tasks when their phase status changes to 'completed'.

Receives list of modified YAML file paths as arguments.
Runs verify_completion.py for each task that has a newly-completed phase.
Exits 1 (blocks commit) if any verification fails.
"""
import sys
import subprocess
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
VERIFY_SCRIPT = SCRIPT_DIR / "verify_completion.py"


def get_task_id(path: Path) -> str | None:
    """Return task ID from a task YAML path (not _module.yaml)."""
    if path.name == "_module.yaml" or not path.suffix == ".yaml":
        return None
    try:
        import yaml
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if data and "id" in data:
            return data["id"]
    except Exception:
        pass
    return None


def has_completed_phase(path: Path) -> bool:
    """Return True if any phase in this task YAML is marked 'completed'."""
    try:
        import yaml
        with open(path, encoding="utf-8") as f:
            data = yaml.safe_load(f) or {}
        for phase in data.get("phases", {}).values():
            if isinstance(phase, dict) and phase.get("status") == "completed":
                return True
    except Exception:
        pass
    return False


def main() -> int:
    modified_files = [Path(p) for p in sys.argv[1:]]
    tasks_to_verify = []

    for path in modified_files:
        if not path.exists():
            continue
        task_id = get_task_id(path)
        if task_id and has_completed_phase(path):
            tasks_to_verify.append((task_id, path))

    if not tasks_to_verify:
        return 0

    print(f"[verify-on-complete] Verifying {len(tasks_to_verify)} task(s) with completed phases...")
    failures = []
    for task_id, path in tasks_to_verify:
        result = subprocess.run(
            [sys.executable, str(VERIFY_SCRIPT), task_id],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT),
        )
        if result.returncode != 0:
            failures.append((task_id, result.stdout + result.stderr))
            print(f"  FAIL  {task_id}")
            for line in (result.stdout + result.stderr).strip().splitlines():
                print(f"    {line}")
        else:
            print(f"  PASS  {task_id}")

    if failures:
        print(f"\n[verify-on-complete] {len(failures)} task(s) FAILED verification.")
        print("Fix the issues above before committing.")
        return 1

    print(f"[verify-on-complete] All {len(tasks_to_verify)} task(s) verified OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
