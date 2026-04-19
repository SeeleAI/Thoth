"""Tests for report generation (report.py)."""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from report import (
    generate_report,
    parse_run_log_entries,
    task_current_phase,
    is_task_completed,
    task_completed_in_range,
    task_created_in_range,
)


def _setup_project(tmp_path, tasks=None, run_log_content=""):
    """Set up a minimal project for report testing."""
    agent_os = tmp_path / ".agent-os"
    agent_os.mkdir(exist_ok=True)
    research_dir = agent_os / "research-tasks"
    research_dir.mkdir(exist_ok=True)

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

    # run-log.md
    (agent_os / "run-log.md").write_text(run_log_content, encoding="utf-8")

    if tasks:
        task_dir = research_dir / "frontend" / "f1"
        task_dir.mkdir(parents=True, exist_ok=True)
        for i, task in enumerate(tasks):
            with open(task_dir / f"task_{i}.yaml", "w", encoding="utf-8") as fh:
                yaml.dump(task, fh)


def test_report_generates_markdown(tmp_path, monkeypatch):
    """Generated report should be valid markdown with expected sections."""
    monkeypatch.chdir(tmp_path)

    _setup_project(tmp_path, tasks=[
        {
            "id": "f1-h1-test",
            "title": "Test Task",
            "module": "f1",
            "direction": "frontend",
            "hypothesis": "test",
            "null_hypothesis": "null",
            "phases": {
                "survey": {"status": "completed", "completed_at": "2026-01-20T17:00:00Z",
                           "deliverables": []},
                "method_design": {"status": "completed", "completed_at": "2026-01-25T17:00:00Z",
                                  "deliverables": []},
                "experiment": {"status": "completed", "completed_at": "2026-02-10T17:00:00Z",
                               "deliverables": []},
                "conclusion": {"status": "completed", "completed_at": "2026-02-15T17:00:00Z",
                               "deliverables": []},
            },
            "depends_on": [],
            "results": {"verdict": "confirmed", "evidence_paths": [], "metrics": {}},
            "created_at": "2026-01-15T10:00:00Z",
        },
    ])

    output_path = tmp_path / "reports" / "test-report.md"
    from_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 3, 1, 23, 59, 59, tzinfo=timezone.utc)

    generate_report(from_date, to_date, output_path)

    assert output_path.exists(), f"Expected report file at {output_path}"
    content = output_path.read_text(encoding="utf-8")

    # Check required markdown sections
    assert "# Progress Report:" in content, "Expected report title"
    assert "## Summary" in content, "Expected Summary section"
    assert "## Completed" in content, "Expected Completed section"
    assert "## In Progress" in content, "Expected In Progress section"
    assert "## Blockers & Risks" in content, "Expected Blockers & Risks section"


def test_report_date_filtering(tmp_path, monkeypatch):
    """Report should only include entries within the specified date range."""
    monkeypatch.chdir(tmp_path)

    run_log = """# Run Log

- 2026-01-10 14:00 UTC [task started]
  - Started f1-h1-test survey phase

- 2026-02-15 10:00 UTC [task completed]
  - Completed f1-h1-test conclusion phase

- 2026-03-20 09:00 UTC [out of range entry]
  - This should not appear in Jan-Feb report
"""

    _setup_project(tmp_path, tasks=[], run_log_content=run_log)

    # Parse entries for January only
    from_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 1, 31, 23, 59, 59, tzinfo=timezone.utc)

    entries = parse_run_log_entries(run_log, from_date, to_date)

    assert len(entries) == 1, f"Expected 1 entry in January range, got {len(entries)}"
    assert "2026-01-10" in entries[0], f"Expected January entry, got: {entries[0]}"


def test_report_date_filtering_full_range(tmp_path, monkeypatch):
    """Entries within a broad range should all be included."""
    monkeypatch.chdir(tmp_path)

    run_log = """# Run Log

- 2026-01-10 14:00 UTC [task started]
  - Started survey

- 2026-02-15 10:00 UTC [task completed]
  - Completed conclusion
"""

    from_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)

    entries = parse_run_log_entries(run_log, from_date, to_date)
    assert len(entries) == 2, f"Expected 2 entries in full year range, got {len(entries)}"


def test_task_completed_in_range():
    """task_completed_in_range should correctly check date boundaries."""
    task = {
        "phases": {
            "conclusion": {
                "status": "completed",
                "completed_at": "2026-02-15T17:00:00Z",
            },
        },
    }

    # Within range
    from_date = datetime(2026, 2, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 2, 28, 23, 59, 59, tzinfo=timezone.utc)
    assert task_completed_in_range(task, from_date, to_date), (
        "Expected task completed on Feb 15 to be in Feb range"
    )

    # Outside range
    from_date = datetime(2026, 3, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 3, 31, 23, 59, 59, tzinfo=timezone.utc)
    assert not task_completed_in_range(task, from_date, to_date), (
        "Expected task completed on Feb 15 to NOT be in March range"
    )


def test_task_created_in_range():
    """task_created_in_range should correctly check creation date."""
    task = {"created_at": "2026-01-15T10:00:00Z"}

    from_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 1, 31, 23, 59, 59, tzinfo=timezone.utc)
    assert task_created_in_range(task, from_date, to_date), (
        "Expected task created on Jan 15 to be in January range"
    )


def test_report_empty_project(tmp_path, monkeypatch):
    """Report for a project with no tasks should still generate valid markdown."""
    monkeypatch.chdir(tmp_path)

    _setup_project(tmp_path, tasks=[], run_log_content="")

    output_path = tmp_path / "reports" / "empty-report.md"
    from_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 12, 31, 23, 59, 59, tzinfo=timezone.utc)

    generate_report(from_date, to_date, output_path)

    assert output_path.exists(), "Expected report file to be created even for empty project"
    content = output_path.read_text(encoding="utf-8")
    assert "# Progress Report:" in content
    assert "No tasks completed" in content or "0" in content
