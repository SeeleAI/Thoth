"""Tests for Thoth internal runtime protocol helpers."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.run.ledger import (
    append_protocol_event,
    complete_run,
    fail_run,
    heartbeat_run,
    record_artifact,
)
from thoth.run.model import CLAUDE_EXTERNAL_WORKER_ALLOWED_TOOLS
from thoth.run.packets import prepare_execution
from thoth.run.phases import default_validate_output_schema, next_phase_payload, submit_phase_output
from thoth.run.worker import ExternalWorkerPhaseDriver, build_external_worker_prompt, external_worker_command


def _prepare_project(tmp_path: Path) -> Path:
    project = tmp_path / "project"
    project.mkdir()
    (project / ".thoth" / "project").mkdir(parents=True)
    return project


def test_prepare_execution_writes_packet_and_live_dispatch(tmp_path):
    project = _prepare_project(tmp_path)
    handle, packet = prepare_execution(
        project,
        command_id="run",
        title="Demo task",
        task_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task={"task_id": "task-1", "title": "Demo task"},
        goal="ship demo",
    )
    assert packet["run_id"] == handle.run_id
    assert packet["dispatch_mode"] == "live_native"
    assert (handle.run_dir / "packet.json").exists()
    assert "next_phase" in packet["controller_commands"]
    assert len(json.dumps(packet, ensure_ascii=False)) < 3400


def test_protocol_updates_artifacts_and_completion_shape(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="review",
        title="Review demo",
        task_id=None,
        host="claude",
        executor="claude",
        sleep_requested=False,
        target="src/app.py",
        goal="review app",
    )
    append_protocol_event(project, handle.run_id, message="started review", kind="log", phase="analyzing", progress_pct=20)
    heartbeat_run(project, handle.run_id, phase="writing_findings", progress_pct=60, note="heartbeat")
    record_artifact(project, handle.run_id, path="artifacts/findings.json", label="findings")
    complete_run(
        project,
        handle.run_id,
        summary="Review finished.",
        result_payload={
            "summary": "1 issue",
            "findings": [
                {
                    "severity": "high",
                    "title": "Missing validation",
                    "path": "src/app.py",
                    "line": 12,
                    "summary": "input guard missing",
                }
            ],
        },
        checks=[{"name": "structured_findings", "ok": True}],
    )

    state = json.loads((handle.run_dir / "state.json").read_text(encoding="utf-8"))
    result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    artifacts = json.loads((handle.run_dir / "artifacts.json").read_text(encoding="utf-8"))
    assert state["status"] == "completed"
    assert result["status"] == "completed"
    assert result["result"]["findings"][0]["title"] == "Missing validation"
    assert artifacts["artifacts"][0]["label"] == "findings"


def test_review_packet_includes_exact_completion_command_when_expectation_is_frozen(tmp_path):
    project = _prepare_project(tmp_path)
    handle, packet = prepare_execution(
        project,
        command_id="review",
        title="Review demo",
        task_id="task-review-probe",
        host="claude",
        executor="codex",
        sleep_requested=False,
        target="tracker/review_probe.py",
        goal="review app",
        strict_task={
            "task_id": "task-review-probe",
            "review_expectation": {
                "summary": "1 issue",
                "findings": [
                    {
                        "severity": "high",
                        "title": "Empty title accepted",
                        "path": "tracker/review_probe.py",
                        "line": 4,
                        "summary": "Blank titles are persisted as valid task state.",
                    }
                ],
            },
        },
    )

    exact_command = packet["protocol_commands"]["complete_exact"]
    assert handle.run_id in exact_command
    assert "--summary" in exact_command
    assert "--result-json" in exact_command
    assert "--checks-json" in exact_command
    assert "review_exact_match" in exact_command
    assert "Empty title accepted" in exact_command


def test_review_completion_dedupes_duplicate_findings(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="review",
        title="Review demo",
        task_id=None,
        host="claude",
        executor="claude",
        sleep_requested=False,
        target="src/app.py",
        goal="review app",
    )
    complete_run(
        project,
        handle.run_id,
        summary="Review finished.",
        result_payload={
            "summary": "2 issues",
            "findings": [
                {
                    "severity": "high",
                    "title": "Missing validation",
                    "path": "src/app.py",
                    "line": 12,
                    "summary": "input guard missing",
                },
                {
                    "severity": "high",
                    "title": "Missing validation",
                    "path": "src/app.py",
                    "line": 12,
                    "summary": "input guard missing",
                },
            ],
        },
    )
    result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert len(result["result"]["findings"]) == 1


def test_fail_run_writes_failure_shape(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Broken task",
        task_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task={"task_id": "task-1"},
        goal="broken",
    )
    fail_run(project, handle.run_id, summary="Execution failed.", reason="validator failed")
    state = json.loads((handle.run_dir / "state.json").read_text(encoding="utf-8"))
    result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    assert state["status"] == "failed"
    assert result["status"] == "failed"
    assert result["checks"][0]["detail"] == "validator failed"


def test_external_worker_prompt_mentions_protocol_and_limits(tmp_path):
    project = _prepare_project(tmp_path)
    handle, packet = prepare_execution(
        project,
        command_id="loop",
        title="Loop demo",
        task_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=True,
        strict_task={
            "task_id": "task-1",
            "title": "Loop demo",
            "implementation_recipe": ["Edit files", "Run validator"],
            "eval_entrypoint": {"command": "pytest -q tests/test_demo.py"},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="close loop",
        max_rounds=5,
        max_runtime_seconds=720,
    )
    prompt = build_external_worker_prompt(handle, packet)
    assert handle.run_id in prompt
    assert "Do not invoke `$thoth run`, `$thoth loop`, or `$thoth review`." in prompt
    assert "\"max_iterations\": 10" in prompt
    assert "pytest -q tests/test_demo.py" in prompt
    assert "worker-output.json" in prompt
    assert len(json.dumps(packet, ensure_ascii=False)) < 4200
    assert len(prompt) < 4000


def test_phase_packets_include_phase_specific_prompt_contract(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Prompt demo",
        task_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task={
            "task_id": "task-1",
            "title": "Prompt demo",
            "implementation_recipe": ["Edit files", "Run validator"],
            "eval_entrypoint": {"command": "pytest -q tests/test_demo.py"},
            "validate_output_schema": default_validate_output_schema(),
        },
        goal="close prompt gaps",
    )
    execute_packet = next_phase_payload(project, handle.run_id)
    assert execute_packet["phase"] == "execute"
    assert execute_packet["phase_authority"]["objective"].startswith("Perform the smallest execution slice")
    assert "Do not terminalize the full run from inside execute." in execute_packet["phase_authority"]["hard_stops"]

    submit_phase_output(
        project,
        handle.run_id,
        phase="execute",
        payload={"summary": "exec ok", "files_touched": [], "commands_run": [], "artifacts": []},
    )
    validate_packet = next_phase_payload(project, handle.run_id)
    assert validate_packet["phase"] == "validate"
    assert validate_packet["phase_authority"]["objective"] != execute_packet["phase_authority"]["objective"]


def test_phase_output_rejects_overlong_summary(tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Budget demo",
        task_id="task-1",
        host="codex",
        executor="claude",
        sleep_requested=False,
        strict_task={"task_id": "task-1", "title": "Budget demo"},
        goal="close budget gap",
    )
    too_long = "x" * 25
    try:
        submit_phase_output(
            project,
            handle.run_id,
            phase="execute",
            payload={"summary": too_long, "files_touched": [], "commands_run": [], "artifacts": []},
        )
    except ValueError as exc:
        assert "execute.summary exceeds 24 UTF-8 chars" in str(exc)
    else:
        raise AssertionError("expected summary budget failure")


def test_external_worker_retries_with_shorter_correction_prompt(monkeypatch, tmp_path):
    project = _prepare_project(tmp_path)
    handle, _packet = prepare_execution(
        project,
        command_id="run",
        title="Retry demo",
        task_id="task-1",
        host="codex",
        executor="codex",
        sleep_requested=False,
        strict_task={"task_id": "task-1", "title": "Retry demo"},
        goal="retry bad worker output",
    )
    phase_packet = next_phase_payload(project, handle.run_id)
    output_path = handle.run_dir / "execute.worker-output.json"
    prompts: list[str] = []

    def _fake_run(command, cwd, stdout, stderr, text, env, timeout):
        prompts.append(command[-1])
        if len(prompts) == 1:
            output_path.write_text(
                json.dumps({"summary": "x" * 25, "files_touched": [], "commands_run": [], "artifacts": []}) + "\n",
                encoding="utf-8",
            )
        else:
            output_path.write_text(
                json.dumps({"summary": "exec ok", "files_touched": [], "commands_run": [], "artifacts": []}) + "\n",
                encoding="utf-8",
            )
        return type("Proc", (), {"returncode": 0})()

    monkeypatch.setattr("thoth.run.worker.subprocess.run", _fake_run)
    driver = ExternalWorkerPhaseDriver(executor="codex", timeout_seconds=5)
    payload = driver.execute_phase(handle=handle, phase_packet=phase_packet)

    assert payload["summary"] == "exec ok"
    assert len(prompts) == 2
    assert "Previous output failed validation: execute.summary exceeds 24 UTF-8 chars" in prompts[1]


def test_external_worker_command_uses_executor_specific_cli(tmp_path):
    project = _prepare_project(tmp_path)
    codex_cmd = external_worker_command("codex", project, "prompt")
    claude_cmd = external_worker_command("claude", project, "prompt")
    assert codex_cmd[:5] == ["codex", "exec", "-m", "gpt-5.4", "--json"]
    assert "-C" in codex_cmd
    assert str(project) in codex_cmd
    assert claude_cmd[:2] == ["claude", "-p"]
    assert "--permission-mode" in claude_cmd
    assert "--allowed-tools" in claude_cmd
    assert CLAUDE_EXTERNAL_WORKER_ALLOWED_TOOLS in claude_cmd
