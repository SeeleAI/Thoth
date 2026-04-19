"""Test check_consistency.py in the deployed project."""
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
RESEARCH_TASKS_DIR = PROJECT_ROOT / ".agent-os" / "research-tasks"


def test_consistency_check_passes():
    result = subprocess.run(
        [sys.executable, str(RESEARCH_TASKS_DIR / "check_consistency.py")],
        capture_output=True, text=True, cwd=str(PROJECT_ROOT), timeout=30,
    )
    assert result.returncode == 0, f"Consistency check failed: {result.stdout}\n{result.stderr}"
