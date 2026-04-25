"""Durable Thoth runtime, internal protocol, and worker dispatch helpers."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import signal
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .task_contracts import compile_task_authority


ACTIVE_STATUSES = {"queued", "running", "paused", "waiting_input", "stopping"}
TERMINAL_STATUSES = {"completed", "failed", "stopped"}
LIVE_DISPATCH_MODE = "live_native"
SLEEP_DISPATCH_MODE = "external_worker"
PROTOCOL_VERSION = 1
WORKER_HEARTBEAT_INTERVAL_SECONDS = 15.0
WORKER_RETRY_LIMIT = 2
WORKER_RETRY_WINDOW_SECONDS = 90.0
DEFAULT_EXTERNAL_WORKER_TIMEOUT_SECONDS = 15 * 60
CLAUDE_EXTERNAL_WORKER_ALLOWED_TOOLS = "Read,Glob,Grep,Bash,Edit,Write,Task,Monitor"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.parent / f".{path.name}.{os.getpid()}.{uuid.uuid4().hex}.tmp"
    try:
        tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        tmp_path.replace(path)
    finally:
        tmp_path.unlink(missing_ok=True)


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


def _parse_iso8601(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _age_seconds(iso_utc: Any) -> float | None:
    dt = _parse_iso8601(iso_utc)
    if dt is None:
        return None
    return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds())


def project_hash(project_root: Path) -> str:
    return hashlib.sha256(str(project_root.resolve()).encode("utf-8")).hexdigest()[:16]


def _directory_is_writable(path: Path) -> bool:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / f".thoth-write-test-{os.getpid()}"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError:
        return False
    return True


def local_registry_root(project_root: Path) -> Path:
    env = os.environ.get("THOTH_LOCAL_STATE_DIR")
    if env:
        base = Path(env)
    else:
        preferred = Path.home() / ".local" / "state" / "thoth"
        fallback = project_root / ".thoth" / "derived" / "local-state"
        base = preferred if _directory_is_writable(preferred) else fallback
    return base / project_hash(project_root)


def default_executor() -> str:
    return "claude"


def dispatch_mode_for(sleep_requested: bool) -> str:
    return SLEEP_DISPATCH_MODE if sleep_requested else LIVE_DISPATCH_MODE


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

    def heartbeat_json(self) -> dict[str, Any]:
        return _read_json(self.run_dir / "heartbeat.json")


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


def _lease_stale_after_seconds() -> int:
    raw = os.environ.get("THOTH_LEASE_STALE_SECONDS", "120")
    try:
        return max(30, int(raw))
    except ValueError:
        return 120


def _lease_holder_is_stale(project_root: Path, lease_payload: dict[str, Any]) -> bool:
    if not lease_payload or lease_payload.get("status") not in ACTIVE_STATUSES:
        return False
    run_id = lease_payload.get("run_id")
    if not isinstance(run_id, str) or not run_id:
        return True
    run_dir = project_root / ".thoth" / "runs" / run_id
    heartbeat = _read_json(run_dir / "heartbeat.json")
    heartbeat_age = _age_seconds(heartbeat.get("last_heartbeat_at"))
    supervisor = _supervisor_payload(project_root, run_id)
    supervisor_alive = _process_alive(supervisor.get("pid"))
    if supervisor_alive:
        return False
    if heartbeat_age is None:
        return True
    return heartbeat_age >= _lease_stale_after_seconds()


def acquire_repo_lease(project_root: Path, run_id: str, host: str, executor: str, *, dispatch_mode: str | None = None) -> Path:
    lease_path = local_registry_root(project_root) / "lease.json"
    current = _read_json(lease_path)
    if current and current.get("run_id") != run_id and current.get("status") in ACTIVE_STATUSES:
        if _lease_holder_is_stale(project_root, current):
            current["status"] = "released"
            current["released_reason"] = "stale_runtime"
            current["updated_at"] = utc_now()
            _write_json(lease_path, current)
        else:
            raise RuntimeError(f"Active lease already held by {current.get('run_id')}")
    payload = {
        "run_id": run_id,
        "host": host,
        "executor": executor,
        "dispatch_mode": dispatch_mode,
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
    dispatch_mode: str = LIVE_DISPATCH_MODE,
    sleep_requested: bool = False,
    max_rounds: int | None = None,
    max_runtime_seconds: int | None = None,
    target: str | None = None,
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
        "target": target,
        "host": host,
        "executor": executor,
        "durable": durable,
        "attachable": True,
        "dispatch_mode": dispatch_mode,
        "sleep_requested": sleep_requested,
        "worker_mode": "background" if sleep_requested else "foreground",
        "max_rounds": max_rounds,
        "max_runtime_seconds": max_runtime_seconds,
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
        "supervisor_state": "spawning" if dispatch_mode == SLEEP_DISPATCH_MODE else LIVE_DISPATCH_MODE,
        "dispatch_mode": dispatch_mode,
        "sleep_requested": sleep_requested,
    }
    _write_json(handle.run_dir / "run.json", run_payload)
    _write_json(handle.run_dir / "state.json", state_payload)
    _write_json(handle.run_dir / "acceptance.json", {"status": "pending", "checks": [], "updated_at": now})
    _write_json(handle.run_dir / "artifacts.json", {"artifacts": [], "updated_at": now})
    _write_json(handle.run_dir / "heartbeat.json", {"last_heartbeat_at": now, "updated_at": now})
    _append_jsonl(handle.run_dir / "events.jsonl", {"seq": 1, "ts": now, "kind": "log", "message": "run created"})
    return handle


def _update_run(handle: RunHandle, **fields: Any) -> dict[str, Any]:
    run = handle.run_json()
    run.update(fields)
    run["updated_at"] = utc_now()
    _write_json(handle.run_dir / "run.json", run)
    return run


def _update_state(handle: RunHandle, **fields: Any) -> dict[str, Any]:
    state = handle.state_json()
    state.update(fields)
    state["updated_at"] = utc_now()
    _write_json(handle.run_dir / "state.json", state)
    return state


def _write_heartbeat(handle: RunHandle) -> None:
    now = utc_now()
    _write_json(handle.run_dir / "heartbeat.json", {"last_heartbeat_at": now, "updated_at": now})


def _next_event_seq(handle: RunHandle) -> int:
    state = handle.state_json()
    events_path = handle.run_dir / "events.jsonl"
    if not events_path.exists():
        return max(1, int(state.get("last_event_seq", 0)) + 1)
    lines = [line for line in events_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return max(int(state.get("last_event_seq", 0)), len(lines)) + 1


def _append_event(
    handle: RunHandle,
    message: str,
    *,
    kind: str = "log",
    level: str = "info",
    payload: dict[str, Any] | None = None,
) -> None:
    seq = _next_event_seq(handle)
    event = {"seq": seq, "ts": utc_now(), "kind": kind, "level": level, "message": message}
    if payload:
        event["payload"] = payload
    _append_jsonl(handle.run_dir / "events.jsonl", event)
    _update_state(handle, last_event_seq=seq)


def _protocol_command_argv(project_root: Path, command: str, run_id: str, *extra: str) -> list[str]:
    repo_root = Path(__file__).resolve().parent.parent
    return [
        sys.executable,
        "-m",
        "thoth.cli",
        command,
        "--project-root",
        str(project_root),
        "--run-id",
        run_id,
        *extra,
    ]


def _protocol_command_strings(project_root: Path, run_id: str) -> dict[str, str]:
    def render(command: str, *extra: str) -> str:
        argv = _protocol_command_argv(project_root, command, run_id, *extra)
        return " ".join(json.dumps(part) for part in argv)

    return {
        "append_event": render("append-event", "--message", "message", "--kind", "log"),
        "record_artifact": render("record-artifact", "--path", "path/to/artifact", "--label", "artifact"),
        "heartbeat": render("heartbeat", "--phase", "active", "--progress", "50"),
        "complete": render("complete", "--summary", "finished"),
        "fail": render("fail", "--summary", "failed", "--reason", "reason"),
    }


def _build_execution_packet(
    handle: RunHandle,
    *,
    goal: str,
    command_id: str,
    target: str | None = None,
    strict_task: dict[str, Any] | None = None,
) -> dict[str, Any]:
    run = handle.run_json()
    state = handle.state_json()
    packet = {
        "schema_version": PROTOCOL_VERSION,
        "protocol": "thoth-runtime/v1",
        "packet_kind": "execution",
        "prepared_at": utc_now(),
        "project_root": str(handle.project_root.resolve()),
        "run_id": handle.run_id,
        "kind": run.get("kind"),
        "command_id": command_id,
        "task_id": run.get("task_id"),
        "title": run.get("title"),
        "target": target or run.get("target"),
        "goal": goal,
        "host": run.get("host"),
        "executor": run.get("executor"),
        "dispatch_mode": run.get("dispatch_mode"),
        "sleep_requested": bool(run.get("sleep_requested")),
        "background_mode": "detached" if run.get("dispatch_mode") == SLEEP_DISPATCH_MODE else "current_session",
        "attachable": bool(run.get("attachable", True)),
        "state": {
            "status": state.get("status"),
            "phase": state.get("phase"),
            "progress_pct": state.get("progress_pct"),
        },
        "limits": {
            "max_rounds": run.get("max_rounds"),
            "max_runtime_seconds": run.get("max_runtime_seconds"),
        },
        "strict_task": strict_task or {},
        "protocol_commands": _protocol_command_strings(handle.project_root, handle.run_id),
        "paths": {
            "run_dir": str(handle.run_dir),
            "events": str(handle.run_dir / "events.jsonl"),
            "state": str(handle.run_dir / "state.json"),
            "artifacts": str(handle.run_dir / "artifacts.json"),
            "acceptance": str(handle.run_dir / "acceptance.json"),
            "packet": str(handle.run_dir / "packet.json"),
        },
        "execution_requirements": [
            "Use only the current packet plus compiler-generated strict task/context as authority.",
            "Run the strict task eval_entrypoint exactly as written before inventing parallel validator orchestration.",
            "Write heartbeat and progress updates through the internal runtime protocol.",
            "Record material artifacts and finish via complete/fail rather than silently exiting.",
        ],
    }
    if command_id == "review":
        packet["required_review_shape"] = {
            "summary": "Short evidence-backed review summary.",
            "findings": [
                {
                    "severity": "high|medium|low",
                    "title": "Finding title",
                    "path": "relative/file/path",
                    "line": 1,
                    "summary": "Why this is a bug/risk/regression.",
                }
            ],
        }
    _write_json(handle.run_dir / "packet.json", packet)
    return packet


def _mark_prepare_started(handle: RunHandle) -> None:
    _write_heartbeat(handle)
    _update_state(handle, status="running", phase="prepared", progress_pct=1)
    _append_event(handle, "execution packet prepared", kind="prepare")


def prepare_execution(
    project_root: Path,
    *,
    command_id: str,
    title: str,
    task_id: str | None,
    host: str,
    executor: str,
    sleep_requested: bool,
    strict_task: dict[str, Any] | None = None,
    target: str | None = None,
    goal: str | None = None,
    max_rounds: int | None = None,
    max_runtime_seconds: int | None = None,
) -> tuple[RunHandle, dict[str, Any]]:
    dispatch_mode = dispatch_mode_for(sleep_requested)
    handle = create_run(
        project_root,
        kind=command_id,
        title=title,
        task_id=task_id,
        host=host,
        executor=executor,
        durable=command_id in {"run", "loop"},
        dispatch_mode=dispatch_mode,
        sleep_requested=sleep_requested,
        max_rounds=max_rounds,
        max_runtime_seconds=max_runtime_seconds,
        target=target,
    )
    try:
        acquire_repo_lease(project_root, handle.run_id, host, executor, dispatch_mode=dispatch_mode)
    except RuntimeError as exc:
        _update_state(handle, status="failed", phase="lease_conflict", supervisor_state="failed", progress_pct=0)
        _append_event(handle, "lease conflict", kind="error", level="error", payload={"reason": str(exc)})
        raise
    _mark_prepare_started(handle)
    packet = _build_execution_packet(
        handle,
        goal=goal or title,
        command_id=command_id,
        target=target,
        strict_task=strict_task,
    )
    return handle, packet


def append_protocol_event(
    project_root: Path,
    run_id: str,
    *,
    message: str,
    kind: str = "log",
    level: str = "info",
    phase: str | None = None,
    progress_pct: int | None = None,
    payload: dict[str, Any] | None = None,
) -> RunHandle:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    _append_event(handle, message, kind=kind, level=level, payload=payload)
    state_updates: dict[str, Any] = {}
    if phase:
        state_updates["phase"] = phase
    if progress_pct is not None:
        state_updates["progress_pct"] = max(0, min(100, int(progress_pct)))
    if state_updates:
        _update_state(handle, **state_updates)
    _write_heartbeat(handle)
    return handle


def record_artifact(
    project_root: Path,
    run_id: str,
    *,
    path: str,
    label: str | None = None,
    artifact_kind: str = "file",
    metadata: dict[str, Any] | None = None,
) -> RunHandle:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    artifacts = _read_json(handle.run_dir / "artifacts.json")
    rows = artifacts.get("artifacts")
    if not isinstance(rows, list):
        rows = []
    rows.append(
        {
            "path": path,
            "label": label or Path(path).name,
            "kind": artifact_kind,
            "metadata": metadata or {},
            "recorded_at": utc_now(),
        }
    )
    artifacts["artifacts"] = rows
    artifacts["updated_at"] = utc_now()
    _write_json(handle.run_dir / "artifacts.json", artifacts)
    _append_event(handle, f"artifact recorded: {label or path}", kind="artifact", payload={"path": path, "label": label, "kind": artifact_kind})
    _write_heartbeat(handle)
    return handle


def heartbeat_run(
    project_root: Path,
    run_id: str,
    *,
    phase: str | None = None,
    progress_pct: int | None = None,
    note: str | None = None,
) -> RunHandle:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    updates: dict[str, Any] = {}
    if phase:
        updates["phase"] = phase
    if progress_pct is not None:
        updates["progress_pct"] = max(0, min(100, int(progress_pct)))
    if updates:
        _update_state(handle, **updates)
    _write_heartbeat(handle)
    if note:
        _append_event(handle, note, kind="heartbeat")
    return handle


def _normalize_acceptance_payload(
    *,
    summary: str,
    result_payload: dict[str, Any] | None = None,
    checks: list[dict[str, Any]] | None = None,
    status: str,
) -> dict[str, Any]:
    payload = {
        "status": status,
        "summary": summary,
        "checks": checks or [],
        "result": result_payload or {},
        "updated_at": utc_now(),
    }
    return payload


def complete_run(
    project_root: Path,
    run_id: str,
    *,
    summary: str,
    result_payload: dict[str, Any] | None = None,
    checks: list[dict[str, Any]] | None = None,
) -> RunHandle:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    _write_json(
        handle.run_dir / "acceptance.json",
        _normalize_acceptance_payload(summary=summary, result_payload=result_payload, checks=checks, status="passed"),
    )
    _append_event(handle, summary, kind="complete")
    _update_state(handle, status="completed", phase="conclusion", progress_pct=100, supervisor_state="completed")
    _write_heartbeat(handle)
    _update_run(handle, attachable=False)
    release_repo_lease(project_root, run_id)
    _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "completed", "updated_at": utc_now()})
    return handle


def fail_run(
    project_root: Path,
    run_id: str,
    *,
    summary: str,
    reason: str | None = None,
    result_payload: dict[str, Any] | None = None,
) -> RunHandle:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    checks = []
    if reason:
        checks.append({"name": "reason", "ok": False, "detail": reason})
    _write_json(
        handle.run_dir / "acceptance.json",
        _normalize_acceptance_payload(summary=summary, result_payload=result_payload, checks=checks, status="failed"),
    )
    _append_event(handle, summary, kind="error", level="error", payload={"reason": reason})
    _update_state(handle, status="failed", phase="failed", progress_pct=min(99, int(handle.state_json().get("progress_pct", 0))), supervisor_state="failed")
    _write_heartbeat(handle)
    _update_run(handle, attachable=False)
    release_repo_lease(project_root, run_id)
    _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "failed", "updated_at": utc_now()})
    return handle


def spawn_supervisor(handle: RunHandle) -> int:
    package_root = Path(__file__).resolve().parent.parent
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(package_root) if not existing else f"{package_root}:{existing}"
    cmd = [
        sys.executable,
        "-m",
        "thoth.cli",
        "worker",
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
    handle.local_dir.mkdir(parents=True, exist_ok=True)
    _write_json(handle.local_dir / "supervisor.json", {"pid": proc.pid, "state": "running", "runtime": "external_worker", "updated_at": utc_now()})
    _update_state(
        handle,
        status="running",
        supervisor_state="running",
        phase="queued",
        progress_pct=max(1, int(handle.state_json().get("progress_pct", 1))),
        dispatch_mode=SLEEP_DISPATCH_MODE,
    )
    _update_run(handle, dispatch_mode=SLEEP_DISPATCH_MODE, sleep_requested=True, worker_mode="background")
    _append_event(handle, "external worker spawned", kind="worker")
    return proc.pid


def _worker_prompt_path(handle: RunHandle) -> Path:
    return handle.run_dir / "external-worker-prompt.md"


def _worker_log_dir(handle: RunHandle) -> Path:
    path = handle.run_dir / "worker-logs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _worker_timeout_seconds(run_payload: dict[str, Any]) -> float:
    configured = run_payload.get("max_runtime_seconds")
    if isinstance(configured, int) and configured > 0:
        return float(configured + 180)
    return float(DEFAULT_EXTERNAL_WORKER_TIMEOUT_SECONDS)


def _normalize_worker_executor(executor: Any) -> str:
    text = str(executor or default_executor()).strip().lower()
    return "codex" if text == "codex" else "claude"


def codex_exec_model() -> str:
    return str(os.environ.get("THOTH_CODEX_EXEC_MODEL") or "gpt-5.4").strip() or "gpt-5.4"


def _looks_like_transient_worker_outage(detail: str) -> bool:
    lowered = detail.lower()
    return any(
        marker in lowered
        for marker in (
            "api error: 503",
            "server-side issue",
            "try again in a moment",
            "status.claude.com",
            "temporarily unavailable",
            "无可用渠道",
            "rate limit",
            "connection reset",
            "connection refused",
            "timed out",
        )
    )


def _tail_text(path: Path, *, limit: int = 4000) -> str:
    if not path.exists():
        return ""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    if len(text) <= limit:
        return text
    return text[-limit:]


def _protocol_cli_commands(project_root: Path, run_id: str) -> dict[str, str]:
    return {
        "append_event": f"{shlex.quote(sys.executable)} -m thoth.cli append-event --project-root {shlex.quote(str(project_root))} --run-id {shlex.quote(run_id)} --message \"message\" --kind log",
        "record_artifact": f"{shlex.quote(sys.executable)} -m thoth.cli record-artifact --project-root {shlex.quote(str(project_root))} --run-id {shlex.quote(run_id)} --path path/to/artifact --label artifact",
        "heartbeat": f"{shlex.quote(sys.executable)} -m thoth.cli heartbeat --project-root {shlex.quote(str(project_root))} --run-id {shlex.quote(run_id)} --phase active --progress 50 --note \"progress update\"",
        "complete": f"{shlex.quote(sys.executable)} -m thoth.cli complete --project-root {shlex.quote(str(project_root))} --run-id {shlex.quote(run_id)} --summary \"finished\" --result-json '{{\"ok\":true}}' --checks-json '[{{\"name\":\"validator\",\"ok\":true}}]'",
        "fail": f"{shlex.quote(sys.executable)} -m thoth.cli fail --project-root {shlex.quote(str(project_root))} --run-id {shlex.quote(run_id)} --summary \"failed\" --reason \"reason\" --result-json '{{\"ok\":false}}'",
    }


def _build_external_worker_prompt(handle: RunHandle, packet: dict[str, Any]) -> str:
    project_root = handle.project_root.resolve()
    run = handle.run_json()
    protocol_commands = _protocol_cli_commands(project_root, handle.run_id)
    packet_path = handle.run_dir / "packet.json"
    kind = str(packet.get("command_id") or run.get("kind") or "run")
    strict_task = packet.get("strict_task") if isinstance(packet.get("strict_task"), dict) else {}
    eval_command = str(strict_task.get("eval_entrypoint", {}).get("command") or "").strip()
    loop_limits = ""
    if kind == "loop":
        loop_limits = (
            f"- This loop is bounded: at most {int(run.get('max_rounds') or 5)} rounds and "
            f"at most {int(run.get('max_runtime_seconds') or 12 * 60)} seconds of active work.\n"
        )
    review_clause = ""
    if kind == "review":
        findings_path = handle.run_dir / "review-findings.json"
        review_clause = f"""
