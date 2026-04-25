"""Process-real Thoth lifecycle integration tests."""

from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

import pytest
from thoth.init.render import render_codex_hooks_payload
from thoth.plan.compiler import compile_task_authority
from thoth.run.lease import local_registry_root


ROOT = Path(__file__).parent.parent.parent


def _run_cli(project_dir: Path, *args: str, env: dict[str, str] | None = None, timeout: float = 120) -> subprocess.CompletedProcess[str]:
    merged = dict(os.environ)
    existing = merged.get("PYTHONPATH", "")
    merged["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    if env:
        merged.update(env)
    return subprocess.run(
        [sys.executable, "-m", "thoth.cli", *args],
        cwd=str(project_dir),
        text=True,
        capture_output=True,
        env=merged,
        timeout=timeout,
    )


def _wait_until(predicate, *, timeout: float, description: str) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.2)
    raise AssertionError(f"Timed out waiting for {description}")


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def _extract_json(stdout: str) -> dict:
    start = stdout.find("{")
    assert start >= 0, stdout
    payload = json.loads(stdout[start:])
    assert isinstance(payload, dict)
    body = payload.get("body")
    if isinstance(body, dict) and isinstance(body.get("packet"), dict):
        return body["packet"]
    if isinstance(body, dict):
        status_payload = body.get("status")
        if isinstance(status_payload, dict):
            return status_payload
    return payload


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        handle.bind(("127.0.0.1", 0))
        return int(handle.getsockname()[1])


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
                "implementation_recipe": [
                    "Create detached runtime.",
                    "Observe attach/watch/stop/resume.",
                ],
                "baseline_ids": ["temp-project"],
                "eval_entrypoint": {"command": "pytest -q tests/integration/test_runtime_lifecycle_e2e.py"},
                "primary_metric": {"name": "lifecycle_checks", "direction": "gte", "threshold": 1},
                "failure_classes": ["runtime_drift", "lease_conflict_failure"],
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


@pytest.fixture
def thoth_project(tmp_path, monkeypatch):
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    subprocess.run(["git", "init"], cwd=str(project_dir), capture_output=True, check=False)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(project_dir), capture_output=True, check=False)
    subprocess.run(["git", "config", "user.name", "Thoth Test"], cwd=str(project_dir), capture_output=True, check=False)
    monkeypatch.setenv("THOTH_LOCAL_STATE_DIR", str(tmp_path / ".machine-state"))

    init = _run_cli(project_dir, "init")
    assert init.returncode == 0, init.stderr
    _write_task(project_dir)
    return project_dir


@pytest.mark.integration
def test_run_and_loop_lifecycle_end_to_end(thoth_project: Path):
    run_result = _run_cli(thoth_project, "run", "--task-id", "task-1")
    assert run_result.returncode == 0, run_result.stderr
    run_packet = _extract_json(run_result.stdout)
    run_id = run_packet["run_id"]
    assert run_packet["dispatch_mode"] == "live_native"
    run_json = _read_json(thoth_project / ".thoth" / "runs" / run_id / "run.json")
    assert run_json["task_id"] == "task-1"
    assert run_json["executor"] == "claude"

    watch_result = _run_cli(thoth_project, "run", "--watch", run_id, timeout=20)
    assert watch_result.returncode == 0
    assert "status=running" in watch_result.stdout

    conflict_result = _run_cli(thoth_project, "run", "--task-id", "task-1")
    assert conflict_result.returncode == 1
    assert "Active lease already held" in conflict_result.stderr

    stop_result = _run_cli(thoth_project, "run", "--stop", run_id)
    assert stop_result.returncode == 0
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / run_id / "state.json").get("status") == "stopped",
        timeout=15,
        description="live run to stop",
    )

    run_sleep_result = _run_cli(
        thoth_project,
        "run",
        "--task-id",
        "task-1",
        "--sleep",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"},
    )
    assert run_sleep_result.returncode == 0, run_sleep_result.stderr
    run_sleep_packet = _extract_json(run_sleep_result.stdout)
    run_sleep_id = run_sleep_packet["run_id"]
    assert run_sleep_packet["dispatch_mode"] == "external_worker"
    assert run_sleep_packet["worker_spawned"] is True
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / run_sleep_id / "state.json").get("status") == "completed",
        timeout=15,
        description="sleep run to complete",
    )

    loop_live_result = _run_cli(thoth_project, "loop", "--task-id", "task-1")
    assert loop_live_result.returncode == 0, loop_live_result.stderr
    loop_live_packet = _extract_json(loop_live_result.stdout)
    loop_live_id = loop_live_packet["run_id"]
    assert loop_live_packet["dispatch_mode"] == "live_native"
    loop_live_watch = _run_cli(thoth_project, "loop", "--watch", loop_live_id, timeout=20)
    assert loop_live_watch.returncode == 0
    assert "status=running" in loop_live_watch.stdout
    loop_live_stop = _run_cli(thoth_project, "loop", "--stop", loop_live_id)
    assert loop_live_stop.returncode == 0
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / loop_live_id / "state.json").get("status") == "stopped",
        timeout=15,
        description="live loop to stop",
    )

    loop_result = _run_cli(
        thoth_project,
        "loop",
        "--task-id",
        "task-1",
        "--sleep",
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "hold"},
    )
    assert loop_result.returncode == 0, loop_result.stderr
    loop_packet = _extract_json(loop_result.stdout)
    loop_id = loop_packet["run_id"]
    assert loop_packet["dispatch_mode"] == "external_worker"
    assert loop_packet["worker_spawned"] is True
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / loop_id / "state.json").get("status") in {"running", "completed"},
        timeout=15,
        description="sleep loop to become active",
    )

    loop_stop = _run_cli(thoth_project, "loop", "--stop", loop_id)
    assert loop_stop.returncode == 0
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / loop_id / "state.json").get("status") in {"stopped", "completed"},
        timeout=15,
        description="loop to stop",
    )


