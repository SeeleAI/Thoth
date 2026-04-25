"""CLI entrypoint for the official `$thoth` Codex surface."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .host_hooks import run_host_hook
from .project_init import initialize_project, parse_config, sync_project_layer
from .runtime import (
    LIVE_DISPATCH_MODE,
    attach_run,
    append_protocol_event,
    build_status_payload,
    complete_run,
    default_executor,
    fail_run,
    heartbeat_run,
    prepare_execution,
    record_artifact,
    resume_run,
    runtime_arg_parser,
    spawn_supervisor,
    stop_run,
    supervisor_main,
    worker_main,
)
from .task_contracts import (
    build_doctor_payload,
    compile_task_authority,
    create_discussion_placeholder,
    load_task_for_execution,
    render_doctor_text,
    upsert_contract,
    upsert_decision,
)


ROOT = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = ROOT / "scripts"


def _run_legacy_script(script_name: str, extra_args: list[str] | None = None, *, cwd: Path | None = None) -> int:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    cmd = [sys.executable, str(SCRIPTS_DIR / script_name)]
    if extra_args:
        cmd.extend(extra_args)
    result = subprocess.run(cmd, cwd=str(cwd or Path.cwd()), env=env)
    return result.returncode


def _run_shell_script(script_name: str, extra_args: list[str] | None = None, *, cwd: Path | None = None) -> int:
    cmd = ["bash", str(SCRIPTS_DIR / script_name)]
    if extra_args:
        cmd.extend(extra_args)
    result = subprocess.run(cmd, cwd=str(cwd or Path.cwd()))
    return result.returncode


def _append_project_note(project_root: Path, note_type: str, content: str) -> Path:
    thoth_dir = project_root / ".thoth" / "project"
    thoth_dir.mkdir(parents=True, exist_ok=True)
    path = thoth_dir / "conversations.jsonl"
    payload = {
        "ts": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "type": note_type,
        "host": "codex",
        "content": content,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return path


def _print_generic(command: str, args) -> int:
    print(f"$thoth {command} recorded shared authority input. Arguments: {list(args.rest)}")
    return 0


def _decode_json_arg(raw: str | None, *, field: str) -> dict | list | None:
    if raw is None:
        return None
    payload = json.loads(raw)
    if not isinstance(payload, (dict, list)):
        raise ValueError(f"{field} must decode to an object or list")
    return payload


def _print_init_result(result: dict[str, object], project_root: Path) -> None:
    audit = result.get("audit", {}) if isinstance(result, dict) else {}
    preview = result.get("preview", {}) if isinstance(result, dict) else {}
    config = result.get("config", {}) if isinstance(result, dict) else {}
    claude_permissions = result.get("claude_permissions", {}) if isinstance(result, dict) else {}
    print(f"Initialized Thoth project at {project_root}")
    print(f"- Mode: {result.get('mode', 'init')}")
    print(f"- Migration: {result.get('migration_id', 'unknown')}")
    print(
        f"- Audit: {len(audit.get('top_level_entries', []))} top-level entries, "
        f"{len(audit.get('docs_files', []))} docs files, "
        f"{len(audit.get('agent_os_files', []))} .agent-os files, "
        f"{len(audit.get('code_roots', []))} code roots"
    )
    print(
        f"- Managed paths: {len(preview.get('create', []))} create, "
        f"{len(preview.get('update', []))} update, "
        f"{len(preview.get('preserve', []))} preserve"
    )
    if isinstance(config, dict):
        print(f"- Dashboard: http://localhost:{config.get('port', 8501)}")
    if isinstance(claude_permissions, dict):
        if claude_permissions.get("effective_allowed"):
            sources = ", ".join(claude_permissions.get("sources", []))
            print(f"- Claude bridge permission: ready via {sources}")
        else:
            print("- Claude bridge permission: missing")
            print("  Create one of these before relying on Claude `/thoth:*` commands without approval prompts:")
            print(f"  - Global: {claude_permissions.get('global_path')}")
            print(f"  - Project-local: {claude_permissions.get('project_local_path')}")
            print("  Minimal JSON:")
            print("    {")
            print('      "$schema": "https://json.schemastore.org/claude-code-settings.json",')
            print('      "permissions": {')
            print('        "allow": ["Bash(*thoth-claude-command.sh*)"]')
            print("      }")
            print("    }")


def main(argv: list[str] | None = None) -> int:
    parser = runtime_arg_parser()
    args = parser.parse_args(argv)
    project_root = Path.cwd()

    if args.command == "supervise":
        return supervisor_main(Path(args.project_root), args.run_id)

    if args.command == "worker":
        return worker_main(Path(args.project_root), args.run_id)

    if args.command == "init":
        config = parse_config(args.config_json) if getattr(args, "config_json", None) else {}
        result = initialize_project(config, project_root)
        _print_init_result(result, project_root)
        return 0

    if args.command == "status":
        payload = build_status_payload(project_root)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(f"Project: {payload['project_root']}")
            print(f"Active runs: {payload['active_run_count']}")
            compiler = payload.get("compiler", {})
            print(
                "Compiler: ready={ready} blocked={blocked} invalid={invalid} open_decisions={open_count} legacy={legacy}".format(
                    ready=int(compiler.get("task_counts", {}).get("ready", 0)),
                    blocked=int(compiler.get("task_counts", {}).get("blocked", 0)),
                    invalid=int(compiler.get("task_counts", {}).get("invalid", 0)),
                    open_count=int(compiler.get("decision_counts", {}).get("open", 0)),
                    legacy=int(compiler.get("legacy_task_count", 0)),
                )
            )
            defaults = payload.get("runtime_defaults", {})
            print(
                "Runtime defaults: executor={executor} live={live} sleep={sleep}".format(
                    executor=defaults.get("default_executor", default_executor()),
                    live=defaults.get("live_dispatch_mode", LIVE_DISPATCH_MODE),
                    sleep=defaults.get("sleep_dispatch_mode", "external_worker"),
                )
            )
            for run in payload["active_runs"]:
                print(
                    f"- {run['run_id']} [{run['kind']}] {run['host']}/{run['executor']} "
                    f"{run['status']} {run['progress_pct']}% dispatch={run.get('dispatch_mode')}"
                )
        return 0

    if args.command == "doctor":
        payload = build_doctor_payload(project_root)
        if args.json:
            print(json.dumps(payload, ensure_ascii=False, indent=2))
        else:
            print(render_doctor_text(payload), end="")
        return 0 if payload.get("overall_ok") else 1

    if args.command == "dashboard":
        action = getattr(args, "action", "start")
        return _run_shell_script("dashboard.sh", [action], cwd=project_root)

    if args.command == "sync":
        sync_project_layer(project_root)
        return _run_legacy_script("sync.py", [], cwd=project_root)

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
                print("Strict task execution requires --task-id.", file=sys.stderr)
                return 2
            try:
                strict_task = load_task_for_execution(root, args.task_id, require_ready=True)
            except (FileNotFoundError, ValueError) as exc:
                print(str(exc), file=sys.stderr)
                return 2
            title = str(strict_task.get("title") or args.task_id)
        elif args.command_id == "review" and not (args.target or args.goal):
            print("Review prepare requires --target or --goal.", file=sys.stderr)
            return 2
        try:
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
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        if packet.get("dispatch_mode") == "external_worker":
            spawn_supervisor(handle)
            packet["worker_spawned"] = True
            packet["background_mode"] = "detached"
        print(json.dumps(packet, ensure_ascii=False, indent=2))
        return 0

    if args.command == "append-event":
        payload = _decode_json_arg(getattr(args, "payload_json", None), field="--payload-json")
        append_protocol_event(
            Path(args.project_root),
            args.run_id,
            message=args.message,
            kind=args.kind,
            level=args.level,
            phase=args.phase,
            progress_pct=args.progress,
            payload=payload if isinstance(payload, dict) else None,
        )
        return 0

    if args.command == "record-artifact":
        metadata = _decode_json_arg(getattr(args, "metadata_json", None), field="--metadata-json")
        record_artifact(
            Path(args.project_root),
            args.run_id,
            path=args.path,
            label=args.label,
            artifact_kind=args.kind,
            metadata=metadata if isinstance(metadata, dict) else None,
        )
        return 0

    if args.command == "heartbeat":
        heartbeat_run(
            Path(args.project_root),
            args.run_id,
            phase=args.phase,
            progress_pct=args.progress,
            note=args.note,
        )
        return 0

    if args.command == "complete":
        result_payload = _decode_json_arg(getattr(args, "result_json", None), field="--result-json")
        checks = _decode_json_arg(getattr(args, "checks_json", None), field="--checks-json")
        complete_run(
            Path(args.project_root),
            args.run_id,
            summary=args.summary,
            result_payload=result_payload if isinstance(result_payload, dict) else None,
            checks=checks if isinstance(checks, list) else None,
        )
        return 0

    if args.command == "fail":
        result_payload = _decode_json_arg(getattr(args, "result_json", None), field="--result-json")
        fail_run(
            Path(args.project_root),
            args.run_id,
            summary=args.summary,
            reason=args.reason,
            result_payload=result_payload if isinstance(result_payload, dict) else None,
        )
        return 0

    if args.command == "report":
        end = datetime.now(timezone.utc).date()
        start = end - timedelta(days=7)
        legacy_args = ["--from", start.isoformat(), "--to", end.isoformat()]
        if getattr(args, "format", "md") == "json":
            legacy_args.extend(["--output", str(project_root / "reports" / f"{end.isoformat()}-report.json.md")])
        return _run_legacy_script("report.py", legacy_args, cwd=project_root)

    if args.command == "extend":
        changed = getattr(args, "changed", []) or []
        legacy_args = ["--changed", *changed] if changed else []
        return _run_legacy_script("extend.py", legacy_args, cwd=ROOT)

    if args.command in {"review", "discuss"}:
        content = (getattr(args, "goal", None) or " ".join(getattr(args, "rest", []) or [])).strip()
        note_path = _append_project_note(project_root, args.command, content)
        compiler = None
        if args.command == "discuss":
            if getattr(args, "decision_json", None):
                payload = json.loads(args.decision_json)
                if not isinstance(payload, dict):
                    raise ValueError("--decision-json must decode to an object")
                decision = upsert_decision(project_root, payload)
                print(f"Upserted decision {decision['decision_id']}")
            elif getattr(args, "contract_json", None):
                payload = json.loads(args.contract_json)
                if not isinstance(payload, dict):
                    raise ValueError("--contract-json must decode to an object")
                contract = upsert_contract(project_root, payload)
                print(f"Upserted contract {contract['contract_id']}")
            else:
                decision = create_discussion_placeholder(project_root, content, host="codex")
                print(f"Created open decision {decision['decision_id']}")
            compiler = compile_task_authority(project_root)
        print(f"Recorded {args.command} note in {note_path}")
        if compiler:
            summary = compiler.get("summary", {})
            print(
                "Compiler summary: ready={ready} blocked={blocked} invalid={invalid} open_decisions={open_count} legacy={legacy}".format(
                    ready=int(summary.get("task_counts", {}).get("ready", 0)),
                    blocked=int(summary.get("task_counts", {}).get("blocked", 0)),
                    invalid=int(summary.get("task_counts", {}).get("invalid", 0)),
                    open_count=int(summary.get("decision_counts", {}).get("open", 0)),
                    legacy=int(summary.get("legacy_task_count", 0)),
                )
            )
            return 0
        if not content:
            print("Review target is required.", file=sys.stderr)
            return 2
        try:
            _handle, packet = prepare_execution(
                project_root,
                command_id="review",
                title=f"Review: {content}",
                task_id=None,
                host=args.host,
                executor=args.executor,
                sleep_requested=False,
                target=content,
                goal=getattr(args, "goal", None) or content,
            )
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print(f"Recorded review note in {note_path}")
        print(json.dumps(packet, ensure_ascii=False, indent=2))
        return 0

    if args.command in {"run", "loop"}:
        if getattr(args, "attach", None):
            print(attach_run(project_root, args.attach, watch=False))
            return 0
        if getattr(args, "watch", None):
            print(attach_run(project_root, args.watch, watch=True))
            return 0
        if getattr(args, "stop", None):
            stop_run(project_root, args.stop)
            print(f"Stop requested for {args.stop}")
            return 0
        if args.command == "loop" and getattr(args, "resume", None):
            handle = resume_run(project_root, args.resume)
            run_payload = handle.run_json()
            packet_path = handle.run_dir / "packet.json"
            if run_payload.get("dispatch_mode") == "external_worker":
                spawn_supervisor(handle)
                refreshed = json.loads(packet_path.read_text(encoding="utf-8")) if packet_path.exists() else {"run_id": handle.run_id}
                refreshed["worker_spawned"] = True
                print(json.dumps(refreshed, ensure_ascii=False, indent=2))
                return 0
            if packet_path.exists():
                print(packet_path.read_text(encoding="utf-8").rstrip())
                return 0
            print(attach_run(project_root, handle.run_id, watch=True))
            return 0

        if args.detach and not args.sleep:
            print("Detached live execution is no longer allowed. Use --sleep for background external-worker mode.", file=sys.stderr)
            return 2

        if not getattr(args, "task_id", None):
            print("Strict task execution requires --task-id. Free-form run/loop entry is disabled.", file=sys.stderr)
            return 2
        if getattr(args, "legacy_task_text", None):
            print("Free-form run text is disabled. Compile a strict task and use --task-id only.", file=sys.stderr)
            return 2
        if getattr(args, "legacy_goal_text", None):
            print("Free-form loop goal text is disabled. Compile a strict task and use --task-id only.", file=sys.stderr)
            return 2
        try:
            task = load_task_for_execution(project_root, args.task_id, require_ready=True)
        except (FileNotFoundError, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 2

        title = str(task.get("title") or args.task_id)
        try:
            handle, packet = prepare_execution(
                project_root,
                command_id=args.command,
                title=title,
                task_id=args.task_id,
                host=args.host,
                executor=args.executor,
                sleep_requested=bool(args.sleep),
                strict_task=task,
                goal=getattr(args, "goal", None) or title,
                max_rounds=5 if args.command == "loop" else None,
                max_runtime_seconds=12 * 60 if args.command == "loop" else None,
            )
        except RuntimeError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        if packet.get("dispatch_mode") == "external_worker":
            spawn_supervisor(handle)
            packet["worker_spawned"] = True
        print(json.dumps(packet, ensure_ascii=False, indent=2))
        return 0

    return _print_generic(args.command, args)


if __name__ == "__main__":
    sys.exit(main())
