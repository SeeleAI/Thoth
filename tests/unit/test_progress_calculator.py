"""Tests for the progress calculation engine (progress_calculator.py)."""

import sys
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from progress_calculator import (
    calculate_task_progress,
    calculate_module_progress,
    calculate_global_progress,
    find_blocked_tasks,
    estimate_completion,
    get_task_status,
    status_counts,
)


# ---------------------------------------------------------------------------
# Helper: Build synthetic task dicts
# ---------------------------------------------------------------------------

def _make_task(task_id, survey="pending", method_design="pending",
               experiment="pending", conclusion="pending",
               depends_on=None, created_at=None,
               survey_criteria=None, experiment_criteria=None):
    """Build a minimal task dict for testing."""
    phases = {
        "survey": {"status": survey},
        "method_design": {"status": method_design},
        "experiment": {"status": experiment},
        "conclusion": {"status": conclusion},
    }
    if survey_criteria:
        phases["survey"]["criteria"] = survey_criteria
    if experiment_criteria:
        phases["experiment"]["criteria"] = experiment_criteria
    task = {
        "id": task_id,
        "phases": phases,
        "depends_on": depends_on or [],
    }
    if created_at:
        task["created_at"] = created_at
    return task


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_pending_task_is_zero():
    """A task with all phases pending should have 0% progress."""
    task = _make_task("t1")
    progress = calculate_task_progress(task)
    assert progress == 0.0, f"Expected 0%, got {progress}%"


def test_completed_task_is_100():
    """A task with all phases completed should have 100% progress."""
    task = _make_task("t1",
                      survey="completed",
                      method_design="completed",
                      experiment="completed",
                      conclusion="completed")
    progress = calculate_task_progress(task)
    assert progress == 100.0, f"Expected 100%, got {progress}%"


def test_in_progress_with_criteria():
    """An in_progress phase with criteria.current/threshold should give proportional progress."""
    task = _make_task(
        "t1",
        survey="in_progress",
        survey_criteria={
            "metric": "papers_reviewed",
            "threshold": 10,
            "current": 5,
            "unit": "papers",
        },
    )
    progress = calculate_task_progress(task)
    # survey weight = 0.20, phase progress = (5/10)*100 = 50%
    # total = 50 * 0.20 = 10.0
    assert progress == 10.0, f"Expected 10.0%, got {progress}%"


def test_in_progress_no_criteria():
    """An in_progress phase without criteria should default to 50% phase progress."""
    task = _make_task("t1", survey="in_progress")
    progress = calculate_task_progress(task)
    # survey weight = 0.20, default phase progress = 50%
    # total = 50 * 0.20 = 10.0
    assert progress == 10.0, f"Expected 10.0%, got {progress}%"


def test_mixed_phases_progress():
    """A task with mixed phase statuses should produce correct weighted progress."""
    task = _make_task("t1",
                      survey="completed",       # 100% * 0.20 = 20
                      method_design="completed", # 100% * 0.20 = 20
                      experiment="in_progress",   # 50% * 0.40 = 20  (no criteria)
                      conclusion="pending")       # 0% * 0.20 = 0
    progress = calculate_task_progress(task)
    # total = 20 + 20 + 20 + 0 = 60.0
    assert progress == 60.0, f"Expected 60.0%, got {progress}%"


def test_skipped_phase_counts_as_complete():
    """A skipped phase should count as 100% for progress."""
    task = _make_task("t1", survey="skipped")
    progress = calculate_task_progress(task)
    # skipped survey = 100% * 0.20 = 20
    assert progress == 20.0, f"Expected 20.0%, got {progress}%"


def test_blocked_task_detection():
    """A task with an unmet hard dependency should be detected as blocked."""
    dep_task = _make_task("dep1")  # All pending, not completed
    main_task = _make_task(
        "main1",
        depends_on=[{"task_id": "dep1", "type": "hard", "reason": "needs dep"}],
    )
    blocked = find_blocked_tasks([dep_task, main_task])
    blocked_ids = [t["id"] for t in blocked]
    assert "main1" in blocked_ids, f"Expected main1 to be blocked, got blocked: {blocked_ids}"


def test_completed_dependency_not_blocked():
    """A task whose hard dependency is completed should NOT be blocked."""
    dep_task = _make_task("dep1",
                          survey="completed",
                          method_design="completed",
                          experiment="completed",
                          conclusion="completed")
    main_task = _make_task(
        "main1",
        depends_on=[{"task_id": "dep1", "type": "hard", "reason": "needs dep"}],
    )
    blocked = find_blocked_tasks([dep_task, main_task])
    blocked_ids = [t["id"] for t in blocked]
    assert "main1" not in blocked_ids, f"Expected main1 NOT blocked, got blocked: {blocked_ids}"


