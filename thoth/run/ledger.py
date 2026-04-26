"""Canonical runtime ledger write protocol."""

from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Any

from thoth.plan.results import update_task_result_from_run_result

from .io import _append_jsonl, _read_json, _write_json, ensure_runtime_tree
from .lease import release_repo_lease
from .model import LIVE_DISPATCH_MODE, PROTOCOL_VERSION, RunHandle, SLEEP_DISPATCH_MODE, utc_now

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
        "last_heartbeat_at": now,
        "updated_at": now,
        "supervisor_state": "spawning" if dispatch_mode == SLEEP_DISPATCH_MODE else LIVE_DISPATCH_MODE,
        "dispatch_mode": dispatch_mode,
        "sleep_requested": sleep_requested,
    }
    _write_json(handle.run_dir / "run.json", run_payload)
    _write_json(handle.run_dir / "state.json", state_payload)
    _write_json(
        handle.run_dir / "result.json",
        {
            "schema_version": PROTOCOL_VERSION,
            "kind": kind,
            "run_id": run_id,
            "task_id": task_id,
            "status": "pending",
            "summary": None,
            "checks": [],
            "result": {},
            "updated_at": now,
        },
    )
    _write_json(handle.run_dir / "artifacts.json", {"artifacts": [], "updated_at": now})
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
    _update_state(handle, last_heartbeat_at=now)


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


def _normalize_run_result(
    *,
    handle: RunHandle,
    summary: str,
    result_payload: dict[str, Any] | None = None,
    checks: list[dict[str, Any]] | None = None,
    status: str,
    reason: str | None = None,
) -> dict[str, Any]:
    run = handle.run_json()
    payload = {
        "schema_version": PROTOCOL_VERSION,
        "run_id": handle.run_id,
        "task_id": run.get("task_id"),
        "kind": run.get("kind"),
        "status": status,
        "summary": summary,
        "checks": checks or [],
        "result": result_payload or {},
        "updated_at": utc_now(),
        "finished_at": utc_now(),
    }
    if reason:
        payload["reason"] = reason
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
    run_payload = handle.run_json()
    artifacts_payload = _read_json(handle.run_dir / "artifacts.json")
    run_result = _normalize_run_result(
        handle=handle,
        summary=summary,
        result_payload=result_payload,
        checks=checks,
        status="completed",
    )
    _write_json(
        handle.run_dir / "result.json",
        run_result,
    )
    _append_event(handle, summary, kind="complete")
    _update_state(handle, status="completed", phase="conclusion", progress_pct=100, supervisor_state="completed")
    _write_heartbeat(handle)
    _update_run(handle, attachable=False)
    release_repo_lease(project_root, run_id)
    _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "completed", "updated_at": utc_now()})
    update_task_result_from_run_result(
        project_root,
        run_payload=run_payload,
        run_result=run_result,
        artifacts_payload=artifacts_payload,
    )
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
    run_payload = handle.run_json()
    artifacts_payload = _read_json(handle.run_dir / "artifacts.json")
    checks = []
    if reason:
        checks.append({"name": "reason", "ok": False, "detail": reason})
    run_result = _normalize_run_result(
        handle=handle,
        summary=summary,
        result_payload=result_payload,
        checks=checks,
        status="failed",
        reason=reason,
    )
    _write_json(
        handle.run_dir / "result.json",
        run_result,
    )
    _append_event(handle, summary, kind="error", level="error", payload={"reason": reason})
    _update_state(handle, status="failed", phase="failed", progress_pct=min(99, int(handle.state_json().get("progress_pct", 0))), supervisor_state="failed")
    _write_heartbeat(handle)
    _update_run(handle, attachable=False)
    release_repo_lease(project_root, run_id)
    _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "failed", "updated_at": utc_now()})
    update_task_result_from_run_result(
        project_root,
        run_payload=run_payload,
        run_result=run_result,
        artifacts_payload=artifacts_payload,
    )
    return handle


def _write_stopped_result(handle: RunHandle) -> None:
    run = handle.run_json()
    _write_json(
        handle.run_dir / "result.json",
        {
            "schema_version": PROTOCOL_VERSION,
            "run_id": handle.run_id,
            "task_id": run.get("task_id"),
            "kind": run.get("kind"),
            "status": "stopped",
            "summary": "Run stopped before completion.",
            "checks": [],
            "result": {},
            "updated_at": utc_now(),
            "finished_at": utc_now(),
        },
    )
