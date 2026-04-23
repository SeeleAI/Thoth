"""Tests for host-neutral command spec projections."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.command_specs import COMMAND_SPECS, PUBLIC_CODEX_COMMANDS
from thoth.projections import (
    render_claude_command,
    render_codex_skill,
    render_plugin_manifest,
    sync_repository_surfaces,
)


ROOT = Path(__file__).parent.parent.parent


def test_claude_surface_renders_from_spec():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "run")
    rendered = render_claude_command(spec)
    assert "name: thoth:run" in rendered
    assert "Durable: yes" in rendered
    assert "Codex executor allowed: yes" in rendered


def test_codex_skill_lists_single_public_entry():
    content = render_codex_skill()
    assert "$thoth <command>" in content
    for command in PUBLIC_CODEX_COMMANDS:
        assert f"$thoth {command}" in content


def test_plugin_manifest_matches_single_skill_surface():
    manifest = render_plugin_manifest()
    assert manifest["name"] == "thoth"
    assert manifest["entrypoint"] == "$thoth"
    assert manifest["commands"] == list(PUBLIC_CODEX_COMMANDS)


def test_sync_repository_surfaces_writes_generated_files(tmp_path):
    (tmp_path / "commands").mkdir()
    written = sync_repository_surfaces(tmp_path)
    assert tmp_path / "commands" / "run.md" in written
    assert (tmp_path / ".agents" / "skills" / "thoth" / "SKILL.md").exists()
    manifest = json.loads((tmp_path / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert manifest["public_skill_path"] == ".agents/skills/thoth/SKILL.md"
