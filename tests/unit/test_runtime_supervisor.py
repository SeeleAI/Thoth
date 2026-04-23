"""Tests for durable runtime supervisor lifecycle."""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path

from thoth.runtime import build_status_payload, create_run, stop_run, spawn_supervisor


def _prepare_project(tmp_path: Path) -> None:
    (tmp_path / ".thoth" / "runs").mkdir(parents=True, exist_ok=True)


def test_create_run_writes_full_ledger(tmp_path):
    _prepare_project(tmp_path)
    handle = create_run(tmp_path, kind="run", title="demo", task_id="task-1", host="codex", executor="codex")
    assert (handle.run_dir / "run.json").exists()
    assert (handle.run_dir / "state.json").exists()
    assert (handle.run_dir / "events.jsonl").exists()
    assert (handle.run_dir / "acceptance.json").exists()
    assert (handle.run_dir / "artifacts.json").exists()
    run_data = json.loads((handle.run_dir / "run.json").read_text(encoding="utf-8"))
    assert run_data["host"] == "codex"
    assert run_data["executor"] == "codex"
    assert run_data["attachable"] is True


def test_spawn_and_stop_supervisor(tmp_path, monkeypatch):
    _prepare_project(tmp_path)
    monkeypatch.setenv("THOTH_LOCAL_STATE_DIR", str(tmp_path / ".machine-state"))
    monkeypatch.chdir(tmp_path)
    handle = create_run(tmp_path, kind="run", title="demo", task_id=None, host="codex", executor="codex")
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
        if state["status"] == "stopped":
            break
        time.sleep(0.1)
    else:
        raise AssertionError("supervisor did not stop")

    payload = build_status_payload(tmp_path)
    assert payload["active_run_count"] == 0
