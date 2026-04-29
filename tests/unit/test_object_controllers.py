"""Tests for object-graph controller services."""

from __future__ import annotations

from thoth.objects import Store
from thoth.plan.store import ensure_work_authority_tree, upsert_work_item, upsert_decision
from thoth.run.controllers import create_auto_controller, create_orchestration_controller
from thoth.run.phases import default_validate_output_schema


def _work_payload(work_id: str) -> dict:
    return {
        "work_id": work_id,
        "title": work_id,
        "status": "ready",
        "work_type": "task",
        "runnable": True,
        "goal": f"Complete {work_id}",
        "context": "test",
        "constraints": ["small"],
        "execution_plan": ["execute one step"],
        "eval_contract": {
            "entrypoint": {"command": "true"},
            "primary_metric": {"name": "ok", "direction": "gte", "threshold": 1},
            "failure_classes": ["failed"],
            "validate_output_schema": default_validate_output_schema(),
        },
        "runtime_policy": {"loop": {"max_iterations": 3, "max_runtime_seconds": 60}},
        "decisions": ["DEC-001"],
        "missing_questions": [],
    }


def _seed_ready_work(tmp_path, *work_ids: str) -> None:
    ensure_work_authority_tree(tmp_path)
    upsert_decision(
        tmp_path,
        {
            "decision_id": "DEC-001",
            "question": "method",
            "status": "frozen",
            "candidate_method_ids": ["direct"],
            "unresolved_gaps": [],
        },
    )
    for work_id in work_ids:
        upsert_work_item(tmp_path, _work_payload(work_id))


def test_orchestration_controller_batches_by_depends_on_links(tmp_path):
    _seed_ready_work(tmp_path, "work-a", "work-b")
    store = Store(tmp_path)
    store.link("work_item", "work-b", link_type="depends_on", target_kind="work_item", target_id="work-a")

    controller = create_orchestration_controller(tmp_path, work_ids=["work-a", "work-b"], host="codex", executor="claude")

    assert controller["kind"] == "controller"
    assert controller["payload"]["controller_type"] == "orchestration"
    assert controller["payload"]["batches"] == [["work-a"], ["work-b"]]
    assert controller["payload"]["work_refs"][0]["revision"] == 1


def test_auto_controller_records_linear_queue_cursor(tmp_path):
    _seed_ready_work(tmp_path, "work-a", "work-b")

    controller = create_auto_controller(tmp_path, work_ids=["work-a", "work-b"], mode="loop", host="codex", executor="claude")

    assert controller["payload"]["controller_type"] == "auto"
    assert controller["payload"]["mode"] == "loop"
    assert [item["work_id"] for item in controller["payload"]["queue"]] == ["work-a", "work-b"]
    assert controller["payload"]["cursor"] == {"index": 0, "active_run_id": None, "completed_work_ids": []}
