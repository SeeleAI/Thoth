"""Tests for the status script output format (status.py)."""

import os
import sys
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from status import (
    render_status,
    task_current_phase,
    task_progress_pct,
    is_task_completed,
    is_task_blocked,
    quick_health,
    progress_bar,
)


def _setup_project(tmp_path, config=None, tasks=None):
    """Helper to set up a temporary project directory with config and optional tasks."""
    agent_os = tmp_path / ".agent-os"
    agent_os.mkdir(exist_ok=True)
    research_dir = agent_os / "research-tasks"
    research_dir.mkdir(exist_ok=True)

    # Write config
    if config is None:
        config = {
            "project": {"name": "TestProject", "language": "en", "version": "0.1.0"},
            "research": {
                "directions": [
                    {"id": "frontend", "label_en": "Frontend", "color": "#CC8B3A"},
                ],
                "phases": [
                    {"id": "survey", "weight": 20},
                    {"id": "method_design", "weight": 20},
                    {"id": "experiment", "weight": 40},
                    {"id": "conclusion", "weight": 20},
                ],
            },
        }
    (tmp_path / ".research-config.yaml").write_text(
        yaml.dump(config), encoding="utf-8"
    )

    # Write required files
    required = [
        "project-index.md", "requirements.md", "architecture-milestones.md",
        "todo.md", "cross-repo-mapping.md", "acceptance-report.md",
        "lessons-learned.md", "run-log.md", "change-decisions.md",
    ]
    for fname in required:
        (agent_os / fname).write_text(f"# {fname}\n", encoding="utf-8")

    # Write tasks
    if tasks:
        task_dir = research_dir / "frontend" / "f1"
        task_dir.mkdir(parents=True, exist_ok=True)
        for i, task in enumerate(tasks):
            with open(task_dir / f"task_{i}.yaml", "w", encoding="utf-8") as fh:
                yaml.dump(task, fh)


def test_status_output_format(tmp_path, monkeypatch):
    """Output should contain expected sections: Running, Recent, Next, Health."""
    monkeypatch.chdir(tmp_path)

    _setup_project(tmp_path, tasks=[
        {
            "id": "f1-h1-test",
            "title": "Test Task",
            "module": "f1",
            "direction": "frontend",
            "hypothesis": "test hypothesis",
            "null_hypothesis": "null",
            "phases": {
                "survey": {"status": "pending"},
                "method_design": {"status": "pending"},
                "experiment": {"status": "pending"},
                "conclusion": {"status": "pending"},
            },
            "depends_on": [],
            "results": {"verdict": None, "evidence_paths": [], "metrics": {}},
        },
    ])

    output = render_status(full=False)
    assert "Running:" in output, f"Expected 'Running:' section in output"
    assert "Recent:" in output, f"Expected 'Recent:' section in output"
    assert "Next:" in output, f"Expected 'Next:' section in output"
    assert "Health:" in output, f"Expected 'Health:' section in output"


def test_status_empty_project(tmp_path, monkeypatch):
    """A project with no tasks should show an empty state."""
    monkeypatch.chdir(tmp_path)

    _setup_project(tmp_path, tasks=[])

    output = render_status(full=False)
    assert "No research tasks found" in output, (
        f"Expected 'No research tasks found' for empty project, got:\n{output}"
    )


def test_task_current_phase_pending():
    """A fully pending task should report survey/pending."""
    task = {
        "phases": {
            "survey": {"status": "pending"},
            "method_design": {"status": "pending"},
            "experiment": {"status": "pending"},
            "conclusion": {"status": "pending"},
        },
        "results": {"verdict": None},
    }
    phase, status = task_current_phase(task)
    assert phase == "survey", f"Expected phase 'survey', got '{phase}'"
    assert status == "pending", f"Expected status 'pending', got '{status}'"


def test_task_current_phase_in_progress():
    """A task with experiment in_progress should report experiment."""
    task = {
        "phases": {
            "survey": {"status": "completed"},
            "method_design": {"status": "completed"},
            "experiment": {"status": "in_progress"},
            "conclusion": {"status": "pending"},
        },
        "results": {"verdict": None},
    }
    phase, status = task_current_phase(task)
    assert phase == "experiment", f"Expected phase 'experiment', got '{phase}'"
    assert status == "in_progress", f"Expected status 'in_progress', got '{status}'"


def test_task_current_phase_with_verdict():
    """A task with a verdict should report conclusion/verdict:X."""
    task = {
        "phases": {
            "survey": {"status": "completed"},
            "method_design": {"status": "completed"},
            "experiment": {"status": "completed"},
            "conclusion": {"status": "completed"},
        },
        "results": {"verdict": "confirmed"},
    }
    phase, status = task_current_phase(task)
    assert phase == "conclusion", f"Expected phase 'conclusion', got '{phase}'"
    assert "verdict:confirmed" in status, f"Expected 'verdict:confirmed' in status, got '{status}'"


def test_is_task_completed():
    """A task with a verdict should be considered completed."""
    task = {
        "results": {"verdict": "confirmed"},
        "phases": {"conclusion": {"status": "completed"}},
    }
    assert is_task_completed(task), "Expected task with verdict to be completed"


def test_is_task_not_completed():
    """A task with no verdict and pending conclusion should NOT be completed."""
    task = {
        "results": {"verdict": None},
        "phases": {"conclusion": {"status": "pending"}},
    }
    assert not is_task_completed(task), "Expected task without verdict to NOT be completed"


def test_is_task_blocked():
    """A task with unmet hard dependencies should be detected as blocked."""
    task = {
        "id": "t2",
        "depends_on": [{"task_id": "t1", "type": "hard", "reason": "needs t1"}],
    }
    all_tasks = [
        {
            "id": "t1",
            "results": {"verdict": None},
            "phases": {"conclusion": {"status": "pending"}},
        },
    ]
    blocked, blockers = is_task_blocked(task, all_tasks)
    assert blocked, "Expected task to be blocked"
    assert "t1" in blockers, f"Expected t1 in blockers, got {blockers}"


def test_progress_bar():
    """Progress bar rendering should match expected format."""
    bar = progress_bar(50, width=10)
    assert len(bar) == 12, f"Expected bar length 12 (2 brackets + 10 chars), got {len(bar)}"
    assert bar.startswith("["), f"Expected bar to start with '[', got: {bar}"
    assert bar.endswith("]"), f"Expected bar to end with ']', got: {bar}"


def test_quick_health_all_present(tmp_path, monkeypatch):
    """quick_health should pass when all required files are present."""
    monkeypatch.chdir(tmp_path)

    _setup_project(tmp_path)

    healthy, msg = quick_health()
    assert healthy, f"Expected healthy=True, got: {msg}"
