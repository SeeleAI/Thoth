from __future__ import annotations

import argparse
import json
import os
import re
import selectors
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable
from urllib.error import URLError
from urllib.request import urlopen

import yaml

from thoth.init.render import render_codex_hooks_payload
from thoth.plan.compiler import compile_task_authority
from thoth.prompt_specs import build_codex_public_command_prompt
from thoth.run.ledger import complete_run, heartbeat_run
from thoth.selftest_seed import seed_host_real_app

from .model import *
from .recorder import *
from .processes import *
from .capabilities import *
from .fixtures import *
from .hard_suite import *

def _looks_like_transient_host_outage(result: CommandResult) -> bool:
    detail = f"{result.stdout}\n{result.stderr}".lower()
    return any(
        marker in detail
        for marker in (
            "api error: 503",
            '"subtype":"api_retry"',
            '"error_status":503',
            '"error":"server_error"',
            "no available accounts",
            "server-side issue",
            "try again in a moment",
            "status.claude.com",
            "temporarily unavailable",
            "无可用渠道",
        )
    )


def _is_live_packet_public_command(public_command: str) -> bool:
    normalized = public_command.strip()
    prefixes = (
        "/thoth:run",
        "/thoth:loop",
        "/thoth:review",
        "$thoth run",
        "$thoth loop",
        "$thoth review",
        "thoth run",
        "thoth loop",
        "thoth review",
    )
    return normalized.startswith(prefixes)


def _effective_host_command_timeout(host_name: str, public_command: str, requested_timeout: float) -> float:
    if host_name == "claude" and not _is_live_packet_public_command(public_command):
        # Bridge-only slash commands should return quickly. Keeping this bounded
        # prevents upstream account outages from consuming the entire heavy gate.
        return min(requested_timeout, 25.0)
    return requested_timeout


def _read_claude_bridge_events(project_dir: Path) -> list[dict[str, Any]]:
    path = project_dir / ".thoth" / "derived" / "host-bridges" / "claude-command-events.jsonl"
    if not path.exists():
        return []
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            events.append(payload)
    return events


def _write_claude_local_settings(project_dir: Path, repo_root: Path, recorder: Recorder) -> str:
    settings_path = project_dir / ".claude" / "settings.local.json"
    payload = {
        "$schema": "https://json.schemastore.org/claude-code-settings.json",
        "permissions": {
            "allow": [
                f"Bash(*{repo_root / 'scripts' / 'thoth-claude-command.sh'}*)",
            ]
        },
    }
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return recorder.write_text("claude/settings.local.json", settings_path.read_text(encoding="utf-8"))


def _run_claude_public_command(
    repo_root: Path,
    project_dir: Path,
    slash_command: str,
    *,
    recorder: Recorder,
    artifact_name: str,
    timeout: float = 240,
) -> tuple[CommandResult, list[str]]:
    result = _run_command(
        [
            "claude",
            "-p",
            "--plugin-dir",
            str(repo_root),
            "--permission-mode",
            "dontAsk",
            "--verbose",
            "--output-format",
            "stream-json",
            "--include-hook-events",
            slash_command,
        ],
        cwd=project_dir,
        timeout=timeout,
    )
    return result, _save_command(recorder, artifact_name, result)


def _codex_prompt_for_public_command(public_command: str, done_token: str) -> str:
    shell_command = _shell_command_for_public_command(public_command)
    parts = shell_command.split()
    command_id = parts[1] if len(parts) >= 2 else "status"
    return build_codex_public_command_prompt(
        command_id,
        public_command=public_command,
        shell_command=shell_command,
        done_token=done_token,
    )


def _shell_command_for_public_command(public_command: str) -> str:
    shell_command = public_command.strip()
    if shell_command.startswith("$thoth "):
        shell_command = f"thoth {shell_command[len('$thoth '):]}"
    return shell_command


