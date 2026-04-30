"""Tests for the official `$thoth` CLI surface."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from thoth.plan.store import upsert_work_item, upsert_decision
from thoth.run.phases import default_validate_output_schema


ROOT = Path(__file__).parent.parent.parent


def _run_cli(tmp_path: Path, *args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    merged_env = dict(os.environ)
    existing = merged_env.get("PYTHONPATH", "")
    merged_env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    if env:
        merged_env.update(env)
    return subprocess.run(
        [sys.executable, "-m", "thoth.cli", *args],
        cwd=str(tmp_path),
        text=True,
        capture_output=True,
        env=merged_env,
    )


def _write_task(
    project_dir: Path,
    work_id: str = "task-1",
    *,
    title: str = "Lifecycle Validation",
    work_goal: str = "State stays inspectable under real execution.",
    module: str = "f1",
    direction: str = "frontend",
    eval_command: str = "pytest -q tests/unit/test_cli_surface.py",
) -> None:
    decision_id = f"DEC-{work_id}"
    upsert_decision(
        project_dir,
        {
            "schema_version": 1,
            "kind": "decision",
            "decision_id": decision_id,
            "scope_id": f"{module}-{work_id}",
            "question": "Which runtime validation method should be executed?",
            "candidate_method_ids": ["real-process-lifecycle"],
            "selected_values": {"candidate_method_id": "real-process-lifecycle"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    upsert_work_item(
        project_dir,
        {
            "schema_version": 1,
            "kind": "work_item",
            "work_id": work_id,
            "direction": direction,
            "module": module,
            "title": title,
            "status": "ready",
            "work_type": "task",
            "runnable": True,
            "goal": work_goal,
            "context": f"{module}-{work_id}",
            "constraints": ["temp-project"],
            "execution_plan": ["Create runtime packet.", "Observe protocol updates."],
            "eval_contract": {
                "entrypoint": {"command": eval_command},
                "primary_metric": {"name": "lifecycle_checks", "direction": "gte", "threshold": 1},
                "failure_classes": ["runtime_drift"],
                "validate_output_schema": default_validate_output_schema(),
            },
            "runtime_policy": {"loop": {"max_iterations": 10, "max_runtime_seconds": 28800}},
            "decisions": [decision_id],
            "missing_questions": [],
        },
    )


def _extract_envelope(text: str) -> dict:
    start = text.find("{")
    if start < 0:
        raise AssertionError(f"No JSON object found in output: {text!r}")
    payload = json.loads(text[start:])
    if not isinstance(payload, dict):
        raise AssertionError(f"Expected object payload, got: {payload!r}")
    return payload


def _extract_json_object(text: str) -> dict:
    payload = _extract_envelope(text)
    body = payload.get("body")
    if isinstance(body, dict):
        if isinstance(body.get("packet"), dict):
            return body["packet"]
        if isinstance(body.get("status"), dict):
            return body["status"]
        if isinstance(body.get("doctor"), dict):
            return body["doctor"]
        if isinstance(body.get("result"), dict):
            return body["result"]
    return payload


def _jsonl_events(text: str) -> list[dict]:
    rows: list[dict] = []
    for line in text.splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if isinstance(payload, dict):
            rows.append(payload)
    return rows


def test_cli_init_creates_project_layer(tmp_path):
    result = _run_cli(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    assert (tmp_path / ".thoth" / "objects" / "project" / "project.json").exists()
    assert (tmp_path / ".thoth" / "docs" / "project.json").exists()
    assert (tmp_path / "AGENTS.md").exists()
    assert (tmp_path / ".thoth" / "derived" / "codex-hooks.json").exists()


def test_cli_discuss_records_note(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "planning", "note")
    assert result.returncode == 0
    discussions = list((tmp_path / ".thoth" / "objects" / "discussion").glob("*.json"))
    assert discussions, "Discuss should materialize an inquiring discussion object"
    payload = json.loads(discussions[-1].read_text(encoding="utf-8"))
    assert payload["kind"] == "discussion"
    assert payload["status"] == "inquiring"
    assert payload["payload"]["messages"][-1]["content"] == "planning note"


def test_cli_discuss_accepts_structured_decision_payload(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    payload = json.dumps(
        {
            "decision_id": "DEC-host-real-selftest",
            "scope_id": "host-real-board",
            "question": "Which host-real validation workflow should the disposable board follow?",
            "candidate_method_ids": ["feature-run", "bugfix-run", "review-loop"],
            "selected_values": {"workflow": ["feature-run", "bugfix-run", "review-loop"]},
            "status": "frozen",
            "unresolved_gaps": [],
        },
        ensure_ascii=False,
    )
    result = _run_cli(tmp_path, "discuss", "--decision-json", payload)
    assert result.returncode == 0, result.stderr
    decision_path = tmp_path / ".thoth" / "objects" / "decision" / "DEC-host-real-selftest.json"
    assert decision_path.exists()
    stored = json.loads(decision_path.read_text(encoding="utf-8"))
    assert stored["status"] == "accepted"
    payload = json.loads(result.stdout)
    assert payload["command"] == "discuss"
    assert payload["status"] == "ok"


def test_cli_review_records_note(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "review", "audit", "this")
    assert result.returncode == 0
    packet = _extract_json_object(result.stdout)
    assert packet["command_id"] == "review"
    assert packet["dispatch_mode"] == "live_native"


def test_cli_sync_regenerates_project_layer(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    agents_path = tmp_path / "AGENTS.md"
    agents_path.write_text("drifted\n", encoding="utf-8")
    result = _run_cli(tmp_path, "sync")
    assert result.returncode == 0
    assert "drifted" not in agents_path.read_text(encoding="utf-8")


def test_cli_status_json(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "status", "--json")
    assert result.returncode == 0
    payload = _extract_json_object(result.stdout)
    assert payload["active_run_count"] == 0
    assert payload["compiler"]["work_item_counts"]["total"] == 0


def test_cli_doctor_quick(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "doctor", "--quick")
    assert result.returncode == 0
    assert "Thoth Doctor" in result.stdout


def test_cli_run_rejects_free_form_execution(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "task-auth-fix", title="Fix Auth Session", work_goal="Repair session persistence bug in auth flow.")
    _write_task(tmp_path, "task-dashboard", title="Dashboard Polish", work_goal="Polish dashboard filters and layout.")
    result = _run_cli(tmp_path, "run", "legacy free text")
    assert result.returncode == 2
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "needs_input"
    assert payload["command"] == "run"
    assert payload["body"]["candidates"]
    assert "No work item was created" in payload["summary"]


def test_cli_run_without_work_id_suggests_closest_work_items_and_stops(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "task-auth-fix", title="Fix Auth Session", work_goal="Repair session persistence bug in auth flow.")
    _write_task(tmp_path, "task-dashboard", title="Dashboard Polish", work_goal="Polish dashboard filters and layout.")
    _write_task(tmp_path, "task-report", title="Report Cleanup", work_goal="Clean report rendering and summary wording.")
    result = _run_cli(tmp_path, "run", "fix", "auth", "session")
    assert result.returncode == 2
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "needs_input"
    assert payload["body"]["query"] == "fix auth session"
    candidates = payload["body"]["candidates"]
    assert len(candidates) == 3
    assert candidates[0]["work_id"] == "task-auth-fix"


def test_cli_loop_without_work_id_uses_goal_to_suggest_work_items_and_stops(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path, "task-column-persist", title="Persist Column Settings", work_goal="Persist dashboard column selections across reloads.")
    _write_task(tmp_path, "task-auth-fix", title="Fix Auth Session", work_goal="Repair session persistence bug in auth flow.")
    result = _run_cli(tmp_path, "loop", "--goal", "persist dashboard column", "--sleep")
    assert result.returncode == 2
    payload = _extract_envelope(result.stdout)
    assert payload["status"] == "needs_input"
    assert payload["body"]["query"] == "persist dashboard column"
    assert payload["body"]["candidates"][0]["work_id"] == "task-column-persist"


def test_cli_runtime_defaults_and_prepare_packet(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "run", "--work-id", "task-1", env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"})
    assert result.returncode == 0, result.stderr
    events = _jsonl_events(result.stdout)
    assert events[0]["type"] == "thoth.run.started"
    assert events[0]["executor"] == "codex"
    assert events[-1]["type"] == "thoth.run.terminal"
    assert events[-1]["status"] == "completed"


def test_cli_sleep_mode_auto_backgrounds(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "loop", "--work-id", "task-1", "--sleep")
    assert result.returncode == 0, result.stderr
    packet = _extract_json_object(result.stdout)
    assert packet["dispatch_mode"] == "external_worker"
    assert packet["worker_spawned"] is True


def test_cli_live_mode_rejects_removed_detach_flag(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "run", "--work-id", "task-1", "--detach")
    assert result.returncode == 2
    assert "--detach" in result.stderr
