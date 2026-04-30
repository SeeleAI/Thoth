"""Tests for host-neutral command spec projections."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.command_specs import COMMAND_SPECS, PUBLIC_CODEX_COMMANDS
from thoth.projections import (
    PLUGIN_PACKAGE_DIR,
    PLUGIN_SKILLS_PATH,
    render_claude_command,
    render_codex_marketplace,
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
    assert "disable-model-invocation: false" in rendered
    assert "allowed-tools: Read, Glob, Grep, Edit, Write, Bash, Task" in rendered
    assert 'scripts/thoth-claude-command.sh" run --host claude $ARGUMENTS' in rendered
    assert "RuntimeDriver advances phases" in rendered
    assert "do not invent, create, compile, or guess a work item" in rendered
    assert "## Authority Summary" in rendered
    assert "route_class: `live_intelligent`" in rendered
    assert "packet_authority_mode: `phase_controller`" in rendered
    assert "plan -> execute -> validate -> reflect" in rendered


def test_claude_discuss_surface_preserves_structured_arguments():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "discuss")
    rendered = render_claude_command(spec)
    assert 'scripts/thoth-claude-command.sh" discuss $ARGUMENTS' in rendered
    assert "disable-model-invocation: false" in rendered


def test_claude_review_surface_preserves_structured_arguments():
    spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "review")
    rendered = render_claude_command(spec)
    assert 'scripts/thoth-claude-command.sh" review --host claude $ARGUMENTS' in rendered
    assert "allowed-tools: Read, Glob, Grep, Bash, Task" in rendered
    assert "packet.required_review_shape" in rendered
    assert "packet.review_mode` is `exact_match`" in rendered
    assert "packet.protocol_commands.complete_exact" in rendered
    assert "route_class: `live_intelligent`" in rendered
    assert "packet_authority_mode: `review_packet`" in rendered


def test_codex_skill_lists_single_public_entry():
    content = render_codex_skill()
    assert content.startswith("---\nname: thoth\n")
    assert "$thoth <command>" in content
    assert "## Dispatcher" in content
    assert "./commands/<command>.md" in content
    assert "## Route Table" in content
    assert "## Command Contracts" not in content
    assert "### `$thoth run`" not in content
    for command in PUBLIC_CODEX_COMMANDS:
        assert f"$thoth {command}" in content


def test_prompt_surface_size_regression():
    run_spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "run")
    review_spec = next(spec for spec in COMMAND_SPECS if spec.command_id == "review")
    codex_skill = render_codex_skill()
    claude_run = render_claude_command(run_spec)
    claude_review = render_claude_command(review_spec)

    assert len(codex_skill) < 4200
    assert len(claude_run) < 3200
    assert len(claude_review) < 3000


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


def test_codex_marketplace_points_to_plugin_package():
    marketplace = render_codex_marketplace()
    assert marketplace["name"] == "thoth"
    assert marketplace["plugins"][0]["name"] == "thoth"
    assert marketplace["plugins"][0]["source"]["path"] == f"./{PLUGIN_PACKAGE_DIR}"
    assert marketplace["plugins"][0]["policy"]["installation"] == "AVAILABLE"
    assert marketplace["plugins"][0]["policy"]["authentication"] == "ON_INSTALL"


def test_sync_repository_surfaces_writes_generated_files(tmp_path):
    (tmp_path / "commands").mkdir()
    written = sync_repository_surfaces(tmp_path)
    assert tmp_path / "commands" / "run.md" in written
    assert (tmp_path / ".agents" / "plugins" / "marketplace.json").exists()
    assert (tmp_path / "plugins" / "thoth" / "skills" / "thoth" / "SKILL.md").exists()
    assert (tmp_path / "plugins" / "thoth" / "skills" / "thoth" / "commands" / "run.md").exists()
    assert (tmp_path / "plugins" / "thoth" / "skills" / "thoth" / "agents" / "openai.yaml").exists()
    manifest = json.loads((tmp_path / "plugins" / "thoth" / ".codex-plugin" / "plugin.json").read_text(encoding="utf-8"))
    assert manifest["skills"] == PLUGIN_SKILLS_PATH
