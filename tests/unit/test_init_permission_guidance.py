"""Tests for Claude bridge permission guidance emitted by init."""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).parent.parent.parent


def _run_cli(tmp_path: Path, claude_config_dir: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    env["THOTH_CLAUDE_CONFIG_DIR"] = str(claude_config_dir)
    return subprocess.run(
        [sys.executable, "-m", "thoth.cli", *args],
        cwd=str(tmp_path),
        text=True,
        capture_output=True,
        env=env,
    )


def test_init_prints_permission_guidance_when_bridge_allow_missing(tmp_path):
    claude_dir = tmp_path / "fake-home" / ".claude"
    claude_dir.mkdir(parents=True)
    result = _run_cli(tmp_path, claude_dir, "init")
    assert result.returncode == 0, result.stderr
    assert "Claude bridge permission: missing" in result.stdout
    assert "settings.local.json" in result.stdout
    assert "Bash(*thoth-claude-command.sh*)" in result.stdout


def test_init_detects_global_bridge_allow_rule(tmp_path):
    claude_dir = tmp_path / "fake-home" / ".claude"
    claude_dir.mkdir(parents=True)
    (claude_dir / "settings.json").write_text(
        "{\n"
        '  "permissions": {\n'
        '    "allow": ["Bash(*thoth-claude-command.sh*)"]\n'
        "  }\n"
        "}\n",
        encoding="utf-8",
    )
    result = _run_cli(tmp_path, claude_dir, "init")
    assert result.returncode == 0, result.stderr
    assert "Claude bridge permission: ready via global" in result.stdout
