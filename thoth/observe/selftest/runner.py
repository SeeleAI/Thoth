"""Heavy self-test orchestration for Thoth.

The self-test runner exercises the real CLI, real dashboard processes, real
temporary workspaces, and optional host-native Codex/Claude surfaces. The
heavy gate now uses a deterministic pure-Python seed repo so command behavior
is validated by stable input/output contracts instead of browser tooling.
"""

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
from thoth.run.ledger import complete_run, heartbeat_run
from thoth.plan.compiler import compile_task_authority
from thoth.selftest_seed import seed_host_real_app


ROOT = Path(__file__).resolve().parents[3]
PYTHON = sys.executable
FIXED_CLAUDE_DIR = Path("/tmp/thoth-selftest-claude")
FIXED_CODEX_DIR = Path("/tmp/thoth-selftest-codex")
FIXED_RUNTIME_DIR = Path("/tmp/thoth-selftest-runtime")
CODEX_SKILL_NAME = "thoth"
HARD_SUITE_MAX_RUNTIME_SECONDS = 180.0
HEAVY_PREFLIGHT_MAX_RUNTIME_SECONDS = 120.0
HEAVY_HOST_MAX_RUNTIME_SECONDS = 900.0
_SELFTEST_DEADLINE: float | None = None
_SELFTEST_DEADLINE_LABEL: str | None = None
_SELFTEST_DEADLINE_SECONDS: float | None = None
_SELFTEST_STREAM_OUTPUT = False


def utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _dump_yaml(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as handle:
        handle.bind(("127.0.0.1", 0))
        return int(handle.getsockname()[1])


def _remove_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path, ignore_errors=True)
        return
    try:
        path.unlink(missing_ok=True)
    except OSError:
        shutil.rmtree(path, ignore_errors=True)


def _path_is_within(path: Path, root: Path) -> bool:
    try:
        resolved_path = path.resolve()
        resolved_root = root.resolve()
    except OSError:
        return False
    return resolved_path == resolved_root or resolved_root in resolved_path.parents


def _legacy_heavy_process_targets(
    *,
    proc_root: Path = Path("/proc"),
    current_pid: int | None = None,
    fixed_roots: Iterable[Path] | None = None,
) -> list[int]:
    roots = tuple((fixed_roots or (FIXED_CLAUDE_DIR, FIXED_CODEX_DIR, FIXED_RUNTIME_DIR)))
    current = int(current_pid or os.getpid())
    targets: set[int] = set()
    for entry in proc_root.iterdir():
        if not entry.is_dir() or not entry.name.isdigit():
            continue
        pid = int(entry.name)
        if pid == current:
            continue
        cmdline_bytes = b""
        try:
            cmdline_bytes = (entry / "cmdline").read_bytes()
        except OSError:
            cmdline_bytes = b""
        cmdline = cmdline_bytes.replace(b"\x00", b" ").decode("utf-8", errors="ignore").strip()
        cwd: Path | None = None
        try:
            cwd = (entry / "cwd").resolve()
        except OSError:
            cwd = None
        if "python -m thoth.selftest" in cmdline and "--tier heavy" in cmdline:
            targets.add(pid)
            continue
        if any(str(root) in cmdline for root in roots):
            targets.add(pid)
            continue
        if cwd is not None and any(_path_is_within(cwd, root) for root in roots):
            targets.add(pid)
    return sorted(targets)


def _terminate_processes(
    pids: Iterable[int],
    *,
    proc_root: Path = Path("/proc"),
    term_timeout: float = 5.0,
    kill_timeout: float = 2.0,
) -> list[int]:
    remaining = sorted({int(pid) for pid in pids})
    for signum, timeout in ((signal.SIGTERM, term_timeout), (signal.SIGKILL, kill_timeout)):
        attempted: list[int] = []
        for pid in remaining:
            try:
                os.kill(pid, signum)
            except ProcessLookupError:
                continue
            except PermissionError:
                attempted.append(pid)
            else:
                attempted.append(pid)
        if not attempted:
            return []
        deadline = time.time() + timeout
        while True:
            remaining = [pid for pid in attempted if (proc_root / str(pid)).exists()]
            if not remaining or time.time() >= deadline:
                break
            time.sleep(0.05)
    return [pid for pid in remaining if (proc_root / str(pid)).exists()]


def _cleanup_legacy_heavy_processes() -> None:
    stale_pids = _legacy_heavy_process_targets()
    if not stale_pids:
        return
    still_running = _terminate_processes(stale_pids)
    if still_running:
        raise RuntimeError(f"failed to clear stale heavy host-real processes: {still_running}")


def _cleanup_legacy_heavy_tmp(*, preserve: Iterable[Path], tmp_root: Path = Path("/tmp")) -> None:
    preserve_paths = {item.resolve() for item in preserve}
    cleanup_patterns = ("thoth-heavy-*", "thoth-selftest-*")
    for pattern in cleanup_patterns:
        for candidate in tmp_root.glob(pattern):
            resolved = candidate.resolve()
            if resolved in preserve_paths:
                continue
            _remove_path(candidate)


def _http_get_json(url: str) -> dict[str, Any]:
    with urlopen(url, timeout=5) as response:  # noqa: S310 - local self-test URL
        return json.loads(response.read().decode("utf-8"))


def _selftest_runtime_exceeded_message() -> str:
    label = f" for {_SELFTEST_DEADLINE_LABEL}" if _SELFTEST_DEADLINE_LABEL else ""
    if _SELFTEST_DEADLINE_SECONDS is None:
        return f"Self-test exceeded the active runtime limit{label}."
    seconds = int(_SELFTEST_DEADLINE_SECONDS)
    return f"Self-test exceeded the active {seconds}s runtime limit{label}."


def _remaining_selftest_seconds() -> float | None:
    if _SELFTEST_DEADLINE is None:
        return None
    return max(0.0, _SELFTEST_DEADLINE - time.time())


class _SelftestBudget:
    def __init__(self, seconds: float | None, *, label: str) -> None:
        self.seconds = seconds
        self.label = label
        self._previous_deadline: float | None = None
        self._previous_label: str | None = None
        self._previous_seconds: float | None = None

    def __enter__(self) -> None:
        global _SELFTEST_DEADLINE, _SELFTEST_DEADLINE_LABEL, _SELFTEST_DEADLINE_SECONDS
        self._previous_deadline = _SELFTEST_DEADLINE
        self._previous_label = _SELFTEST_DEADLINE_LABEL
        self._previous_seconds = _SELFTEST_DEADLINE_SECONDS
        _SELFTEST_DEADLINE = None if self.seconds is None else time.time() + self.seconds
        _SELFTEST_DEADLINE_LABEL = self.label
        _SELFTEST_DEADLINE_SECONDS = self.seconds

    def __exit__(self, exc_type, exc, tb) -> None:
        global _SELFTEST_DEADLINE, _SELFTEST_DEADLINE_LABEL, _SELFTEST_DEADLINE_SECONDS
        _SELFTEST_DEADLINE = self._previous_deadline
        _SELFTEST_DEADLINE_LABEL = self._previous_label
        _SELFTEST_DEADLINE_SECONDS = self._previous_seconds


def _emit_selftest_progress(message: str) -> None:
    if not _SELFTEST_STREAM_OUTPUT:
        return
    print(f"[thoth-selftest] {message}", file=sys.stderr, flush=True)


def _cap_selftest_timeout(timeout: float) -> float:
    remaining = _remaining_selftest_seconds()
    if remaining is None:
        return timeout
    if remaining <= 0:
        raise RuntimeError(_selftest_runtime_exceeded_message())
    return max(0.1, min(timeout, remaining))


def _wait_until(predicate, *, timeout: float, interval: float = 0.2, description: str) -> None:
    deadline = time.time() + _cap_selftest_timeout(timeout)
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(interval)
        remaining = _remaining_selftest_seconds()
        if remaining is not None and remaining <= 0:
            raise RuntimeError(_selftest_runtime_exceeded_message())
    raise RuntimeError(f"Timed out waiting for {description}")


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in value)


def _extract_json(stdout: str) -> dict[str, Any]:
    start = stdout.find("{")
    if start < 0:
        return {}
    try:
        payload = json.loads(stdout[start:])
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    body = payload.get("body")
    if isinstance(body, dict):
        packet = body.get("packet")
        if isinstance(packet, dict):
            return packet
        status_payload = body.get("status")
        if isinstance(status_payload, dict):
            return status_payload
        doctor_payload = body.get("doctor")
        if isinstance(doctor_payload, dict):
            return doctor_payload
        result_payload = body.get("result")
        if isinstance(result_payload, dict):
            return result_payload
    return payload


@dataclass
class CommandResult:
    argv: list[str]
    cwd: str
    returncode: int
    stdout: str
    stderr: str
    duration_seconds: float


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str
    artifacts: list[str] = field(default_factory=list)


