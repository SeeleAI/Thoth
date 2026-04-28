"""Execution packet construction and prepare orchestration."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from thoth.prompt_specs import build_review_result_shape

from .io import _read_json, _write_json
from .lease import acquire_repo_lease
from .ledger import _append_event, _update_state, _write_heartbeat, create_run
from .model import LIVE_DISPATCH_MODE, SLEEP_DISPATCH_MODE, PROTOCOL_VERSION, RunHandle, _parse_iso8601, dispatch_mode_for, utc_now
from .phases import (
    build_live_packet,
    initialize_loop_controller,
    initialize_run_controller,
    normalize_runtime_contract,
)
from .review_context import latest_fresh_review_context

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
    if command_id in {"run", "loop"}:
        packet = build_live_packet(handle)
        _write_json(handle.run_dir / "packet.json", packet)
        return packet
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
            "result": str(handle.run_dir / "result.json"),
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
        packet["required_review_shape"] = build_review_result_shape()
    elif command_id == "loop":
        review_binding = strict_task.get("review_binding") if isinstance(strict_task, dict) else {}
        review_target = review_binding.get("target") if isinstance(review_binding, dict) else None
        review_context = latest_fresh_review_context(
            handle.project_root,
            task_id=str(run.get("task_id") or "") or None,
            target=review_target if isinstance(review_target, str) else None,
        )
        if review_context:
            packet["review_context"] = review_context
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
    runtime_contract = normalize_runtime_contract(strict_task.get("runtime_contract") if isinstance(strict_task, dict) else None)
    resolved_max_runtime_seconds = max_runtime_seconds
    if command_id == "loop" and (not isinstance(resolved_max_runtime_seconds, int) or resolved_max_runtime_seconds <= 0):
        resolved_max_runtime_seconds = runtime_contract["loop"]["max_runtime_seconds"]
    handle = create_run(
        project_root,
        kind=command_id,
        title=title,
        task_id=task_id,
        host=host,
        executor=executor,
        durable=command_id in {"run", "loop", "review"},
        dispatch_mode=dispatch_mode,
        sleep_requested=sleep_requested,
        max_rounds=max_rounds,
        max_iterations=runtime_contract["loop"]["max_iterations"] if command_id == "loop" else None,
        max_runtime_seconds=resolved_max_runtime_seconds,
        target=target,
    )
    try:
        acquire_repo_lease(project_root, handle.run_id, host, executor, dispatch_mode=dispatch_mode)
    except RuntimeError as exc:
        _update_state(handle, status="failed", phase="lease_conflict", supervisor_state="failed", progress_pct=0)
        _append_event(handle, "lease conflict", kind="error", level="error", payload={"reason": str(exc)})
        raise
    _mark_prepare_started(handle)
    if command_id == "run" and isinstance(strict_task, dict):
        initialize_run_controller(handle, strict_task=strict_task, goal=goal or title, target=target)
    elif command_id == "loop" and isinstance(strict_task, dict):
        initialize_loop_controller(handle, strict_task=strict_task, goal=goal or title, target=target)
    packet = _build_execution_packet(
        handle,
        goal=goal or title,
        command_id=command_id,
        target=target,
        strict_task=strict_task,
    )
    return handle, packet
