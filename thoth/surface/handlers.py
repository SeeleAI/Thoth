"""Canonical command handlers for the public Thoth surface."""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from thoth.init.render import parse_config
from thoth.init.service import initialize_project, sync_project_layer
from thoth.observe.dashboard import manage_dashboard
from thoth.observe.report import generate_default_report, render_report_summary
from thoth.observe.status import render_status, status_snapshot
from thoth.plan.compiler import compile_task_authority, create_discussion_placeholder, load_task_for_execution
from thoth.plan.doctor import build_doctor_payload, infer_review_task_id, render_doctor_text
from thoth.plan.store import upsert_contract, upsert_decision
from thoth.run.ledger import append_protocol_event, complete_run, fail_run, heartbeat_run, record_artifact
from thoth.run.lifecycle import attach_run, default_executor, resume_run, stop_run
from thoth.run.packets import LIVE_DISPATCH_MODE, prepare_execution
from thoth.run.status import build_status_payload
from thoth.run.worker import spawn_supervisor, supervisor_main, worker_main
from thoth.surface.hooks import run_host_hook


def output_refs(*refs: str | Path | None) -> list[str]:
    rows: list[str] = []
    for ref in refs:
        if ref in (None, ""):
            continue
        rows.append(str(ref))
    return rows


def response_envelope(
    *,
    command: str,
    status: str,
    summary: str,
    body: dict[str, Any] | None = None,
    refs: list[str] | None = None,
    checks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    return {
        "command": command,
        "status": status,
        "summary": summary,
        "refs": refs or [],
        "checks": checks or [],
        "body": body or {},
    }


def print_envelope(
    *,
    command: str,
    status: str,
    summary: str,
    body: dict[str, Any] | None = None,
    refs: list[str] | None = None,
    checks: list[dict[str, Any]] | None = None,
) -> None:
    print(
        json.dumps(
            response_envelope(
                command=command,
                status=status,
                summary=summary,
                body=body,
                refs=refs,
                checks=checks,
            ),
            ensure_ascii=False,
            indent=2,
        )
    )


def _append_project_note(project_root: Path, note_type: str, content: str) -> Path:
    path = project_root / ".thoth" / "project" / "conversations.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "ts": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "type": note_type,
        "host": "codex",
        "content": content,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return path


def _decode_json_arg(raw: str | None, *, field: str) -> dict | list | None:
    if raw is None:
        return None
    payload = json.loads(raw)
    if not isinstance(payload, (dict, list)):
        raise ValueError(f"{field} must decode to an object or list")
    return payload


def _run_extend(changed: list[str]) -> tuple[int, str]:
    tests_dir = Path(__file__).resolve().parents[2] / "tests"
    result = subprocess.run(
        [sys.executable, "-m", "pytest", str(tests_dir), "-v", "--tb=short"],
        capture_output=True,
        text=True,
        timeout=120,
        cwd=str(Path(__file__).resolve().parents[2]),
    )
    pieces: list[str] = []
    if changed:
        pieces.append("Changed files:\n" + "\n".join(f"- {item}" for item in changed))
    if result.stdout.strip():
        pieces.append(result.stdout.strip())
    if result.stderr.strip():
        pieces.append(result.stderr.strip())
    return (0 if result.returncode in {0, 5} else result.returncode), "\n\n".join(piece for piece in pieces if piece)


def handle_command(args, parser, *, project_root: Path) -> int:
    if args.command == "supervise":
        return supervisor_main(Path(args.project_root), args.run_id)
    if args.command == "worker":
        return worker_main(Path(args.project_root), args.run_id)
    if args.command == "init":
        config = parse_config(args.config_json) if getattr(args, "config_json", None) else {}
        result = initialize_project(config, project_root)
        print_envelope(
            command="init",
            status="ok",
            summary=f"Initialized Thoth project at {project_root}",
            body={"result": result},
            refs=output_refs(
                project_root / ".thoth" / "project" / "project.json",
                project_root / ".thoth" / "project" / "instructions.md",
                project_root / ".thoth" / "project" / "source-map.json",
                project_root / ".thoth" / "derived" / "codex-hooks.json",
            ),
            checks=[{"name": "migration_id", "ok": bool(result.get("migration_id")), "detail": str(result.get("migration_id"))}],
        )
        return 0
    if args.command == "status":
        payload = build_status_payload(project_root)
        if args.json:
            print_envelope(
                command="status",
                status="ok",
                summary=f"Loaded status for {payload['project_root']}",
                body={"status": payload},
                refs=output_refs(project_root / ".thoth" / "project" / "project.json"),
                checks=[{"name": "active_run_count", "ok": True, "detail": str(payload.get("active_run_count", 0))}],
            )
        else:
            print(render_status(project_root, full=False))
        return 0
    if args.command == "doctor":
        payload = build_doctor_payload(project_root)
        if args.json:
            print_envelope(
                command="doctor",
                status="ok" if payload.get("overall_ok") else "failed",
                summary="Doctor checks completed",
                body={"doctor": payload},
                refs=output_refs(project_root / ".thoth" / "project" / "compiler-state.json"),
                checks=payload.get("checks") if isinstance(payload.get("checks"), list) else [],
            )
        else:
            print(render_doctor_text(payload), end="")
        return 0 if payload.get("overall_ok") else 1
    if args.command == "dashboard":
        result = manage_dashboard(project_root, getattr(args, "action", "start"))
        print_envelope(
            command="dashboard",
            status=result["status"],
            summary=result["summary"],
            body=result,
            refs=output_refs(project_root / ".thoth" / "derived" / "dashboard.pid"),
            checks=[{"name": f"dashboard_{result['action']}", "ok": result["status"] == "ok"}],
        )
        return 0
    if args.command == "sync":
        result = sync_project_layer(project_root)
        print_envelope(
            command="sync",
            status="ok",
            summary="Sync completed",
            body={"result": result},
            refs=output_refs(project_root / ".thoth" / "project" / "compiler-state.json", project_root / ".thoth" / "project" / "source-map.json"),
        )
        return 0
    if args.command == "hook":
        result = run_host_hook(host=args.host, event=args.event, project_root=project_root)
        if result.stdout:
            print(result.stdout, end="")
        return result.exit_code
    if args.command == "prepare":
        root = Path(args.project_root).resolve() if getattr(args, "project_root", None) else project_root
        title = str(args.goal or args.target or args.task_id or args.command_id)
        strict_task = None
        if args.command_id in {"run", "loop"}:
            if not args.task_id:
                parser.exit(2, "thoth: error: Strict task execution requires --task-id.\n")
            strict_task = load_task_for_execution(root, args.task_id, require_ready=True)
            title = str(strict_task.get("title") or args.task_id)
        elif args.command_id == "review" and not (args.target or args.goal):
            parser.exit(2, "thoth: error: Review prepare requires --target or --goal.\n")
        handle, packet = prepare_execution(
            root,
            command_id=args.command_id,
            title=title,
            task_id=args.task_id,
            host=args.host,
            executor=args.executor,
            sleep_requested=bool(args.sleep),
            strict_task=strict_task,
            target=args.target,
            goal=args.goal or title,
            max_rounds=5 if args.command_id == "loop" else None,
            max_runtime_seconds=12 * 60 if args.command_id == "loop" else None,
        )
        if packet.get("dispatch_mode") != LIVE_DISPATCH_MODE:
            spawn_supervisor(handle)
            packet["worker_spawned"] = True
            packet["background_mode"] = "detached"
        print(json.dumps(packet, ensure_ascii=False, indent=2))
        return 0
    if args.command == "append-event":
        payload = _decode_json_arg(getattr(args, "payload_json", None), field="--payload-json")
        append_protocol_event(Path(args.project_root), args.run_id, message=args.message, kind=args.kind, level=args.level, phase=args.phase, progress_pct=args.progress, payload=payload if isinstance(payload, dict) else None)
        return 0
    if args.command == "record-artifact":
        metadata = _decode_json_arg(getattr(args, "metadata_json", None), field="--metadata-json")
        record_artifact(Path(args.project_root), args.run_id, path=args.path, label=args.label, artifact_kind=args.kind, metadata=metadata if isinstance(metadata, dict) else None)
        return 0
    if args.command == "heartbeat":
        heartbeat_run(Path(args.project_root), args.run_id, phase=args.phase, progress_pct=args.progress, note=args.note)
        return 0
    if args.command == "complete":
        result_payload = _decode_json_arg(getattr(args, "result_json", None), field="--result-json")
        checks = _decode_json_arg(getattr(args, "checks_json", None), field="--checks-json")
        complete_run(Path(args.project_root), args.run_id, summary=args.summary, result_payload=result_payload if isinstance(result_payload, dict) else None, checks=checks if isinstance(checks, list) else None)
        return 0
    if args.command == "fail":
        result_payload = _decode_json_arg(getattr(args, "result_json", None), field="--result-json")
        fail_run(Path(args.project_root), args.run_id, summary=args.summary, reason=args.reason, result_payload=result_payload if isinstance(result_payload, dict) else None)
        return 0
    if args.command == "report":
        end = datetime.now(timezone.utc).date()
        start = end - timedelta(days=7)
        output_path = generate_default_report(project_root, start.isoformat(), end.isoformat(), fmt=getattr(args, "format", "md"))
        print_envelope(
            command="report",
            status="ok",
            summary=render_report_summary(output_path),
            body={"output_path": str(output_path)},
            refs=output_refs(output_path),
        )
        return 0
    if args.command == "extend":
        changed = getattr(args, "changed", []) or []
        returncode, text = _run_extend(changed)
        print_envelope(
            command="extend",
            status="ok" if returncode == 0 else "failed",
            summary="Extend completed" if returncode == 0 else "Extend failed",
            body={"changed": changed, "output": text},
            checks=[{"name": "plugin_tests", "ok": returncode == 0}],
        )
        return returncode
    if args.command in {"review", "discuss"}:
        content = (getattr(args, "goal", None) or " ".join(getattr(args, "rest", []) or [])).strip()
        note_path = _append_project_note(project_root, args.command, content)
        if args.command == "discuss":
            if getattr(args, "decision_json", None):
                payload = json.loads(args.decision_json)
                decision = upsert_decision(project_root, payload)
                body = {"decision": decision, "note_path": str(note_path)}
            elif getattr(args, "contract_json", None):
                payload = json.loads(args.contract_json)
                contract = upsert_contract(project_root, payload)
                body = {"contract": contract, "note_path": str(note_path)}
            else:
                decision = create_discussion_placeholder(project_root, content, host="codex")
                body = {"decision": decision, "note_path": str(note_path)}
            compiler = compile_task_authority(project_root)
            summary = compiler.get("summary", {})
            print_envelope(
                command="discuss",
                status="ok",
                summary=(
                    "Compiler summary: ready={ready} blocked={blocked} invalid={invalid} open_decisions={open_count} legacy={legacy}".format(
                        ready=int(summary.get("task_counts", {}).get("ready", 0)),
                        blocked=int(summary.get("task_counts", {}).get("blocked", 0)),
                        invalid=int(summary.get("task_counts", {}).get("invalid", 0)),
                        open_count=int(summary.get("decision_counts", {}).get("open", 0)),
                        legacy=int(summary.get("legacy_task_count", 0)),
                    )
                ),
                body={**body, "compiler": compiler},
                refs=output_refs(note_path, project_root / ".thoth" / "project" / "compiler-state.json"),
                checks=[{"name": "compiler_ready", "ok": True, "detail": str(summary.get("task_counts", {}).get("ready", 0))}],
            )
            return 0
        if not content:
            parser.exit(2, "thoth: error: Review target is required.\n")
        review_task_id = getattr(args, "task_id", None) or infer_review_task_id(project_root, content)
        handle, packet = prepare_execution(
            project_root,
            command_id="review",
            title=f"Review: {content}",
            task_id=review_task_id,
            host=args.host,
            executor=args.executor,
            sleep_requested=False,
            target=content,
            goal=getattr(args, "goal", None) or content,
        )
        print_envelope(
            command="review",
            status="ok",
            summary=f"Prepared live review packet for {content}",
            body={"packet": packet, "note_path": str(note_path)},
            refs=output_refs(note_path, handle.run_dir),
            checks=[{"name": "live_only", "ok": packet.get("dispatch_mode") == LIVE_DISPATCH_MODE}],
        )
        return 0
    if args.command in {"run", "loop"}:
        if getattr(args, "attach", None):
            print_envelope(command=args.command, status="ok", summary=f"Attached to {args.attach}", body={"attach_output": attach_run(project_root, args.attach, watch=False)}, refs=output_refs(project_root / ".thoth" / "runs" / args.attach))
            return 0
        if getattr(args, "watch", None):
            print_envelope(command=args.command, status="ok", summary=f"Watching {args.watch}", body={"watch_output": attach_run(project_root, args.watch, watch=True)}, refs=output_refs(project_root / ".thoth" / "runs" / args.watch))
            return 0
        if getattr(args, "stop", None):
            stop_run(project_root, args.stop)
            print_envelope(command=args.command, status="ok", summary=f"Stop requested for {args.stop}", refs=output_refs(project_root / ".thoth" / "runs" / args.stop))
            return 0
        if args.command == "loop" and getattr(args, "resume", None):
            handle = resume_run(project_root, args.resume)
            packet_path = handle.run_dir / "packet.json"
            if handle.run_json().get("dispatch_mode") != LIVE_DISPATCH_MODE:
                spawn_supervisor(handle)
            packet = json.loads(packet_path.read_text(encoding="utf-8")) if packet_path.exists() else {"run_id": handle.run_id}
            print_envelope(command="loop", status="ok", summary=f"Resumed loop {handle.run_id}", body={"packet": packet}, refs=output_refs(handle.run_dir, packet_path))
            return 0
        if not getattr(args, "task_id", None):
            parser.exit(2, "thoth: error: Strict task execution requires --task-id. Free-form run/loop entry is disabled.\n")
        task = load_task_for_execution(project_root, args.task_id, require_ready=True)
        handle, packet = prepare_execution(
            project_root,
            command_id=args.command,
            title=str(task.get("title") or args.task_id),
            task_id=args.task_id,
            host=args.host,
            executor=args.executor,
            sleep_requested=bool(args.sleep),
            strict_task=task,
            goal=getattr(args, "goal", None) or str(task.get("title") or args.task_id),
            max_rounds=5 if args.command == "loop" else None,
            max_runtime_seconds=12 * 60 if args.command == "loop" else None,
        )
        if packet.get("dispatch_mode") != LIVE_DISPATCH_MODE:
            spawn_supervisor(handle)
            packet["worker_spawned"] = True
        print_envelope(
            command=args.command,
            status="ok",
            summary=f"Prepared {args.command} packet for {args.task_id}",
            body={"packet": packet},
            refs=output_refs(handle.run_dir, handle.run_dir / "packet.json"),
            checks=[{"name": "dispatch_mode", "ok": True, "detail": str(packet.get("dispatch_mode"))}],
        )
        return 0
    snapshot = status_snapshot(project_root)
    print_envelope(command=args.command, status="ok", summary=f"Loaded {args.command}", body=snapshot)
    return 0