class Recorder:
    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.checks: list[CheckResult] = []

    def write_text(self, relpath: str, content: str) -> str:
        path = self.artifact_dir / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return str(path)

    def write_json(self, relpath: str, payload: dict[str, Any]) -> str:
        path = self.artifact_dir / relpath
        _write_json(path, payload)
        return str(path)

    def add(self, name: str, status: str, detail: str, artifacts: Iterable[str] | None = None) -> None:
        self.checks.append(CheckResult(name=name, status=status, detail=detail, artifacts=list(artifacts or [])))

    def summary_payload(self, *, tier: str, capabilities: dict[str, Any], work_root: str) -> dict[str, Any]:
        counts = {"passed": 0, "failed": 0, "degraded": 0}
        for item in self.checks:
            counts[item.status] = counts.get(item.status, 0) + 1
        overall = "failed" if counts.get("failed", 0) or counts.get("degraded", 0) else "passed"
        return {
            "schema_version": 1,
            "generated_at": utc_now(),
            "tier": tier,
            "overall_status": overall,
            "counts": counts,
            "capabilities": capabilities,
            "work_root": work_root,
            "checks": [
                {
                    "name": item.name,
                    "status": item.status,
                    "detail": item.detail,
                    "artifacts": item.artifacts,
                }
                for item in self.checks
            ],
        }


def _run_command(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str] | None = None,
    timeout: float = 120,
) -> CommandResult:
    merged_env = dict(os.environ)
    if env:
        merged_env.update(env)
    effective_timeout = _cap_selftest_timeout(timeout)
    started = time.time()
    _emit_selftest_progress(f"exec cwd={cwd} argv={json.dumps(argv, ensure_ascii=False)} timeout={effective_timeout:.1f}s")
    process = subprocess.Popen(
        argv,
        cwd=str(cwd),
        env=merged_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=False,
    )
    stdout_chunks: list[bytes] = []
    stderr_chunks: list[bytes] = []
    selector = selectors.DefaultSelector()
    if process.stdout is not None:
        selector.register(process.stdout, selectors.EVENT_READ, data="stdout")
    if process.stderr is not None:
        selector.register(process.stderr, selectors.EVENT_READ, data="stderr")

    timed_out = False
    while selector.get_map():
        remaining = effective_timeout - (time.time() - started)
        if remaining <= 0:
            timed_out = True
            process.kill()
            break
        events = selector.select(timeout=min(0.1, remaining))
        if not events:
            if process.poll() is not None:
                events = [(key, None) for key in list(selector.get_map().values())]
            else:
                continue
        for key, _ in events:
            stream = key.fileobj
            data = b""
            try:
                data = stream.read1(4096) if hasattr(stream, "read1") else stream.read(4096)
            except OSError:
                data = b""
            if not data:
                selector.unregister(stream)
                stream.close()
                continue
            if key.data == "stdout":
                stdout_chunks.append(data)
                if _SELFTEST_STREAM_OUTPUT:
                    sys.stdout.write(data.decode("utf-8", errors="ignore"))
                    sys.stdout.flush()
            else:
                stderr_chunks.append(data)
                if _SELFTEST_STREAM_OUTPUT:
                    sys.stderr.write(data.decode("utf-8", errors="ignore"))
                    sys.stderr.flush()

    if timed_out:
        deadline = time.time() + 1.0
        while selector.get_map() and time.time() < deadline:
            events = selector.select(timeout=0.05)
            if not events:
                break
            for key, _ in events:
                stream = key.fileobj
                data = b""
                try:
                    data = stream.read1(4096) if hasattr(stream, "read1") else stream.read(4096)
                except OSError:
                    data = b""
                if not data:
                    selector.unregister(stream)
                    stream.close()
                    continue
                if key.data == "stdout":
                    stdout_chunks.append(data)
                else:
                    stderr_chunks.append(data)

    for key in list(selector.get_map().values()):
        try:
            selector.unregister(key.fileobj)
        except Exception:
            pass
        try:
            key.fileobj.close()
        except Exception:
            pass

    try:
        process.wait(timeout=1.0 if timed_out else 0.5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=1.0)

    stdout = b"".join(stdout_chunks).decode("utf-8", errors="ignore")
    stderr = b"".join(stderr_chunks).decode("utf-8", errors="ignore")
    if timed_out:
        timeout_note = f"Command timed out after {effective_timeout:.1f}s."
        stderr = f"{stderr}\n{timeout_note}".strip()
        _emit_selftest_progress(f"timeout argv={json.dumps(argv, ensure_ascii=False)} after {effective_timeout:.1f}s")
        return CommandResult(
            argv=argv,
            cwd=str(cwd),
            returncode=124,
            stdout=stdout,
            stderr=stderr,
            duration_seconds=round(time.time() - started, 3),
        )
    _emit_selftest_progress(
        f"done rc={process.returncode} argv={json.dumps(argv, ensure_ascii=False)} duration={time.time() - started:.3f}s"
    )
    return CommandResult(
        argv=argv,
        cwd=str(cwd),
        returncode=int(process.returncode or 0),
        stdout=stdout,
        stderr=stderr,
        duration_seconds=round(time.time() - started, 3),
    )


def _save_command(recorder: Recorder, name: str, result: CommandResult) -> list[str]:
    stem = _safe_name(name)
    return [
        recorder.write_text(
            f"commands/{stem}.txt",
            textwrap.dedent(
                f"""\
                CWD: {result.cwd}
                ARGV: {json.dumps(result.argv, ensure_ascii=False)}
                RETURN CODE: {result.returncode}
                DURATION: {result.duration_seconds:.3f}s

                --- STDOUT ---
                {result.stdout}

                --- STDERR ---
                {result.stderr}
                """
            ),
        )
    ]


def detect_capabilities() -> dict[str, Any]:
    def tool_path(name: str) -> str | None:
        return shutil.which(name)

    capabilities: dict[str, Any] = {
        "python": PYTHON,
        "codex_cli_present": bool(tool_path("codex")),
        "claude_cli_present": bool(tool_path("claude")),
    }

    if capabilities["codex_cli_present"]:
        result = _run_command(["codex", "login", "status"], cwd=ROOT, timeout=20)
        status_text = result.stdout.strip() or result.stderr.strip()
        capabilities["codex_authenticated"] = "logged in" in status_text.lower()
        capabilities["codex_login_status"] = status_text
        features = _run_command(["codex", "features", "list"], cwd=ROOT, timeout=20)
        hooks_line = next((line for line in features.stdout.splitlines() if line.startswith("codex_hooks")), "codex_hooks false")
        capabilities["codex_hooks_enabled"] = hooks_line.split()[-1].lower() == "true"
        capabilities["codex_features_snapshot"] = features.stdout.strip()
    else:
        capabilities["codex_authenticated"] = False
        capabilities["codex_hooks_enabled"] = False

    if capabilities["claude_cli_present"]:
        result = _run_command(["claude", "auth", "status"], cwd=ROOT, timeout=20)
        capabilities["claude_authenticated"] = result.returncode == 0 and "\"loggedIn\": true" in result.stdout
        capabilities["claude_auth_status"] = result.stdout.strip() or result.stderr.strip()
    else:
        capabilities["claude_authenticated"] = False

    return capabilities


def _codex_config_path() -> Path:
    return Path.home() / ".codex" / "config.toml"


def _codex_hooks_path() -> Path:
    return Path.home() / ".codex" / "hooks.json"


def _codex_skills_root() -> Path:
    return Path.home() / ".codex" / "skills"


def _path_snapshot(path: Path) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists() or path.is_symlink(),
        "is_symlink": path.is_symlink(),
        "is_dir": path.is_dir(),
        "is_file": path.is_file(),
    }
    try:
        payload["resolved"] = str(path.resolve())
    except OSError:
        payload["resolved"] = None
    return payload


def _ensure_features_flag(content: str, *, key: str, value: str) -> str:
    lines = content.splitlines()
    if not lines:
        return f"[features]\n{key} = {value}\n"
    result: list[str] = []
    in_features = False
    inserted = False
    replaced = False
    for line in lines:
        stripped = line.strip()
        section_match = re.match(r"^\s*\[([^\]]+)\]", line)
        if section_match:
            if in_features and not inserted:
                result.append(f"{key} = {value}")
                inserted = True
            in_features = section_match.group(1).strip() == "features"
            result.append(line)
            continue
        if in_features and stripped.startswith(f"{key} "):
            result.append(f"{key} = {value}")
            inserted = True
            replaced = True
            continue
        result.append(line)
    if in_features and not inserted:
        result.append(f"{key} = {value}")
        inserted = True
    if not inserted and not replaced:
        if result and result[-1].strip():
            result.append("")
        result.extend(["[features]", f"{key} = {value}"])
    return "\n".join(result).rstrip() + "\n"


def _ensure_codex_hooks_enabled(recorder: Recorder) -> dict[str, Any]:
    config_path = _codex_config_path()
    before = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    before_artifact = recorder.write_text("codex-hooks/config.before.toml", before or "__MISSING__\n")
    updated = _ensure_features_flag(before, key="codex_hooks", value="true")
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(updated, encoding="utf-8")
    after = config_path.read_text(encoding="utf-8")
    after_artifact = recorder.write_text("codex-hooks/config.after.toml", after)
    features = _run_command(["codex", "features", "list"], cwd=ROOT, timeout=20)
    features_artifact = _save_command(recorder, "codex-features-list", features)
    hooks_line = next((line for line in features.stdout.splitlines() if line.startswith("codex_hooks")), "codex_hooks false")
    enabled = hooks_line.split()[-1].lower() == "true"
    payload = {
        "path": str(config_path),
        "before_artifact": before_artifact,
        "after_artifact": after_artifact,
        "effective_enabled": enabled,
        "effective_line": hooks_line,
    }
    recorder.add(
        "preflight.codex_hooks_config",
        "passed" if enabled else "failed",
        "Codex global config was checked and codex_hooks was forced on under [features].",
        [before_artifact, after_artifact, *features_artifact],
    )
    if not enabled:
        raise RuntimeError("codex hooks feature flag is still disabled after config.toml update")
    return payload


