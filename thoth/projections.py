"""Render host-specific projections from the host-neutral Thoth command specs."""

from __future__ import annotations

import json
from pathlib import Path

from .command_specs import COMMAND_SPECS, CommandSpec, PUBLIC_CODEX_COMMANDS


ROOT = Path(__file__).resolve().parent.parent
PLUGIN_NAME = "thoth"
PLUGIN_VERSION = "0.1.4"
PLUGIN_REPOSITORY = "https://github.com/SeeleAI/thoth"
PLUGIN_SKILLS_PATH = "./.agents/skills"


def _bullet_lines(items: tuple[str, ...]) -> str:
    if not items:
        return "- (none)\n"
    return "".join(f"- {item}\n" for item in items)


def render_claude_command(spec: CommandSpec) -> str:
    lifecycle = " -> ".join(spec.lifecycle) if spec.lifecycle else "n/a"
    runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} $ARGUMENTS'
    if spec.command_id in {"discuss", "review"}:
        runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} --goal "$ARGUMENTS"'
    return f"""---
name: thoth:{spec.command_id}
description: {spec.summary}
argument-hint: "{spec.argument_hint}"
disable-model-invocation: true
---

# /thoth:{spec.command_id}

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
{runtime_invocation}
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result.

## Scope Guard

**CAN:**
{_bullet_lines(spec.scope_can)}
**CANNOT:**
{_bullet_lines(spec.scope_cannot)}
## Runtime Contract

- Durable: {"yes" if spec.durable else "no"}
- Codex executor allowed: {"yes" if spec.supports_codex_executor else "no"}
- Hooks required for correctness: {"no" if not spec.needs_hooks else "hooks may enhance but are not correctness-critical"}
- Subagents required for correctness: no
- Lifecycle: {lifecycle}
- Acceptance: {spec.acceptance}

## Interaction Gaps

{_bullet_lines(spec.interaction_gaps)}
## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
"""


def render_codex_skill() -> str:
    command_lines = "\n".join(
        f"- `$thoth {spec.command_id}`: {spec.summary}" for spec in COMMAND_SPECS
    )
    return f"""---
name: thoth
description: Official Codex public surface for the Thoth authority runtime. Use this skill when the user wants to operate Thoth through the single `$thoth <command>` public entry.
---

# Thoth

Official Codex public surface for Thoth. This skill is generated from the same host-neutral command specification that renders the Claude `/thoth:*` commands.

## Public Entry

Use the single public entrypoint:

- `$thoth <command>`

Supported commands:
{command_lines}

## Runtime Rules

- `.thoth` is the only runtime authority.
- `run` and `loop` are durable by default and support attach/watch/stop semantics.
- Host hooks and subagents may enhance throughput but are never correctness requirements.
- Do not create alternative public Codex skill variants such as `run:codex` or `loop:codex`.

## Execution Guidance

- When the current workspace is this Thoth repository itself, prefer the repo-local CLI implementation over any globally installed `thoth` binary.
- In that case, invoke commands from the repository root with `python -m thoth.cli <command>` and ensure `PYTHONPATH` includes the repository root.
- Only rely on a PATH-level `thoth` binary when you have already verified it resolves to the same checked-out repository code.
"""


def render_codex_agent_metadata() -> str:
    return """interface:
  display_name: "thoth"
  short_description: "Official Codex public surface for the Thoth authority runtime."
  default_prompt: "Use $thoth as the single public entrypoint for Thoth and operate the shared .thoth runtime through $thoth <command>."
"""


def render_plugin_manifest() -> dict:
    return {
        "name": PLUGIN_NAME,
        "version": PLUGIN_VERSION,
        "description": "Official Codex-native public surface for the Thoth authority runtime.",
        "author": {
            "name": "SeeleAI",
            "email": "viceyzy@foxmail.com",
            "url": "https://github.com/SeeleAI",
        },
        "homepage": f"{PLUGIN_REPOSITORY}#readme",
        "repository": PLUGIN_REPOSITORY,
        "license": "MIT",
        "keywords": [
            "thoth",
            "codex",
            "claude-code",
            "agent",
            "runtime",
            "dashboard",
        ],
        "skills": PLUGIN_SKILLS_PATH,
        "interface": {
            "displayName": "Thoth",
            "shortDescription": "Single Codex entrypoint for the shared Thoth runtime.",
            "longDescription": "Operate Thoth through one $thoth command surface backed by the shared .thoth authority, durable run ledger, and dashboard-visible project state.",
            "developerName": "SeeleAI",
            "category": "Productivity",
            "capabilities": ["Read", "Write", "Execute"],
            "websiteURL": PLUGIN_REPOSITORY,
            "defaultPrompt": [
                "Show the current Thoth project status and active runs.",
                "Initialize Thoth in this repository and render project layers.",
                "Start a durable Thoth run for the current task.",
            ],
            "brandColor": "#3B82F6",
        },
    }


def sync_repository_surfaces(root: Path | None = None) -> list[Path]:
    """Render all generated repository surfaces from the canonical spec."""
    repo_root = (root or ROOT).resolve()
    written: list[Path] = []

    commands_dir = repo_root / "commands"
    commands_dir.mkdir(parents=True, exist_ok=True)
    for spec in COMMAND_SPECS:
        path = commands_dir / f"{spec.command_id}.md"
        path.write_text(render_claude_command(spec), encoding="utf-8")
        written.append(path)

    skill_path = repo_root / ".agents" / "skills" / "thoth" / "SKILL.md"
    skill_path.parent.mkdir(parents=True, exist_ok=True)
    skill_path.write_text(render_codex_skill(), encoding="utf-8")
    written.append(skill_path)

    agent_metadata_path = repo_root / ".agents" / "skills" / "thoth" / "agents" / "openai.yaml"
    agent_metadata_path.parent.mkdir(parents=True, exist_ok=True)
    agent_metadata_path.write_text(render_codex_agent_metadata(), encoding="utf-8")
    written.append(agent_metadata_path)

    plugin_path = repo_root / ".codex-plugin" / "plugin.json"
    plugin_path.parent.mkdir(parents=True, exist_ok=True)
    plugin_path.write_text(json.dumps(render_plugin_manifest(), indent=2) + "\n", encoding="utf-8")
    written.append(plugin_path)
    return written
