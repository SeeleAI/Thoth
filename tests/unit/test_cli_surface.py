"""Tests for the official `$thoth` CLI surface."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parent.parent.parent


def _run_cli(tmp_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    return subprocess.run(
        [sys.executable, "-m", "thoth.cli", *args],
        cwd=str(tmp_path),
        text=True,
        capture_output=True,
        env=env,
    )


def test_cli_init_creates_project_layer(tmp_path):
    result = _run_cli(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    assert (tmp_path / ".thoth" / "project" / "project.json").exists()
    assert (tmp_path / "AGENTS.md").exists()
    assert (tmp_path / ".codex" / "config.json").exists()


def test_cli_discuss_records_note(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "discuss", "planning", "note")
    assert result.returncode == 0
    note_path = tmp_path / ".thoth" / "project" / "conversations.jsonl"
    assert note_path.exists()
    payload = json.loads(note_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["type"] == "discuss"
    assert payload["content"] == "planning note"


def test_cli_review_records_note(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "review", "audit", "this")
    assert result.returncode == 0
    note_path = tmp_path / ".thoth" / "project" / "conversations.jsonl"
    payload = json.loads(note_path.read_text(encoding="utf-8").splitlines()[-1])
    assert payload["type"] == "review"


def test_cli_sync_regenerates_project_layer(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    agents_path = tmp_path / "AGENTS.md"
    agents_path.write_text("drifted\n", encoding="utf-8")
    result = _run_cli(tmp_path, "sync")
    assert result.returncode == 0
    assert "drifted" not in agents_path.read_text(encoding="utf-8")


def test_cli_status_json(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "status", "--json")
    assert result.returncode == 0
    payload = json.loads(result.stdout)
    assert payload["active_run_count"] == 0


def test_cli_doctor_quick(tmp_path):
    assert _run_cli(tmp_path, "init").returncode == 0
    result = _run_cli(tmp_path, "doctor", "--quick", "--fix")
    assert result.returncode == 0
    assert "Thoth Doctor" in result.stdout