def _ensure_codex_skill_installed(recorder: Recorder) -> dict[str, Any]:
    source = ROOT / ".agents" / "skills" / CODEX_SKILL_NAME
    if not source.exists():
        raise RuntimeError(f"missing generated Codex skill at {source}")
    target = _codex_skills_root() / CODEX_SKILL_NAME
    before_snapshot = _path_snapshot(target)
    before_artifact = recorder.write_json("codex-skill/skill.before.json", before_snapshot)

    same_target = bool(target.exists() or target.is_symlink())
    if same_target:
        try:
            same_target = target.resolve() == source.resolve()
        except OSError:
            same_target = False
    if not same_target:
        if target.is_symlink() or target.is_file():
            target.unlink()
        elif target.is_dir():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(source, target_is_directory=True)

    after_snapshot = _path_snapshot(target)
    after_artifact = recorder.write_json("codex-skill/skill.after.json", after_snapshot)
    effective = bool(target.exists() or target.is_symlink())
    try:
        effective = effective and target.resolve() == source.resolve()
    except OSError:
        effective = False
    recorder.add(
        "preflight.codex_skill_install",
        "passed" if effective else "failed",
        "Codex global skill entry for Thoth was checked and aligned to the repo-generated public skill surface.",
        [before_artifact, after_artifact],
    )
    if not effective:
        raise RuntimeError("codex skill installation did not resolve to the repo-generated Thoth skill")
    return {
        "source": str(source),
        "target": str(target),
        "before": before_snapshot,
        "after": after_snapshot,
        "effective": effective,
    }


def _ensure_codex_global_hooks(recorder: Recorder) -> dict[str, Any]:
    hooks_path = _codex_hooks_path()
    before = hooks_path.read_text(encoding="utf-8") if hooks_path.exists() else ""
    before_artifact = recorder.write_text("codex-hooks/global.before.json", before or "__MISSING__\n")
    payload = render_codex_hooks_payload()
    hooks_path.parent.mkdir(parents=True, exist_ok=True)
    hooks_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    after = hooks_path.read_text(encoding="utf-8")
    after_artifact = recorder.write_text("codex-hooks/global.after.json", after)
    effective = "thoth-codex-hook.sh" in after
    recorder.add(
        "preflight.codex_global_hooks",
        "passed" if effective else "failed",
        "Codex global hooks.json was aligned to the repo-local Thoth hook bridge commands.",
        [before_artifact, after_artifact],
    )
    if not effective:
        raise RuntimeError("codex global hooks.json does not contain the Thoth hook bridge commands")
    return {
        "path": str(hooks_path),
        "before_artifact": before_artifact,
        "after_artifact": after_artifact,
        "effective": effective,
    }


def _preflight_host_real(capabilities: dict[str, Any], recorder: Recorder) -> None:
    required = {
        "codex_cli_present": bool(capabilities.get("codex_cli_present")),
        "codex_authenticated": bool(capabilities.get("codex_authenticated")),
        "claude_cli_present": bool(capabilities.get("claude_cli_present")),
        "claude_authenticated": bool(capabilities.get("claude_authenticated")),
        "thoth_cli_present": bool(shutil.which("thoth")),
    }
    missing = [name for name, ok in required.items() if not ok]
    if missing:
        recorder.add("preflight.host_tools", "failed", f"Missing heavy host-real prerequisites: {', '.join(missing)}")
        raise RuntimeError(f"missing heavy host-real prerequisites: {', '.join(missing)}")
    _ensure_codex_hooks_enabled(recorder)
    _ensure_codex_global_hooks(recorder)
    _ensure_codex_skill_installed(recorder)
    recorder.add(
        "preflight.deterministic_seed",
        "passed",
        "Verified heavy prerequisites for the deterministic Python host workflow.",
    )


def _compact_json(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(",", ":"))


def _shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\"'\"'") + "'"


def _host_real_decision_payload() -> dict[str, Any]:
    now = utc_now()
    return {
        "schema_version": 1,
        "kind": "decision",
        "decision_id": "DEC-host-real-selftest",
        "scope_id": "deterministic-python-repo",
        "question": "Which deterministic Python workflow should the disposable host repo follow?",
        "candidate_method_ids": ["feature-run", "bugfix-run", "review-loop"],
        "selected_values": {"workflow": ["feature-run", "bugfix-run", "review-loop"]},
        "status": "frozen",
        "unresolved_gaps": [],
        "created_at": now,
        "updated_at": now,
    }


def _host_real_contract_payloads() -> list[dict[str, Any]]:
    now = utc_now()
    return [
        {
            "schema_version": 1,
            "kind": "contract",
            "contract_id": "CTR-host-real-feature",
            "task_id": "task-feature-owner-due-date",
            "scope_id": "deterministic-python-repo",
            "direction": "backend",
            "module": "selftest",
            "title": "Persist owner and due date during task creation",
            "decision_ids": ["DEC-host-real-selftest"],
            "candidate_method_id": "feature-run",
            "goal_statement": "create_task() must persist owner and due_date in both return payload and stored task data.",
            "implementation_recipe": [
                "Read tracker/store.py before editing.",
                "Keep the repo pure Python with deterministic data file semantics.",
                "Make create_task() persist owner and due_date instead of dropping them.",
                "Validate with python scripts/validate_feature.py.",
            ],
            "baseline_ids": ["selftest-deterministic-python-repo"],
            "eval_entrypoint": {"command": "python scripts/validate_feature.py"},
            "primary_metric": {"name": "deterministic_acceptance", "direction": "gte", "threshold": 1},
            "failure_classes": ["feature_gap"],
            "acceptance_contract": {
                "usable_question": "Does create_task() produce the requested owner/due_date output under deterministic validation?",
                "goal_question": "Does the feature task close without fallback or degraded behavior?",
            },
            "status": "frozen",
            "blocking_gaps": [],
            "created_at": now,
            "updated_at": now,
        },
        {
            "schema_version": 1,
            "kind": "contract",
            "contract_id": "CTR-host-real-bugfix",
            "task_id": "task-bugfix-column-persist",
            "scope_id": "deterministic-python-repo",
            "direction": "backend",
            "module": "selftest",
            "title": "Persist column updates after reload",
            "decision_ids": ["DEC-host-real-selftest"],
            "candidate_method_id": "bugfix-run",
            "goal_statement": "update_task() must persist column changes into stored task data.",
            "implementation_recipe": [
                "Inspect tracker/store.py column update behavior.",
                "Persist the requested column instead of silently keeping the old value.",
                "Do not regress the feature task semantics.",
                "Validate with python scripts/validate_bugfix.py.",
            ],
            "baseline_ids": ["selftest-deterministic-python-repo"],
            "eval_entrypoint": {"command": "python scripts/validate_bugfix.py"},
            "primary_metric": {"name": "deterministic_acceptance", "direction": "gte", "threshold": 1},
            "failure_classes": ["persistence_bug"],
            "acceptance_contract": {
                "usable_question": "Does update_task() persist the requested column after reload under deterministic validation?",
                "goal_question": "Does the bugfix task close without fallback or degraded behavior?",
            },
            "status": "frozen",
            "blocking_gaps": [],
            "created_at": now,
            "updated_at": now,
        },
        {
            "schema_version": 1,
            "kind": "contract",
            "contract_id": "CTR-host-real-loop",
            "task_id": "task-loop-close-review",
            "scope_id": "deterministic-python-repo",
            "direction": "backend",
            "module": "selftest",
            "title": "Close review findings and satisfy deterministic full validation",
            "decision_ids": ["DEC-host-real-selftest"],
            "candidate_method_id": "review-loop",
            "goal_statement": "Review findings are fixed and the repo passes the full deterministic validator without degraded paths.",
            "review_binding": {"target": "tracker/store.py"},
            "implementation_recipe": [
                "Use review findings against tracker/store.py as authority.",
                "Fix the empty-title validation gap in update_task().",
                "Keep feature and bugfix validators green while closing the review issue.",
                "Validate with python scripts/validate_full.py.",
            ],
            "baseline_ids": ["selftest-deterministic-python-repo"],
            "eval_entrypoint": {"command": "python scripts/validate_full.py"},
            "primary_metric": {"name": "deterministic_acceptance", "direction": "gte", "threshold": 1},
            "failure_classes": ["review_gap"],
            "acceptance_contract": {
                "usable_question": "Does the repo satisfy feature, bugfix, and review-closure behavior under deterministic validation?",
                "goal_question": "Does the review-closure loop finish without fallback or degraded behavior?",
            },
            "status": "frozen",
            "blocking_gaps": [],
            "created_at": now,
            "updated_at": now,
        },
    ]


