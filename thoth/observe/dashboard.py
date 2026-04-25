"""Canonical dashboard runtime service."""

from __future__ import annotations

import json
import os
import signal
import subprocess
import time
from pathlib import Path
from typing import Any

from thoth.plan.store import load_project_manifest


def _manifest(project_root: Path) -> dict[str, Any]:
    return load_project_manifest(project_root)


def _python_bin(project_root: Path) -> str:
    runtime = _manifest(project_root).get("runtime", {})
    if isinstance(runtime, dict):
        value = runtime.get("python_bin")
        if isinstance(value, str) and value.strip():
            return value.strip()
    return "python"


def dashboard_port(project_root: Path) -> int:
    dashboard = _manifest(project_root).get("dashboard", {})
    if isinstance(dashboard, dict):
        value = dashboard.get("port")
        if isinstance(value, int):
            return value
    return 8501


def _pid_file(project_root: Path) -> Path:
    return project_root / ".thoth" / "derived" / "dashboard.pid"


def _log_file(project_root: Path) -> Path:
    return project_root / ".thoth" / "derived" / "dashboard.log"


def _backend_dir(project_root: Path) -> Path:
    return project_root / "tools" / "dashboard" / "backend"


def _frontend_dir(project_root: Path) -> Path:
    return project_root / "tools" / "dashboard" / "frontend"


def _read_pid(project_root: Path) -> int | None:
    path = _pid_file(project_root)
    if not path.exists():
        return None
    try:
        return int(path.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        path.unlink(missing_ok=True)
        return None


def _process_alive(pid: int | None) -> bool:
    if pid is None or pid <= 0:
        return False
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _write_pid(project_root: Path, pid: int) -> None:
    path = _pid_file(project_root)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(f"{pid}\n", encoding="utf-8")


def _maybe_build_frontend(project_root: Path, *, required: bool) -> None:
    frontend_dir = _frontend_dir(project_root)
    if not frontend_dir.is_dir():
        return
    dist_dir = frontend_dir / "dist"
    if dist_dir.is_dir() and not required:
        return
    subprocess.run(["npm", "run", "build"], cwd=str(frontend_dir), check=required)


def start_dashboard(project_root: Path, *, rebuild: bool = False) -> dict[str, Any]:
    pid = _read_pid(project_root)
    port = dashboard_port(project_root)
    if _process_alive(pid):
        return {"status": "ok", "action": "start", "summary": f"Dashboard already running at http://localhost:{port}", "pid": pid}

    backend_dir = _backend_dir(project_root)
    if not backend_dir.is_dir():
        raise FileNotFoundError(f"Dashboard backend not found at {backend_dir}")

    _maybe_build_frontend(project_root, required=rebuild)
    log_path = _log_file(project_root)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("a", encoding="utf-8") as handle:
        process = subprocess.Popen(
            [_python_bin(project_root), "-m", "uvicorn", "app:app", "--host", "0.0.0.0", "--port", str(port)],
            cwd=str(backend_dir),
            stdin=subprocess.DEVNULL,
            stdout=handle,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            text=True,
        )
    _write_pid(project_root, process.pid)
    time.sleep(1.0)
    if not _process_alive(process.pid):
        raise RuntimeError(f"Dashboard failed to start. Check {_log_file(project_root)}")
    return {"status": "ok", "action": "start", "summary": f"Dashboard running at http://localhost:{port}", "pid": process.pid}


def stop_dashboard(project_root: Path) -> dict[str, Any]:
    pid = _read_pid(project_root)
    if not _process_alive(pid):
        _pid_file(project_root).unlink(missing_ok=True)
        return {"status": "ok", "action": "stop", "summary": "Dashboard is not running.", "pid": None}

    os.kill(pid, signal.SIGTERM)
    deadline = time.time() + 5.0
    while time.time() < deadline and _process_alive(pid):
        time.sleep(0.25)
    if _process_alive(pid):
        os.kill(pid, signal.SIGKILL)
    _pid_file(project_root).unlink(missing_ok=True)
    return {"status": "ok", "action": "stop", "summary": f"Dashboard stopped (PID: {pid})", "pid": pid}


def rebuild_dashboard(project_root: Path) -> dict[str, Any]:
    stop_dashboard(project_root)
    _maybe_build_frontend(project_root, required=True)
    return start_dashboard(project_root, rebuild=False)


def manage_dashboard(project_root: Path, action: str) -> dict[str, Any]:
    action = action.strip().lower()
    if action == "start":
        return start_dashboard(project_root)
    if action == "stop":
        return stop_dashboard(project_root)
    if action == "rebuild":
        return rebuild_dashboard(project_root)
    raise ValueError(f"Unknown dashboard action: {action}")


def main(argv: list[str] | None = None) -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Thoth dashboard manager")
    parser.add_argument("action", nargs="?", default="start", choices=("start", "stop", "rebuild"))
    args = parser.parse_args(argv)
    result = manage_dashboard(Path.cwd(), args.action)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0

