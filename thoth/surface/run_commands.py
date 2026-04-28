"""Run, loop, review, prepare, and worker command handlers."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.plan.doctor import infer_review_task_id
from thoth.plan.paths import compiler_state_path, tasks_dir
from thoth.plan.store import load_task_for_execution, suggest_tasks_for_query
from thoth.run.packets import LIVE_DISPATCH_MODE, prepare_execution
from thoth.run.service import attach_run, resume_run, stop_run
from thoth.run.worker import spawn_supervisor, supervisor_main, worker_main
from thoth.surface.envelope import output_refs, print_envelope
from thoth.surface.plan_commands import append_project_note


def handle_supervise(args, parser, *, project_root: Path) -> int:
    return supervisor_main(Path(args.project_root), args.run_id)


def handle_worker(args, parser, *, project_root: Path) -> int:
    return worker_main(Path(args.project_root), args.run_id)


def _missing_task_query(args, *, command_id: str) -> str:
    parts: list[str] = []
    prompt_query = str(getattr(args, "prompt_query", "") or "").strip()
    if prompt_query:
        parts.append(prompt_query)
    goal = str(getattr(args, "goal", "") or "").strip()
    if goal and not (command_id == "loop" and goal == "loop"):
        parts.append(goal)
    target = str(getattr(args, "target", "") or "").strip()
    if target:
        parts.append(target)
    return " ".join(parts).strip()


def _reject_missing_task_id(*, command_id: str, args, project_root: Path) -> int:
    query = _missing_task_query(args, command_id=command_id)
    candidates = suggest_tasks_for_query(project_root, query, limit=3)
    summary = (
        f"`{command_id}` requires --task-id. No task was created and no code was touched."
    )
    body = {
        "query": query or None,
        "candidates": candidates,
        "guidance": f"Re-run with `{command_id} --task-id <task_id>` after choosing one of the suggested tasks.",
    }
    print_envelope(
        command=command_id,
        status="needs_input",
        summary=summary,
        body=body,
        refs=output_refs(tasks_dir(project_root), compiler_state_path(project_root)),
        checks=[
            {"name": "task_id_required", "ok": False, "detail": "--task-id missing"},
            {"name": "task_creation_blocked", "ok": True, "detail": "no new task created"},
            {"name": "code_execution_blocked", "ok": True, "detail": "no code touched"},
        ],
    )
    return 2


def handle_prepare(args, parser, *, project_root: Path) -> int:
    root = Path(args.project_root).resolve() if getattr(args, "project_root", None) else project_root
    title = str(args.goal or args.target or args.task_id or args.command_id)
    strict_task = None
    if args.command_id in {"run", "loop"}:
        if not args.task_id:
            return _reject_missing_task_id(command_id=args.command_id, args=args, project_root=root)
        strict_task = load_task_for_execution(root, args.task_id, require_ready=True)
        title = str(strict_task.get("title") or args.task_id)
    elif args.command_id == "review" and args.task_id:
        strict_task = load_task_for_execution(root, args.task_id, require_ready=True)
        title = str(strict_task.get("title") or f"Review: {args.task_id}")
    elif args.command_id == "review" and not (args.target or args.goal):
        parser.exit(2, "thoth: error: Review prepare requires --target or --goal.\n")
    handle, packet = prepare_execution(root, command_id=args.command_id, title=title, task_id=args.task_id, host=args.host, executor=args.executor, sleep_requested=bool(args.sleep), strict_task=strict_task, target=args.target, goal=args.goal or title)
    if packet.get("dispatch_mode") != LIVE_DISPATCH_MODE:
        spawn_supervisor(handle)
        packet["worker_spawned"] = True
        packet["background_mode"] = "detached"
    print(json.dumps(packet, ensure_ascii=False, indent=2))
    return 0


def handle_review(args, parser, *, project_root: Path) -> int:
    content = (getattr(args, "goal", None) or " ".join(getattr(args, "rest", []) or [])).strip()
    note_path = append_project_note(project_root, "review", content)
    if not content:
        parser.exit(2, "thoth: error: Review target is required.\n")
    review_task_id = getattr(args, "task_id", None) or infer_review_task_id(project_root, content)
    strict_task = None
    if review_task_id:
        strict_task = load_task_for_execution(project_root, review_task_id, require_ready=True)
    handle, packet = prepare_execution(
        project_root,
        command_id="review",
        title=f"Review: {content}",
        task_id=review_task_id,
        host=args.host,
        executor=args.executor,
        sleep_requested=False,
        strict_task=strict_task,
        target=content,
        goal=getattr(args, "goal", None) or content,
    )
    print_envelope(command="review", status="ok", summary=f"Prepared live review packet for {content}", body={"packet": packet, "note_path": str(note_path)}, refs=output_refs(note_path, handle.run_dir), checks=[{"name": "live_only", "ok": packet.get("dispatch_mode") == LIVE_DISPATCH_MODE}])
    return 0


def handle_run_or_loop(args, parser, *, project_root: Path) -> int:
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
        return _reject_missing_task_id(command_id=args.command, args=args, project_root=project_root)
    task = load_task_for_execution(project_root, args.task_id, require_ready=True)
    handle, packet = prepare_execution(project_root, command_id=args.command, title=str(task.get("title") or args.task_id), task_id=args.task_id, host=args.host, executor=args.executor, sleep_requested=bool(args.sleep), strict_task=task, goal=getattr(args, "goal", None) or str(task.get("title") or args.task_id))
    if packet.get("dispatch_mode") != LIVE_DISPATCH_MODE:
        spawn_supervisor(handle)
        packet["worker_spawned"] = True
    print_envelope(command=args.command, status="ok", summary=f"Prepared {args.command} packet for {args.task_id}", body={"packet": packet}, refs=output_refs(handle.run_dir, handle.run_dir / "packet.json"), checks=[{"name": "dispatch_mode", "ok": True, "detail": str(packet.get("dispatch_mode"))}])
    return 0
