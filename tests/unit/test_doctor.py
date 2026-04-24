"""Tests for strict doctor helper functions."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from doctor import REQUIRED_AGENT_OS_FILES, check_id_integrity, check_required_files


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_check_required_files_all_present(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    agent_os = tmp_path / ".agent-os"
    agent_os.mkdir()
    for fname in REQUIRED_AGENT_OS_FILES:
        (agent_os / fname).write_text(f"# {fname}\n", encoding="utf-8")
    passed, detail = check_required_files()
    assert passed
    assert "PASS" in detail


def test_check_required_files_missing(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    agent_os = tmp_path / ".agent-os"
    agent_os.mkdir()
    for fname in REQUIRED_AGENT_OS_FILES[:4]:
        (agent_os / fname).write_text(f"# {fname}\n", encoding="utf-8")
    passed, detail = check_required_files()
    assert not passed
    assert "missing" in detail.lower()


def test_check_id_integrity_unique(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    _write_json(tmp_path / ".thoth" / "project" / "tasks" / "task-1.json", {"task_id": "task-1"})
    _write_json(tmp_path / ".thoth" / "project" / "tasks" / "task-2.json", {"task_id": "task-2"})
    passed, detail = check_id_integrity()
    assert passed
    assert "2 unique" in detail


def test_check_id_integrity_no_tasks(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    passed, detail = check_id_integrity()
    assert passed
    assert "no strict tasks" in detail
