"""Tests for the mechanical run/loop phase controller."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.run.packets import prepare_execution
from thoth.run.phases import (
    default_validate_output_schema,
    next_phase_payload,
    submit_phase_output,
)


def _prepare_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / ".thoth" / "project").mkdir(parents=True)
    return project


def _strict_task(*, runtime_contract: dict | None = None) -> dict:
    payload = {
        "work_id": "task-1",
        "title": "Demo task",
        "work_goal": "Ship the demo work.",
        "implementation_recipe": ["Plan edits", "Execute edits", "Run validator"],
        "eval_entrypoint": {"command": "pytest -q"},
        "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
        "failure_classes": ["runtime_drift"],
        "validate_output_schema": default_validate_output_schema(),
    }
    if runtime_contract is not None:
        payload["runtime_contract"] = runtime_contract
    return payload


def test_run_state_machine_completes_after_validate_pass(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Demo task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(),
        goal="ship demo",
    )

    phase = next_phase_payload(project, handle.run_id)
    assert phase["phase"] == "plan"
    submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload={
            "summary": "plan ok",
            "execution_steps": ["edit", "test"],
            "files_expected": [],
            "commands_expected": ["pytest -q"],
            "validation_plan": "run pytest",
            "risk_assessment": "low risk",
        },
    )
    submit_phase_output(
        project,
        handle.run_id,
        phase="execute",
        payload={"summary": "exec ok", "files_touched": [], "commands_run": [], "artifacts": []},
    )
    interim = submit_phase_output(
        project,
        handle.run_id,
        phase="validate",
        payload={
            "summary": "pass",
            "passed": True,
            "metric_name": "checks",
            "metric_value": 1,
            "threshold": 1,
            "checks": [{"name": "checks", "ok": True}],
        },
    )
    assert interim["terminal"] is False
    assert interim["next_phase"] == "reflect"
    result = submit_phase_output(
        project,
        handle.run_id,
        phase="reflect",
        payload={
            "summary": "reflect ok",
            "outcome": "passed",
            "residual_risks": [],
            "evidence": ["checks passed"],
            "next_recommendation": "close run",
        },
    )

    assert result["terminal"] is True
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["status"] == "completed"
    assert run_result["result"]["validate_passed"] is True
    assert run_result["result"]["phase_statuses"]["execute"] == "completed"
    assert run_result["result"]["phase_statuses"]["validate"] == "completed"
    assert run_result["result"]["phase_statuses"]["reflect"] == "completed"


def test_run_state_machine_forces_reflect_after_validate_failure(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Broken task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(),
        goal="ship demo",
    )
    submit_phase_output(
        project,
        handle.run_id,
        phase="plan",
        payload={
            "summary": "plan ok",
            "execution_steps": ["edit", "test"],
            "files_expected": [],
            "commands_expected": ["pytest -q"],
            "validation_plan": "run pytest",
            "risk_assessment": "low risk",
        },
    )
    submit_phase_output(
        project,
        handle.run_id,
        phase="execute",
        payload={"summary": "exec ok", "files_touched": [], "commands_run": [], "artifacts": []},
    )
    interim = submit_phase_output(
        project,
        handle.run_id,
        phase="validate",
        payload={
            "summary": "fail",
            "passed": False,
            "metric_name": "checks",
            "metric_value": 0,
            "threshold": 1,
            "checks": [{"name": "checks", "ok": False}],
        },
    )
    assert interim["terminal"] is False
    assert interim["next_phase"] == "reflect"

    final = submit_phase_output(
        project,
        handle.run_id,
        phase="reflect",
        payload={
            "summary": "reflect ok",
            "outcome": "failed",
            "residual_risks": ["checks failed"],
            "evidence": ["checks failed"],
            "next_recommendation": "retry",
            "failure_class": "checks",
            "root_cause": "validator failed",
            "next_plan_hint": "change implementation before retrying",
        },
    )
    assert final["terminal"] is True
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["status"] == "failed"
    assert run_result["result"]["phase_statuses"]["validate"] == "failed"
    assert run_result["result"]["phase_statuses"]["reflect"] == "completed"
    assert run_result["result"]["next_hint"] == "change implementation before retrying"


def test_loop_parent_stops_on_iteration_budget(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="loop",
        title="Loop task",
        work_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task=_strict_task(
            runtime_contract={"loop": {"max_iterations": 2, "max_runtime_seconds": 28800}}
        ),
        goal="close loop",
    )

    for _ in range(2):
        phase = next_phase_payload(project, handle.run_id)
        assert phase["phase"] == "plan"
        submit_phase_output(
            project,
            handle.run_id,
            phase="plan",
            payload={
                "summary": "plan ok",
                "execution_steps": ["edit", "test"],
                "files_expected": [],
                "commands_expected": ["pytest -q"],
                "validation_plan": "run pytest",
                "risk_assessment": "low risk",
            },
        )
        submit_phase_output(
            project,
            handle.run_id,
            phase="execute",
            payload={"summary": "exec ok", "files_touched": [], "commands_run": [], "artifacts": []},
        )
        submit_phase_output(
            project,
            handle.run_id,
            phase="validate",
            payload={
                "summary": "fail",
                "passed": False,
                "metric_name": "checks",
                "metric_value": 0,
                "threshold": 1,
                "checks": [{"name": "checks", "ok": False}],
            },
        )
        result = submit_phase_output(
            project,
            handle.run_id,
            phase="reflect",
            payload={
                "summary": "reflect ok",
                "outcome": "failed",
                "residual_risks": ["checks failed"],
                "evidence": ["checks failed"],
                "next_recommendation": "retry",
                "failure_class": "checks",
                "root_cause": "validator failed",
                "next_plan_hint": "retry with a better plan",
            },
        )

    assert result["terminal"] is True
    assert result["status"] == "failed"
    run_result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert run_result["result"]["iterations_attempted"] == 2
    assert run_result["result"]["budget_exhausted_by"] == "max_iterations"
    assert len(run_result["result"]["child_run_ids"]) == 2
