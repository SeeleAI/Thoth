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
from thoth.run.worker import build_external_worker_prompt, external_worker_command


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
    assert "heartbeat" in packet["protocol_commands"]


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
        result_payload={"findings": [{"severity": "high", "title": "Missing validation"}]},
        checks=[{"name": "structured_findings", "ok": True}],
    )

    state = json.loads((handle.run_dir / "state.json").read_text(encoding="utf-8"))
    result = json.loads((handle.run_dir / "result.json").read_text(encoding="utf-8"))
    artifacts = json.loads((handle.run_dir / "artifacts.json").read_text(encoding="utf-8"))
    assert state["status"] == "completed"
    assert result["status"] == "completed"
    assert result["result"]["findings"][0]["title"] == "Missing validation"
    assert artifacts["artifacts"][0]["label"] == "findings"


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
        },
        goal="close loop",
        max_rounds=5,
        max_runtime_seconds=720,
    )
    prompt = build_external_worker_prompt(handle, packet)
    assert handle.run_id in prompt
    assert "Do NOT call `$thoth run`, `$thoth loop`, or `$thoth review` again." in prompt
    assert "at most 5 rounds" in prompt
    assert "pytest -q tests/test_demo.py" in prompt
    assert "complete" in prompt and "fail" in prompt


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