- Produce structured findings matching the required shape in the packet.
- Write them to `{findings_path}` as JSON with top-level keys `summary` and `findings`.
- Record that file as an artifact with label `review-findings`.
- Complete the run with `--result-json` carrying the same `summary` and `findings`.
"""
    else:
        review_clause = f"""
- For this task, do actual repository work instead of summarizing.
- Run the validator exactly as written: `{eval_command}`.
- If the validator passes, call `complete` with a concise summary plus evidence in `--checks-json`.
- If the validator cannot be made to pass within the allowed budget, call `fail` with the concrete blocker.
"""
    return f"""# Thoth External Worker

You are the detached external worker for an already-prepared Thoth run.

## Hard Rules

- Work only inside `{project_root}`.
- Do NOT call `$thoth run`, `$thoth loop`, or `$thoth review` again.
- Do NOT create a new run ledger. The current run id is `{handle.run_id}`.
- `.thoth` is the only runtime authority.
- Before exiting, you MUST terminalize this run by calling exactly one of:
  - `complete`
  - `fail`

## Packet Authority

- Packet file: `{packet_path}`
- Command kind: `{kind}`
- Host: `{run.get("host")}`
- Executor: `{run.get("executor")}`
- Task id: `{run.get("task_id")}`

Read the packet file before taking action. Treat its `strict_task`, `limits`, and `required_review_shape` as authoritative.

