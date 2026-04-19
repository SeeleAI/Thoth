"""Test that validation scripts work correctly in the deployed project."""
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
RESEARCH_TASKS_DIR = PROJECT_ROOT / ".agent-os" / "research-tasks"


def _run_script(script_name: str, *args: str) -> subprocess.CompletedProcess:
    script = RESEARCH_TASKS_DIR / script_name
    return subprocess.run(
        [sys.executable, str(script), *args],
        capture_output=True, text=True, cwd=str(PROJECT_ROOT), timeout=30,
    )


def test_validate_passes():
    result = _run_script("validate.py")
    assert result.returncode == 0, f"validate.py failed: {result.stdout}\n{result.stderr}"


def test_check_consistency_passes():
    result = _run_script("check_consistency.py")
    assert result.returncode == 0, f"check_consistency.py failed: {result.stdout}\n{result.stderr}"


def test_sync_todo_check_only():
    result = _run_script("sync_todo.py", "--check-only")
    assert result.returncode == 0, f"sync_todo.py --check-only failed: {result.stdout}\n{result.stderr}"


def test_schema_json_exists():
    schema = RESEARCH_TASKS_DIR / "schema.json"
    assert schema.exists(), f"schema.json not found at {schema}"


def test_required_agent_os_files():
    required = [
        "project-index.md", "requirements.md", "architecture-milestones.md",
        "todo.md", "change-decisions.md", "acceptance-report.md",
        "lessons-learned.md", "run-log.md",
    ]
    agent_os = PROJECT_ROOT / ".agent-os"
    for fname in required:
        assert (agent_os / fname).exists(), f"Missing required file: .agent-os/{fname}"


def test_research_config_exists():
    config = PROJECT_ROOT / ".research-config.yaml"
    assert config.exists(), "Missing .research-config.yaml"
