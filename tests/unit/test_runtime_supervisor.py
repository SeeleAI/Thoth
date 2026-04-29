"""Tests for durable runtime supervisor lifecycle."""

from __future__ import annotations

import json
import subprocess
import sys
import threading
import time
from pathlib import Path

from thoth.run.ledger import _write_json
from thoth.run.lease import local_registry_root
from thoth.run.ledger import create_run
from thoth.run.status import build_status_payload
from thoth.run.service import stop_run
from thoth.run.worker import spawn_supervisor


def _prepare_project(tmp_path: Path) -> None:
    (tmp_path / ".thoth" / "runs").mkdir(parents=True, exist_ok=True)


def test_create_run_writes_full_ledger(tmp_path):
    _prepare_project(tmp_path)
    handle = create_run(tmp_path, kind="run", title="demo", work_id="task-1", host="codex", executor="codex")
    assert (handle.run_dir / "run.json").exists()
    assert (handle.run_dir / "state.json").exists()
    assert (handle.run_dir / "events.jsonl").exists()
    assert (handle.run_dir / "result.json").exists()
    assert (handle.run_dir / "artifacts.json").exists()
    run_data = json.loads((handle.run_dir / "run.json").read_text(encoding="utf-8"))
    assert run_data["host"] == "codex"
    assert run_data["executor"] == "codex"
    assert run_data["attachable"] is True


def test_spawn_and_stop_supervisor(tmp_path, monkeypatch):
    _prepare_project(tmp_path)
    monkeypatch.setenv("THOTH_LOCAL_STATE_DIR", str(tmp_path / ".machine-state"))
    monkeypatch.chdir(tmp_path)
    handle = create_run(tmp_path, kind="run", title="demo", work_id=None, host="codex", executor="codex")
    pid = spawn_supervisor(handle)
    assert isinstance(pid, int)

    deadline = time.time() + 5
    while time.time() < deadline:
        state = json.loads((handle.run_dir / "state.json").read_text(encoding="utf-8"))
        if state["status"] == "running":
            break
        time.sleep(0.1)
    else:
        raise AssertionError("supervisor did not reach active state")

    stop_run(tmp_path, handle.run_id)
    deadline = time.time() + 5
    while time.time() < deadline:
        state = json.loads((handle.run_dir / "state.json").read_text(encoding="utf-8"))
        if state["status"] in {"stopped", "completed"}:
            break
        time.sleep(0.1)
    else:
        raise AssertionError("supervisor did not settle after stop request")

    payload = build_status_payload(tmp_path)
    assert payload["active_run_count"] == 0


def test_local_registry_root_falls_back_to_repo_local_state_when_home_is_read_only(tmp_path, monkeypatch):
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.delenv("THOTH_LOCAL_STATE_DIR", raising=False)

    def fake_writable(path: Path) -> bool:
        return path == project_dir / ".thoth" / "derived" / "local-state"

    monkeypatch.setattr("thoth.run.io._directory_is_writable", fake_writable)

    root = local_registry_root(project_dir)

    assert root.parent == project_dir / ".thoth" / "derived" / "local-state"


def test_write_json_tolerates_concurrent_writers(tmp_path):
    target = tmp_path / "state.json"
    errors: list[Exception] = []
    start = threading.Event()

    def writer(index: int) -> None:
        try:
            start.wait(timeout=2)
            for seq in range(25):
                _write_json(target, {"writer": index, "seq": seq})
        except Exception as exc:  # pragma: no cover - defensive
            errors.append(exc)

    threads = [threading.Thread(target=writer, args=(idx,)) for idx in range(4)]
    for thread in threads:
        thread.start()
    start.set()
    for thread in threads:
        thread.join(timeout=5)

    assert not errors
    payload = json.loads(target.read_text(encoding="utf-8"))
    assert set(payload) == {"writer", "seq"}
