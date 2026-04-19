"""Tests for completion verification (verify_completion.py)."""

import sys
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from verify_completion import verify_phase, verify_results


def test_completed_task_passes(golden_task_completed, tmp_path):
    """A fully completed task with valid criteria should pass all phase checks
    when deliverable files exist."""
    with open(golden_task_completed, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    phases = data.get("phases", {})
    all_failures = []
    for phase_name, phase in phases.items():
        if phase is None:
            continue
        failures = verify_phase(phase_name, phase)
        criteria_failures = [f for f in failures if "deliverable" not in f.lower() and "not found" not in f.lower()]
        all_failures.extend(criteria_failures)

    assert all_failures == [], (
        f"Expected completed task to pass criteria checks, "
        f"got {len(all_failures)} failure(s): {all_failures}"
    )


def test_null_criteria_fails(golden_task_null_criteria):
    """A completed phase with criteria.current=null should fail verification."""
    with open(golden_task_null_criteria, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    # The experiment phase is completed but has criteria.current = null
    experiment_phase = data["phases"]["experiment"]
    failures = verify_phase("experiment", experiment_phase)

    assert len(failures) > 0, "Expected null criteria.current on completed phase to fail"
    # Check that the failure message mentions null criteria
    joined = " ".join(failures)
    assert "null" in joined.lower() or "current" in joined.lower(), (
        f"Expected failure message to mention null criteria, got: {failures}"
    )


def test_missing_deliverable_fails(tmp_path):
    """A completed phase whose deliverable path does not exist should fail."""
    phase = {
        "status": "completed",
        "started_at": "2026-01-01T09:00:00Z",
        "completed_at": "2026-01-05T17:00:00Z",
        "criteria": {
            "metric": "test_metric",
            "threshold": 1,
            "current": 1,
            "unit": "count",
        },
        "deliverables": [
            {
                "path": "reports/nonexistent-file.md",
                "type": "report",
                "description": "This file does not exist",
            }
        ],
    }
    failures = verify_phase("survey", phase)
    # verify_phase checks deliverables against PROJECT_ROOT which is set at import time.
    # The deliverable path reports/nonexistent-file.md almost certainly does not exist
    # under the real PROJECT_ROOT, so this should fail.
    assert any("deliverable" in f.lower() or "not found" in f.lower() for f in failures), (
        f"Expected missing deliverable to be reported, got: {failures}"
    )


def test_null_verdict_on_completed_conclusion_fails():
    """If conclusion is completed but verdict is null, verify_results should fail."""
    task = {
        "phases": {
            "survey": {"status": "completed"},
            "method_design": {"status": "completed"},
            "experiment": {"status": "completed"},
            "conclusion": {"status": "completed"},
        },
        "results": {
            "verdict": None,
            "evidence_paths": [],
            "metrics": {},
        },
    }
    failures = verify_results(task)
    assert len(failures) > 0, "Expected null verdict on completed conclusion to fail"
    assert any("verdict" in f.lower() and "null" in f.lower() for f in failures), (
        f"Expected failure about null verdict, got: {failures}"
    )


def test_empty_evidence_paths_fails():
    """If verdict is set but evidence_paths is empty, verify_results should fail."""
    task = {
        "phases": {
            "conclusion": {"status": "completed"},
        },
        "results": {
            "verdict": "confirmed",
            "evidence_paths": [],
            "metrics": {},
        },
    }
    failures = verify_results(task)
    assert len(failures) > 0, "Expected empty evidence_paths with set verdict to fail"
    assert any("evidence" in f.lower() and "empty" in f.lower() for f in failures), (
        f"Expected failure about empty evidence_paths, got: {failures}"
    )


def test_pending_phase_skipped():
    """Pending phases should not trigger any checks and should pass."""
    phase = {
        "status": "pending",
        "started_at": None,
        "completed_at": None,
        "criteria": {
            "metric": "test",
            "threshold": 5,
            "current": None,
            "unit": "items",
        },
        "deliverables": [
            {
                "path": "reports/nonexistent.md",
                "type": "report",
            }
        ],
    }
    failures = verify_phase("survey", phase)
    assert failures == [], (
        f"Expected pending phase to produce no failures, got: {failures}"
    )


def test_in_progress_phase_skipped():
    """In-progress phases should not trigger completion checks."""
    phase = {
        "status": "in_progress",
        "started_at": "2026-01-01T09:00:00Z",
        "completed_at": None,
        "criteria": {
            "metric": "papers_reviewed",
            "threshold": 10,
            "current": 3,
            "unit": "papers",
        },
    }
    failures = verify_phase("survey", phase)
    assert failures == [], (
        f"Expected in_progress phase to produce no failures, got: {failures}"
    )


def test_completed_phase_with_met_criteria_passes():
    """A completed phase where current >= threshold should pass criteria check."""
    phase = {
        "status": "completed",
        "started_at": "2026-01-01T09:00:00Z",
        "completed_at": "2026-01-05T17:00:00Z",
        "criteria": {
            "metric": "papers_reviewed",
            "threshold": 5,
            "current": 7,
            "unit": "count",
        },
        "deliverables": [],
    }
    failures = verify_phase("survey", phase)
    # Only deliverable checks may fail; criteria should pass since 7 >= 5
    criteria_failures = [f for f in failures if "criteria" in f.lower()]
    assert criteria_failures == [], (
        f"Expected met criteria to pass, got: {criteria_failures}"
    )


def test_completed_phase_below_threshold_fails():
    """A completed phase where current < threshold should fail."""
    phase = {
        "status": "completed",
        "started_at": "2026-01-01T09:00:00Z",
        "completed_at": "2026-01-05T17:00:00Z",
        "criteria": {
            "metric": "papers_reviewed",
            "threshold": 10,
            "current": 3,
            "unit": "count",
        },
        "deliverables": [],
    }
    failures = verify_phase("survey", phase)
    assert any("criteria not met" in f.lower() for f in failures), (
        f"Expected below-threshold criteria to fail, got: {failures}"
    )
