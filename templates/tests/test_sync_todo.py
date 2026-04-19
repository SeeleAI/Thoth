"""Test sync_todo.py in the deployed project."""
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
RESEARCH_TASKS_DIR = PROJECT_ROOT / ".agent-os" / "research-tasks"


def test_sync_todo_generates_output():
    result = subprocess.run(
        [sys.executable, str(RESEARCH_TASKS_DIR / "sync_todo.py")],
        capture_output=True, text=True, cwd=str(PROJECT_ROOT), timeout=30,
    )
    assert result.returncode == 0, f"sync_todo.py failed: {result.stdout}\n{result.stderr}"
    todo = PROJECT_ROOT / ".agent-os" / "todo.md"
    assert todo.exists(), "todo.md should exist after sync"