def test_soft_dependency_not_blocking():
    """A task with only soft dependencies should NOT be blocked."""
    dep_task = _make_task("dep1")  # pending
    main_task = _make_task(
        "main1",
        depends_on=[{"task_id": "dep1", "type": "soft", "reason": "nice to have"}],
    )
    blocked = find_blocked_tasks([dep_task, main_task])
    assert blocked == [], f"Expected no blocked tasks for soft deps, got: {[t['id'] for t in blocked]}"


def test_status_counts():
    """Verify status_counts output matches expected values."""
    tasks = [
        _make_task("t1"),  # pending
        _make_task("t2", survey="in_progress"),  # in_progress
        _make_task("t3",
                   survey="completed",
                   method_design="completed",
                   experiment="completed",
                   conclusion="completed"),  # completed
        _make_task("t4",
                   depends_on=[{"task_id": "t1", "type": "hard", "reason": "test"}]),
        # t4 depends on t1 which is pending -> blocked
    ]
    counts = status_counts(tasks)
    assert counts["total"] == 4, f"Expected total=4, got {counts['total']}"
    assert counts["completed"] == 1, f"Expected completed=1, got {counts['completed']}"
    assert counts["pending"] >= 1, f"Expected at least 1 pending, got {counts['pending']}"
    assert counts["blocked"] >= 1, f"Expected at least 1 blocked, got {counts['blocked']}"


def test_estimate_completion():
    """With some completed tasks, estimate_completion should return data."""
    tasks = [
        _make_task("t1",
                   survey="completed",
                   method_design="completed",
                   experiment="completed",
                   conclusion="completed",
                   created_at="2026-01-01T10:00:00Z"),
        _make_task("t2", created_at="2026-01-15T10:00:00Z"),
    ]
    result = estimate_completion(tasks)
    assert result is not None, "Expected estimation result, got None"
    assert result["total_tasks"] == 2, f"Expected total_tasks=2, got {result['total_tasks']}"
    assert result["completed_tasks"] == 1, f"Expected completed_tasks=1, got {result['completed_tasks']}"
    assert result["estimated_days_remaining"] is not None, (
        "Expected estimated_days_remaining to be calculated"
    )


def test_estimate_completion_no_completed():
    """With zero completed tasks, estimation should indicate insufficient data."""
    tasks = [_make_task("t1", created_at="2026-01-01T10:00:00Z")]
    result = estimate_completion(tasks)
    assert result is not None, "Expected estimation result, got None"
    assert result["estimated_days_remaining"] is None, (
        "Expected None days remaining with no completed tasks"
    )


def test_estimate_completion_empty():
    """With no tasks at all, estimate_completion should return None."""
    result = estimate_completion([])
    assert result is None, f"Expected None for empty task list, got {result}"


def test_module_progress():
    """Module progress should be the average of its task progresses."""
    tasks = [
        _make_task("t1",
                   survey="completed",
                   method_design="completed",
                   experiment="completed",
                   conclusion="completed"),  # 100%
        _make_task("t2"),  # 0%
    ]
    progress = calculate_module_progress(tasks)
    assert progress == 50.0, f"Expected module progress 50.0%, got {progress}%"


def test_global_progress():
    """Global progress should be average of all task progresses."""
    tasks = [
        _make_task("t1",
                   survey="completed",
                   method_design="completed",
                   experiment="completed",
                   conclusion="completed"),  # 100%
        _make_task("t2"),  # 0%
        _make_task("t3"),  # 0%
    ]
    progress = calculate_global_progress(tasks)
    expected = round(100.0 / 3, 1)
    assert progress == expected, f"Expected global progress {expected}%, got {progress}%"


def test_get_task_status_completed():
    """A task with all phases completed should have status 'completed'."""
    task = _make_task("t1",
                      survey="completed",
                      method_design="completed",
                      experiment="completed",
                      conclusion="completed")
    assert get_task_status(task) == "completed"


def test_get_task_status_in_progress():
    """A task with any phase in_progress should have status 'in_progress'."""
    task = _make_task("t1", survey="in_progress")
    assert get_task_status(task) == "in_progress"


def test_get_task_status_pending():
    """A task with all phases pending should have status 'pending'."""
    task = _make_task("t1")
    assert get_task_status(task) == "pending"
