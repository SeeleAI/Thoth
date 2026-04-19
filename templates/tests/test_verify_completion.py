"""Test verify_completion.py in the deployed project."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / ".agent-os" / "research-tasks"))


def test_verify_phase_pending_skipped():
    from verify_completion import verify_phase
    result = verify_phase("survey", {"status": "pending"})
    assert result == [], "Pending phase should produce no failures"


def test_verify_phase_completed_with_criteria():
    from verify_completion import verify_phase
    phase = {
        "status": "completed",
        "criteria": {"metric": "accuracy", "threshold": 80, "current": 90, "unit": "%"},
        "deliverables": [],
    }
    result = verify_phase("experiment", phase)
    assert result == [], f"Valid completed phase should pass: {result}"


def test_verify_phase_null_criteria_fails():
    from verify_completion import verify_phase
    phase = {
        "status": "completed",
        "criteria": {"metric": "accuracy", "threshold": 80, "current": None, "unit": "%"},
        "deliverables": [],
    }
    result = verify_phase("experiment", phase)
    assert len(result) > 0, "Null criteria.current on completed phase should fail"
