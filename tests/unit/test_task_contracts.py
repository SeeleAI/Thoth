"""Tests for strict decision/contract/task compilation."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.plan.compiler import compile_task_authority
from thoth.plan.doctor import build_doctor_payload
from thoth.plan.store import (
    create_discussion_placeholder,
    ensure_task_authority_tree,
    load_task_for_execution,
    load_task_result,
    upsert_contract,
    upsert_decision,
    upsert_task_result,
)
from thoth.run.phases import default_validate_output_schema


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_compile_generates_ready_task_for_frozen_contract(tmp_path):
    ensure_task_authority_tree(tmp_path)
    upsert_decision(
        tmp_path,
        {
            "decision_id": "DEC-001",
            "scope_id": "runtime",
            "question": "Which method should be used?",
            "candidate_method_ids": ["real-process"],
            "selected_values": {"candidate_method_id": "real-process"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    upsert_contract(
        tmp_path,
        {
            "contract_id": "CTR-001",
            "task_id": "task-1",
            "scope_id": "runtime",
            "direction": "frontend",
            "module": "f1",
            "title": "Runtime validation",
            "decision_ids": ["DEC-001"],
            "candidate_method_id": "real-process",
            "goal_statement": "Validate runtime lifecycle.",
            "implementation_recipe": ["Run detached lifecycle."],
            "baseline_ids": ["tmp-project"],
            "eval_entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
            "failure_classes": ["runtime_drift"],
            "validate_output_schema": default_validate_output_schema(),
            "status": "frozen",
            "blocking_gaps": [],
        },
    )
    compiler = compile_task_authority(tmp_path)
    assert compiler["summary"]["task_counts"]["ready"] == 1

    task = load_task_for_execution(tmp_path, "task-1")
    assert task["ready_state"] == "ready"
    assert task["contract_id"] == "CTR-001"
    assert task["runtime_contract"]["loop"]["max_iterations"] == 10
    assert task["runtime_contract"]["loop"]["max_runtime_seconds"] == 28800


def test_compile_marks_missing_validate_output_schema_invalid(tmp_path):
    ensure_task_authority_tree(tmp_path)
    upsert_decision(
        tmp_path,
        {
            "decision_id": "DEC-VAL",
            "scope_id": "runtime",
            "question": "Which method should be used?",
            "candidate_method_ids": ["real-process"],
            "selected_values": {"candidate_method_id": "real-process"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    upsert_contract(
        tmp_path,
        {
            "contract_id": "CTR-VAL",
            "task_id": "task-val",
            "scope_id": "runtime",
            "direction": "frontend",
            "module": "f1",
            "title": "Runtime validation without schema",
            "decision_ids": ["DEC-VAL"],
            "candidate_method_id": "real-process",
            "goal_statement": "Validate runtime lifecycle.",
            "implementation_recipe": ["Run detached lifecycle."],
            "baseline_ids": ["tmp-project"],
            "eval_entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
            "failure_classes": ["runtime_drift"],
            "status": "frozen",
            "blocking_gaps": [],
        },
    )
    compiler = compile_task_authority(tmp_path)
    assert "task-val" in compiler["invalid_task_ids"]


def test_compile_blocks_contract_with_open_decision(tmp_path):
    ensure_task_authority_tree(tmp_path)
    decision = create_discussion_placeholder(tmp_path, "Need to freeze method universe")
    upsert_contract(
        tmp_path,
        {
            "contract_id": "CTR-open",
            "task_id": "task-open",
            "scope_id": "runtime",
            "title": "Open contract",
            "decision_ids": [decision["decision_id"]],
            "candidate_method_id": "unknown",
            "status": "draft",
        },
    )
    compiler = compile_task_authority(tmp_path)
    assert compiler["summary"]["decision_counts"]["open"] >= 1
    assert compiler["summary"]["task_counts"]["blocked"] >= 1


def test_doctor_fails_when_legacy_yaml_exists(tmp_path):
    ensure_task_authority_tree(tmp_path)
    legacy_task = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1" / "task-1.yaml"
    legacy_task.parent.mkdir(parents=True, exist_ok=True)
    legacy_task.write_text("id: task-1\nhypothesis: stale legacy\n", encoding="utf-8")
    payload = build_doctor_payload(tmp_path)
    assert payload["overall_ok"] is False
    assert payload["summary"]["legacy_task_count"] == 1


def test_compile_uses_external_task_result_ledger(tmp_path):
    ensure_task_authority_tree(tmp_path)
    upsert_task_result(
        tmp_path,
        "task-1",
        {
            "source": "legacy_import",
            "usable": True,
            "meets_goal": False,
            "failure_class": "metric_shortfall",
            "reasons": ["baseline stronger"],
            "conclusion": "No ship",
            "evidence_paths": ["reports/demo.md"],
            "metrics": {},
            "updated_at": "2026-04-24T00:00:00Z",
        },
    )
    upsert_decision(
        tmp_path,
        {
            "decision_id": "DEC-001",
            "scope_id": "runtime",
            "question": "Which method should be used?",
            "candidate_method_ids": ["real-process"],
            "selected_values": {"candidate_method_id": "real-process"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    upsert_contract(
        tmp_path,
        {
            "contract_id": "CTR-001",
            "task_id": "task-1",
            "scope_id": "runtime",
            "direction": "frontend",
            "module": "f1",
            "title": "Runtime validation",
            "decision_ids": ["DEC-001"],
            "candidate_method_id": "real-process",
            "goal_statement": "Validate runtime lifecycle.",
            "implementation_recipe": ["Run detached lifecycle."],
            "baseline_ids": ["tmp-project"],
            "eval_entrypoint": {"command": "pytest -q"},
            "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
            "failure_classes": ["runtime_drift"],
            "validate_output_schema": default_validate_output_schema(),
            "status": "frozen",
            "blocking_gaps": [],
        },
    )
    compile_task_authority(tmp_path)
    task = load_task_for_execution(tmp_path, "task-1")
    assert task["task_result_ref"] == ".thoth/project/tasks/task-1.result.json"
    task_result = load_task_result(tmp_path, "task-1")
    assert task_result["failure_class"] == "metric_shortfall"
    assert task_result["updated_at"] == "2026-04-24T00:00:00Z"
