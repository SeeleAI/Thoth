"""Test dashboard API endpoints."""
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent

sys.path.insert(0, str(PROJECT_ROOT / "tools" / "dashboard" / "backend"))


def test_data_loader_directions():
    from data_loader import _read_directions_from_config
    directions = _read_directions_from_config(PROJECT_ROOT)
    assert len(directions) > 0, "Should have at least one direction"


def test_progress_calculator_imports():
    from progress_calculator import calculate_task_progress, get_task_status
    task = {
        "phases": {
            "survey": {"status": "pending"},
            "method_design": {"status": "pending"},
            "experiment": {"status": "pending"},
            "conclusion": {"status": "pending"},
        }
    }
    assert calculate_task_progress(task) == 0.0
    assert get_task_status(task) == "pending"