@pytest.mark.integration
def test_dashboard_process_and_hooks_are_observable(thoth_project: Path):
    config_path = thoth_project / ".thoth" / "project" / "project.json"
    config = _read_json(config_path)
    port = _free_port()
    config["dashboard"]["port"] = port
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    run_result = _run_cli(thoth_project, "run", "--task-id", "task-1")
    assert run_result.returncode == 0
    run_packet = _extract_json(run_result.stdout)
    run_id = run_packet["run_id"]

    dashboard_env = {"THOTH_HEARTBEAT_STALE_MINUTES": "1"}
    start = _run_cli(thoth_project, "dashboard", "start", env=dashboard_env, timeout=60)
    assert start.returncode == 0, start.stderr

    def _status_payload():
        with urlopen(f"http://127.0.0.1:{port}/api/status", timeout=5) as response:  # noqa: S310
            return json.loads(response.read().decode("utf-8"))

    _wait_until(
        lambda: _status_payload()["runtime"]["active_run_count"] >= 1,
        timeout=20,
        description="dashboard backend to expose runtime payload",
    )

    with urlopen(f"http://127.0.0.1:{port}/api/tasks/task-1/active-run", timeout=5) as response:  # noqa: S310
        active_run = json.loads(response.read().decode("utf-8"))
    assert active_run["run_id"] == run_id
    assert active_run["task_id"] == "task-1"

    state_path = thoth_project / ".thoth" / "runs" / run_id / "state.json"
    state = _read_json(state_path)
    state["last_heartbeat_at"] = "2000-01-01T00:00:00Z"
    state["updated_at"] = "2000-01-01T00:00:00Z"
    state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with urlopen(f"http://127.0.0.1:{port}/api/tasks/task-1/active-run", timeout=5) as response:  # noqa: S310
        stale_run = json.loads(response.read().decode("utf-8"))
    assert stale_run["is_stale"] is True

    hooks_json = render_codex_hooks_payload()
    start_hook = hooks_json["hooks"]["SessionStart"][0]["hooks"][0]
    stop_hook = hooks_json["hooks"]["Stop"][0]["hooks"][0]
    assert "thoth hook --host codex --event start" in start_hook["command"]
    assert "thoth hook --host codex --event stop" in stop_hook["command"]
    assert "thoth-codex-hook.sh" in start_hook["command"]
    assert "thoth-codex-hook.sh" in stop_hook["command"]

    hook_env = dict(os.environ)
    hook_env["THOTH_SOURCE_ROOT"] = str(ROOT)
    hook_start = subprocess.run(
        ["bash", "scripts/thoth-codex-hook.sh", "start"],
        cwd=str(thoth_project),
        capture_output=True,
        text=True,
        timeout=60,
        env=hook_env,
        input=json.dumps({"source": "resume", "session_id": "codex-test-session"}),
    )
    assert hook_start.returncode == 0
    hook_start_payload = json.loads(hook_start.stdout)
    assert "additionalContext" in hook_start_payload["hookSpecificOutput"]
    assert "Active durable runs" in hook_start_payload["hookSpecificOutput"]["additionalContext"]

    hook_stop = subprocess.run(
        ["bash", "scripts/thoth-codex-hook.sh", "stop"],
        cwd=str(thoth_project),
        capture_output=True,
        text=True,
        timeout=60,
        env=hook_env,
        input=json.dumps({"last_assistant_message": "runtime summary"}),
    )
    assert hook_stop.returncode == 0

    conversations_payload = (thoth_project / ".thoth" / "project" / "conversations.jsonl").read_text(encoding="utf-8")
    assert '"type": "hook"' in conversations_payload
    assert '"event": "start"' in conversations_payload
    assert '"event": "stop"' in conversations_payload

    out_of_repo_stop = subprocess.run(
        ["bash", "-lc", stop_hook["command"]],
        cwd="/",
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert out_of_repo_stop.returncode == 0, out_of_repo_stop.stderr

    hook_end = subprocess.run(
        ["bash", "scripts/session-end-check.sh"],
        cwd=str(thoth_project),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert hook_end.returncode == 0
    assert "PASS" in hook_end.stdout or hook_end.stdout == ""

    broken_task = thoth_project / ".thoth" / "project" / "contracts" / "CTR-broken.json"
    broken_task.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "kind": "contract",
                "contract_id": "CTR-broken",
                "task_id": "task-broken",
                "scope_id": "broken",
                "direction": "frontend",
                "module": "f1",
                "title": "Broken contract",
                "decision_ids": ["DEC-missing"],
                "candidate_method_id": "broken",
                "status": "frozen",
                "blocking_gaps": [],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    broken_hook = subprocess.run(
        ["bash", "scripts/session-end-check.sh"],
        cwd=str(thoth_project),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert broken_hook.returncode != 0
    broken_task.unlink(missing_ok=True)

    stop = _run_cli(thoth_project, "dashboard", "stop", timeout=30)
    assert stop.returncode == 0

    restart = _run_cli(thoth_project, "dashboard", "start", env=dashboard_env, timeout=60)
    assert restart.returncode == 0
    _wait_until(
        lambda: _status_payload()["runtime"]["active_run_count"] >= 0,
        timeout=20,
        description="dashboard restart",
    )

    _run_cli(thoth_project, "dashboard", "stop", timeout=30)
    _run_cli(thoth_project, "run", "--stop", run_id, timeout=20)
