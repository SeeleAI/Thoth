"""Tests for advisory host hook behavior."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

from thoth.run.ledger import create_run
from thoth.surface.hooks import run_host_hook


@pytest.fixture
def hook_project(tmp_path, monkeypatch):
    project_dir = tmp_path / "project"
    project_dir.mkdir()
    monkeypatch.chdir(project_dir)
    (project_dir / ".thoth" / "project").mkdir(parents=True)
    (project_dir / ".thoth" / "project" / "project.json").write_text(
        json.dumps({"project": {"name": "Hook Test"}}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return project_dir


def test_claude_start_hook_injects_context_and_records_events(hook_project: Path, monkeypatch):
    handle = create_run(
        hook_project,
        kind="run",
        title="Hook event test",
        task_id="task-1",
        host="claude",
        executor="claude",
    )
    stdin_payload = json.dumps({"source": "resume", "session_id": "session-1"})
    monkeypatch.setattr(sys, "stdin", type("In", (), {"isatty": lambda self: False, "read": lambda self: stdin_payload})())

    result = run_host_hook(host="claude", event="start", project_root=hook_project)

    payload = json.loads(result.stdout)
    assert "Active durable runs" in payload["hookSpecificOutput"]["additionalContext"]

    conversations = (hook_project / ".thoth" / "project" / "conversations.jsonl").read_text(encoding="utf-8")
    assert '"type": "hook"' in conversations
    assert '"event": "start"' in conversations
    assert '"session_id": "session-1"' in conversations


def test_codex_stop_hook_emits_system_message_when_lightweight_issues_exist(hook_project: Path, monkeypatch):
    stdin_payload = json.dumps({"last_assistant_message": "done"})
    monkeypatch.setattr(sys, "stdin", type("In", (), {"isatty": lambda self: False, "read": lambda self: stdin_payload})())
    (hook_project / ".agent-os").mkdir()

    result = run_host_hook(host="codex", event="stop", project_root=hook_project)

    payload = json.loads(result.stdout)
    assert "systemMessage" in payload
    assert "Run $thoth doctor" in payload["systemMessage"]