def _seed_host_real_tasks(project_dir: Path) -> None:
    decision_dir = project_dir / ".thoth" / "project" / "decisions"
    contract_dir = project_dir / ".thoth" / "project" / "contracts"
    decision_dir.mkdir(parents=True, exist_ok=True)
    contract_dir.mkdir(parents=True, exist_ok=True)
    decision = _host_real_decision_payload()
    _write_json(decision_dir / f"{decision['decision_id']}.json", decision)
    for item in _host_real_contract_payloads():
        _write_json(contract_dir / f"{item['contract_id']}.json", item)
    compile_task_authority(project_dir)


def _write_host_real_discuss_payload_files(project_dir: Path) -> tuple[Path, list[Path]]:
    payload_dir = project_dir / ".thoth-selftest-inputs"
    payload_dir.mkdir(parents=True, exist_ok=True)
    decision_path = payload_dir / "decision.json"
    _write_json(decision_path, _host_real_decision_payload())
    contract_paths: list[Path] = []
    for index, contract in enumerate(_host_real_contract_payloads(), start=1):
        contract_path = payload_dir / f"contract-{index}.json"
        _write_json(contract_path, contract)
        contract_paths.append(contract_path)
    return decision_path, contract_paths


def _seed_host_real_repo(project_dir: Path, recorder: Recorder | None = None) -> None:
    shutil.rmtree(project_dir, ignore_errors=True)
    project_dir.mkdir(parents=True, exist_ok=True)
    seed_host_real_app(project_dir)
    _init_git_repo(project_dir)

def _run_deterministic_validators(
    project_dir: Path,
    recorder: Recorder,
    *,
    label: str,
    validators: tuple[str, ...],
) -> list[str]:
    artifacts: list[str] = []
    for script in validators:
        result = _run_command([PYTHON, script], cwd=project_dir, timeout=120)
        script_label = _safe_name(f"{label}-{Path(script).stem}")
        artifacts.extend(_save_command(recorder, script_label, result))
        if result.returncode != 0:
            raise RuntimeError(f"{script} failed for {label}")
    recorder.add(
        f"{label}.validators",
        "passed",
        f"Deterministic validators passed for {label}.",
        artifacts,
    )
    return artifacts


def _latest_run_id(
    project_dir: Path,
    *,
    kind: str,
    task_id: str | None = None,
    exclude_run_ids: set[str] | None = None,
) -> str:
    exclude = exclude_run_ids or set()
    runs_dir = project_dir / ".thoth" / "runs"
    candidates: list[tuple[str, str]] = []
    if not runs_dir.is_dir():
        return ""
    for run_dir in runs_dir.iterdir():
        if not run_dir.is_dir():
            continue
        run = _read_json(run_dir / "run.json")
        run_id = str(run.get("run_id") or run_dir.name)
        if run_id in exclude:
            continue
        if run.get("kind") != kind:
            continue
        if task_id is not None and run.get("task_id") != task_id:
            continue
        candidates.append((str(run.get("created_at") or ""), run_id))
    candidates.sort()
    return candidates[-1][1] if candidates else ""


def _wait_for_http_json(url: str, *, timeout: float, description: str) -> dict[str, Any]:
    payload: dict[str, Any] = {}

    def _probe() -> bool:
        nonlocal payload
        try:
            payload = _http_get_json(url)
            return True
        except Exception:
            return False

    _wait_until(_probe, timeout=timeout, interval=0.5, description=description)
    return payload


def _init_git_repo(project_dir: Path) -> None:
    _run_command(["git", "init"], cwd=project_dir, timeout=20)
    _run_command(["git", "config", "user.email", "selftest@example.com"], cwd=project_dir, timeout=20)
    _run_command(["git", "config", "user.name", "Thoth Selftest"], cwd=project_dir, timeout=20)


def _seed_task(project_dir: Path, *, task_id: str = "task-1") -> None:
    decision_dir = project_dir / ".thoth" / "project" / "decisions"
    contract_dir = project_dir / ".thoth" / "project" / "contracts"
    decision_dir.mkdir(parents=True, exist_ok=True)
    contract_dir.mkdir(parents=True, exist_ok=True)
    _write_json(
        decision_dir / "DEC-selftest-runtime.json",
        {
            "schema_version": 1,
            "kind": "decision",
            "decision_id": "DEC-selftest-runtime",
            "scope_id": "frontend-runtime",
            "question": "Which runtime validation method should be executed for selftest?",
            "candidate_method_ids": ["real-cli-runtime-check"],
            "selected_values": {"candidate_method_id": "real-cli-runtime-check"},
            "status": "frozen",
            "unresolved_gaps": [],
            "created_at": utc_now(),
            "updated_at": utc_now(),
        },
    )
    _write_json(
        contract_dir / "CTR-selftest-runtime.json",
        {
            "schema_version": 1,
            "kind": "contract",
            "contract_id": "CTR-selftest-runtime",
            "task_id": task_id,
            "scope_id": "frontend-runtime",
            "direction": "frontend",
            "module": "f1",
            "title": "Dashboard lifecycle validation",
            "decision_ids": ["DEC-selftest-runtime"],
            "candidate_method_id": "real-cli-runtime-check",
            "goal_statement": "Verify that runtime state remains inspectable under real process execution.",
            "implementation_recipe": [
                "Initialize a temp Thoth project.",
                "Start detached run and loop lifecycles.",
                "Observe dashboard runtime freshness and hook behavior.",
            ],
            "baseline_ids": ["selftest-temp-project"],
            "eval_entrypoint": {"command": "python scripts/selftest.py --tier hard --hosts none"},
            "primary_metric": {"name": "selftest_checks_passed", "direction": "gte", "threshold": 1},
            "failure_classes": ["runtime_unstable", "dashboard_drift", "hook_failure"],
            "acceptance_contract": {
                "usable_question": "Does the lifecycle remain attachable and observable?",
                "goal_question": "Do hard selftest checks pass without ambiguity?",
            },
            "status": "frozen",
            "blocking_gaps": [],
            "created_at": utc_now(),
            "updated_at": utc_now(),
        },
    )
    compile_task_authority(project_dir)


def _set_dashboard_port(project_dir: Path, port: int) -> None:
    manifest_path = project_dir / ".thoth" / "project" / "project.json"
    manifest = _read_json(manifest_path)
    manifest.setdefault("dashboard", {})
    manifest["dashboard"]["port"] = port
    _write_json(manifest_path, manifest)


