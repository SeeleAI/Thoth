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
from thoth.plan.store import upsert_work_item, upsert_decision
from thoth.run.lease import local_registry_root
from thoth.run.phases import default_validate_output_schema


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


def _extract_runtime_run_id(stdout: str) -> str:
    for raw in stdout.splitlines():
        if not raw.strip():
            continue
        payload = json.loads(raw)
        if isinstance(payload, dict) and str(payload.get("type") or "").startswith("thoth."):
            run_id = payload.get("run_id")
            if isinstance(run_id, str) and run_id:
                return run_id
    raise AssertionError(f"No runtime run id found in output: {stdout!r}")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        handle.bind(("127.0.0.1", 0))
        return int(handle.getsockname()[1])


def _write_task(project_dir: Path, work_id: str = "task-1") -> None:
    upsert_decision(
        project_dir,
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
        },
    )
    upsert_work_item(
        project_dir,
        {
            "schema_version": 1,
            "kind": "work_item",
            "work_id": work_id,
            "direction": "frontend",
            "module": "f1",
            "title": "Lifecycle Validation",
            "status": "ready",
            "work_type": "task",
            "runnable": True,
            "goal": "State stays inspectable under real execution.",
            "context": "frontend-runtime",
            "constraints": ["temp-project"],
            "execution_plan": [
                "Create detached runtime.",
                "Observe attach/watch/stop/resume.",
            ],
            "eval_contract": {
                "entrypoint": {"command": "pytest -q tests/integration/test_runtime_lifecycle_e2e.py"},
                "primary_metric": {"name": "lifecycle_checks", "direction": "gte", "threshold": 1},
                "failure_classes": ["runtime_drift", "lease_conflict_failure"],
                "validate_output_schema": default_validate_output_schema(),
            },
            "runtime_policy": {"loop": {"max_iterations": 10, "max_runtime_seconds": 28800}},
            "decisions": ["DEC-test-runtime"],
            "missing_questions": [],
        },
    )


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
    run_result = _run_cli(thoth_project, "run", "--work-id", "task-1", env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"})
    assert run_result.returncode == 0, run_result.stderr
    run_id = _extract_runtime_run_id(run_result.stdout)
    run_json = _read_json(thoth_project / ".thoth" / "runs" / run_id / "run.json")
    assert run_json["work_id"] == "task-1"
    assert run_json["executor"] == "codex"

    watch_result = _run_cli(thoth_project, "run", "--watch", run_id, timeout=20)
    assert watch_result.returncode == 0
    assert "status=completed" in watch_result.stdout

    run_sleep_result = _run_cli(
        thoth_project,
        "run",
        "--work-id",
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

    loop_live_result = _run_cli(thoth_project, "loop", "--work-id", "task-1", env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"})
    assert loop_live_result.returncode == 0, loop_live_result.stderr
    loop_live_id = _extract_runtime_run_id(loop_live_result.stdout)
    loop_live_watch = _run_cli(thoth_project, "loop", "--watch", loop_live_id, timeout=20)
    assert loop_live_watch.returncode == 0
    assert "status=completed" in loop_live_watch.stdout

    loop_result = _run_cli(
        thoth_project,
        "loop",
        "--work-id",
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
    config_path = thoth_project / ".thoth" / "objects" / "project" / "project.json"
    config = _read_json(config_path)
    port = _free_port()
    config["payload"]["dashboard"]["port"] = port
    config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    run_result = _run_cli(thoth_project, "run", "--work-id", "task-1", "--sleep", env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "hold"})
    assert run_result.returncode == 0
    run_id = _extract_json(run_result.stdout)["run_id"]

    dashboard_env = {"THOTH_HEARTBEAT_STALE_MINUTES": "1"}
    start = _run_cli(thoth_project, "dashboard", "start", env=dashboard_env, timeout=60)
    assert start.returncode == 0, start.stderr
    status_cache_path = thoth_project / ".thoth" / "derived" / "dashboard.status.json"
    port_cache_path = thoth_project / ".thoth" / "derived" / "dashboard.port"
    assert status_cache_path.exists()
    assert port_cache_path.exists()
    cached_status = _read_json(status_cache_path)
    assert isinstance(cached_status.get("runtime"), dict)
    assert "active_run_count" in cached_status["runtime"]
    assert port_cache_path.read_text(encoding="utf-8").strip() == str(port)

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
    assert active_run["work_id"] == "task-1"

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

    hook_discussions = [
        json.loads(path.read_text(encoding="utf-8"))
        for path in (thoth_project / ".thoth" / "objects" / "discussion").glob("*.json")
    ]
    hook_messages = json.dumps(hook_discussions, ensure_ascii=False)
    assert '"event": "start"' in hook_messages
    assert '"event": "stop"' in hook_messages

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
        env=hook_env,
    )
    assert hook_end.returncode == 0
    assert "PASS" in hook_end.stdout or hook_end.stdout == ""

    broken_task = thoth_project / ".thoth" / "objects" / "work_item" / "task-broken.json"
    broken_task.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "kind": "work_item",
                "object_id": "task-broken",
                "status": "ready",
                "title": "Broken contract",
                "summary": "Broken work item",
                "revision": 1,
                "created_at": "2026-04-29T00:00:00Z",
                "updated_at": "2026-04-29T00:00:00Z",
                "source": "test",
                "links": [],
                "payload": {
                    "work_type": "task",
                    "runnable": True,
                    "missing_questions": [],
                },
                "history": [],
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
    assert not status_cache_path.exists()
    assert not port_cache_path.exists()

    restart = _run_cli(thoth_project, "dashboard", "start", env=dashboard_env, timeout=60)
    assert restart.returncode == 0
    assert status_cache_path.exists()
    assert port_cache_path.exists()
    _wait_until(
        lambda: _status_payload()["runtime"]["active_run_count"] >= 0,
        timeout=20,
        description="dashboard restart",
    )

    _run_cli(thoth_project, "dashboard", "stop", timeout=30)
    assert not status_cache_path.exists()
    assert not port_cache_path.exists()
    _run_cli(thoth_project, "run", "--stop", run_id, timeout=20)
