"""External worker spawning and mechanical phase execution."""

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

from thoth.prompt_specs import render_phase_worker_prompt
from thoth.prompt_validators import validate_phase_output

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
from .phases import PhaseDriver, execute_background_controller, next_phase_payload
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
    phase_packet = packet
    if not str(packet.get("phase") or "").strip():
        phase_packet = next_phase_payload(handle.project_root, handle.run_id)
    return build_phase_worker_prompt(handle, phase_packet, handle.run_dir / "worker-output.json")


def build_phase_worker_prompt(handle: RunHandle, phase_packet: dict[str, Any], output_path: Path) -> str:
    return render_phase_worker_prompt(
        phase_packet=phase_packet,
        run_id=handle.run_id,
        project_root=handle.project_root.resolve(),
        output_path=output_path,
    )


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


class TestPhaseDriver:
    """Deterministic phase driver for integration tests and explicit seams."""

    def __init__(self, mode: str) -> None:
        self.mode = mode

    def execute_phase(self, *, handle: RunHandle, phase_packet: dict[str, Any]) -> dict[str, Any]:
        phase = str(phase_packet.get("phase") or "")
        if phase == "plan":
            return {
                "summary": "plan ready",
                "edits": [],
                "commands": [],
                "checks": [{"name": "plan_shape", "ok": True}],
            }
        if phase == "exec":
            return {
                "summary": "exec done",
                "files_touched": [],
                "commands_run": [],
                "artifacts": [],
            }
        if phase == "validate":
            passed = self.mode != "fail"
            return {
                "summary": "Validator passed." if passed else "Validator failed.",
                "passed": passed,
                "metric_name": "deterministic_acceptance",
                "metric_value": 1 if passed else 0,
                "threshold": 1,
                "checks": [{"name": "deterministic_acceptance", "ok": passed}],
            }
        if phase == "reflect":
            return {
                "summary": "reflect done",
                "failure_class": "deterministic_validation_failed",
                "root_cause": "test phase driver forced validation failure",
                "next_plan_hint": "adjust implementation before retrying",
            }
        raise ValueError(f"unsupported phase for test driver: {phase}")


class ExternalWorkerPhaseDriver:
    """Run one phase via non-interactive Codex or Claude worker commands."""

    def __init__(self, *, executor: str, timeout_seconds: float) -> None:
        self.executor = executor
        self.timeout_seconds = timeout_seconds

    def execute_phase(self, *, handle: RunHandle, phase_packet: dict[str, Any]) -> dict[str, Any]:
        phase = str(phase_packet.get("phase") or "")
        prompt_path = handle.run_dir / f"{phase}-prompt.md"
        output_path = handle.run_dir / f"{phase}.worker-output.json"
        stdout_path = _worker_log_dir(handle) / f"{phase}.stdout.log"
        stderr_path = _worker_log_dir(handle) / f"{phase}.stderr.log"
        env = dict(os.environ)
        existing = env.get("PYTHONPATH", "")
        repo_root = Path(__file__).resolve().parent.parent
        env["PYTHONPATH"] = str(repo_root) if not existing else f"{repo_root}:{existing}"
        env["THOTH_EXTERNAL_WORKER"] = "1"
        validate_schema = phase_packet.get("output_contract", {}).get("validate_output_schema")
        max_attempts = max(1, int(WORKER_RETRY_LIMIT))
        last_error = ""
        for attempt_index in range(1, max_attempts + 1):
            correction_error = last_error if attempt_index > 1 else None
            prompt = render_phase_worker_prompt(
                phase_packet=phase_packet,
                run_id=handle.run_id,
                project_root=handle.project_root.resolve(),
                output_path=output_path,
                correction_error=correction_error,
            )
            prompt_path.write_text(prompt, encoding="utf-8")
            record_artifact(
                handle.project_root,
                handle.run_id,
                path=str(prompt_path),
                label=prompt_path.name,
                artifact_kind="prompt",
            )
            if output_path.exists():
                output_path.unlink()
            command = external_worker_command(self.executor, handle.project_root, prompt)
            with stdout_path.open("w", encoding="utf-8") as stdout_handle, stderr_path.open("w", encoding="utf-8") as stderr_handle:
                proc = subprocess.run(
                    command,
                    cwd=str(handle.project_root),
                    stdout=stdout_handle,
                    stderr=stderr_handle,
                    text=True,
                    env=env,
                    timeout=self.timeout_seconds,
                )
            record_artifact(handle.project_root, handle.run_id, path=str(stdout_path), label=stdout_path.name, artifact_kind="log")
            record_artifact(handle.project_root, handle.run_id, path=str(stderr_path), label=stderr_path.name, artifact_kind="log")
            if proc.returncode != 0:
                stdout_tail = _tail_text(stdout_path)
                stderr_tail = _tail_text(stderr_path)
                raise RuntimeError(
                    f"phase worker failed for {phase}: executor={self.executor} returncode={proc.returncode}\n{stdout_tail}\n{stderr_tail}".strip()
                )
            if not output_path.exists():
                last_error = f"{output_path.name} was not written"
                if attempt_index < max_attempts:
                    continue
                stdout_tail = _tail_text(stdout_path)
                stderr_tail = _tail_text(stderr_path)
                raise RuntimeError(
                    f"phase worker did not write {output_path.name} for {phase}\n{stdout_tail}\n{stderr_tail}".strip()
                )
            payload = _read_json(output_path)
            if not payload:
                last_error = "output was not a single JSON object"
                if attempt_index < max_attempts:
                    continue
                raise RuntimeError(f"phase worker wrote invalid JSON for {phase}: {output_path}")
            try:
                return validate_phase_output(
                    phase,
                    payload,
                    validate_schema=validate_schema if isinstance(validate_schema, dict) else None,
                )
            except ValueError as exc:
                last_error = str(exc)
                if attempt_index < max_attempts:
                    continue
                raise RuntimeError(f"phase worker produced invalid {phase} output: {exc}") from exc
        raise RuntimeError(f"phase worker exhausted retries for {phase}: {last_error or 'unknown error'}")


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
        driver = TestPhaseDriver("fail")
    elif test_mode == "complete":
        driver = TestPhaseDriver("complete")
    else:
        executor = _normalize_worker_executor(run_payload.get("executor"))
        driver = ExternalWorkerPhaseDriver(executor=executor, timeout_seconds=_worker_timeout_seconds(run_payload))

    try:
        status = execute_background_controller(project_root, run_id, driver=driver)
    except Exception as exc:
        fail_run(
            project_root,
            run_id,
            summary="Background phase controller failed.",
            reason=str(exc),
            result_payload={"worker_runtime": "external_worker", "executor": run_payload.get("executor")},
        )
        _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": "failed", "runtime": "external_worker", "updated_at": utc_now()})
        return 1
    final_state = handle.state_json().get("status")
    runtime_state = "completed" if final_state == "completed" else "stopped" if final_state == "stopped" else "failed"
    _write_json(handle.local_dir / "supervisor.json", {"pid": os.getpid(), "state": runtime_state, "runtime": "external_worker", "updated_at": utc_now()})
    return status