def _snapshot_runtime(recorder: Recorder, project_dir: Path, label: str) -> list[str]:
    artifacts: list[str] = []
    for rel in (".thoth", ".agent-os", ".codex"):
        path = project_dir / rel
        if not path.exists():
            continue
        target = recorder.artifact_dir / "snapshots" / _safe_name(label) / rel.replace("/", "_")
        if path.is_dir():
            shutil.copytree(path, target, dirs_exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        artifacts.append(str(target))
    return artifacts


def _run_thoth(project_dir: Path, *args: str, timeout: float = 120, env: dict[str, str] | None = None) -> CommandResult:
    merged_env = dict(env or {})
    existing_pythonpath = os.environ.get("PYTHONPATH", "")
    merged_env["PYTHONPATH"] = str(ROOT) if not existing_pythonpath else f"{ROOT}:{existing_pythonpath}"
    return _run_command([PYTHON, "-m", "thoth.cli", *args], cwd=project_dir, env=merged_env, timeout=timeout)


def _state_payload(project_dir: Path, run_id: str) -> dict[str, Any]:
    return _read_json(project_dir / ".thoth" / "runs" / run_id / "state.json")


def _heartbeat_payload(project_dir: Path, run_id: str) -> dict[str, Any]:
    state = _read_json(project_dir / ".thoth" / "runs" / run_id / "state.json")
    if state.get("last_heartbeat_at"):
        return {
            "last_heartbeat_at": state.get("last_heartbeat_at"),
            "updated_at": state.get("updated_at"),
        }
    return _read_json(project_dir / ".thoth" / "runs" / run_id / "heartbeat.json")


def _run_payload(project_dir: Path, run_id: str) -> dict[str, Any]:
    return _read_json(project_dir / ".thoth" / "runs" / run_id / "run.json")


def _acceptance_payload(project_dir: Path, run_id: str) -> dict[str, Any]:
    return _read_json(project_dir / ".thoth" / "runs" / run_id / "result.json")


def _artifacts_payload(project_dir: Path, run_id: str) -> dict[str, Any]:
    return _read_json(project_dir / ".thoth" / "runs" / run_id / "artifacts.json")


def _events_payload(project_dir: Path, run_id: str) -> list[dict[str, Any]]:
    path = project_dir / ".thoth" / "runs" / run_id / "events.jsonl"
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


_FORBIDDEN_HOST_REAL_PHRASES = (
    "fallback",
    "degraded",
    "official validator",
    "validator skipped",
    "substitute implementation",
)


def _host_run_uses_forbidden_fallback(acceptance: dict[str, Any], events: list[dict[str, Any]]) -> bool:
    texts: list[str] = []
    summary = acceptance.get("summary")
    if isinstance(summary, str) and summary.strip():
        texts.append(summary)
    for check in acceptance.get("checks", []):
        if not isinstance(check, dict):
            continue
        for key in ("name", "detail", "summary"):
            value = check.get(key)
            if isinstance(value, str) and value.strip():
                texts.append(value)
    for event in events:
        message = event.get("message")
        if isinstance(message, str) and message.strip():
            texts.append(message)
    lowered = "\n".join(texts).lower()
    return any(phrase in lowered for phrase in _FORBIDDEN_HOST_REAL_PHRASES)


def _review_findings_payload(project_dir: Path, run_id: str, acceptance: dict[str, Any]) -> list[dict[str, Any]]:
    findings = acceptance.get("result", {}).get("findings")
    if isinstance(findings, list) and findings:
        return [item for item in findings if isinstance(item, dict)]
    artifacts = _artifacts_payload(project_dir, run_id).get("artifacts", [])
    if isinstance(artifacts, list):
        for artifact in artifacts:
            if not isinstance(artifact, dict):
                continue
            label = str(artifact.get("label") or "")
            relpath = str(artifact.get("path") or "")
            if label != "review-findings" or not relpath:
                continue
            payload = _read_json(project_dir / relpath)
            extracted = payload.get("findings") if isinstance(payload, dict) else None
            if isinstance(extracted, list) and extracted:
                return [item for item in extracted if isinstance(item, dict)]
    for event in _events_payload(project_dir, run_id):
        message = event.get("message")
        if not isinstance(message, str) or not message.strip():
            continue
        try:
            payload = json.loads(message)
        except json.JSONDecodeError:
            continue
        extracted = payload.get("findings") if isinstance(payload, dict) else None
        if isinstance(extracted, list) and extracted:
            return [item for item in extracted if isinstance(item, dict)]
    return []


def _local_supervisor(project_dir: Path, run_id: str) -> dict[str, Any]:
    probe = _run_command(
        [
            PYTHON,
            "-c",
            "from pathlib import Path; from thoth.run.lease import local_registry_root; "
            "import json,sys; p=local_registry_root(Path(sys.argv[1]))/'runs'/sys.argv[2]/'supervisor.json'; "
            "print((p.read_text() if p.exists() else '{}'))",
            str(project_dir),
            run_id,
        ],
        cwd=ROOT,
        timeout=20,
    )
    if probe.stdout.strip():
        try:
            return json.loads(probe.stdout)
        except json.JSONDecodeError:
            return {}
    return {}


def _start_dashboard(project_dir: Path, *, recorder: Recorder, rebuild: bool = False, extra_env: dict[str, str] | None = None) -> tuple[int, list[str]]:
    action = "rebuild" if rebuild else "start"
    result = _run_thoth(project_dir, "dashboard", action, timeout=180, env=extra_env)
    artifacts = _save_command(recorder, f"dashboard-{action}", result)
    if result.returncode != 0:
        raise RuntimeError(f"dashboard {action} failed")
    manifest = _read_json(project_dir / ".thoth" / "project" / "project.json")
    port = int(manifest.get("dashboard", {}).get("port", 8501))

    def _dashboard_ready() -> bool:
        try:
            return bool(_http_get_json(f"http://127.0.0.1:{port}/api/status").get("runtime"))
        except (URLError, TimeoutError, json.JSONDecodeError):
            return False

    _wait_until(
        _dashboard_ready,
        timeout=20,
        interval=0.5,
        description=f"dashboard on port {port}",
    )
    return port, artifacts


def _stop_dashboard(project_dir: Path, *, recorder: Recorder) -> list[str]:
    result = _run_thoth(project_dir, "dashboard", "stop", timeout=60)
    return _save_command(recorder, "dashboard-stop", result)


def _verify_host_run_completion(
    project_dir: Path,
    recorder: Recorder,
    *,
    check_name: str,
    run_id: str,
    expected_kind: str,
    expected_task_id: str | None = None,
    expected_host: str | None = None,
    expected_executor: str | None = None,
    expected_dispatch_mode: str | None = None,
    require_findings: bool = False,
    timeout: float = 30,
) -> list[str]:
    _wait_until(
        lambda: _state_payload(project_dir, run_id).get("status") in {"completed", "failed", "stopped"},
        timeout=timeout,
        interval=0.5,
        description=f"{check_name} run {run_id}",
    )
    run = _run_payload(project_dir, run_id)
    state = _state_payload(project_dir, run_id)
    acceptance = _acceptance_payload(project_dir, run_id)
    artifacts = [
        str(project_dir / ".thoth" / "runs" / run_id / "run.json"),
        str(project_dir / ".thoth" / "runs" / run_id / "state.json"),
        str(project_dir / ".thoth" / "runs" / run_id / "result.json"),
        str(project_dir / ".thoth" / "runs" / run_id / "packet.json"),
        str(project_dir / ".thoth" / "runs" / run_id / "events.jsonl"),
    ]
    events = _events_payload(project_dir, run_id)
    findings = _review_findings_payload(project_dir, run_id, acceptance)
    ok = (
        run.get("kind") == expected_kind
        and state.get("status") == "completed"
        and acceptance.get("status") == "completed"
    )
    if expected_task_id is not None:
        ok = ok and run.get("task_id") == expected_task_id
    if expected_host is not None:
        ok = ok and run.get("host") == expected_host
    if expected_executor is not None:
        ok = ok and run.get("executor") == expected_executor
    if expected_dispatch_mode is not None:
        ok = ok and run.get("dispatch_mode") == expected_dispatch_mode
    if require_findings:
        ok = ok and len(findings) > 0
    ok = ok and not _host_run_uses_forbidden_fallback(acceptance, events)
    detail = (
        f"Verified {expected_kind} run {run_id}: status={state.get('status')} "
        f"acceptance={acceptance.get('status')} task_id={run.get('task_id')} "
        f"host={run.get('host')} executor={run.get('executor')} dispatch={run.get('dispatch_mode')}"
    )
    recorder.add(check_name, "passed" if ok else "failed", detail, artifacts)
    if not ok:
        raise RuntimeError(f"{check_name} failed for run {run_id}")
    return artifacts


def _repo_hard_suite(project_dir: Path, recorder: Recorder) -> dict[str, Any]:
    details: dict[str, Any] = {}
    _init_git_repo(project_dir)

    init_result = _run_thoth(project_dir, "init", timeout=60)
    recorder.add(
        "repo.init",
        "passed" if init_result.returncode == 0 else "failed",
        "Initialized a fresh temp project through the public CLI.",
        _save_command(recorder, "repo-init", init_result),
    )
    if init_result.returncode != 0:
        raise RuntimeError("thoth init failed")

    port = _free_port()
    _set_dashboard_port(project_dir, port)
    _seed_task(project_dir)

    discuss_payload = json.dumps(
        {
            "decision_id": "DEC-selftest-runtime",
            "scope_id": "frontend-runtime",
            "question": "Which runtime validation method should be executed for selftest?",
            "candidate_method_ids": ["real-cli-runtime-check"],
            "selected_values": {"candidate_method_id": "real-cli-runtime-check"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
        ensure_ascii=False,
    )

    review_run_id = ""
    for name, argv in (
        ("repo.status_json", ["status", "--json"]),
        ("repo.doctor_quick", ["doctor", "--quick"]),
        ("repo.sync", ["sync"]),
        ("repo.discuss", ["discuss", "--decision-json", discuss_payload]),
        ("repo.review", ["review", "selftest", "review"]),
        ("repo.report", ["report"]),
    ):
        result = _run_thoth(project_dir, *argv, timeout=120)
        recorder.add(
            name,
            "passed" if result.returncode == 0 else "failed",
            f"Command {' '.join(argv)} completed with return code {result.returncode}.",
            _save_command(recorder, name, result),
        )
        if result.returncode != 0:
            raise RuntimeError(f"{name} failed")
        if name == "repo.review":
            review_packet = _extract_json(result.stdout)
            review_run_id = str(review_packet.get("run_id") or "")
            if review_run_id:
                stop_review = _run_thoth(project_dir, "run", "--stop", review_run_id, timeout=20)
                recorder.add(
                    "repo.review_stop",
                    "passed" if stop_review.returncode == 0 else "failed",
                    f"Stopped live review run {review_run_id} before execution lease-sensitive checks.",
                    _save_command(recorder, "repo-review-stop", stop_review),
                )
                if stop_review.returncode != 0:
                    raise RuntimeError("review stop failed")

    run_result = _run_thoth(project_dir, "run", "--task-id", "task-1", timeout=60)
    run_artifacts = _save_command(recorder, "run-live", run_result)
    run_packet = _extract_json(run_result.stdout)
    run_id = str(run_packet.get("run_id") or "")
    if run_result.returncode != 0 or not run_id:
        recorder.add("runtime.run_live_prepare", "failed", "Live run packet preparation failed.", run_artifacts)
        raise RuntimeError("run live prepare failed")
    recorder.add("runtime.run_live_prepare", "passed", f"Prepared live run packet {run_id}.", run_artifacts)
    watch_result = _run_thoth(project_dir, "run", "--watch", run_id, timeout=20)
    watch_artifacts = _save_command(recorder, "run-watch", watch_result)
    recorder.add("runtime.run_watch", "passed", f"Watch stream attached to {run_id}.", run_artifacts + watch_artifacts)

    stop_result = _run_thoth(project_dir, "run", "--stop", run_id, timeout=20)
    _wait_until(
        lambda: _state_payload(project_dir, run_id).get("status") == "stopped",
        timeout=15,
        description=f"run {run_id} to stop",
    )
    stop_artifacts = _save_command(recorder, "run-stop", stop_result)
    recorder.add("runtime.run_stop", "passed", f"Stopped live run {run_id}.", stop_artifacts)

    run_sleep_result = _run_thoth(
        project_dir,
        "run",
        "--task-id",
        "task-1",
        "--sleep",
        timeout=60,
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "complete"},
    )
    run_sleep_artifacts = _save_command(recorder, "run-sleep", run_sleep_result)
    run_sleep_packet = _extract_json(run_sleep_result.stdout)
    run_sleep_id = str(run_sleep_packet.get("run_id") or "")
    if run_sleep_result.returncode != 0 or not run_sleep_id:
        recorder.add("runtime.run_sleep", "failed", "Sleep run creation failed.", run_sleep_artifacts)
        raise RuntimeError("run --sleep failed")
    _wait_until(
        lambda: _state_payload(project_dir, run_sleep_id).get("status") == "completed",
        timeout=15,
        description=f"sleep run {run_sleep_id} to complete",
    )
    recorder.add("runtime.run_sleep", "passed", f"Prepared sleep run packet {run_sleep_id}.", run_sleep_artifacts)

    loop_live_result = _run_thoth(project_dir, "loop", "--task-id", "task-1", timeout=60)
    loop_live_artifacts = _save_command(recorder, "loop-live", loop_live_result)
    loop_live_packet = _extract_json(loop_live_result.stdout)
    loop_live_id = str(loop_live_packet.get("run_id") or "")
    if loop_live_result.returncode != 0 or not loop_live_id:
        recorder.add("runtime.loop_live_prepare", "failed", "Live loop packet preparation failed.", loop_live_artifacts)
        raise RuntimeError("loop live prepare failed")
    recorder.add("runtime.loop_live_prepare", "passed", f"Prepared live loop packet {loop_live_id}.", loop_live_artifacts)
    loop_live_watch = _run_thoth(project_dir, "loop", "--watch", loop_live_id, timeout=20)
    loop_live_watch_artifacts = _save_command(recorder, "loop-watch", loop_live_watch)
    recorder.add("runtime.loop_watch", "passed", f"Watch stream attached to {loop_live_id}.", loop_live_artifacts + loop_live_watch_artifacts)
    loop_live_stop = _run_thoth(project_dir, "loop", "--stop", loop_live_id, timeout=20)
    _wait_until(
        lambda: _state_payload(project_dir, loop_live_id).get("status") == "stopped",
        timeout=15,
        description=f"loop {loop_live_id} to stop",
    )
    recorder.add("runtime.loop_live_stop", "passed", f"Stopped live loop {loop_live_id}.", _save_command(recorder, "loop-live-stop", loop_live_stop))

    loop_result = _run_thoth(
        project_dir,
        "loop",
        "--task-id",
        "task-1",
        "--sleep",
        timeout=60,
        env={"THOTH_TEST_EXTERNAL_WORKER_MODE": "hold"},
    )
    loop_artifacts = _save_command(recorder, "loop-sleep", loop_result)
    loop_packet = _extract_json(loop_result.stdout)
    loop_id = str(loop_packet.get("run_id") or "")
    if loop_result.returncode != 0 or not loop_id:
        recorder.add("runtime.loop_sleep", "failed", "Sleep loop creation failed.", loop_artifacts)
        raise RuntimeError("loop --sleep failed")
    _wait_until(
        lambda: _state_payload(project_dir, loop_id).get("status") in {"running", "completed"},
        timeout=15,
        description=f"loop {loop_id} to become running",
    )
    recorder.add("runtime.loop_sleep", "passed", f"Prepared sleep loop packet {loop_id}.", loop_artifacts)

    conflict_result = _run_thoth(project_dir, "run", "--task-id", "task-1", timeout=60)
    conflict_artifacts = _save_command(recorder, "lease-conflict-probe", conflict_result)
    if conflict_result.returncode == 1 and "Active lease already held" in conflict_result.stderr:
        recorder.add(
            "runtime.lease_conflict",
            "passed",
            f"Secondary live run was rejected while {loop_id} held the repo lease.",
            conflict_artifacts,
        )
    else:
        recorder.add(
            "runtime.lease_conflict",
            "failed",
            f"Secondary run did not hard-fail with lease conflict. returncode={conflict_result.returncode}",
            conflict_artifacts,
        )
        raise RuntimeError("lease conflict behavior regressed")

    loop_stop = _run_thoth(project_dir, "loop", "--stop", loop_id, timeout=20)
    _wait_until(
        lambda: _state_payload(project_dir, loop_id).get("status") in {"stopped", "completed"},
        timeout=15,
        description=f"loop {loop_id} to stop",
    )
    recorder.add("runtime.loop_stop", "passed", f"Stopped loop {loop_id}.", _save_command(recorder, "loop-stop", loop_stop))

    dashboard_run = _run_thoth(project_dir, "run", "--task-id", "task-1", timeout=60)
    dashboard_run_artifacts = _save_command(recorder, "dashboard-run-live", dashboard_run)
    dashboard_packet = _extract_json(dashboard_run.stdout)
    dashboard_run_id = str(dashboard_packet.get("run_id") or "")
    if dashboard_run.returncode != 0 or not dashboard_run_id:
        recorder.add("dashboard.live_run_prepare", "failed", "Dashboard freshness probe could not prepare a live run.", dashboard_run_artifacts)
        raise RuntimeError("dashboard live run prepare failed")
    recorder.add("dashboard.live_run_prepare", "passed", f"Prepared live run {dashboard_run_id} for dashboard freshness checks.", dashboard_run_artifacts)

    state_path = project_dir / ".thoth" / "runs" / dashboard_run_id / "state.json"
    state = _state_payload(project_dir, dashboard_run_id)
    state["last_heartbeat_at"] = "2000-01-01T00:00:00Z"
    state["updated_at"] = utc_now()
    _write_json(state_path, state)

    dashboard_env = {"THOTH_HEARTBEAT_STALE_MINUTES": "1"}
    dashboard_port, dashboard_artifacts = _start_dashboard(project_dir, recorder=recorder, rebuild=False, extra_env=dashboard_env)
    status_payload = _http_get_json(f"http://127.0.0.1:{dashboard_port}/api/status")
    task_payload = _http_get_json(f"http://127.0.0.1:{dashboard_port}/api/runs/{dashboard_run_id}")
    details["dashboard_port"] = dashboard_port
    recorder.write_json("api/status.json", status_payload)
    recorder.write_json("api/active-run.json", task_payload if isinstance(task_payload, dict) else {})
    stale = bool(task_payload.get("is_stale")) if isinstance(task_payload, dict) else False
    recorder.add(
        "dashboard.api_runtime",
        "passed" if stale else "failed",
        "Dashboard backend served the real temp project and reported stale heartbeat state.",
        dashboard_artifacts + [str(recorder.artifact_dir / "api" / "status.json"), str(recorder.artifact_dir / "api" / "active-run.json")],
    )
    if not stale:
        raise RuntimeError("dashboard did not report stale heartbeat")

    restart_artifacts = _stop_dashboard(project_dir, recorder=recorder)
    restarted_port, restarted_artifacts = _start_dashboard(project_dir, recorder=recorder, rebuild=False, extra_env=dashboard_env)
    if restarted_port != dashboard_port:
        raise RuntimeError("dashboard port drifted across restart")
    recorder.add(
        "dashboard.restart",
        "passed",
        f"Dashboard restarted cleanly on port {dashboard_port}.",
        restart_artifacts + restarted_artifacts,
    )

    hooks_config = render_codex_hooks_payload()
    hook_env = {"THOTH_SOURCE_ROOT": str(ROOT)}
    hook_start = _run_command(
        ["bash", "scripts/thoth-codex-hook.sh", "start"],
        cwd=project_dir,
        env=hook_env,
        timeout=60,
    )
    start_hook_payload: dict[str, Any] = {}
    if hook_start.stdout.strip():
        try:
            start_hook_payload = json.loads(hook_start.stdout)
        except json.JSONDecodeError:
            start_hook_payload = {}
    hook_end = _run_command(["bash", "scripts/session-end-check.sh"], cwd=project_dir, timeout=60)
    hook_artifacts = [
        recorder.write_json("hooks/hooks.json", hooks_config),
        recorder.write_json("hooks/start-hook.json", start_hook_payload),
        *_save_command(recorder, "hook-start", hook_start),
        *_save_command(recorder, "hook-end", hook_end),
    ]
    session_start_hooks = hooks_config.get("hooks", {}).get("SessionStart", [])
    start_context = start_hook_payload.get("hookSpecificOutput", {}).get("additionalContext", "") if isinstance(start_hook_payload, dict) else ""
    hook_ok = bool(session_start_hooks) and hook_start.returncode == 0 and "Thoth project detected" in start_context and hook_end.returncode == 0
    recorder.add("hooks.local_success", "passed" if hook_ok else "failed", "Generated project hook configuration, start context injection, and session-end script completed.", hook_artifacts)
    if not hook_ok:
        raise RuntimeError("local session hook success path failed")

    broken_contract = project_dir / ".thoth" / "project" / "contracts" / "CTR-broken-selftest.json"
    _write_json(
        broken_contract,
        {
            "schema_version": 1,
            "kind": "contract",
            "contract_id": "CTR-broken-selftest",
            "task_id": "task-broken",
            "scope_id": "broken",
            "direction": "frontend",
            "module": "f1",
            "title": "Broken contract",
            "decision_ids": ["DEC-missing"],
            "candidate_method_id": "broken",
            "status": "frozen",
            "blocking_gaps": [],
        },
    )
    broken_hook = _run_command(["bash", "scripts/session-end-check.sh"], cwd=project_dir, timeout=60)
    broken_artifacts = _save_command(recorder, "hook-broken", broken_hook)
    broken_contract.unlink(missing_ok=True)
    degraded = broken_hook.returncode != 0
    recorder.add(
        "hooks.local_failure_observable",
        "passed" if degraded else "failed",
        "Broken strict contract file caused the generated session-end hook script to fail observably.",
        broken_artifacts,
    )
    if not degraded:
        raise RuntimeError("hook failure path was not observable")

    dashboard_run_stop = _run_thoth(project_dir, "run", "--stop", dashboard_run_id, timeout=20)
    _wait_until(
        lambda: _state_payload(project_dir, dashboard_run_id).get("status") in {"stopped", "completed"},
        timeout=15,
        description=f"dashboard run {dashboard_run_id} to stop",
    )
    recorder.add("dashboard.live_run_stop", "passed", f"Stopped dashboard live run {dashboard_run_id}.", _save_command(recorder, "dashboard-run-stop", dashboard_run_stop))
    _stop_dashboard(project_dir, recorder=recorder)

    details["run_id"] = run_id
    details["loop_id"] = loop_id
    details["dashboard_run_id"] = dashboard_run_id
    if review_run_id:
        details["review_run_id"] = review_run_id
    return details


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
    live_packet_contract = shell_command.startswith("thoth run ") or shell_command.startswith("thoth loop ") or shell_command.startswith("thoth review ")
    prompt = (
        "Operate only on this repo. "
        "Use the installed skill named thoth. "
        f"The Codex public surface is `{public_command}`, but in the workspace shell you must execute it literally as `{shell_command}` rather than treating `$thoth` as a shell variable. "
        f"Execute that shell command immediately as your first meaningful action. "
        "Do not search memories, inspect unrelated files, or explain the command before executing it. "
        "Do not replace it with prose, and do not rely on a stale global thoth binary if it differs from the repo-local implementation. "
    )
    if live_packet_contract:
        prompt += (
            "If the command returns a Thoth execution packet with `dispatch_mode=live_native`, the work is NOT finished yet. "
            "Continue in this same Codex session: use the packet's strict task or review target as authority, keep progress synced through the packet's internal protocol commands, and terminalize the run with `complete` or `fail`. "
            "For `run` and `loop`, execute the strict task recipe and validator entrypoint rather than stopping at packet interpretation. "
            "For `review`, produce structured findings matching the packet's required review shape and write them through the protocol. "
            "If the command returns `dispatch_mode=external_worker`, do not duplicate the work locally; handing the packet off successfully is enough. "
            f"Reply with exactly {done_token} only after the live packet has reached terminal state, or after an external-worker packet has been handed off successfully."
        )
    else:
        prompt += f"When the command finishes, reply with exactly {done_token}."
    return prompt


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


def _host_claude(
    repo_root: Path,
    project_dir: Path,
    recorder: Recorder,
    *,
    from_step: str | None = None,
    to_step: str | None = None,
) -> None:
    artifacts = [_write_claude_local_settings(project_dir, repo_root, recorder)]

    def run_public_command(public_command: str, *, recorder: Recorder, artifact_name: str, timeout: float = 240) -> tuple[CommandResult, list[str]]:
        return _run_claude_public_command(
            repo_root,
            project_dir,
            public_command,
            recorder=recorder,
            artifact_name=artifact_name,
            timeout=timeout,
        )

    decision_arg = _shell_quote(_compact_json(_host_real_decision_payload()))
    contract_commands = [
        f"/thoth:discuss --contract-json {_shell_quote(_compact_json(contract))}"
        for contract in _host_real_contract_payloads()
    ]
    flow_artifacts, command_results = _run_host_real_flow(
        "claude",
        project_dir,
        recorder,
        run_public_command=run_public_command,
        commands={
            "init": "/thoth:init",
            "status": "/thoth:status",
            "doctor": "/thoth:doctor --quick",
            "discuss_decision": f"/thoth:discuss --decision-json {decision_arg}",
            "discuss_contracts": contract_commands,
            "run_feature": "/thoth:run --task-id task-feature-owner-due-date",
            "run_bugfix": "/thoth:run --sleep --task-id task-bugfix-column-persist",
            "review": "/thoth:review --task-id task-loop-close-review --executor codex tracker/store.py",
            "dashboard": "/thoth:dashboard",
            "loop": "/thoth:loop --sleep --task-id task-loop-close-review",
            "loop_live_followup": "/thoth:loop --task-id task-loop-close-review",
            "report": "/thoth:report",
            "sync": "/thoth:sync",
        },
        review_expected_executor="codex",
        from_step=from_step,
        to_step=to_step,
    )
    artifacts.extend(flow_artifacts)
    partial_window = from_step is not None or to_step is not None

    combined_stdout = "\n".join(result.stdout for result in command_results.values())
    combined_stderr = "\n".join(result.stderr for result in command_results.values())
    bridge_events = _read_claude_bridge_events(project_dir)
    bridge_commands = [event.get("command_id") for event in bridge_events]
    bridge_success = {
        event.get("command_id"): bool(event.get("bridge_success"))
        for event in bridge_events
        if isinstance(event.get("command_id"), str)
    }
    bridge_path = project_dir / ".thoth" / "derived" / "host-bridges" / "claude-command-events.jsonl"
    if bridge_path.exists():
        artifacts.append(str(bridge_path))
    required_bridge_commands = ("init", "status", "doctor", "discuss", "run", "review", "dashboard", "loop", "report", "sync")
    success = all(result.returncode == 0 for result in command_results.values())
    if not partial_window:
        success = success and all(command in bridge_commands for command in required_bridge_commands) and all(
            bridge_success.get(command) is True for command in required_bridge_commands
        )
    hook_seen = "hook" in combined_stdout.lower() or "session" in combined_stdout.lower()
    check_name = "host.claude.window" if partial_window else "host.claude"
    if partial_window and success:
        status = "passed"
        detail = f"Claude host window completed successfully with from_step={from_step!r} to_step={to_step!r}."
    elif success and hook_seen:
        status = "passed"
        detail = "Claude host completed the host-real decision/run/review/loop flow through the public /thoth:* surface, including a real `--executor codex` review bridge."
    elif success:
        status = "failed"
        detail = "Claude host completed the command flow, but hook/session evidence was not visible in Claude output."
    elif any(_looks_like_transient_host_outage(result) for result in command_results.values()):
        status = "failed"
        detail = "Claude host matrix hit an upstream/transient host outage and exceeded the heavy gate's no-degraded policy."
    elif "unknown skill: thoth:thoth-main" in f"{combined_stdout}\n{combined_stderr}".lower():
        status = "failed"
        detail = "Claude host tried to route through the internal thoth-main agent instead of the public /thoth:* slash commands."
    elif "requires approval" in f"{combined_stdout}\n{combined_stderr}".lower():
        status = "failed"
        detail = "Claude host slash commands still required approval for the bridge shell command, so the repo-local runtime did not execute autonomously."
    elif "shell command execution disabled by policy" in combined_stdout.lower():
        status = "failed"
        detail = "Claude host disabled skill shell execution, so /thoth:* could not bridge into the repo-local runtime."
    elif (project_dir / ".thoth" / "project" / "project.json").exists() and not bridge_events:
        status = "failed"
        detail = "Claude host created project state, but no Claude command bridge events were recorded. This indicates a prompt-only fallback rather than the real repo runtime."
    else:
        status = "failed"
        result_codes = {command: result.returncode for command, result in command_results.items()}
        detail = f"Claude host execution failed. result_codes={result_codes} bridge_commands={bridge_commands}"
    recorder.add(check_name, status, detail, artifacts)


def _host_codex(
    repo_root: Path,
    project_dir: Path,
    recorder: Recorder,
    *,
    from_step: str | None = None,
    to_step: str | None = None,
) -> None:
    decision_path, contract_paths = _write_host_real_discuss_payload_files(project_dir)

    def run_public_command(public_command: str, *, recorder: Recorder, artifact_name: str, timeout: float = 240) -> tuple[CommandResult, list[str]]:
        done_token = f"{_safe_name(artifact_name).upper()}_DONE"
        result, artifacts = _run_codex_public_command(
            project_dir,
            public_command,
            done_token=done_token,
            recorder=recorder,
            artifact_name=artifact_name,
            timeout=timeout,
        )
        result = _normalize_codex_public_command_result(
            result,
            public_command=public_command,
            done_token=done_token,
        )
        return result, artifacts

    contract_commands = [
        f"$thoth discuss --contract-json \"$(cat {path})\""
        for path in contract_paths
    ]
    artifacts, command_results = _run_host_real_flow(
        "codex",
        project_dir,
        recorder,
        run_public_command=run_public_command,
        commands={
            "init": "$thoth init",
            "status": "$thoth status",
            "doctor": "$thoth doctor --quick",
            "discuss_decision": f"$thoth discuss --decision-json \"$(cat {decision_path})\"",
            "discuss_contracts": contract_commands,
            "run_feature": "$thoth run --host codex --task-id task-feature-owner-due-date",
            "run_bugfix": "$thoth run --host codex --executor codex --sleep --task-id task-bugfix-column-persist",
            "review": "$thoth review --task-id task-loop-close-review --host codex tracker/store.py",
            "dashboard": "$thoth dashboard",
            "loop": "$thoth loop --host codex --executor codex --sleep --task-id task-loop-close-review",
            "loop_live_followup": "$thoth loop --host codex --task-id task-loop-close-review",
            "report": "$thoth report",
            "sync": "$thoth sync",
        },
        from_step=from_step,
        to_step=to_step,
    )
    conversations_path = project_dir / ".thoth" / "project" / "conversations.jsonl"
    skill_load_failed = any("failed to load skill" in result.stderr.lower() for result in command_results.values())
    if conversations_path.exists():
        artifacts.append(str(conversations_path))
    hook_seen = False
    if conversations_path.exists():
        hook_seen = "\"type\": \"hook\"" in conversations_path.read_text(encoding="utf-8")
    partial_window = from_step is not None or to_step is not None
    success = not skill_load_failed and all(result.returncode == 0 for result in command_results.values())
    if not partial_window:
        success = success and hook_seen
    check_name = "host.codex.window" if partial_window else "host.codex"
    if partial_window and success:
        status = "passed"
        detail = f"Codex host window completed successfully with from_step={from_step!r} to_step={to_step!r}."
    elif success:
        status = "passed"
        detail = "Codex host completed the host-real decision/run/review/loop flow through the installed `$thoth` skill and emitted hook ledger notes."
    elif any(_looks_like_transient_host_outage(result) for result in command_results.values()):
        status = "failed"
        detail = "Codex host matrix hit an upstream/transient host outage and exceeded the heavy gate's no-degraded policy."
    elif skill_load_failed:
        status = "failed"
        detail = "Codex host could not load the generated Thoth public skill, so the host-real surface is not valid."
    elif not hook_seen:
        status = "failed"
        detail = "Codex host completed the command flow, but no hook ledger notes were observed."
    else:
        status = "failed"
        result_codes = {command: result.returncode for command, result in command_results.items()}
        detail = f"Codex host execution failed. result_codes={result_codes}"
    recorder.add(check_name, status, detail, artifacts)


def _should_run_host(mode: str, *, host: str, capabilities: dict[str, Any]) -> bool:
    if mode == "none":
        return False
    if mode in {host, "both"}:
        return True
    if mode != "auto":
        return False
    if host == "claude":
        return bool(capabilities.get("claude_cli_present") and capabilities.get("claude_authenticated"))
    if host == "codex":
        return bool(capabilities.get("codex_cli_present") and capabilities.get("codex_authenticated"))
    return False


def run_selftest(
    *,
    tier: str,
    hosts: str,
    artifact_dir: Path | None,
    json_report: Path | None,
    keep_workdir: bool,
    only_host: str | None = None,
    from_step: str | None = None,
    to_step: str | None = None,
) -> int:
    global _SELFTEST_DEADLINE, _SELFTEST_DEADLINE_LABEL, _SELFTEST_DEADLINE_SECONDS, _SELFTEST_STREAM_OUTPUT
    capabilities = detect_capabilities()
    base_dir = Path(tempfile.mkdtemp(prefix="thoth-selftest-"))
    if tier == "heavy":
        _cleanup_legacy_heavy_processes()
        _cleanup_legacy_heavy_tmp(preserve=[FIXED_CLAUDE_DIR, FIXED_CODEX_DIR, FIXED_RUNTIME_DIR])
        shutil.rmtree(FIXED_RUNTIME_DIR, ignore_errors=True)
        FIXED_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        base_dir = FIXED_RUNTIME_DIR
    run_artifact_dir = artifact_dir or (base_dir / "artifacts")
    if run_artifact_dir.exists():
        shutil.rmtree(run_artifact_dir, ignore_errors=True)
    if json_report is not None:
        json_report.unlink(missing_ok=True)
    recorder = Recorder(run_artifact_dir)
    exit_code = 0

    try:
        project_dir = base_dir / "repo-hard"
        project_dir.mkdir(parents=True, exist_ok=True)
        _SELFTEST_STREAM_OUTPUT = True
        with _SelftestBudget(HARD_SUITE_MAX_RUNTIME_SECONDS, label=f"{tier} repo-hard suite"):
            hard_details = _repo_hard_suite(project_dir, recorder)
        recorder.write_json("repo-hard/details.json", hard_details)
        recorder.add("repo-hard.snapshot", "passed", "Captured runtime and project snapshots.", _snapshot_runtime(recorder, project_dir, "repo-hard"))

        if tier == "heavy":
            with _SelftestBudget(HEAVY_PREFLIGHT_MAX_RUNTIME_SECONDS, label="heavy host preflight"):
                _preflight_host_real(capabilities, recorder)
            requested_hosts = ["claude", "codex"] if hosts in {"auto", "both"} else ([] if hosts == "none" else [hosts])
            if only_host is not None:
                requested_hosts = [only_host]
            if not requested_hosts:
                raise RuntimeError("heavy host-real selftest requires at least one explicit host")

            for host_name, host_project in (("claude", FIXED_CLAUDE_DIR), ("codex", FIXED_CODEX_DIR)):
                if host_name not in requested_hosts:
                    continue
                _seed_host_real_repo(host_project, recorder)
                recorder.add(
                    f"host.{host_name}.seed_repo",
                    "passed",
                    f"Rebuilt disposable host-real repo for {host_name} at {host_project}.",
                    _snapshot_runtime(recorder, host_project, f"host-{host_name}-seed"),
                )
                try:
                    with _SelftestBudget(HEAVY_HOST_MAX_RUNTIME_SECONDS, label=f"heavy host {host_name}"):
                        if host_name == "claude":
                            _host_claude(ROOT, host_project, recorder, from_step=from_step, to_step=to_step)
                        else:
                            _host_codex(ROOT, host_project, recorder, from_step=from_step, to_step=to_step)
                except Exception as exc:  # pragma: no cover - environment-specific
                    recorder.add(f"host.{host_name}", "failed", f"{host_name} host matrix failed: {exc}", _snapshot_runtime(recorder, host_project, f"host-{host_name}"))
                recorder.add(
                    f"host.{host_name}.snapshot",
                    "passed",
                    f"Captured post-host snapshot for {host_name}.",
                    _snapshot_runtime(recorder, host_project, f"host-{host_name}-final"),
                )

        summary = recorder.summary_payload(tier=tier, capabilities=capabilities, work_root=str(base_dir))
        summary_path = json_report or (run_artifact_dir / "summary.json")
        _write_json(summary_path, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if summary["overall_status"] == "failed":
            exit_code = 1
    except Exception as exc:
        recorder.add("selftest.runner", "failed", f"Self-test aborted: {exc}")
        summary = recorder.summary_payload(tier=tier, capabilities=capabilities, work_root=str(base_dir))
        summary["overall_status"] = "failed"
        summary_path = json_report or (run_artifact_dir / "summary.json")
        _write_json(summary_path, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        exit_code = 1
    finally:
        _SELFTEST_DEADLINE = None
        _SELFTEST_DEADLINE_LABEL = None
        _SELFTEST_DEADLINE_SECONDS = None
        _SELFTEST_STREAM_OUTPUT = False
        if keep_workdir:
            print(f"Kept self-test workdir at {base_dir}")
        else:
            shutil.rmtree(base_dir, ignore_errors=True)
    return exit_code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Thoth heavy self-tests.")
    parser.add_argument("--tier", choices=("hard", "heavy"), default="heavy")
    parser.add_argument("--hosts", choices=("auto", "none", "codex", "claude", "both"), default="auto")
    parser.add_argument("--only-host", choices=("codex", "claude"))
    parser.add_argument("--from-step")
    parser.add_argument("--to-step")
    parser.add_argument("--json-report", type=Path)
    parser.add_argument("--artifact-dir", type=Path)
    parser.add_argument("--keep-workdir", action="store_true")
    args = parser.parse_args(argv)
    return run_selftest(
        tier=args.tier,
        hosts=args.hosts,
        artifact_dir=args.artifact_dir,
        json_report=args.json_report,
        keep_workdir=args.keep_workdir,
        only_host=args.only_host,
        from_step=args.from_step,
        to_step=args.to_step,
    )


if __name__ == "__main__":
    raise SystemExit(main())
