"""Durable Thoth runtime and supervisor."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ACTIVE_STATUSES = {"queued", "running", "paused", "waiting_input", "stopping"}
TERMINAL_STATUSES = {"completed", "failed", "stopped"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def project_hash(project_root: Path) -> str:
    return hashlib.sha256(str(project_root.resolve()).encode("utf-8")).hexdigest()[:16]


def local_registry_root(project_root: Path) -> Path:
    env = os.environ.get("THOTH_LOCAL_STATE_DIR")
    if env:
        base = Path(env)
    else:
        base = Path.home() / ".local" / "state" / "thoth"
    return base / project_hash(project_root)


@dataclass
class RunHandle:
    project_root: Path
    run_id: str

    @property
    def run_dir(self) -> Path:
        return self.project_root / ".thoth" / "runs" / self.run_id

    @property
    def local_dir(self) -> Path:
        return local_registry_root(self.project_root) / "runs" / self.run_id

    def run_json(self) -> dict[str, Any]:
        return _read_json(self.run_dir / "run.json")

    def state_json(self) -> dict[str, Any]:
        return _read_json(self.run_dir / "state.json")


def ensure_runtime_tree(project_root: Path) -> None:
    for rel in (
        ".thoth/project",
        ".thoth/runs",
        ".thoth/migrations",
        ".thoth/derived",
    ):
        (project_root / rel).mkdir(parents=True, exist_ok=True)


def _process_alive(pid: int | None) -> bool:
    if not isinstance(pid, int) or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _supervisor_payload(project_root: Path, run_id: str) -> dict[str, Any]:
    local_dir = local_registry_root(project_root) / "runs" / run_id
    return _read_json(local_dir / "supervisor.json")


def _lease_holder_is_stale(project_root: Path, lease_payload: dict[str, Any]) -> bool:
    if not lease_payload:
        return False
    if lease_payload.get("status") not in ACTIVE_STATUSES:
        return False
    run_id = lease_payload.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        return True
    supervisor = _supervisor_payload(project_root, run_id)
    return not _process_alive(supervisor.get("pid"))


def acquire_repo_lease(project_root: Path, run_id: str, host: str, executor: str) -> Path:
    lease_path = local_registry_root(project_root) / "lease.json"
    current = _read_json(lease_path)
    if current and current.get("run_id") != run_id and current.get("status") in ACTIVE_STATUSES:
        if _lease_holder_is_stale(project_root, current):
            current["status"] = "released"
            current["released_reason"] = "stale_supervisor"
            current["updated_at"] = utc_now()
            _write_json(lease_path, current)
        else:
            raise RuntimeError(f"Active lease already held by {current.get('run_id')}")
    payload = {
        "run_id": run_id,
        "host": host,
        "executor": executor,
        "status": "running",
        "updated_at": utc_now(),
        "project_root": str(project_root.resolve()),
    }
    _write_json(lease_path, payload)
    return lease_path


def release_repo_lease(project_root: Path, run_id: str) -> None:
    lease_path = local_registry_root(project_root) / "lease.json"
    current = _read_json(lease_path)
    if current.get("run_id") == run_id:
        current["status"] = "released"
        current["updated_at"] = utc_now()
        _write_json(lease_path, current)


def create_run(
    project_root: Path,
    *,
    kind: str,
    title: str,
    task_id: str | None,
    host: str,
    executor: str,
    durable: bool = True,
) -> RunHandle:
    ensure_runtime_tree(project_root)
    run_id = f"{kind}-{uuid.uuid4().hex[:12]}"
    handle = RunHandle(project_root=project_root, run_id=run_id)
    now = utc_now()
    run_payload = {
        "run_id": run_id,
        "kind": kind,
        "title": title,
        "task_id": task_id,
        "host": host,
        "executor": executor,
        "durable": durable,
        "attachable": True,
        "created_at": now,
        "updated_at": now,
        "project_root": str(project_root.resolve()),
    }
    state_payload = {
        "run_id": run_id,
        "task_id": task_id,
        "status": "queued",
        "phase": "queued",
        "progress_pct": 0,
        "last_event_seq": 0,
        "updated_at": now,
        "supervisor_state": "spawning",
    }
    _write_json(handle.run_dir / "run.json", run_payload)
    _write_json(handle.run_dir / "state.json", state_payload)
    _write_json(handle.run_dir / "acceptance.json", {"status": "pending", "checks": [], "updated_at": now})
    _write_json(handle.run_dir / "artifacts.json", {"artifacts": [], "updated_at": now})
    _write_json(handle.run_dir / "heartbeat.json", {"last_heartbeat_at": now, "updated_at": now})
    _append_jsonl(handle.run_dir / "events.jsonl", {"seq": 1, "ts": now, "kind": "log", "message": "run created"})
    return handle


def _update_state(handle: RunHandle, **fields: Any) -> dict[str, Any]:
    state = handle.state_json()
    state.update(fields)
    state["updated_at"] = utc_now()
    _write_json(handle.run_dir / "state.json", state)
    return state


def _write_heartbeat(handle: RunHandle) -> None:
    now = utc_now()
    _write_json(handle.run_dir / "heartbeat.json", {"last_heartbeat_at": now, "updated_at": now})


def _append_event(handle: RunHandle, message: str, *, kind: str = "log", level: str = "info") -> None:
    state = handle.state_json()
    existing_events = (handle.run_dir / "events.jsonl").read_text(encoding="utf-8").splitlines() if (handle.run_dir / "events.jsonl").exists() else []
    seq = max(int(state.get("last_event_seq", 0)), len([line for line in existing_events if line.strip()])) + 1
    _append_jsonl(handle.run_dir / "events.jsonl", {"seq": seq, "ts": utc_now(), "kind": kind, "level": level, "message": message})
    _update_state(handle, last_event_seq=seq)


def spawn_supervisor(handle: RunHandle) -> int:
    package_root = Path(__file__).resolve().parent.parent
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(package_root) if not existing else f"{package_root}:{existing}"
    cmd = [
        sys.executable,
        "-m",
        "thoth.cli",
        "supervise",
        "--project-root",
        str(handle.project_root),
        "--run-id",
        handle.run_id,
    ]
    proc = subprocess.Popen(
        cmd,
        cwd=str(handle.project_root),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        env=env,
    )
    local_dir = handle.local_dir
    local_dir.mkdir(parents=True, exist_ok=True)
    _write_json(local_dir / "supervisor.json", {"pid": proc.pid, "state": "running", "updated_at": utc_now()})
    return proc.pid


def supervisor_main(project_root: Path, run_id: str) -> int:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    run_payload = handle.run_json()
    try:
        acquire_repo_lease(project_root, run_id, run_payload.get("host", "unknown"), run_payload.get("executor", "unknown"))
    except RuntimeError:
        _update_state(handle, status="failed", phase="lease_conflict", supervisor_state="failed")
        _append_event(handle, "lease conflict", kind="error", level="error")
        return 1

    _update_state(handle, status="running", phase="startup", progress_pct=5, supervisor_state="running")
    _append_event(handle, "supervisor started")

    interrupted = False

    def _mark_stop(_signum, _frame):
        nonlocal interrupted
        interrupted = True

    signal.signal(signal.SIGTERM, _mark_stop)
    signal.signal(signal.SIGINT, _mark_stop)

    while True:
        state = handle.state_json()
        status = state.get("status")
        if interrupted or status == "stopping":
            _append_event(handle, "supervisor stopping")
            _update_state(handle, status="stopped", phase="stopped", progress_pct=100, supervisor_state="stopped")
            _write_json(handle.run_dir / "acceptance.json", {"status": "stopped", "checks": [], "updated_at": utc_now()})
            break
        if status in TERMINAL_STATUSES:
            break

        progress = min(95, int(state.get("progress_pct", 0)) + 5)
        _update_state(handle, status="running", phase="active", progress_pct=progress, supervisor_state="running")
        _write_heartbeat(handle)
        time.sleep(0.2)

    release_repo_lease(project_root, run_id)
    _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "stopped", "updated_at": utc_now()})
    return 0


def stop_run(project_root: Path, run_id: str) -> None:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    _append_event(handle, "stop requested")
    _update_state(handle, status="stopping", phase="stopping", supervisor_state="stopping")
    supervisor = _read_json(handle.local_dir / "supervisor.json")
    pid = supervisor.get("pid")
    if isinstance(pid, int):
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


def resume_run(project_root: Path, run_id: str) -> RunHandle:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    run_payload = handle.run_json()
    if not run_payload:
        raise FileNotFoundError(f"Run {run_id} not found")

    state = handle.state_json()
    supervisor = _read_json(handle.local_dir / "supervisor.json")
    supervisor_alive = _process_alive(supervisor.get("pid"))
    if state.get("status") in ACTIVE_STATUSES and supervisor_alive:
        return handle

    if state.get("status") in ACTIVE_STATUSES and not supervisor_alive:
        _append_event(handle, "stale supervisor detected; takeover requested", kind="warning", level="warning")

    _append_event(handle, "resume requested")
    _update_state(handle, status="queued", phase="resume_requested", supervisor_state="spawning")
    spawn_supervisor(handle)
    return handle


def attach_run(project_root: Path, run_id: str, *, watch: bool = False, timeout_seconds: float = 5.0) -> str:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    deadline = time.time() + timeout_seconds
    last_seen = 0
    lines: list[str] = []
    while True:
        events_path = handle.run_dir / "events.jsonl"
        if events_path.exists():
            for raw in events_path.read_text(encoding="utf-8").splitlines():
                if not raw.strip():
                    continue
                payload = json.loads(raw)
                seq = int(payload.get("seq", 0))
                if seq <= last_seen:
                    continue
                last_seen = seq
                lines.append(f"[{payload.get('ts')}] {payload.get('message')}")
        state = handle.state_json()
        if not watch or state.get("status") not in ACTIVE_STATUSES or time.time() >= deadline:
            lines.append(f"status={state.get('status')} phase={state.get('phase')} progress={state.get('progress_pct')}")
            return "\n".join(lines).strip()
        time.sleep(0.2)


def list_active_runs(project_root: Path) -> list[dict[str, Any]]:
    runs_dir = project_root / ".thoth" / "runs"
    rows: list[dict[str, Any]] = []
    if not runs_dir.is_dir():
        return rows
    for run_dir in sorted(runs_dir.iterdir()):
        if not run_dir.is_dir():
            continue
        run = _read_json(run_dir / "run.json")
        state = _read_json(run_dir / "state.json")
        if state.get("status") in ACTIVE_STATUSES:
            rows.append({
                "run_id": run.get("run_id", run_dir.name),
                "kind": run.get("kind"),
                "host": run.get("host"),
                "executor": run.get("executor"),
                "status": state.get("status"),
                "phase": state.get("phase"),
                "progress_pct": state.get("progress_pct"),
            })
    return rows


def build_status_payload(project_root: Path) -> dict[str, Any]:
    active_runs = list_active_runs(project_root)
    return {
        "project_root": str(project_root.resolve()),
        "active_run_count": len(active_runs),
        "active_runs": active_runs,
        "local_registry": str(local_registry_root(project_root)),
    }


def runtime_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="thoth")
    sub = parser.add_subparsers(dest="command", required=True)

    run_parser = sub.add_parser("run")
    run_parser.add_argument("task", nargs="?", default="ad-hoc task")
    run_parser.add_argument("--task-id")
    run_parser.add_argument("--host", default="codex")
    run_parser.add_argument("--executor", default="codex")
    run_parser.add_argument("--detach", action="store_true")
    run_parser.add_argument("--attach")
    run_parser.add_argument("--watch")
    run_parser.add_argument("--stop")

    loop_parser = sub.add_parser("loop")
    loop_parser.add_argument("--goal", default="loop")
    loop_parser.add_argument("--task-id")
    loop_parser.add_argument("--host", default="codex")
    loop_parser.add_argument("--executor", default="codex")
    loop_parser.add_argument("--detach", action="store_true")
    loop_parser.add_argument("--attach")
    loop_parser.add_argument("--resume")
    loop_parser.add_argument("--watch")
    loop_parser.add_argument("--stop")

    status_parser = sub.add_parser("status")
    status_parser.add_argument("--json", action="store_true")

    init_parser = sub.add_parser("init")
    init_parser.add_argument("--config-json")

    doctor = sub.add_parser("doctor")
    doctor.add_argument("--quick", action="store_true")
    doctor.add_argument("--fix", action="store_true")

    dashboard = sub.add_parser("dashboard")
    dashboard.add_argument("action", nargs="?", default="start", choices=("start", "stop", "rebuild"))

    sub.add_parser("sync")

    report = sub.add_parser("report")
    report.add_argument("--format", choices=("md", "json"), default="md")

    discuss = sub.add_parser("discuss")
    discuss.add_argument("--goal")
    discuss.add_argument("rest", nargs="*")

    extend = sub.add_parser("extend")
    extend.add_argument("changed", nargs="*")

    review = sub.add_parser("review")
    review.add_argument("--goal")
    review.add_argument("rest", nargs="*")

    hook = sub.add_parser("hook")
    hook.add_argument("--host", required=True, choices=("claude", "codex"))
    hook.add_argument("--event", required=True, choices=("start", "end", "stop"))

    supervise = sub.add_parser("supervise")
    supervise.add_argument("--project-root", required=True)
    supervise.add_argument("--run-id", required=True)
    return parser
