"""Tests for canonical discussion/decision/work_item object authority."""

from __future__ import annotations

from thoth.objects import ActiveExecutionLock, Store, flatten_work_item, work_item_ready_errors
from thoth.plan.compiler import compile_task_authority
from thoth.plan.doctor import build_doctor_payload
from thoth.plan.store import (
    create_discussion_placeholder,
    ensure_work_authority_tree,
    load_work_for_execution,
    load_work_result,
    upsert_work_item,
    upsert_decision,
    upsert_work_result,
)
from thoth.run.ledger import create_run
from thoth.run.phases import default_validate_output_schema


def _ready_work_payload(decision_id: str = "DEC-001") -> dict:
    return {
        "work_id": "work-1",
        "title": "Runtime validation",
        "status": "ready",
        "work_type": "task",
        "runnable": True,
        "goal": "Validate runtime lifecycle.",
        "context": "runtime",
        "constraints": ["tmp-project"],
        "execution_plan": ["Run detached lifecycle."],
        "eval_contract": {
            "entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
            "failure_classes": ["runtime_drift"],
            "validate_output_schema": default_validate_output_schema(),
        },
        "runtime_policy": {"loop": {"max_iterations": 3, "max_runtime_seconds": 60}},
        "decisions": [decision_id],
        "missing_questions": [],
    }


def test_discuss_work_json_creates_ready_work_item_object(tmp_path):
    ensure_work_authority_tree(tmp_path)
    decision = upsert_decision(
        tmp_path,
        {
            "decision_id": "DEC-001",
            "question": "Which method should be used?",
            "candidate_method_ids": ["real-process"],
            "selected_values": {"candidate_method_id": "real-process"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    work = upsert_work_item(tmp_path, _ready_work_payload(decision["decision_id"]))
    compiler = compile_task_authority(tmp_path)

    assert compiler["summary"]["work_item_counts"]["ready"] == 1
    assert compiler["summary"]["decision_counts"]["accepted"] == 1

    loaded = load_work_for_execution(tmp_path, "work-1")
    assert loaded["ready_state"] == "ready"
    assert loaded["work_id"] == "work-1"
    assert loaded["revision"] == 1
    assert loaded["runtime_contract"]["loop"]["max_iterations"] == 3


def test_ready_gate_rejects_missing_eval_contract(tmp_path):
    ensure_work_authority_tree(tmp_path)
    payload = _ready_work_payload()
    payload["eval_contract"].pop("validate_output_schema")
    work = upsert_work_item(tmp_path, payload)
    assert work["ready_state"] == "blocked"
    assert "validate_output_schema" in work["blocking_reason"]
    compiler = compile_task_authority(tmp_path)
    assert compiler["summary"]["work_item_counts"]["blocked"] == 1


def test_inquiring_discussion_does_not_generate_ready_work(tmp_path):
    ensure_work_authority_tree(tmp_path)
    discussion = create_discussion_placeholder(tmp_path, "Need to freeze method universe")
    compiler = compile_task_authority(tmp_path)
    assert discussion["status"] == "inquiring"
    assert compiler["summary"]["work_item_counts"]["ready"] == 0
    assert (tmp_path / ".thoth" / "objects" / "discussion" / f"{discussion['discussion_id']}.json").exists()


def test_doctor_reads_object_graph_and_flags_legacy_yaml(tmp_path):
    ensure_work_authority_tree(tmp_path)
    legacy_task = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1" / "task-1.yaml"
    legacy_task.parent.mkdir(parents=True, exist_ok=True)
    legacy_task.write_text("id: task-1\nhypothesis: stale legacy\n", encoding="utf-8")
    payload = build_doctor_payload(tmp_path)
    assert payload["overall_ok"] is False
    assert payload["summary"]["legacy_task_count"] == 1


def test_work_result_read_view_uses_docs_not_work_item_authority(tmp_path):
    ensure_work_authority_tree(tmp_path)
    upsert_work_result(
        tmp_path,
        "work-1",
        {
            "source": "run_result",
            "usable": True,
            "meets_goal": True,
            "conclusion": "Ship",
            "evidence_paths": ["reports/demo.md"],
            "metrics": {},
            "updated_at": "2026-04-24T00:00:00Z",
        },
    )
    work_result = load_work_result(tmp_path, "work-1")
    assert work_result["conclusion"] == "Ship"
    assert ".thoth/docs/work-results/work-1.result.json" in str(
        tmp_path / ".thoth" / "docs" / "work-results" / "work-1.result.json"
    )


def test_active_run_locks_work_item_mutation(tmp_path):
    ensure_work_authority_tree(tmp_path)
    upsert_decision(tmp_path, {"decision_id": "DEC-001", "question": "Method", "status": "frozen", "candidate_method_ids": ["a"], "unresolved_gaps": []})
    upsert_work_item(tmp_path, _ready_work_payload())
    create_run(tmp_path, kind="run", title="Run", work_id="work-1", work_revision=1, host="codex", executor="claude")

    try:
        upsert_work_item(tmp_path, {**_ready_work_payload(), "title": "Changed title"})
    except ActiveExecutionLock as exc:
        assert "work_item:work-1" in str(exc)
    else:
        raise AssertionError("active work item mutation should be rejected")
