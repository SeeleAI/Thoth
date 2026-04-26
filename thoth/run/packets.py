"""Execution packet construction and prepare orchestration."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

from thoth.plan.store import load_task_result

from .io import _read_json, _write_json
from .lease import acquire_repo_lease
from .ledger import _append_event, _update_state, _write_heartbeat, create_run
from .model import LIVE_DISPATCH_MODE, SLEEP_DISPATCH_MODE, PROTOCOL_VERSION, RunHandle, _parse_iso8601, dispatch_mode_for, utc_now

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


def _latest_fresh_review_context(
    project_root: Path,
    *,
    task_id: str | None,
    target: str | None,
) -> dict[str, Any]:
    if not task_id or not target:
        return {}
    task_result = load_task_result(project_root, task_id)
    last_closure_at = task_result.get("last_closure_at")
    last_closure_ts = _parse_iso8601(last_closure_at)
    best: dict[str, Any] = {}
    runs_root = project_root / ".thoth" / "runs"
    if not runs_root.is_dir():
        return {}
    for run_dir in runs_root.iterdir():
        if not run_dir.is_dir():
            continue
        run_payload = _read_json(run_dir / "run.json")
        if run_payload.get("kind") != "review":
            continue
        if run_payload.get("task_id") != task_id or run_payload.get("target") != target:
            continue
        result_payload = _read_json(run_dir / "result.json")
        if result_payload.get("status") != "completed":
            continue
        finished_at = result_payload.get("finished_at") or result_payload.get("updated_at")
        finished_ts = _parse_iso8601(finished_at)
        if finished_ts is None:
            continue
        if last_closure_ts is not None and finished_ts <= last_closure_ts:
            continue
        current_best_ts = _parse_iso8601(best.get("finished_at")) if best else None
        if current_best_ts is not None and finished_ts <= current_best_ts:
            continue
        review_result = result_payload.get("result") if isinstance(result_payload.get("result"), dict) else {}
        best = {
            "run_id": run_payload.get("run_id") or run_dir.name,
            "target": target,
            "summary": result_payload.get("summary"),
            "finished_at": finished_at,
            "findings": review_result.get("findings", []),
        }
    return best


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
    elif command_id == "loop":
        review_binding = strict_task.get("review_binding") if isinstance(strict_task, dict) else {}
        review_target = review_binding.get("target") if isinstance(review_binding, dict) else None
        review_context = _latest_fresh_review_context(
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
