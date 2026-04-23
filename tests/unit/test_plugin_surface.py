"""Tests for the public plugin surface layout."""

from pathlib import Path
import re


ROOT = Path(__file__).parent.parent.parent


def test_no_internal_public_skills():
    """Internal contracts should not remain in the public skills surface."""
    forbidden = [
        ROOT / "skills" / "thoth-core" / "SKILL.md",
        ROOT / "skills" / "thoth-audit" / "SKILL.md",
        ROOT / "skills" / "thoth-exec" / "SKILL.md",
        ROOT / "skills" / "thoth-memory" / "SKILL.md",
        ROOT / "skills" / "thoth-counsel" / "SKILL.md",
        ROOT / "skills" / "thoth-codex" / "SKILL.md",
        ROOT / "skills" / "thoth-testing" / "SKILL.md",
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
        assert "--executor claude|codex" in content


def test_internal_agents_and_settings_exist():
    """The plugin should provide a default main agent and an internal Codex worker."""
    assert (ROOT / "settings.json").exists()
    assert (ROOT / "agents" / "thoth-main.md").exists()
    assert (ROOT / "agents" / "codex-worker.md").exists()


def test_public_command_names_are_bare():
    """Public command names should stay explicitly namespaced under Thoth."""
    for path in sorted((ROOT / "commands").glob("*.md")):
        content = path.read_text(encoding="utf-8")
        match = re.search(r"^name:\s*(.+)$", content, re.MULTILINE)
        assert match, path
        name = match.group(1).strip()
        assert name.startswith("thoth:"), (path, name)
