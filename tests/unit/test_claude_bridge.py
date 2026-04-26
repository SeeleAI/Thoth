"""Tests for the Claude command bridge."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parent.parent.parent


def _run_bridge(tmp_path: Path, command_id: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    env["THOTH_CLAUDE_PLUGIN_ROOT"] = str(ROOT)
    return subprocess.run(
        [sys.executable, str(ROOT / "thoth" / "surface" / "bridges" / "claude.py"), command_id, *args],
        cwd=str(tmp_path),
        text=True,
        capture_output=True,
        env=env,
    )


def test_bridge_executes_repo_local_init_and_records_event(tmp_path):
    result = _run_bridge(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "init"
    assert payload["bridge_success"] is True
    assert payload["checks"]["project_manifest_exists"] is True
    event_log = tmp_path / ".thoth" / "derived" / "host-bridges" / "claude-command-events.jsonl"
    assert event_log.exists()
    event = json.loads(event_log.read_text(encoding="utf-8").splitlines()[-1])
    assert event["command_id"] == "init"
    assert event["bridge_success"] is True


def test_bridge_records_status_after_init(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True
    status_result = _run_bridge(tmp_path, "status")
    assert status_result.returncode == 0, status_result.stderr
    status_payload = json.loads(status_result.stdout)
    assert status_payload["command_id"] == "status"
    assert status_payload["bridge_success"] is True
    events = [
        json.loads(line)
        for line in (tmp_path / ".thoth" / "derived" / "host-bridges" / "claude-command-events.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert [event["command_id"] for event in events][-2:] == ["init", "status"]


def test_bridge_uses_plugin_cli_even_if_project_has_shadow_thoth_package(tmp_path):
    shadow_pkg = tmp_path / "thoth"
    shadow_pkg.mkdir()
    (shadow_pkg / "__init__.py").write_text("", encoding="utf-8")
    (shadow_pkg / "cli.py").write_text(
        "raise SystemExit('shadow-cli-should-not-run')\n",
        encoding="utf-8",
    )

    result = _run_bridge(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["bridge_success"] is True
    assert "shadow-cli-should-not-run" not in payload["stderr"]


def test_bridge_rewrites_review_positional_target_for_prepare(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True

    result = _run_bridge(tmp_path, "review", "--executor", "codex", "backend/app.py")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "review"
    assert payload["bridged_command_id"] == "prepare"
    assert payload["bridge_success"] is True
    assert "--target" in payload["argv"]
    assert "backend/app.py" in payload["argv"]
    assert payload["packet"]["command_id"] == "review"
    assert payload["packet"]["target"] == "backend/app.py"
    assert "protocol_commands" in payload["packet"]
