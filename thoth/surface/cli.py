"""Canonical `$thoth` CLI surface."""

from __future__ import annotations

import argparse
from pathlib import Path

from thoth.run.lifecycle import default_executor
from .handlers import handle_command


def build_cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="thoth")
    sub = parser.add_subparsers(dest="command", required=True)

    run_parser = sub.add_parser("run")
    run_parser.add_argument("--task-id")
    run_parser.add_argument("--host", default="codex")
    run_parser.add_argument("--executor", default=default_executor())
    run_parser.add_argument("--sleep", action="store_true")
    run_parser.add_argument("--attach")
    run_parser.add_argument("--watch")
    run_parser.add_argument("--stop")

    loop_parser = sub.add_parser("loop")
    loop_parser.add_argument("--goal", default="loop")
    loop_parser.add_argument("--task-id")
    loop_parser.add_argument("--host", default="codex")
    loop_parser.add_argument("--executor", default=default_executor())
    loop_parser.add_argument("--sleep", action="store_true")
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
    review.add_argument("--task-id")
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


def main(argv: list[str] | None = None) -> int:
    parser = build_cli_parser()
    args, extras = parser.parse_known_args(argv)
    if extras:
        if args.command in {"run", "loop"} and any(not token.startswith("-") for token in extras):
            parser.exit(2, "thoth: error: Strict task execution requires --task-id. Free-form run/loop entry is disabled.\n")
        parser.error(f"unrecognized arguments: {' '.join(extras)}")
    return handle_command(args, parser, project_root=Path.cwd())
