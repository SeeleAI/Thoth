"""Tests for strict status script output."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from status import (
    is_task_blocked,
    is_task_completed,
    progress_bar,
    quick_health,
    render_status,
    task_current_phase,
)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _setup_project(tmp_path: Path) -> None:
    (tmp_path / ".agent-os").mkdir(exist_ok=True)
    for fname in [
        "project-index.md",
        "requirements.md",
        "architecture-milestones.md",
        "todo.md",
        "cross-repo-mapping.md",
        "acceptance-report.md",
        "lessons-learned.md",
        "run-log.md",
        "change-decisions.md",
    ]:
        (tmp_path / ".agent-os" / fname).write_text(f"# {fname}\n", encoding="utf-8")
    _write_json(
        tmp_path / ".thoth" / "project" / "project.json",
        {
            "project": {"name": "TestProject", "directions": [{"id": "frontend"}]},
            "dashboard": {"port": 8501},
        },
    )
    _write_json(
        tmp_path / ".thoth" / "project" / "compiler-state.json",
        {
            "summary": {
                "decision_counts": {"open": 0, "frozen": 1},
                "task_counts": {"ready": 0, "blocked": 0, "invalid": 0, "imported_resolved": 1, "total": 1},
            }
        },
    )


def test_status_output_format(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _setup_project(tmp_path)
    _write_json(
        tmp_path / ".thoth" / "project" / "tasks" / "task-1.json",
        {"task_id": "task-1", "title": "Imported", "module": "f1", "direction": "frontend", "ready_state": "imported_resolved"},
    )
    _write_json(
        tmp_path / ".thoth" / "project" / "tasks" / "task-1.result.json",
        {"task_id": "task-1", "source": "legacy_import", "updated_at": "2026-04-24T00:00:00Z", "evidence_paths": ["reports/demo.md"], "metrics": {}},
    )

    output = render_status(full=False)
    assert "Running:" in output
    assert "Recent:" in output
    assert "Next:" in output
    assert "Health:" in output


def test_status_empty_project(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _setup_project(tmp_path)
    output = render_status(full=False)
    assert "No strict tasks found" in output


def test_task_current_phase_with_verdict():
    phase, status = task_current_phase({"task_result": {"updated_at": "2026-04-24T00:00:00Z", "source": "legacy_import"}})
    assert phase == "task_result"
    assert status == "task_result:legacy_import"


def test_is_task_completed():
    assert is_task_completed({"task_result": {"updated_at": "2026-04-24T00:00:00Z"}})
    assert not is_task_completed({"ready_state": "blocked"})


def test_is_task_blocked():
    blocked, blockers = is_task_blocked({"ready_state": "blocked", "depends_on": [{"task_id": "dep", "type": "hard"}]}, [])
    assert blocked
    assert blockers == ["dep"]


def test_progress_bar():
    bar = progress_bar(50, width=10)
    assert len(bar) == 12
    assert bar.startswith("[")
    assert bar.endswith("]")


def test_quick_health_all_present(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _setup_project(tmp_path)
    healthy, msg = quick_health()
    assert healthy
    assert "Strict authority" in msg or "Last run-log update" in msg