## Internal Protocol Commands

- Append an event:
  - `{protocol_commands["append_event"]}`
- Heartbeat:
  - `{protocol_commands["heartbeat"]}`
- Record artifact:
  - `{protocol_commands["record_artifact"]}`
- Complete:
  - `{protocol_commands["complete"]}`
- Fail:
  - `{protocol_commands["fail"]}`

Use these repo-local CLI protocol commands for runtime updates. Do not mutate run ledgers by hand.

## Required Workflow

- Append one event when you begin meaningful work.
- Emit heartbeat updates as you make progress.
- Record material artifacts such as validator logs, report files, or findings files.
{loop_limits}{review_clause}
## Packet Snapshot

```json
{json.dumps(packet, ensure_ascii=False, indent=2)}
```
"""


def _external_worker_command(executor: str, project_root: Path, prompt: str) -> list[str]:
    if executor == "codex":
        return [
            "codex",
            "exec",
            "-m",
            codex_exec_model(),
            "--json",
            "--full-auto",
            "-C",
            str(project_root),
            prompt,
        ]
    return [
        "claude",
        "-p",
        "--permission-mode",
        "dontAsk",
        "--allowed-tools",
        CLAUDE_EXTERNAL_WORKER_ALLOWED_TOOLS,
        "--verbose",
        "--output-format",
        "stream-json",
        prompt,
    ]


def _test_external_worker_mode() -> str:
    return os.environ.get("THOTH_TEST_EXTERNAL_WORKER_MODE", "").strip().lower()


def _terminalize_stopped_worker(handle: RunHandle) -> int:
    _append_event(handle, "external worker stopping", kind="worker")
    _update_state(handle, status="stopped", phase="stopped", progress_pct=100, supervisor_state="stopped")
    _write_json(handle.run_dir / "acceptance.json", {"status": "stopped", "checks": [], "updated_at": utc_now()})
    release_repo_lease(handle.project_root, handle.run_id)
    _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "stopped", "runtime": "external_worker", "updated_at": utc_now()})
    return 0


def supervisor_main(project_root: Path, run_id: str) -> int:
    """Compatibility entrypoint retained for older tests and callers."""
    return worker_main(project_root, run_id)


def worker_main(project_root: Path, run_id: str) -> int:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    run_payload = handle.run_json()
    if not run_payload:
        return 1
    interrupted = False
    child_pid: int | None = None

    def _mark_stop(_signum, _frame):
        nonlocal interrupted, child_pid
        interrupted = True
        if child_pid is not None:
            try:
                os.killpg(child_pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    signal.signal(signal.SIGTERM, _mark_stop)
    signal.signal(signal.SIGINT, _mark_stop)
    _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "running", "runtime": "external_worker", "updated_at": utc_now()})
    heartbeat_run(project_root, run_id, phase="external_worker_start", progress_pct=5, note="external worker started")
    test_mode = _test_external_worker_mode()
    if test_mode == "complete":
        time.sleep(0.2)
        complete_run(
            project_root,
            run_id,
            summary="External worker completed through the explicit test seam.",
            result_payload={"worker_runtime": "external_worker", "executor": run_payload.get("executor"), "test_mode": test_mode},
        )
        return 0
    if test_mode == "hold":
        while True:
            state = handle.state_json()
            if interrupted or state.get("status") == "stopping":
                return _terminalize_stopped_worker(handle)
            heartbeat_run(
                project_root,
                run_id,
                phase="external_worker_test_hold",
                progress_pct=25,
                note="external worker hold test seam heartbeat",
            )
            time.sleep(0.5)
    if test_mode == "fail":
        fail_run(
            project_root,
            run_id,
            summary="External worker failed through the explicit test seam.",
            reason="test mode fail",
            result_payload={"worker_runtime": "external_worker", "executor": run_payload.get("executor"), "test_mode": test_mode},
        )
        return 1

    packet = _read_json(handle.run_dir / "packet.json")
    if not packet:
        fail_run(project_root, run_id, summary="External worker could not find packet.json.", reason="missing packet")
        return 1

    prompt = _build_external_worker_prompt(handle, packet)
    prompt_path = _worker_prompt_path(handle)
    prompt_path.write_text(prompt, encoding="utf-8")
    record_artifact(project_root, run_id, path=str(prompt_path), label="external-worker-prompt", artifact_kind="prompt")

    executor = _normalize_worker_executor(run_payload.get("executor"))
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    repo_root = Path(__file__).resolve().parent.parent
    env["PYTHONPATH"] = str(repo_root) if not existing else f"{repo_root}:{existing}"
    env["THOTH_EXTERNAL_WORKER"] = "1"

    timeout_seconds = _worker_timeout_seconds(run_payload)
    attempts = 0
    attempt_window_started = time.time()

    while attempts <= WORKER_RETRY_LIMIT:
        attempts += 1
        _append_event(
            handle,
            f"external worker attempt {attempts} starting",
            kind="worker",
            payload={"executor": executor, "attempt": attempts},
        )
        heartbeat_run(project_root, run_id, phase=f"external_worker_attempt_{attempts}", progress_pct=min(95, 10 + attempts * 5), note=f"external worker attempt {attempts} running")

        log_dir = _worker_log_dir(handle)
        stdout_path = log_dir / f"attempt-{attempts}.stdout.log"
        stderr_path = log_dir / f"attempt-{attempts}.stderr.log"
        command = _external_worker_command(executor, handle.project_root, prompt)

        with stdout_path.open("w", encoding="utf-8") as stdout_handle, stderr_path.open("w", encoding="utf-8") as stderr_handle:
            proc = subprocess.Popen(
                command,
                cwd=str(handle.project_root),
                stdout=stdout_handle,
                stderr=stderr_handle,
                text=True,
                env=env,
                start_new_session=True,
            )
            child_pid = proc.pid
            deadline = time.time() + timeout_seconds
            last_heartbeat_at = 0.0

            while proc.poll() is None:
                state = handle.state_json()
                now = time.time()
                if interrupted or state.get("status") == "stopping":
                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    child_pid = None
                    return _terminalize_stopped_worker(handle)
                if now >= deadline:
                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        proc.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        try:
                            os.killpg(proc.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    break
                if now - last_heartbeat_at >= WORKER_HEARTBEAT_INTERVAL_SECONDS:
                    heartbeat_run(
                        project_root,
                        run_id,
                        phase=f"external_worker_attempt_{attempts}",
                        progress_pct=min(95, 15 + attempts * 5),
                        note=f"external worker attempt {attempts} still running",
                    )
                    last_heartbeat_at = now
                time.sleep(1.0)

            returncode = proc.wait()
            child_pid = None

        record_artifact(project_root, run_id, path=str(stdout_path), label=f"external-worker-attempt-{attempts}-stdout", artifact_kind="log")
        record_artifact(project_root, run_id, path=str(stderr_path), label=f"external-worker-attempt-{attempts}-stderr", artifact_kind="log")

        terminal_state = handle.state_json().get("status")
        if terminal_state == "completed":
            _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "completed", "runtime": "external_worker", "updated_at": utc_now()})
            return 0
        if terminal_state == "stopped":
            _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "stopped", "runtime": "external_worker", "updated_at": utc_now()})
            return 0
        if terminal_state == "failed":
            _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "failed", "runtime": "external_worker", "updated_at": utc_now()})
            return 1

        stdout_tail = _tail_text(stdout_path)
        stderr_tail = _tail_text(stderr_path)
        detail = f"{stdout_tail}\n{stderr_tail}".strip()
        timed_out = returncode != 0 and "timed out" in detail.lower()
        transient = _looks_like_transient_worker_outage(detail) or timed_out
        if transient and attempts <= WORKER_RETRY_LIMIT and (time.time() - attempt_window_started) <= WORKER_RETRY_WINDOW_SECONDS:
            _append_event(
                handle,
                f"external worker attempt {attempts} hit a transient host failure; retrying",
                kind="worker",
                level="warning",
                payload={"returncode": returncode},
            )
            continue

        fail_run(
            project_root,
            run_id,
            summary="External worker exited without a terminal protocol write.",
            reason=f"executor={executor} returncode={returncode}",
            result_payload={
                "worker_runtime": "external_worker",
                "executor": executor,
                "attempts": attempts,
                "stdout_tail": stdout_tail,
                "stderr_tail": stderr_tail,
            },
        )
        return 1

    fail_run(
        project_root,
        run_id,
        summary="External worker exhausted the retry budget without terminalizing the run.",
        reason="retry_budget_exhausted",
        result_payload={"worker_runtime": "external_worker", "executor": executor, "attempts": attempts},
    )
    return 1


def stop_run(project_root: Path, run_id: str) -> None:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    run_payload = handle.run_json()
    _append_event(handle, "stop requested")
    dispatch_mode = run_payload.get("dispatch_mode")
    terminalize_immediately = dispatch_mode in {LIVE_DISPATCH_MODE, SLEEP_DISPATCH_MODE}
    _update_state(handle, status="stopping", phase="stopping", supervisor_state="stopping")
    supervisor = _read_json(handle.local_dir / "supervisor.json")
    pid = supervisor.get("pid")
    if isinstance(pid, int) and _process_alive(pid):
        if terminalize_immediately:
            _update_state(handle, status="stopped", phase="stopped", progress_pct=100, supervisor_state="stopped")
            _write_json(handle.run_dir / "acceptance.json", {"status": "stopped", "checks": [], "updated_at": utc_now()})
            _update_run(handle, attachable=False)
            release_repo_lease(project_root, run_id)
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        return
    if handle.state_json().get("status") in TERMINAL_STATUSES:
        release_repo_lease(project_root, run_id)
        return
    if terminalize_immediately:
        _update_state(handle, status="stopped", phase="stopped", progress_pct=100, supervisor_state="stopped")
        _write_json(handle.run_dir / "acceptance.json", {"status": "stopped", "checks": [], "updated_at": utc_now()})
        _update_run(handle, attachable=False)
        release_repo_lease(project_root, run_id)


def resume_run(project_root: Path, run_id: str) -> RunHandle:
    handle = RunHandle(project_root=project_root.resolve(), run_id=run_id)
    run_payload = handle.run_json()
    if not run_payload:
        raise FileNotFoundError(f"Run {run_id} not found")
    state = handle.state_json()
    if state.get("status") in ACTIVE_STATUSES and run_payload.get("dispatch_mode") == LIVE_DISPATCH_MODE:
        return handle

    acquire_repo_lease(
        project_root,
        run_id,
        str(run_payload.get("host") or "unknown"),
        str(run_payload.get("executor") or "unknown"),
        dispatch_mode=str(run_payload.get("dispatch_mode") or LIVE_DISPATCH_MODE),
    )
    _append_event(handle, "resume requested")
    _update_state(handle, status="running", phase="prepared", supervisor_state="resumed", progress_pct=max(1, int(state.get("progress_pct", 0))))
    _write_heartbeat(handle)
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
        run = handle.run_json()
        if not watch or state.get("status") not in ACTIVE_STATUSES or time.time() >= deadline:
            lines.append(
                "status={status} phase={phase} progress={progress} dispatch={dispatch}".format(
                    status=state.get("status"),
                    phase=state.get("phase"),
                    progress=state.get("progress_pct"),
                    dispatch=run.get("dispatch_mode"),
                )
            )
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
            heartbeat = _read_json(run_dir / "heartbeat.json")
            rows.append(
                {
                    "run_id": run.get("run_id", run_dir.name),
                    "kind": run.get("kind"),
                    "host": run.get("host"),
                    "executor": run.get("executor"),
                    "dispatch_mode": run.get("dispatch_mode"),
                    "attachable": bool(run.get("attachable", True)),
                    "status": state.get("status"),
                    "phase": state.get("phase"),
                    "progress_pct": state.get("progress_pct"),
                    "last_heartbeat_at": heartbeat.get("last_heartbeat_at"),
                }
            )
    return rows


def build_status_payload(project_root: Path) -> dict[str, Any]:
    active_runs = list_active_runs(project_root)
    return {
        "project_root": str(project_root.resolve()),
        "active_run_count": len(active_runs),
        "active_runs": active_runs,
        "local_registry": str(local_registry_root(project_root)),
        "compiler": compile_task_authority(project_root).get("summary", {}),
        "runtime_defaults": {
            "default_executor": default_executor(),
            "live_dispatch_mode": LIVE_DISPATCH_MODE,
            "sleep_dispatch_mode": SLEEP_DISPATCH_MODE,
        },
    }


def runtime_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="thoth")
    sub = parser.add_subparsers(dest="command", required=True)

    run_parser = sub.add_parser("run")
    run_parser.add_argument("--task-id")
    run_parser.add_argument("legacy_task_text", nargs="*")
    run_parser.add_argument("--host", default="codex")
    run_parser.add_argument("--executor", default=default_executor())
    run_parser.add_argument("--sleep", action="store_true")
    run_parser.add_argument("--detach", action="store_true")
    run_parser.add_argument("--attach")
    run_parser.add_argument("--watch")
    run_parser.add_argument("--stop")

    loop_parser = sub.add_parser("loop")
    loop_parser.add_argument("--goal", default="loop")
    loop_parser.add_argument("--task-id")
    loop_parser.add_argument("legacy_goal_text", nargs="*")
    loop_parser.add_argument("--host", default="codex")
    loop_parser.add_argument("--executor", default=default_executor())
    loop_parser.add_argument("--sleep", action="store_true")
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
    doctor.add_argument("--json", action="store_true")

    dashboard = sub.add_parser("dashboard")
    dashboard.add_argument("action", nargs="?", default="start", choices=("start", "stop", "rebuild"))

    sub.add_parser("sync")

    report = sub.add_parser("report")
    report.add_argument("--format", choices=("md", "json"), default="md")

    discuss = sub.add_parser("discuss")
    discuss.add_argument("--goal")
    discuss.add_argument("--decision-json")
    discuss.add_argument("--contract-json")
    discuss.add_argument("rest", nargs="*")

    extend = sub.add_parser("extend")
    extend.add_argument("changed", nargs="*")

    review = sub.add_parser("review")
    review.add_argument("--goal")
    review.add_argument("--host", default="codex")
    review.add_argument("--executor", default=default_executor())
    review.add_argument("rest", nargs="*")

    hook = sub.add_parser("hook")
    hook.add_argument("--host", required=True, choices=("claude", "codex"))
    hook.add_argument("--event", required=True, choices=("start", "end", "stop"))

    supervise = sub.add_parser("supervise")
    supervise.add_argument("--project-root", required=True)
    supervise.add_argument("--run-id", required=True)

    worker = sub.add_parser("worker")
    worker.add_argument("--project-root", required=True)
    worker.add_argument("--run-id", required=True)

    prepare = sub.add_parser("prepare")
    prepare.add_argument("--project-root")
    prepare.add_argument("--command-id", required=True, choices=("run", "loop", "review"))
    prepare.add_argument("--task-id")
    prepare.add_argument("--goal")
    prepare.add_argument("--target")
    prepare.add_argument("--host", default="codex")
    prepare.add_argument("--executor", default=default_executor())
    prepare.add_argument("--sleep", action="store_true")

    append_event = sub.add_parser("append-event")
    append_event.add_argument("--project-root", required=True)
    append_event.add_argument("--run-id", required=True)
    append_event.add_argument("--message", required=True)
    append_event.add_argument("--kind", default="log")
    append_event.add_argument("--level", default="info")
    append_event.add_argument("--phase")
    append_event.add_argument("--progress", type=int)
    append_event.add_argument("--payload-json")

    record = sub.add_parser("record-artifact")
    record.add_argument("--project-root", required=True)
    record.add_argument("--run-id", required=True)
    record.add_argument("--path", required=True)
    record.add_argument("--label")
    record.add_argument("--kind", default="file")
    record.add_argument("--metadata-json")

    heartbeat = sub.add_parser("heartbeat")
    heartbeat.add_argument("--project-root", required=True)
    heartbeat.add_argument("--run-id", required=True)
    heartbeat.add_argument("--phase")
    heartbeat.add_argument("--progress", type=int)
    heartbeat.add_argument("--note")

    complete = sub.add_parser("complete")
    complete.add_argument("--project-root", required=True)
    complete.add_argument("--run-id", required=True)
    complete.add_argument("--summary", required=True)
    complete.add_argument("--result-json")
    complete.add_argument("--checks-json")

    fail = sub.add_parser("fail")
    fail.add_argument("--project-root", required=True)
    fail.add_argument("--run-id", required=True)
    fail.add_argument("--summary", required=True)
    fail.add_argument("--reason")
    fail.add_argument("--result-json")
    return parser
