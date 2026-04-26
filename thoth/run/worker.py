"""External worker spawning and execution."""

from __future__ import annotations

import json
import os
import shlex
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

from .io import _read_json, _write_json
from .lease import release_repo_lease
from .ledger import (
    _append_event,
    _update_run,
    _update_state,
    _write_stopped_result,
    complete_run,
    fail_run,
    heartbeat_run,
    record_artifact,
)
from .model import (
    CLAUDE_EXTERNAL_WORKER_ALLOWED_TOOLS,
    DEFAULT_EXTERNAL_WORKER_TIMEOUT_SECONDS,
    SLEEP_DISPATCH_MODE,
    WORKER_HEARTBEAT_INTERVAL_SECONDS,
    WORKER_RETRY_LIMIT,
    WORKER_RETRY_WINDOW_SECONDS,
    RunHandle,
    default_executor,
    utc_now,
)

def spawn_supervisor(handle: RunHandle) -> int:
    run_payload = handle.run_json()
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
    handle.local_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = handle.local_dir / "worker-bootstrap.stdout.log"
    stderr_path = handle.local_dir / "worker-bootstrap.stderr.log"
    detached_launcher = str(os.environ.get("THOTH_DETACH_WORKER_VIA_NOHUP") or "").strip().lower() in {"1", "true", "yes"}

    if detached_launcher:
        launcher = (
            f"nohup {shlex.join(cmd)} </dev/null >{shlex.quote(str(stdout_path))} "
            f"2>{shlex.quote(str(stderr_path))} & echo $!"
        )
        launch = subprocess.run(
            ["bash", "-lc", launcher],
            cwd=str(handle.project_root),
            capture_output=True,
            text=True,
            env=env,
        )
        if launch.returncode != 0:
            raise RuntimeError(f"failed to launch external worker: {launch.stderr.strip() or launch.stdout.strip() or 'unknown launcher failure'}")
        pid_text = (launch.stdout or "").strip().splitlines()
        try:
            worker_pid = int(pid_text[-1]) if pid_text else -1
        except ValueError as exc:
            raise RuntimeError(f"failed to parse external worker pid from launcher output: {launch.stdout!r}") from exc
    else:
        stdout_handle = stdout_path.open("w", encoding="utf-8")
        stderr_handle = stderr_path.open("w", encoding="utf-8")
        try:
            proc = subprocess.Popen(
                cmd,
                cwd=str(handle.project_root),
                stdout=stdout_handle,
                stderr=stderr_handle,
                start_new_session=True,
                env=env,
            )
        finally:
            stdout_handle.close()
            stderr_handle.close()
        worker_pid = proc.pid
    _write_json(handle.local_dir / "supervisor.json", {"pid": worker_pid, "state": "running", "runtime": "external_worker", "updated_at": utc_now()})
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
    if not detached_launcher:
        return worker_pid
    boot_deadline = time.time() + 5.0
    while time.time() < boot_deadline:
        state = handle.state_json()
        phase = str(state.get("phase") or "")
        progress_pct = int(state.get("progress_pct") or 0)
        last_event_seq = int(state.get("last_event_seq") or 0)
        if phase not in {"", "queued"} or progress_pct >= 5 or last_event_seq >= 4:
            return worker_pid
        time.sleep(0.1)
    stderr_tail = _tail_text(stderr_path, limit=2000)
    stdout_tail = _tail_text(stdout_path, limit=2000)
    detail = "\n".join(part for part in (stdout_tail.strip(), stderr_tail.strip()) if part).strip()
    fail_run(
        handle.project_root,
        handle.run_id,
        summary="External worker failed to report a startup heartbeat.",
        reason="worker bootstrap timeout",
        result_payload={
            "worker_runtime": "external_worker",
            "worker_pid": worker_pid,
            "bootstrap_stdout": stdout_tail,
            "bootstrap_stderr": stderr_tail,
        },
    )
    raise RuntimeError(f"external worker bootstrap timed out before first heartbeat: {detail or 'no worker output'}")


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


def build_external_worker_prompt(handle: RunHandle, packet: dict[str, Any]) -> str:
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


def external_worker_command(executor: str, project_root: Path, prompt: str) -> list[str]:
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
    _write_stopped_result(handle)
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

    prompt = build_external_worker_prompt(handle, packet)
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
        command = external_worker_command(executor, handle.project_root, prompt)

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
