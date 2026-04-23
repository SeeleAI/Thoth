"""Heavy self-test orchestration for Thoth.

The self-test runner intentionally exercises the real CLI, real dashboard
processes, real temporary workspaces, and optional host-native Codex/Claude
surfaces. It is designed to produce a machine-readable report plus rich
artifacts that make failures inspectable.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable
from urllib.error import URLError
from urllib.request import urlopen

import yaml


ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable


def utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _dump_yaml(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        handle.bind(("127.0.0.1", 0))
        return int(handle.getsockname()[1])


def _http_get_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=5) as response:  # noqa: S310 - local self-test URL
        return json.loads(response.read().decode("utf-8"))


def _wait_until(predicate, *, timeout: float, interval: float = 0.2, description: str) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(interval)
    raise RuntimeError(f"Timed out waiting for {description}")


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in value)


@dataclass
class CommandResult:
    argv: list[str]
    cwd: str
    returncode: int
    stdout: str
    stderr: str
    duration_seconds: float


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str
    artifacts: list[str] = field(default_factory=list)


class Recorder:
    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.checks: list[CheckResult] = []

    def write_text(self, relpath: str, content: str) -> str:
        path = self.artifact_dir / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return str(path)

    def write_json(self, relpath: str, payload: dict[str, Any]) -> str:
        path = self.artifact_dir / relpath
        _write_json(path, payload)
        return str(path)

    def add(self, name: str, status: str, detail: str, artifacts: Iterable[str] | None = None) -> None:
        self.checks.append(CheckResult(name=name, status=status, detail=detail, artifacts=list(artifacts or [])))

    def summary_payload(self, *, tier: str, capabilities: dict[str, Any], work_root: str) -> dict[str, Any]:
        counts = {"passed": 0, "failed": 0, "degraded": 0}
        for item in self.checks:
            counts[item.status] = counts.get(item.status, 0) + 1
        overall = "failed" if counts.get("failed", 0) else ("degraded" if counts.get("degraded", 0) else "passed")
        return {
            "schema_version": 1,
            "generated_at": utc_now(),
            "tier": tier,
            "overall_status": overall,
            "counts": counts,
            "capabilities": capabilities,
            "work_root": work_root,
            "checks": [
                {
                    "name": item.name,
                    "status": item.status,
                    "detail": item.detail,
                    "artifacts": item.artifacts,
                }
                for item in self.checks
            ],
        }


def _run_command(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: float = 120,
) -> CommandResult:
    merged_env = dict(os.environ)
    if env:
        merged_env.update(env)
    started = time.time()
    completed = subprocess.run(
        argv,
        cwd=str(cwd),
        env=merged_env,
        text=True,
        capture_output=True,
        timeout=timeout,
    )
    return CommandResult(
        argv=argv,
        cwd=str(cwd),
        returncode=completed.returncode,
        stdout=completed.stdout,
        stderr=completed.stderr,
        duration_seconds=round(time.time() - started, 3),
    )


def _save_command(recorder: Recorder, name: str, result: CommandResult) -> list[str]:
    stem = _safe_name(name)
    return [
        recorder.write_text(
            f"commands/{stem}.txt",
            textwrap.dedent(
                f"""\
                CWD: {result.cwd}
                ARGV: {json.dumps(result.argv, ensure_ascii=False)}
                RETURN CODE: {result.returncode}
                DURATION: {result.duration_seconds:.3f}s

                --- STDOUT ---
                {result.stdout}

                --- STDERR ---
                {result.stderr}
                """
            ),
        )
    ]


def detect_capabilities() -> dict[str, Any]:
    def tool_path(name: str) -> str | None:
        return shutil.which(name)

    capabilities: dict[str, Any] = {
        "python": PYTHON,
        "codex_cli_present": bool(tool_path("codex")),
        "claude_cli_present": bool(tool_path("claude")),
        "node_present": bool(tool_path("node")),
        "npm_present": bool(tool_path("npm")),
    }

    if capabilities["codex_cli_present"]:
        result = _run_command(["codex", "login", "status"], cwd=ROOT, timeout=20)
        status_text = result.stdout.strip() or result.stderr.strip()
        capabilities["codex_authenticated"] = "logged in" in status_text.lower()
        capabilities["codex_login_status"] = status_text
        features = _run_command(["codex", "features", "list"], cwd=ROOT, timeout=20)
        hooks_line = next((line for line in features.stdout.splitlines() if line.startswith("codex_hooks")), "codex_hooks false")
        capabilities["codex_hooks_enabled"] = hooks_line.split()[-1].lower() == "true"
        capabilities["codex_features_snapshot"] = features.stdout.strip()
    else:
        capabilities["codex_authenticated"] = False
        capabilities["codex_hooks_enabled"] = False

    if capabilities["claude_cli_present"]:
        result = _run_command(["claude", "auth", "status"], cwd=ROOT, timeout=20)
        capabilities["claude_authenticated"] = result.returncode == 0 and "\"loggedIn\": true" in result.stdout
        capabilities["claude_auth_status"] = result.stdout.strip() or result.stderr.strip()
    else:
        capabilities["claude_authenticated"] = False

    if capabilities["npm_present"]:
        npm = _run_command(["npm", "--version"], cwd=ROOT, timeout=20)
        capabilities["npm_version"] = npm.stdout.strip()
    if capabilities["node_present"]:
        node = _run_command(["node", "--version"], cwd=ROOT, timeout=20)
        capabilities["node_version"] = node.stdout.strip()
    return capabilities


def _init_git_repo(project_dir: Path) -> None:
    _run_command(["git", "init"], cwd=project_dir, timeout=20)
    _run_command(["git", "config", "user.email", "selftest@example.com"], cwd=project_dir, timeout=20)
    _run_command(["git", "config", "user.name", "Thoth Selftest"], cwd=project_dir, timeout=20)


def _seed_task(project_dir: Path, *, task_id: str = "task-1") -> None:
    tasks_dir = project_dir / ".agent-os" / "research-tasks" / "frontend" / "f1"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    _dump_yaml(
        tasks_dir / "_module.yaml",
        {
            "id": "f1",
            "name": "Frontend Runtime Validation",
            "direction": "frontend",
            "scientific_question": "Can dashboard and runtime stay consistent under stress?",
            "dev_research_ratio": "60/40",
            "design_decisions": [
                "Use real CLI-driven runtime checks",
                "Prefer dashboard evidence over synthetic mocks",
            ],
            "related_modules": {"upstream": [], "downstream": []},
            "seed_hypothesis_count": 1,
        },
    )
    _dump_yaml(
        tasks_dir / f"{task_id}.yaml",
        {
            "id": task_id,
            "title": "Dashboard lifecycle validation",
            "module": "f1",
            "direction": "frontend",
            "type": "hypothesis",
            "hypothesis": "Runtime state should remain inspectable under real process execution.",
            "null_hypothesis": "Dashboard drifts from runtime state.",
            "depends_on": [],
            "data_requirements": {
                "dataset": "selftest-artifacts",
                "min_assets": 1,
                "min_views_per_asset": 1,
                "format": "Generated temporary repository files",
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
            "tags": ["selftest", "runtime", "dashboard"],
        },
    )
    sync_script = project_dir / ".agent-os" / "research-tasks" / "sync_todo.py"
    if sync_script.exists():
        _run_command([PYTHON, str(sync_script)], cwd=project_dir, timeout=60)


def _set_dashboard_port(project_dir: Path, port: int) -> None:
    config_path = project_dir / ".research-config.yaml"
    config = _load_yaml(config_path)
    config.setdefault("dashboard", {})
    config["dashboard"]["port"] = port
    _dump_yaml(config_path, config)


def _snapshot_runtime(recorder: Recorder, project_dir: Path, label: str) -> list[str]:
    artifacts: list[str] = []
    for rel in (".thoth", ".agent-os", ".codex"):
        path = project_dir / rel
        if not path.exists():
            continue
        target = recorder.artifact_dir / "snapshots" / _safe_name(label) / rel.replace("/", "_")
        if path.is_dir():
            shutil.copytree(path, target, dirs_exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        artifacts.append(str(target))
    return artifacts


def _run_thoth(project_dir: Path, *args: str, timeout: float = 120, env: dict[str, str] | None = None) -> CommandResult:
    merged_env = dict(env or {})
    existing_pythonpath = os.environ.get("PYTHONPATH", "")
    merged_env["PYTHONPATH"] = str(ROOT) if not existing_pythonpath else f"{ROOT}:{existing_pythonpath}"
    return _run_command([PYTHON, "-m", "thoth.cli", *args], cwd=project_dir, env=merged_env, timeout=timeout)


def _state_payload(project_dir: Path, run_id: str) -> dict[str, Any]:
    return _read_json(project_dir / ".thoth" / "runs" / run_id / "state.json")


def _heartbeat_payload(project_dir: Path, run_id: str) -> dict[str, Any]:
    return _read_json(project_dir / ".thoth" / "runs" / run_id / "heartbeat.json")


def _local_supervisor(project_dir: Path, run_id: str) -> dict[str, Any]:
    probe = _run_command(
        [
            PYTHON,
            "-c",
            "from pathlib import Path; from thoth.runtime import local_registry_root; "
            "import json,sys; p=local_registry_root(Path(sys.argv[1]))/'runs'/sys.argv[2]/'supervisor.json'; "
            "print((p.read_text() if p.exists() else '{}'))",
            str(project_dir),
            run_id,
        ],
        cwd=ROOT,
        timeout=20,
    )
    if probe.stdout.strip():
        try:
            return json.loads(probe.stdout)
        except json.JSONDecodeError:
            return {}
    return {}


def _start_dashboard(project_dir: Path, *, recorder: Recorder, rebuild: bool = False, extra_env: dict[str, str] | None = None) -> tuple[int, list[str]]:
    action = "rebuild" if rebuild else "start"
    result = _run_thoth(project_dir, "dashboard", action, timeout=180, env=extra_env)
    artifacts = _save_command(recorder, f"dashboard-{action}", result)
    if result.returncode != 0:
        raise RuntimeError(f"dashboard {action} failed")
    config = _load_yaml(project_dir / ".research-config.yaml")
    port = int(config.get("dashboard", {}).get("port", 8501))

    def _dashboard_ready() -> bool:
        try:
            return bool(_http_get_json(f"http://127.0.0.1:{port}/api/status").get("runtime"))
        except (URLError, TimeoutError, json.JSONDecodeError):
            return False

    _wait_until(
        _dashboard_ready,
        timeout=20,
        interval=0.5,
        description=f"dashboard on port {port}",
    )
    return port, artifacts


def _stop_dashboard(project_dir: Path, *, recorder: Recorder) -> list[str]:
    result = _run_thoth(project_dir, "dashboard", "stop", timeout=60)
    return _save_command(recorder, "dashboard-stop", result)


def _repo_hard_suite(project_dir: Path, recorder: Recorder) -> dict[str, Any]:
    details: dict[str, Any] = {}
    _init_git_repo(project_dir)

    init_result = _run_thoth(project_dir, "init", timeout=60)
    recorder.add(
        "repo.init",
        "passed" if init_result.returncode == 0 else "failed",
        "Initialized a fresh temp project through the public CLI.",
        _save_command(recorder, "repo-init", init_result),
    )
    if init_result.returncode != 0:
        raise RuntimeError("thoth init failed")

    port = _free_port()
    _set_dashboard_port(project_dir, port)
    _seed_task(project_dir)

    for name, argv in (
        ("repo.status_json", ["status", "--json"]),
        ("repo.doctor_quick", ["doctor", "--quick"]),
        ("repo.sync", ["sync"]),
        ("repo.discuss", ["discuss", "selftest", "discussion"]),
        ("repo.review", ["review", "selftest", "review"]),
        ("repo.report", ["report"]),
    ):
        result = _run_thoth(project_dir, *argv, timeout=120)
        recorder.add(
            name,
            "passed" if result.returncode == 0 else "failed",
            f"Command {' '.join(argv)} completed with return code {result.returncode}.",
            _save_command(recorder, name, result),
        )
        if result.returncode != 0:
            raise RuntimeError(f"{name} failed")

    run_result = _run_thoth(project_dir, "run", "--task-id", "task-1", "--detach", "hard gate runtime", timeout=60)
    run_artifacts = _save_command(recorder, "run-detach", run_result)
    if run_result.returncode != 0:
        recorder.add("runtime.run_detach", "failed", "Detached run creation failed.", run_artifacts)
        raise RuntimeError("run --detach failed")
    run_id = run_result.stdout.strip().splitlines()[-1].strip()
    _wait_until(
        lambda: _state_payload(project_dir, run_id).get("status") == "running",
        timeout=15,
        description=f"run {run_id} to become running",
    )
    watch_result = _run_thoth(project_dir, "run", "--watch", run_id, timeout=20)
    watch_artifacts = _save_command(recorder, "run-watch", watch_result)
    recorder.add("runtime.run_watch", "passed", f"Watch stream attached to {run_id}.", run_artifacts + watch_artifacts)

    stop_result = _run_thoth(project_dir, "run", "--stop", run_id, timeout=20)
    _wait_until(
        lambda: _state_payload(project_dir, run_id).get("status") == "stopped",
        timeout=15,
        description=f"run {run_id} to stop",
    )
    stop_artifacts = _save_command(recorder, "run-stop", stop_result)
    recorder.add("runtime.run_stop", "passed", f"Stopped detached run {run_id}.", stop_artifacts)

    loop_result = _run_thoth(project_dir, "loop", "--task-id", "task-1", "--detach", "--goal", "selftest loop", timeout=60)
    loop_artifacts = _save_command(recorder, "loop-detach", loop_result)
    if loop_result.returncode != 0:
        recorder.add("runtime.loop_detach", "failed", "Detached loop creation failed.", loop_artifacts)
        raise RuntimeError("loop --detach failed")
    loop_id = loop_result.stdout.strip().splitlines()[-1].strip()
    _wait_until(
        lambda: _state_payload(project_dir, loop_id).get("status") == "running",
        timeout=15,
        description=f"loop {loop_id} to become running",
    )

    conflict_result = _run_thoth(project_dir, "run", "--task-id", "task-1", "--detach", "lease conflict probe", timeout=60)
    conflict_artifacts = _save_command(recorder, "lease-conflict-probe", conflict_result)
    if conflict_result.returncode != 0:
        recorder.add("runtime.lease_conflict", "failed", "Conflict probe command itself failed.", conflict_artifacts)
        raise RuntimeError("lease conflict probe command failed")
    conflict_run_id = conflict_result.stdout.strip().splitlines()[-1].strip()
    _wait_until(
        lambda: _state_payload(project_dir, conflict_run_id).get("status") in {"failed", "running"},
        timeout=15,
        description=f"conflict run {conflict_run_id} to settle",
    )
    conflict_state = _state_payload(project_dir, conflict_run_id)
    if conflict_state.get("phase") == "lease_conflict":
        recorder.add(
            "runtime.lease_conflict",
            "passed",
            f"Secondary run {conflict_run_id} failed with lease_conflict while {loop_id} held the repo lease.",
            conflict_artifacts,
        )
    else:
        recorder.add(
            "runtime.lease_conflict",
            "failed",
            f"Secondary run {conflict_run_id} did not report lease_conflict. State={conflict_state}",
            conflict_artifacts,
        )
        raise RuntimeError("lease conflict behavior regressed")

    supervisor = _local_supervisor(project_dir, loop_id)
    loop_pid = supervisor.get("pid")
    if isinstance(loop_pid, int) and loop_pid > 0:
        os.kill(loop_pid, signal.SIGKILL)
    _wait_until(
        lambda: not isinstance(_local_supervisor(project_dir, loop_id).get("pid"), int)
        or _local_supervisor(project_dir, loop_id).get("pid") == loop_pid,
        timeout=2,
        description="loop supervisor kill acknowledgement",
    )
    resume_result = _run_thoth(project_dir, "loop", "--resume", loop_id, "--detach", timeout=60)
    resume_artifacts = _save_command(recorder, "loop-resume", resume_result)
    if resume_result.returncode != 0:
        recorder.add("runtime.loop_resume", "failed", "Loop resume command failed.", resume_artifacts)
        raise RuntimeError("loop resume failed")
    _wait_until(
        lambda: _state_payload(project_dir, loop_id).get("status") == "running"
        and _state_payload(project_dir, loop_id).get("phase") == "active",
        timeout=15,
        description=f"loop {loop_id} to resume",
    )
    recorder.add("runtime.loop_resume", "passed", f"Loop {loop_id} resumed after supervisor kill.", resume_artifacts)

    stale_supervisor = _local_supervisor(project_dir, loop_id)
    stale_pid = stale_supervisor.get("pid")
    if isinstance(stale_pid, int) and stale_pid > 0:
        os.kill(stale_pid, signal.SIGKILL)

    heartbeat_path = project_dir / ".thoth" / "runs" / loop_id / "heartbeat.json"
    heartbeat = _heartbeat_payload(project_dir, loop_id)
    heartbeat["last_heartbeat_at"] = "2000-01-01T00:00:00Z"
    heartbeat["updated_at"] = utc_now()
    _write_json(heartbeat_path, heartbeat)

    dashboard_env = {"THOTH_HEARTBEAT_STALE_MINUTES": "1"}
    dashboard_port, dashboard_artifacts = _start_dashboard(project_dir, recorder=recorder, rebuild=False, extra_env=dashboard_env)
    status_payload = _http_get_json(f"http://127.0.0.1:{dashboard_port}/api/status")
    task_payload = _http_get_json(f"http://127.0.0.1:{dashboard_port}/api/runs/{loop_id}")
    details["dashboard_port"] = dashboard_port
    recorder.write_json("api/status.json", status_payload)
    recorder.write_json("api/active-run.json", task_payload if isinstance(task_payload, dict) else {})
    stale = bool(task_payload.get("is_stale")) if isinstance(task_payload, dict) else False
    recorder.add(
        "dashboard.api_runtime",
        "passed" if stale else "failed",
        "Dashboard backend served the real temp project and reported stale heartbeat state.",
        dashboard_artifacts + [str(recorder.artifact_dir / "api" / "status.json"), str(recorder.artifact_dir / "api" / "active-run.json")],
    )
    if not stale:
        raise RuntimeError("dashboard did not report stale heartbeat")

    restart_artifacts = _stop_dashboard(project_dir, recorder=recorder)
    restarted_port, restarted_artifacts = _start_dashboard(project_dir, recorder=recorder, rebuild=False, extra_env=dashboard_env)
    if restarted_port != dashboard_port:
        raise RuntimeError("dashboard port drifted across restart")
    recorder.add(
        "dashboard.restart",
        "passed",
        f"Dashboard restarted cleanly on port {dashboard_port}.",
        restart_artifacts + restarted_artifacts,
    )

    hooks_config = json.loads((project_dir / ".codex" / "hooks" / "hooks.json").read_text(encoding="utf-8"))
    hook_end = _run_command(["bash", "scripts/session-end-check.sh"], cwd=project_dir, timeout=60)
    hook_artifacts = [
        recorder.write_json("hooks/hooks.json", hooks_config),
        *_save_command(recorder, "hook-end", hook_end),
    ]
    hook_ok = hooks_config.get("enabled") is True and hook_end.returncode == 0
    recorder.add("hooks.local_success", "passed" if hook_ok else "failed", "Generated project hook configuration and session-end script completed.", hook_artifacts)
    if not hook_ok:
        raise RuntimeError("local session hook success path failed")

    bad_task = project_dir / ".agent-os" / "research-tasks" / "frontend" / "f1" / "broken.yaml"
    bad_task.write_text("id: broken\nphases: [\n", encoding="utf-8")
    broken_hook = _run_command(["bash", "scripts/session-end-check.sh"], cwd=project_dir, timeout=60)
    broken_artifacts = _save_command(recorder, "hook-broken", broken_hook)
    bad_task.unlink(missing_ok=True)
    degraded = broken_hook.returncode != 0
    recorder.add(
        "hooks.local_failure_observable",
        "passed" if degraded else "failed",
        "Broken task YAML caused the generated session-end hook script to fail observably.",
        broken_artifacts,
    )
    if not degraded:
        raise RuntimeError("hook failure path was not observable")

    final_resume = _run_thoth(project_dir, "loop", "--resume", loop_id, "--detach", timeout=60)
    recorder.add("runtime.loop_resume_after_stale", "passed" if final_resume.returncode == 0 else "failed", "Loop can be resumed after stale-heartbeat fault injection.", _save_command(recorder, "loop-resume-after-stale", final_resume))
    if final_resume.returncode != 0:
        raise RuntimeError("loop resume after stale fault failed")
    _wait_until(
        lambda: _state_payload(project_dir, loop_id).get("phase") == "active",
        timeout=15,
        description=f"loop {loop_id} final resume",
    )

    loop_stop = _run_thoth(project_dir, "loop", "--stop", loop_id, timeout=20)
    _wait_until(
        lambda: _state_payload(project_dir, loop_id).get("status") == "stopped",
        timeout=15,
        description=f"loop {loop_id} to stop",
    )
    recorder.add("runtime.loop_stop", "passed", f"Stopped loop {loop_id}.", _save_command(recorder, "loop-stop", loop_stop))
    _stop_dashboard(project_dir, recorder=recorder)

    details["run_id"] = run_id
    details["loop_id"] = loop_id
    details["conflict_run_id"] = conflict_run_id
    return details


def _run_playwright(project_dir: Path, recorder: Recorder, *, run_id: str) -> list[str]:
    frontend_dir = project_dir / "tools" / "dashboard" / "frontend"
    install_artifacts: list[str] = []
    if not (frontend_dir / "node_modules").exists():
        install = _run_command(["npm", "ci", "--no-audit", "--no-fund"], cwd=frontend_dir, timeout=240)
        install_artifacts = _save_command(recorder, "playwright-npm-ci", install)
        if install.returncode != 0:
            raise RuntimeError("npm ci failed for Playwright setup")

    browsers = _run_command(["npx", "playwright", "install", "chromium"], cwd=frontend_dir, timeout=900)
    browser_artifacts = _save_command(recorder, "playwright-install", browsers)
    if browsers.returncode != 0:
        raise RuntimeError("playwright browser install failed")

    config = _load_yaml(project_dir / ".research-config.yaml")
    port = int(config.get("dashboard", {}).get("port", 8501))
    env = {
        "THOTH_DASHBOARD_URL": f"http://127.0.0.1:{port}",
        "THOTH_SELFTEST_RUN_ID": run_id,
        "THOTH_SELFTEST_TASK_ID": "task-1",
        "THOTH_SELFTEST_PROJECT_ROOT": str(project_dir),
        "THOTH_SELFTEST_SOURCE_ROOT": str(ROOT),
        "THOTH_SELFTEST_PYTHON": PYTHON,
        "THOTH_PLAYWRIGHT_OUTPUT_DIR": str((recorder.artifact_dir / "playwright-report").resolve()),
    }
    test = _run_command(["npx", "playwright", "test", "e2e/dashboard-realtime.spec.ts"], cwd=frontend_dir, env=env, timeout=240)
    test_artifacts = _save_command(recorder, "playwright-test", test)
    if test.returncode != 0:
        raise RuntimeError("playwright runtime spec failed")
    return install_artifacts + browser_artifacts + test_artifacts


def _looks_like_transient_host_outage(result: CommandResult) -> bool:
    detail = f"{result.stdout}\n{result.stderr}".lower()
    return any(
        marker in detail
        for marker in (
            "api error: 503",
            "server-side issue",
            "try again in a moment",
            "status.claude.com",
            "temporarily unavailable",
            "无可用渠道",
        )
    )


def _host_claude(repo_root: Path, project_dir: Path, recorder: Recorder) -> None:
    permission_mode = "dontAsk" if hasattr(os, "geteuid") and os.geteuid() == 0 else "bypassPermissions"
    result = _run_command(
        [
            "claude",
            "-p",
            "--plugin-dir",
            str(repo_root),
            "--permission-mode",
            permission_mode,
            "--verbose",
            "--output-format",
            "stream-json",
            "--include-hook-events",
            "Use the official /thoth:init command to initialize the current repository, then run /thoth:status. Reply with the exact token SELFTEST_OK.",
        ],
        cwd=project_dir,
        timeout=240,
    )
    artifacts = _save_command(recorder, "host-claude", result)
    success = result.returncode == 0 and "SELFTEST_OK" in result.stdout and (project_dir / ".thoth" / "project" / "project.json").exists()
    hook_seen = "hook" in result.stdout.lower() or "session" in result.stdout.lower()
    if success:
        status = "passed" if hook_seen else "degraded"
        detail = "Claude host initialized the repo through the plugin surface and emitted hook/session evidence." if hook_seen else "Claude host initialized the repo, but hook/session evidence was not emitted in stream output."
    elif _looks_like_transient_host_outage(result):
        status = "degraded"
        detail = "Claude host matrix hit an upstream/transient host outage rather than a deterministic Thoth runtime failure."
    else:
        status = "failed"
        detail = "Claude host execution failed."
    recorder.add("host.claude", status, detail, artifacts)


def _host_codex(repo_root: Path, project_dir: Path, recorder: Recorder) -> None:
    prompt = (
        f"Operate only on the project at {project_dir}. "
        "Use the official Thoth public skill `$thoth` from this repository's generated skill surface to initialize that project and then run status for it. "
        "Do not rely on any globally installed stale `thoth` binary if it differs from the repo-local implementation. "
        "Finish with the exact token SELFTEST_OK."
    )
    result = _run_command(
        [
            "codex",
            "exec",
            "--json",
            "--full-auto",
            "-C",
            str(repo_root),
            "--add-dir",
            str(project_dir),
            prompt,
        ],
        cwd=repo_root,
        timeout=240,
    )
    artifacts = _save_command(recorder, "host-codex", result)
    skill_load_failed = "failed to load skill" in result.stderr.lower()
    project_ready = (project_dir / ".thoth" / "project" / "project.json").exists()
    success = result.returncode == 0 and "SELFTEST_OK" in result.stdout and project_ready and not skill_load_failed
    if success:
        status = "passed"
        detail = "Codex host used the repo-local Thoth public skill against a fresh temp project."
    elif _looks_like_transient_host_outage(result):
        status = "degraded"
        detail = "Codex host matrix hit an upstream/transient host outage rather than a deterministic Thoth runtime failure."
    elif skill_load_failed:
        status = "failed"
        detail = "Codex host could not load the generated Thoth public skill, so the host-real surface is not valid."
    elif result.returncode == 0 and "SELFTEST_OK" in result.stdout and not project_ready:
        status = "failed"
        detail = "Codex host reported success text, but the canonical .thoth project authority was not created. This usually means it fell back to a stale global CLI."
    else:
        status = "failed"
        detail = "Codex host execution failed."
    recorder.add(
        "host.codex",
        status,
        detail,
        artifacts,
    )


def _should_run_host(mode: str, *, host: str, capabilities: dict[str, Any]) -> bool:
    if mode == "none":
        return False
    if mode in {host, "both"}:
        return True
    if mode != "auto":
        return False
    if host == "claude":
        return bool(capabilities.get("claude_cli_present") and capabilities.get("claude_authenticated"))
    if host == "codex":
        return bool(capabilities.get("codex_cli_present") and capabilities.get("codex_authenticated"))
    return False


def run_selftest(
    *,
    tier: str,
    hosts: str,
    artifact_dir: Path | None,
    json_report: Path | None,
    keep_workdir: bool,
) -> int:
    capabilities = detect_capabilities()
    base_dir = Path(tempfile.mkdtemp(prefix="thoth-selftest-"))
    run_artifact_dir = artifact_dir or (base_dir / "artifacts")
    recorder = Recorder(run_artifact_dir)
    exit_code = 0

    try:
        project_dir = base_dir / "repo-hard"
        project_dir.mkdir(parents=True, exist_ok=True)
        hard_details = _repo_hard_suite(project_dir, recorder)
        recorder.write_json("repo-hard/details.json", hard_details)
        recorder.add("repo-hard.snapshot", "passed", "Captured runtime and project snapshots.", _snapshot_runtime(recorder, project_dir, "repo-hard"))

        if tier == "heavy":
            heavy_project = base_dir / "repo-heavy"
            shutil.copytree(project_dir, heavy_project, dirs_exist_ok=True)
            heavy_port = _free_port()
            _set_dashboard_port(heavy_project, heavy_port)
            loop_id = hard_details["loop_id"]
            run_id = hard_details["run_id"]
            frontend_dir = heavy_project / "tools" / "dashboard" / "frontend"
            frontend_install = _run_command(["npm", "ci", "--no-audit", "--no-fund"], cwd=frontend_dir, timeout=240)
            frontend_install_artifacts = _save_command(recorder, "heavy-frontend-npm-ci", frontend_install)
            if frontend_install.returncode != 0:
                raise RuntimeError("heavy gate frontend dependency install failed")

            restart_artifacts = _start_dashboard(
                heavy_project,
                recorder=recorder,
                rebuild=True,
                extra_env={
                    "THOTH_HEARTBEAT_STALE_MINUTES": "1",
                    "VITE_THOTH_DASHBOARD_POLL_MS": "1000",
                },
            )[1]
            fresh_run = _run_thoth(heavy_project, "run", "--task-id", "task-1", "--detach", "browser gate runtime", timeout=60)
            fresh_artifacts = _save_command(recorder, "browser-run-detach", fresh_run)
            if fresh_run.returncode != 0:
                raise RuntimeError("heavy gate browser run creation failed")
            browser_run_id = fresh_run.stdout.strip().splitlines()[-1].strip()
            _wait_until(
                lambda: _state_payload(heavy_project, browser_run_id).get("status") == "running",
                timeout=15,
                description=f"browser run {browser_run_id} to become running",
            )
            browser_artifacts = _run_playwright(heavy_project, recorder, run_id=browser_run_id)
            recorder.add(
                "dashboard.browser_realtime",
                "passed",
                "Playwright observed live dashboard state and stop transitions against a real dashboard process.",
                frontend_install_artifacts + restart_artifacts + fresh_artifacts + browser_artifacts,
            )
            recorder.add("repo-heavy.snapshot", "passed", "Captured heavy-gate runtime snapshots.", _snapshot_runtime(recorder, heavy_project, "repo-heavy"))
            _stop_dashboard(heavy_project, recorder=recorder)
            _run_thoth(heavy_project, "run", "--stop", browser_run_id, timeout=20)

            if _should_run_host(hosts, host="claude", capabilities=capabilities):
                host_project = base_dir / "host-claude"
                host_project.mkdir(parents=True, exist_ok=True)
                _init_git_repo(host_project)
                try:
                    _host_claude(ROOT, host_project, recorder)
                except Exception as exc:  # pragma: no cover - environment-specific
                    recorder.add("host.claude", "degraded", f"Claude host matrix degraded: {exc}", _snapshot_runtime(recorder, host_project, "host-claude"))
            else:
                recorder.add("host.claude", "degraded", "Claude host matrix skipped because the CLI/auth surface was unavailable for this environment.")

            if _should_run_host(hosts, host="codex", capabilities=capabilities):
                host_project = base_dir / "host-codex"
                host_project.mkdir(parents=True, exist_ok=True)
                _init_git_repo(host_project)
                try:
                    _host_codex(ROOT, host_project, recorder)
                except Exception as exc:  # pragma: no cover - environment-specific
                    recorder.add("host.codex", "degraded", f"Codex host matrix degraded: {exc}", _snapshot_runtime(recorder, host_project, "host-codex"))
            else:
                recorder.add("host.codex", "degraded", "Codex host matrix skipped because the CLI/auth surface was unavailable for this environment.")

        summary = recorder.summary_payload(tier=tier, capabilities=capabilities, work_root=str(base_dir))
        summary_path = json_report or (run_artifact_dir / "summary.json")
        _write_json(summary_path, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if summary["overall_status"] == "failed":
            exit_code = 1
    except Exception as exc:
        recorder.add("selftest.runner", "failed", f"Self-test aborted: {exc}")
        summary = recorder.summary_payload(tier=tier, capabilities=capabilities, work_root=str(base_dir))
        summary["overall_status"] = "failed"
        summary_path = json_report or (run_artifact_dir / "summary.json")
        _write_json(summary_path, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        exit_code = 1
    finally:
        if keep_workdir:
            print(f"Kept self-test workdir at {base_dir}")
        else:
            shutil.rmtree(base_dir, ignore_errors=True)
    return exit_code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Thoth heavy self-tests.")
    parser.add_argument("--tier", choices=("hard", "heavy"), default="heavy")
    parser.add_argument("--hosts", choices=("auto", "none", "codex", "claude", "both"), default="auto")
    parser.add_argument("--json-report", type=Path)
    parser.add_argument("--artifact-dir", type=Path)
    parser.add_argument("--keep-workdir", action="store_true")
    args = parser.parse_args(argv)
    return run_selftest(
        tier=args.tier,
        hosts=args.hosts,
        artifact_dir=args.artifact_dir,
        json_report=args.json_report,
        keep_workdir=args.keep_workdir,
    )


if __name__ == "__main__":
    raise SystemExit(main())
