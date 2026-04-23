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
import yaml

from thoth.runtime import local_registry_root


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


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        handle.bind(("127.0.0.1", 0))
        return int(handle.getsockname()[1])


def _write_task(project_dir: Path, task_id: str = "task-1") -> None:
    task_dir = project_dir / ".agent-os" / "research-tasks" / "frontend" / "f1"
    task_dir.mkdir(parents=True, exist_ok=True)
    (task_dir / "_module.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "f1",
                "name": "Frontend Runtime Validation",
                "direction": "frontend",
                "scientific_question": "Can runtime state be observed under real execution?",
                "dev_research_ratio": "60/40",
                "design_decisions": ["Use ledger-backed runtime observation", "Prefer real process tests over mocks"],
                "related_modules": {"upstream": [], "downstream": []},
                "seed_hypothesis_count": 1,
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (task_dir / f"{task_id}.yaml").write_text(
        yaml.safe_dump(
            {
                "id": task_id,
                "title": "Lifecycle Validation",
                "module": "f1",
                "direction": "frontend",
                "type": "hypothesis",
                "hypothesis": "State stays inspectable under real execution.",
                "null_hypothesis": "State drifts.",
                "depends_on": [],
                "data_requirements": {
                    "dataset": "selftest-artifacts",
                    "min_assets": 1,
                    "min_views_per_asset": 1,
                    "format": "Generated temporary project files",
                },
                "phases": {
                    "survey": {"status": "completed"},
                    "method_design": {"status": "completed"},
                    "experiment": {"status": "in_progress"},
                    "conclusion": {"status": "pending"},
                },
                "results": {"verdict": None, "evidence_paths": [], "metrics": {}},
                "estimated_total_hours": 4,
                "time_spent_hours": 1,
                "tags": ["runtime", "dashboard", "selftest"],
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    subprocess.run(
        [sys.executable, str(project_dir / ".agent-os" / "research-tasks" / "sync_todo.py")],
        cwd=str(project_dir),
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
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
    run_result = _run_cli(thoth_project, "run", "--task-id", "task-1", "--detach", "integration run")
    assert run_result.returncode == 0, run_result.stderr
    run_id = run_result.stdout.strip().splitlines()[-1]

    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / run_id / "state.json").get("status") == "running",
        timeout=15,
        description="detached run to become active",
    )
    run_json = _read_json(thoth_project / ".thoth" / "runs" / run_id / "run.json")
    assert run_json["task_id"] == "task-1"

    watch_result = _run_cli(thoth_project, "run", "--watch", run_id, timeout=20)
    assert watch_result.returncode == 0
    assert "status=running" in watch_result.stdout

    stop_result = _run_cli(thoth_project, "run", "--stop", run_id)
    assert stop_result.returncode == 0
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / run_id / "state.json").get("status") == "stopped",
        timeout=15,
        description="detached run to stop",
    )

    loop_result = _run_cli(thoth_project, "loop", "--task-id", "task-1", "--detach", "--goal", "integration loop")
    assert loop_result.returncode == 0, loop_result.stderr
    loop_id = loop_result.stdout.strip().splitlines()[-1]
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / loop_id / "state.json").get("status") == "running",
        timeout=15,
        description="detached loop to become active",
    )

    supervisor_path = local_registry_root(thoth_project) / "runs" / loop_id / "supervisor.json"
    supervisor = _read_json(supervisor_path)
    os.kill(int(supervisor["pid"]), signal.SIGKILL)

    resume_result = _run_cli(thoth_project, "loop", "--resume", loop_id, "--detach")
    assert resume_result.returncode == 0, resume_result.stderr
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / loop_id / "state.json").get("phase") == "active",
        timeout=15,
        description="loop resume after supervisor kill",
    )

    conflict_result = _run_cli(thoth_project, "run", "--task-id", "task-1", "--detach", "conflict probe")
    assert conflict_result.returncode == 0, conflict_result.stderr
    conflict_id = conflict_result.stdout.strip().splitlines()[-1]
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / conflict_id / "state.json").get("status") in {"failed", "running"},
        timeout=15,
        description="conflict probe to settle",
    )
    conflict_state = _read_json(thoth_project / ".thoth" / "runs" / conflict_id / "state.json")
    assert conflict_state["phase"] == "lease_conflict"

    loop_stop = _run_cli(thoth_project, "loop", "--stop", loop_id)
    assert loop_stop.returncode == 0
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / loop_id / "state.json").get("status") == "stopped",
        timeout=15,
        description="loop to stop",
    )


@pytest.mark.integration
def test_dashboard_process_and_hooks_are_observable(thoth_project: Path):
    config_path = thoth_project / ".research-config.yaml"
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    port = _free_port()
    config["dashboard"]["port"] = port
    config_path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")

    run_result = _run_cli(thoth_project, "run", "--task-id", "task-1", "--detach", "dashboard integration")
    assert run_result.returncode == 0
    run_id = run_result.stdout.strip().splitlines()[-1]
    _wait_until(
        lambda: _read_json(thoth_project / ".thoth" / "runs" / run_id / "state.json").get("status") == "running",
        timeout=15,
        description="dashboard-bound run to become active",
    )

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

    heartbeat_path = thoth_project / ".thoth" / "runs" / run_id / "heartbeat.json"
    heartbeat = _read_json(heartbeat_path)
    heartbeat["last_heartbeat_at"] = "2000-01-01T00:00:00Z"
    heartbeat["updated_at"] = "2000-01-01T00:00:00Z"
    heartbeat_path.write_text(json.dumps(heartbeat, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    with urlopen(f"http://127.0.0.1:{port}/api/tasks/task-1/active-run", timeout=5) as response:  # noqa: S310
        stale_run = json.loads(response.read().decode("utf-8"))
    assert stale_run["is_stale"] is True

    hooks_json = json.loads((thoth_project / ".codex" / "hooks.json").read_text(encoding="utf-8"))
    start_hook = hooks_json["hooks"]["SessionStart"][0]["hooks"][0]
    stop_hook = hooks_json["hooks"]["Stop"][0]["hooks"][0]
    assert "thoth-codex-hook.sh\" start" in start_hook["command"]
    assert "thoth-codex-hook.sh\" stop" in stop_hook["command"]

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

    events_payload = (thoth_project / ".thoth" / "runs" / run_id / "events.jsonl").read_text(encoding="utf-8")
    assert "codex session_start hook observed" in events_payload
    assert "codex stop hook observed" in events_payload

    hook_end = subprocess.run(
        ["bash", "scripts/session-end-check.sh"],
        cwd=str(thoth_project),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert hook_end.returncode == 0
    assert "PASS" in hook_end.stdout or hook_end.stdout == ""

    broken_task = thoth_project / ".agent-os" / "research-tasks" / "frontend" / "f1" / "broken.yaml"
    broken_task.write_text("id: broken\nphases: [\n", encoding="utf-8")
    broken_hook = subprocess.run(
        ["bash", "scripts/session-end-check.sh"],
        cwd=str(thoth_project),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert broken_hook.returncode != 0

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
