#!/usr/bin/env python3
"""Thoth session lifecycle handler.

Called by hooks.json on SessionStart and SessionEnd events.

Usage:
    python session-hook.py start
    python session-hook.py end
"""

import subprocess
import sys
from pathlib import Path

CONFIG_FILE = ".research-config.yaml"


def _load_project_name() -> str:
    """Read project name from .research-config.yaml in CWD."""
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        return ""
    try:
        import yaml
        with open(config_path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        return data.get("project", {}).get("name", "") if data else ""
    except Exception:
        return ""


def handle_start() -> int:
    """Session start: detect Thoth project."""
    config_path = Path.cwd() / CONFIG_FILE
    if config_path.exists():
        name = _load_project_name() or "(unnamed)"
        print(f"Thoth project detected: {name}")
    else:
        print("No Thoth project. Run /thoth:init to set up.")
    return 0


def handle_end() -> int:
    """Session end: run quick doctor checks and print summary."""
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        # Not a Thoth project -- nothing to check.
        return 0

    passed = 0
    issues = 0

    # Check 1: validate.py exists and runs
    validate_path = Path.cwd() / ".agent-os" / "research-tasks" / "validate.py"
    if validate_path.exists():
        try:
            result = subprocess.run(
                [sys.executable, str(validate_path)],
                capture_output=True, text=True, timeout=30,
                cwd=str(Path.cwd()),
            )
            if result.returncode == 0:
                passed += 1
            else:
                issues += 1
        except Exception:
            issues += 1
    else:
        issues += 1

    # Check 2: check-required-files existence
    required_files = [
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
    agent_os = Path.cwd() / ".agent-os"
    all_present = True
    for fname in required_files:
        if not (agent_os / fname).exists():
            all_present = False
            break
    if all_present:
        passed += 1
    else:
        issues += 1

    # Check 3: consistency check exists and runs
    consistency_path = (
        Path.cwd() / ".agent-os" / "research-tasks" / "check_consistency.py"
    )
    if consistency_path.exists():
        try:
            result = subprocess.run(
                [sys.executable, str(consistency_path)],
                capture_output=True, text=True, timeout=30,
                cwd=str(Path.cwd()),
            )
            if result.returncode == 0:
                passed += 1
            else:
                issues += 1
        except Exception:
            issues += 1
    else:
        # Not an error if script doesn't exist -- project may not have tasks yet.
        passed += 1

    total = passed + issues
    print(f"Session end: {passed} checks passed, {issues} issues")
    return 0  # Never block session end.


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: session-hook.py start|end", file=sys.stderr)
        return 1

    action = sys.argv[1].lower()
    if action == "start":
        return handle_start()
    elif action == "end":
        return handle_end()
    else:
        print(f"Unknown action: {action}. Use 'start' or 'end'.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
