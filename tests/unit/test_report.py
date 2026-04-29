"""Tests for strict report generation."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from report import (
    generate_report,
    is_task_completed,
    parse_run_log_entries,
    task_completed_in_range,
    task_created_in_range,
    task_current_phase,
)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _setup_project(tmp_path: Path) -> None:
    (tmp_path / ".agent-os").mkdir(exist_ok=True)
    (tmp_path / ".agent-os" / "run-log.md").write_text(
        "# Run Log\n\n- 2026-01-10 14:00 UTC [task started]\n  - Started task-1\n",
        encoding="utf-8",
    )
    _write_json(
        tmp_path / ".thoth" / "project" / "project.json",
        {"project": {"name": "TestProject", "directions": [{"id": "frontend"}]}},
    )
    _write_json(
        tmp_path / ".thoth" / "project" / "tasks" / "task-1.json",
        {
            "task_id": "task-1",
            "title": "Imported Task",
            "module": "f1",
            "direction": "frontend",
            "ready_state": "imported_resolved",
            "generated_at": "2026-01-15T10:00:00Z",
        },
    )
    _write_json(
        tmp_path / ".thoth" / "project" / "tasks" / "task-1.result.json",
        {
            "task_id": "task-1",
            "source": "legacy_import",
            "updated_at": "2026-02-15T17:00:00Z",
            "evidence_paths": ["reports/task-1.md"],
            "metrics": {},
            "conclusion": "Imported from legacy.",
        },
    )


def test_report_generates_markdown(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _setup_project(tmp_path)
    output_path = tmp_path / "reports" / "test-report.md"
    from_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 3, 1, 23, 59, 59, tzinfo=timezone.utc)
    generate_report(from_date, to_date, output_path)
    content = output_path.read_text(encoding="utf-8")
    assert "# Progress Report:" in content
    assert "## Summary" in content
    assert "## Completed" in content
    assert "## In Progress" in content
    assert "## Blockers & Risks" in content


def test_parse_run_log_entries():
    run_log = "# Run Log\n\n- 2026-01-10 14:00 UTC [task started]\n  - Started\n\n- 2026-02-15 10:00 UTC [task completed]\n  - Completed\n"
    from_date = datetime(2026, 1, 1, tzinfo=timezone.utc)
    to_date = datetime(2026, 1, 31, 23, 59, 59, tzinfo=timezone.utc)
    entries = parse_run_log_entries(run_log, from_date, to_date)
    assert len(entries) == 1


def test_task_completed_and_created_helpers():
    task = {"generated_at": "2026-01-15T10:00:00Z", "work_result": {"updated_at": "2026-02-15T17:00:00Z"}}
    assert is_task_completed(task)
    assert task_created_in_range(task, datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 1, 31, 23, 59, 59, tzinfo=timezone.utc))
    assert task_completed_in_range(task, datetime(2026, 2, 1, tzinfo=timezone.utc), datetime(2026, 2, 28, 23, 59, 59, tzinfo=timezone.utc))


def test_task_current_phase():
    phase, status = task_current_phase({"work_result": {"updated_at": "2026-04-24T00:00:00Z", "source": "legacy_import"}})
    assert phase == "work_result"
    assert status == "legacy_import"
