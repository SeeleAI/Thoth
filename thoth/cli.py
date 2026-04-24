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
    attach_run,
    build_status_payload,
    create_run,
    resume_run,
    runtime_arg_parser,
    spawn_supervisor,
    stop_run,
    supervisor_main,
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


def _print_init_result(result: dict[str, object], project_root: Path) -> None:
    audit = result.get("audit", {}) if isinstance(result, dict) else {}
    preview = result.get("preview", {}) if isinstance(result, dict) else {}
    config = result.get("config", {}) if isinstance(result, dict) else {}
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


def main(argv: list[str] | None = None) -> int:
    parser = runtime_arg_parser()
    args = parser.parse_args(argv)
    project_root = Path.cwd()

    if args.command == "supervise":
        return supervisor_main(Path(args.project_root), args.run_id)

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
            for run in payload["active_runs"]:
                print(f"- {run['run_id']} [{run['kind']}] {run['host']}/{run['executor']} {run['status']} {run['progress_pct']}%")
        return 0

    if args.command == "doctor":
        legacy_args = ["--quick"] if getattr(args, "quick", False) else []
        if getattr(args, "fix", False):
            legacy_args.append("--fix")
        return _run_legacy_script("doctor.py", legacy_args, cwd=project_root)

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
        content = " ".join(getattr(args, "rest", []) or [])
        note_path = _append_project_note(project_root, args.command, content)
        print(f"Recorded {args.command} note in {note_path}")
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
            if args.detach:
                print(handle.run_id)
                return 0
            print(attach_run(project_root, handle.run_id, watch=True))
            return 0

        title = args.task if args.command == "run" else args.goal
        handle = create_run(
            project_root,
            kind=args.command,
            title=title,
            task_id=getattr(args, "task_id", None),
            host=args.host,
            executor=args.executor,
        )
        spawn_supervisor(handle)
        if args.detach:
            print(handle.run_id)
            return 0
        print(attach_run(project_root, handle.run_id, watch=True))
        return 0

    return _print_generic(args.command, args)


if __name__ == "__main__":
    sys.exit(main())
