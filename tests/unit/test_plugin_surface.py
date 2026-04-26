"""Tests for the public plugin surface layout."""

import json
from pathlib import Path
import re

import yaml


ROOT = Path(__file__).parent.parent.parent


def test_no_internal_public_skills():
    """Internal contracts should not remain in the public skills surface."""
    forbidden = [
        ROOT / ".agents" / "skills" / "run-codex" / "SKILL.md",
        ROOT / ".agents" / "skills" / "loop-codex" / "SKILL.md",
        ROOT / ".agents" / "skills" / "review-codex" / "SKILL.md",
    ]
    assert all(not path.exists() for path in forbidden), forbidden


def test_no_public_codex_variant_commands():
    """Codex executor variants should not exist as standalone public commands."""
    forbidden = [
        ROOT / "commands" / "run" / "codex.md",
        ROOT / "commands" / "loop" / "codex.md",
        ROOT / "commands" / "review" / "codex.md",
    ]
    assert all(not path.exists() for path in forbidden), forbidden


def test_executor_mode_documents_exist():
    """Public commands should advertise executor-mode routing instead."""
    for relpath in ["commands/run.md", "commands/loop.md", "commands/review.md"]:
        content = (ROOT / relpath).read_text(encoding="utf-8")
        assert "Codex executor allowed: yes" in content


def test_plugin_does_not_force_default_agent_activation():
    """The plugin should not rely on a default agent activation file."""
    assert not (ROOT / "settings.json").exists()
    assert not (ROOT / "agents").exists()


def test_public_command_names_are_bare():
    """Public command names should stay explicitly namespaced under Thoth."""
    for path in sorted((ROOT / "commands").glob("*.md")):
        content = path.read_text(encoding="utf-8")
        match = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
        assert match, path
        name = match.group(1).strip()
        assert name.startswith("thoth:"), (path, name)


def test_single_official_codex_plugin_package_and_marketplace():
    """Codex public install surface should be the marketplace entry plus one plugin package."""
    marketplace_path = ROOT / ".agents" / "plugins" / "marketplace.json"
    assert marketplace_path.exists()
    marketplace = json.loads(marketplace_path.read_text(encoding="utf-8"))
    assert marketplace["plugins"][0]["source"]["path"] == "./plugins/thoth"

    plugin_path = ROOT / "plugins" / "thoth" / ".codex-plugin" / "plugin.json"
    assert plugin_path.exists()
    manifest = json.loads(plugin_path.read_text(encoding="utf-8"))
    assert manifest["name"] == "thoth"
    assert manifest["skills"] == "./skills"
    assert manifest["interface"]["displayName"] == "Thoth"
    assert "entrypoint" not in manifest
    assert "public_skill_path" not in manifest


def test_codex_agent_metadata_exists():
    """Plugin-packaged OpenAI metadata should exist for the installable Codex skill."""
    plugin_metadata_path = ROOT / "plugins" / "thoth" / "skills" / "thoth" / "agents" / "openai.yaml"
    assert plugin_metadata_path.exists()
    metadata = yaml.safe_load(plugin_metadata_path.read_text(encoding="utf-8"))
    assert metadata["interface"]["display_name"] == "thoth"


def test_claude_bridge_script_executes_file_path_directly():
    """Claude bridge shell script should not rely on module-name resolution."""
    script_path = ROOT / "scripts" / "thoth-claude-command.sh"
    assert script_path.exists()
    content = script_path.read_text(encoding="utf-8")
    assert '"${PYTHON_BIN}" "${PLUGIN_ROOT}/thoth/claude_bridge.py" "$@"' in content
    assert '-m thoth.claude_bridge' not in content


def test_plugin_cli_entry_exists_for_shadow_safe_execution():
    """The plugin should ship a wrapper that pins CLI imports to the plugin root."""
    entry_path = ROOT / "scripts" / "thoth-cli-entry.py"
    assert entry_path.exists()
    content = entry_path.read_text(encoding="utf-8")
    assert "from thoth.cli import main as cli_main" in content