def _run_codex_public_command(
    project_dir: Path,
    public_command: str,
    *,
    done_token: str,
    recorder: Recorder,
    artifact_name: str,
    timeout: float = 240,
) -> tuple[CommandResult, list[str]]:
    result = _run_command(
        [
            "codex",
            "exec",
            "-m",
            os.environ.get("THOTH_CODEX_EXEC_MODEL", "gpt-5.4"),
            "--json",
            "--full-auto",
            "-C",
            str(project_dir),
            _codex_prompt_for_public_command(public_command, done_token),
        ],
        cwd=project_dir,
        timeout=timeout,
    )
    return result, _save_command(recorder, artifact_name, result)


def _codex_completed_command_items(stdout: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line in stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if payload.get("type") != "item.completed":
            continue
        item = payload.get("item")
        if isinstance(item, dict) and item.get("type") == "command_execution":
            items.append(item)
    return items


def _normalize_codex_public_command_result(
    result: CommandResult,
    *,
    public_command: str,
    done_token: str,
) -> CommandResult:
    completed_commands = _codex_completed_command_items(result.stdout)
    shell_command = _shell_command_for_public_command(public_command)
    live_packet_contract = _is_live_packet_public_command(public_command)
    matching_commands = [
        item for item in completed_commands if shell_command in str(item.get("command") or "")
    ]
    public_step = matching_commands[0] if matching_commands else None
    if public_step is None:
        return CommandResult(
            argv=result.argv,
            cwd=result.cwd,
            returncode=1,
            stdout=result.stdout,
            stderr=(result.stderr + "\nCodex did not execute the requested shell command: " + shell_command).strip(),
            duration_seconds=result.duration_seconds,
        )
    if public_step.get("status") != "completed" or int(public_step.get("exit_code") or 0) != 0:
        return CommandResult(
            argv=result.argv,
            cwd=result.cwd,
            returncode=1,
            stdout=result.stdout,
            stderr=(
                result.stderr
                + "\nCodex command execution failed: "
                + json.dumps(
                    {
                        "command": public_step.get("command"),
                        "status": public_step.get("status"),
                        "exit_code": public_step.get("exit_code"),
                    },
                    ensure_ascii=False,
                )
            ).strip(),
            duration_seconds=result.duration_seconds,
        )
    if not live_packet_contract:
        failed_commands = [
            item
            for item in completed_commands
            if item.get("status") != "completed" or int(item.get("exit_code") or 0) != 0
        ]
        if failed_commands:
            first = failed_commands[0]
            return CommandResult(
                argv=result.argv,
                cwd=result.cwd,
                returncode=1,
                stdout=result.stdout,
                stderr=(
                    result.stderr
                    + "\nCodex command execution failed: "
                    + json.dumps(
                        {
                            "command": first.get("command"),
                            "status": first.get("status"),
                            "exit_code": first.get("exit_code"),
                        },
                        ensure_ascii=False,
                    )
                ).strip(),
                duration_seconds=result.duration_seconds,
            )
    if done_token not in result.stdout:
        return CommandResult(
            argv=result.argv,
            cwd=result.cwd,
            returncode=1,
            stdout=result.stdout,
            stderr=(result.stderr + f"\nMissing done token: {done_token}").strip(),
            duration_seconds=result.duration_seconds,
        )
    return result


def _run_host_real_flow(
    host_name: str,
    project_dir: Path,
    recorder: Recorder,
    *,
    run_public_command,
    commands: dict[str, Any],
    review_expected_executor: str | None = None,
    from_step: str | None = None,
    to_step: str | None = None,
) -> tuple[list[str], dict[str, CommandResult]]:
    artifacts: list[str] = []
    command_results: dict[str, CommandResult] = {}
    seen_run_ids: set[str] = set()
    transient_retry_limit = 2
    transient_retry_window_seconds = 90.0
    ordered_step_ids = [
        "init",
        "status",
        "doctor",
        "discuss-decision",
        *[f"discuss-contract-{index}" for index, _ in enumerate(commands["discuss_contracts"], start=1)],
        "run-feature",
        "run-bugfix",
        "review",
        "dashboard",
        "loop",
    ]
    if commands.get("loop_live_followup"):
        ordered_step_ids.append("loop-live-followup")
    ordered_step_ids.extend(["report", "sync"])
    step_index = {step_id: index for index, step_id in enumerate(ordered_step_ids)}
    if from_step is not None and from_step not in step_index:
        raise RuntimeError(f"unknown host-real from-step: {from_step}")
    if to_step is not None and to_step not in step_index:
        raise RuntimeError(f"unknown host-real to-step: {to_step}")
    start_index = step_index.get(from_step, 0)
    end_index = step_index.get(to_step, len(ordered_step_ids) - 1)
    if start_index > end_index:
        raise RuntimeError(f"invalid host-real step window: from-step={from_step} after to-step={to_step}")

    def is_sleep_command(public_command: str) -> bool:
        return "--sleep" in public_command.split()

    def expected_dispatch(public_command: str) -> str:
        return "external_worker" if is_sleep_command(public_command) else "live_native"

    def completion_timeout(public_command: str) -> float:
        return 900 if is_sleep_command(public_command) else 60

    def step_mode(step_id: str) -> str:
        index = step_index[step_id]
        if index < start_index:
            return "prereq"
        if index > end_index:
            return "skipped"
        return "selected"

    def should_run(step_id: str) -> bool:
        return step_index[step_id] <= end_index

    def check_name(base: str, mode: str) -> str:
        if mode == "selected":
            return f"host.{host_name}.{base}"
        return f"host.{host_name}.prereq.{base}"

    def execute(step_id: str, public_command: str, *, timeout: float = 240) -> CommandResult | None:
        mode = step_mode(step_id)
        if mode == "skipped":
            return None
        started = time.time()
        attempt = 0
        effective_timeout = _effective_host_command_timeout(host_name, public_command, timeout)
        _emit_selftest_progress(f"{host_name} step {step_id} mode={mode} begin")
        while True:
            attempt += 1
            base_artifact_name = f"host-{host_name}-{step_id}" if mode == "selected" else f"host-{host_name}-prereq-{step_id}"
            artifact_suffix = "" if attempt == 1 else f"-attempt-{attempt}"
            result, command_artifacts = run_public_command(
                public_command,
                recorder=recorder,
                artifact_name=f"{base_artifact_name}{artifact_suffix}",
                timeout=effective_timeout,
            )
            if mode == "selected":
                command_results[step_id] = result
            artifacts.extend(command_artifacts)
            if result.returncode == 0:
                _emit_selftest_progress(f"{host_name} step {step_id} mode={mode} ok")
                return result
            transient = _looks_like_transient_host_outage(result)
            if transient and attempt <= transient_retry_limit and (time.time() - started) <= transient_retry_window_seconds:
                time.sleep(min(5 * attempt, 15))
                continue
            if transient:
                raise RuntimeError(
                    f"{host_name} step {step_id} hit an upstream/transient host outage and exceeded the bounded retry budget"
                )
            raise RuntimeError(f"{host_name} step {step_id} failed with return code {result.returncode}")

    execute("init", commands["init"])
    _set_dashboard_port(project_dir, _free_port())
    execute("status", commands["status"])
    execute("doctor", commands["doctor"])
    execute("discuss-decision", commands["discuss_decision"])
    for index, command in enumerate(commands["discuss_contracts"], start=1):
        execute(f"discuss-contract-{index}", command)

    last_discuss_step = f"discuss-contract-{len(commands['discuss_contracts'])}"
    if should_run(last_discuss_step):
        compiler_summary = compile_task_authority(project_dir).get("summary", {})
        ready_count = int(compiler_summary.get("task_counts", {}).get("ready", 0))
        queue_count = int(compiler_summary.get("decision_queue_count", 0))
        compiler_ok = ready_count == 3 and queue_count == 0
        compiler_artifact = recorder.write_json(f"host-{host_name}-compiler-summary.json", compiler_summary)
        recorder.add(
            check_name("compiler_ready", step_mode(last_discuss_step)),
            "passed" if compiler_ok else "failed",
            f"Structured discuss compiled the host-real tasks: ready={ready_count} decision_queue={queue_count}.",
            [compiler_artifact],
        )
        if not compiler_ok:
            raise RuntimeError("compiled host-real tasks were not ready after structured discuss")

    if should_run("run-feature"):
        execute("run-feature", commands["run_feature"], timeout=900)
        feature_run_id = _latest_run_id(project_dir, kind="run", task_id="task-feature-owner-due-date", exclude_run_ids=seen_run_ids)
        if not feature_run_id:
            raise RuntimeError("feature run did not create a new run ledger")
        seen_run_ids.add(feature_run_id)
        artifacts.extend(
            _verify_host_run_completion(
                project_dir,
                recorder,
                check_name=check_name("feature_run", step_mode("run-feature")),
                run_id=feature_run_id,
                expected_kind="run",
                expected_task_id="task-feature-owner-due-date",
                expected_host=host_name,
                expected_dispatch_mode=expected_dispatch(commands["run_feature"]),
                timeout=completion_timeout(commands["run_feature"]),
            )
        )

    if should_run("run-bugfix"):
        execute("run-bugfix", commands["run_bugfix"], timeout=900)
        bugfix_run_id = _latest_run_id(project_dir, kind="run", task_id="task-bugfix-column-persist", exclude_run_ids=seen_run_ids)
        if not bugfix_run_id:
            raise RuntimeError("bugfix run did not create a new run ledger")
        seen_run_ids.add(bugfix_run_id)
        artifacts.extend(
            _verify_host_run_completion(
                project_dir,
                recorder,
                check_name=check_name("bugfix_run", step_mode("run-bugfix")),
                run_id=bugfix_run_id,
                expected_kind="run",
                expected_task_id="task-bugfix-column-persist",
                expected_host=host_name,
                expected_dispatch_mode=expected_dispatch(commands["run_bugfix"]),
                timeout=completion_timeout(commands["run_bugfix"]),
            )
        )
        artifacts.extend(
            _run_deterministic_validators(
                project_dir,
                recorder,
                label=check_name("post_bugfix", step_mode("run-bugfix")),
                validators=("scripts/validate_feature.py", "scripts/validate_bugfix.py"),
            )
        )

    if should_run("review"):
        execute("review", commands["review"], timeout=900)
        review_run_id = _latest_run_id(project_dir, kind="review", exclude_run_ids=seen_run_ids)
        if not review_run_id:
            raise RuntimeError("review did not create a new run ledger")
        seen_run_ids.add(review_run_id)
        artifacts.extend(
            _verify_host_run_completion(
                project_dir,
                recorder,
                check_name=check_name("review_run", step_mode("review")),
                run_id=review_run_id,
                expected_kind="review",
                expected_host=host_name,
                expected_executor=review_expected_executor,
                expected_dispatch_mode=expected_dispatch(commands["review"]),
                require_findings=True,
                timeout=completion_timeout(commands["review"]),
            )
        )

    dashboard_port = int(_read_json(project_dir / ".thoth" / "project" / "project.json").get("dashboard", {}).get("port", 8501))
    if should_run("dashboard"):
        execute("dashboard", commands["dashboard"], timeout=240)
        dashboard_status = _wait_for_http_json(
            f"http://127.0.0.1:{dashboard_port}/api/status",
            timeout=20,
            description=f"{host_name} dashboard start",
        )
        dashboard_status_artifact = recorder.write_json(f"host-{host_name}-dashboard-status.json", dashboard_status)
        dashboard_ready = isinstance(dashboard_status, dict) and bool(dashboard_status.get("runtime"))
        recorder.add(
            check_name("dashboard_start", step_mode("dashboard")),
            "passed" if dashboard_ready else "failed",
            f"Dashboard started for {host_name} on port {dashboard_port}.",
            [dashboard_status_artifact],
        )
        if not dashboard_ready:
            raise RuntimeError(f"{host_name} dashboard did not become ready")

    if should_run("loop"):
        execute("loop", commands["loop"], timeout=900)
        loop_run_id = _latest_run_id(project_dir, kind="loop", task_id="task-loop-close-review", exclude_run_ids=seen_run_ids)
        if not loop_run_id:
            raise RuntimeError("loop did not create a new run ledger")
        seen_run_ids.add(loop_run_id)
        artifacts.extend(
            _verify_host_run_completion(
                project_dir,
                recorder,
                check_name=check_name("loop_run", step_mode("loop")),
                run_id=loop_run_id,
                expected_kind="loop",
                expected_task_id="task-loop-close-review",
                expected_host=host_name,
                expected_dispatch_mode=expected_dispatch(commands["loop"]),
                timeout=completion_timeout(commands["loop"]),
            )
        )
        artifacts.extend(
            _run_deterministic_validators(
                project_dir,
                recorder,
                label=check_name("post_loop_sleep", step_mode("loop")),
                validators=("scripts/validate_full.py",),
            )
        )
        if should_run("dashboard"):
            dashboard_run = _http_get_json(f"http://127.0.0.1:{dashboard_port}/api/runs/{loop_run_id}")
            dashboard_run_artifact = recorder.write_json(
                f"host-{host_name}-dashboard-run.json",
                dashboard_run if isinstance(dashboard_run, dict) else {},
            )
            dashboard_runtime_ok = isinstance(dashboard_run, dict) and str(dashboard_run.get("run_id") or "") == loop_run_id
            recorder.add(
                check_name("dashboard_runtime", step_mode("dashboard")),
                "passed" if dashboard_runtime_ok else "failed",
                f"Dashboard served runtime details for loop run {loop_run_id}.",
                [dashboard_run_artifact],
            )

    if commands.get("loop_live_followup") and should_run("loop-live-followup"):
        execute("loop-live-followup", commands["loop_live_followup"], timeout=900)
        loop_live_followup_id = _latest_run_id(project_dir, kind="loop", task_id="task-loop-close-review", exclude_run_ids=seen_run_ids)
        if not loop_live_followup_id:
            raise RuntimeError("loop live followup did not create a new run ledger")
        seen_run_ids.add(loop_live_followup_id)
        artifacts.extend(
            _verify_host_run_completion(
                project_dir,
                recorder,
                check_name=check_name("loop_live_followup", step_mode("loop-live-followup")),
                run_id=loop_live_followup_id,
                expected_kind="loop",
                expected_task_id="task-loop-close-review",
                expected_host=host_name,
                expected_dispatch_mode=expected_dispatch(commands["loop_live_followup"]),
                timeout=completion_timeout(commands["loop_live_followup"]),
            )
        )
        artifacts.extend(
            _run_deterministic_validators(
                project_dir,
                recorder,
                label=check_name("post_loop_live", step_mode("loop-live-followup")),
                validators=("scripts/validate_full.py",),
            )
        )

    if should_run("dashboard"):
        _stop_dashboard(project_dir, recorder=recorder)

    if should_run("loop") or (commands.get("loop_live_followup") and should_run("loop-live-followup")):
        final_validator_step = "loop-live-followup" if commands.get("loop_live_followup") and should_run("loop-live-followup") else "loop"
        artifacts.extend(
            _run_deterministic_validators(
                project_dir,
                recorder,
                label=check_name("final", step_mode(final_validator_step)),
                validators=("scripts/validate_full.py",),
            )
        )

    if should_run("report"):
        execute("report", commands["report"], timeout=240)
    if should_run("sync"):
        execute("sync", commands["sync"], timeout=240)
    return artifacts, command_results

__all__ = [name for name in globals() if not name.startswith("__")]
