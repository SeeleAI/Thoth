"""Integration test: dashboard API endpoints."""
import sys
from pathlib import Path

import pytest

THOTH_ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(THOTH_ROOT / "templates" / "dashboard" / "backend"))

from progress_calculator import (
    calculate_task_progress,
    calculate_module_progress,
    calculate_global_progress,
    get_task_status,
    find_blocked_tasks,
    status_counts,
    estimate_completion,
)


@pytest.mark.integration
class TestProgressCalculator:

    def test_pending_task_zero_progress(self):
        task = {"phases": {
            "survey": {"status": "pending"},
            "method_design": {"status": "pending"},
            "experiment": {"status": "pending"},
            "conclusion": {"status": "pending"},
        }}
        assert calculate_task_progress(task) == 0.0
        assert get_task_status(task) == "pending"

    def test_completed_task_full_progress(self):
        task = {"phases": {
            "survey": {"status": "completed"},
            "method_design": {"status": "completed"},
            "experiment": {"status": "completed"},
            "conclusion": {"status": "completed"},
        }}
        assert calculate_task_progress(task) == 100.0
        assert get_task_status(task) == "completed"

    def test_in_progress_with_criteria(self):
        task = {"phases": {
            "survey": {"status": "completed"},
            "method_design": {"status": "completed"},
            "experiment": {
                "status": "in_progress",
                "criteria": {"threshold": 100, "current": 50},
            },
            "conclusion": {"status": "pending"},
        }}
        progress = calculate_task_progress(task)
        assert 40 < progress < 70
        assert get_task_status(task) == "in_progress"

    def test_blocked_task_detection(self):
        tasks = [
            {"id": "t1", "phases": {
                "survey": {"status": "pending"},
                "method_design": {"status": "pending"},
                "experiment": {"status": "pending"},
                "conclusion": {"status": "pending"},
            }, "depends_on": []},
            {"id": "t2", "phases": {
                "survey": {"status": "pending"},
                "method_design": {"status": "pending"},
                "experiment": {"status": "pending"},
                "conclusion": {"status": "pending"},
            }, "depends_on": [{"task_id": "t1", "type": "hard"}]},
        ]
        blocked = find_blocked_tasks(tasks)
        assert len(blocked) == 1
        assert blocked[0]["id"] == "t2"

    def test_status_counts(self):
        tasks = [
            {"id": "t1", "phases": {"survey": {"status": "completed"}, "method_design": {"status": "completed"}, "experiment": {"status": "completed"}, "conclusion": {"status": "completed"}}, "depends_on": []},
            {"id": "t2", "phases": {"survey": {"status": "pending"}, "method_design": {"status": "pending"}, "experiment": {"status": "pending"}, "conclusion": {"status": "pending"}}, "depends_on": []},
        ]
        counts = status_counts(tasks)
        assert counts["total"] == 2
        assert counts["completed"] == 1
        assert counts["pending"] == 1

    def test_global_progress(self):
        tasks = [
            {"id": "t1", "phases": {"survey": {"status": "completed"}, "method_design": {"status": "completed"}, "experiment": {"status": "completed"}, "conclusion": {"status": "completed"}}},
            {"id": "t2", "phases": {"survey": {"status": "pending"}, "method_design": {"status": "pending"}, "experiment": {"status": "pending"}, "conclusion": {"status": "pending"}}},
        ]
        progress = calculate_global_progress(tasks)
        assert progress == 50.0
