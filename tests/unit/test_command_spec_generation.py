"""Tests for host-neutral command spec projections."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.command_specs import COMMAND_SPECS, PUBLIC_CODEX_COMMANDS
from thoth.projections import (
    PLUGIN_SKILLS_PATH,
    render_claude_command,
    render_codex_agent_metadata,
    render_codex_skill,
    render_plugin_manifest,
    sync_repository_surfaces,
)


ROOT = Path(__file__).parent.parent.parent


def test_claude_surface_renders_from_spec():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "run")
    rendered = render_claude_command(spec)
    assert "name: thoth:run" in rendered
    assert "disable-model-invocation: true" in rendered
    assert "Durable: yes" in rendered
    assert "Codex executor allowed: yes" in rendered
    assert 'scripts/thoth-claude-command.sh" run $ARGUMENTS' in rendered


def test_codex_skill_lists_single_public_entry():
    content = render_codex_skill()
    assert content.startswith("---\nname: thoth\n")
    assert "$thoth <command>" in content
    assert "python -m thoth.cli <command>" in content
    for command in PUBLIC_CODEX_COMMANDS:
        assert f"$thoth {command}" in content


def test_codex_agent_metadata_uses_single_public_entry():
    content = render_codex_agent_metadata()
    assert 'display_name: "thoth"' in content
    assert "Use $thoth as the single public entrypoint" in content


def test_plugin_manifest_matches_official_schema_shape():
    manifest = render_plugin_manifest()
    assert manifest["name"] == "thoth"
    assert manifest["version"] == "0.1.4"
    assert manifest["skills"] == PLUGIN_SKILLS_PATH
    assert manifest["interface"]["displayName"] == "Thoth"
    assert manifest["interface"]["defaultPrompt"][0].startswith("Show the current Thoth")
    for removed_field in {"schema_version", "display_name", "entrypoint", "public_skill_path", "commands"}:
        assert removed_field not in manifest


def test_sync_repository_surfaces_writes_generated_files(tmp_path):
    (tmp_path / "commands").mkdir()
    written = sync_repository_surfaces(tmp_path)
    assert tmp_path / "commands" / "run.md" in written
    assert (tmp_path / ".agents" / "skills" / "thoth" / "SKILL.md").exists()
    assert (tmp_path / ".agents" / "skills" / "thoth" / "agents" / "openai.yaml").exists()
    manifest = json.loads((tmp_path / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert manifest["skills"] == PLUGIN_SKILLS_PATH
