"""Tests for the official `$thoth` CLI surface."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from thoth.task_contracts import compile_task_authority


ROOT = Path(__file__).parent.parent.parent


def _run_cli(tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    return subprocess.run(
        [sys.executable, "-m", "thoth.cli", *args],
        cwd=str(tmp_path),
        text=True,
        capture_output=True,
        env=env,
    )


def _write_task(project_dir: Path, task_id: str = "task-1") -> None:
    decisions = project_dir / ".thoth" / "project" / "decisions"
    contracts = project_dir / ".thoth" / "project" / "contracts"
    decisions.mkdir(parents=True, exist_ok=True)
    contracts.mkdir(parents=True, exist_ok=True)
    (decisions / "DEC-test-runtime.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "kind": "decision",
                "decision_id": "DEC-test-runtime",
                "scope_id": "frontend-runtime",
                "question": "Which runtime validation method should be executed?",
                "candidate_method_ids": ["real-process-lifecycle"],
                "selected_values": {"candidate_method_id": "real-process-lifecycle"},
                "status": "frozen",
                "unresolved_gaps": [],
                "created_at": "2026-04-24T00:00:00Z",
                "updated_at": "2026-04-24T00:00:00Z",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (contracts / "CTR-test-runtime.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "kind": "contract",
                "contract_id": "CTR-test-runtime",
                "task_id": task_id,
                "scope_id": "frontend-runtime",
                "direction": "frontend",
                "module": "f1",
                "title": "Lifecycle Validation",
                "decision_ids": ["DEC-test-runtime"],
                "candidate_method_id": "real-process-lifecycle",
                "goal_statement": "State stays inspectable under real execution.",
                "implementation_recipe": ["Create runtime packet.", "Observe protocol updates."],
                "baseline_ids": ["temp-project"],
                "eval_entrypoint": {"command": "pytest -q tests/unit/test_cli_surface.py"},
                "primary_metric": {"name": "lifecycle_checks", "direction": "gte", "threshold": 1},
                "failure_classes": ["runtime_drift"],
                "status": "frozen",
                "blocking_gaps": [],
                "created_at": "2026-04-24T00:00:00Z",
                "updated_at": "2026-04-24T00:00:00Z",
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    compile_task_authority(project_dir)


def _extract_json_object(text: str) -> dict:
    start = text.find("{")
    if start < 0:
        raise AssertionError(f"No JSON object found in output: {text!r}")
    return json.loads(text[start:])


def test_cli_init_creates_project_layer(tmp_path):
    result = _run_cli(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    assert (tmp_path / ".thoth" / "project" / "project.json").exists()
    assert (tmp_path / "AGENTS.md").exists()
    assert (tmp_path / ".thoth" / "derived" / "codex-hooks.json").exists()


def test_cli_discuss_records_note(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "planning", "note")
    assert result.returncode == 0
    note_path = tmp_path / ".thoth" / "project" / "conversations.jsonl"
    assert note_path.exists()
    payload = json.loads(note_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["type"] == "discuss"
    assert payload["content"] == "planning note"
    decisions = list((tmp_path / ".thoth" / "project" / "decisions").glob("*.json"))
    assert decisions, "Discuss should materialize an open decision placeholder"


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
    decision_path = tmp_path / ".thoth" / "project" / "decisions" / "DEC-host-real-selftest.json"
    assert decision_path.exists()
    stored = json.loads(decision_path.read_text(encoding="utf-8"))
    assert stored["status"] == "frozen"
    assert "Compiler summary:" in result.stdout


def test_cli_review_records_note(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "review", "audit", "this")
    assert result.returncode == 0
    note_path = tmp_path / ".thoth" / "project" / "conversations.jsonl"
    payload = json.loads(note_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["type"] == "review"
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
    payload = json.loads(result.stdout)
    assert payload["active_run_count"] == 0
    assert payload["compiler"]["task_counts"]["total"] == 0


def test_cli_doctor_quick(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "doctor", "--quick")
    assert result.returncode == 0
    assert "Thoth Doctor" in result.stdout


def test_cli_run_rejects_free_form_execution(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "run", "legacy free text")
    assert result.returncode == 2
    assert "--task-id" in result.stderr


def test_cli_runtime_defaults_and_prepare_packet(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "run", "--task-id", "task-1")
    assert result.returncode == 0, result.stderr
    packet = _extract_json_object(result.stdout)
    assert packet["command_id"] == "run"
    assert packet["executor"] == "claude"
    assert packet["dispatch_mode"] == "live_native"
    assert "complete" in packet["protocol_commands"]


def test_cli_sleep_mode_auto_backgrounds(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "loop", "--task-id", "task-1", "--sleep")
    assert result.returncode == 0, result.stderr
    packet = _extract_json_object(result.stdout)
    assert packet["dispatch_mode"] == "external_worker"
    assert packet["worker_spawned"] is True


def test_cli_live_mode_rejects_detach(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    _write_task(tmp_path)
    result = _run_cli(tmp_path, "run", "--task-id", "task-1", "--detach")
    assert result.returncode == 2
    assert "--sleep" in result.stderr
