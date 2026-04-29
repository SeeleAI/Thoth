"""Render host-specific projections from the host-neutral Thoth command specs."""

from __future__ import annotations

import json
from pathlib import Path

from .command_specs import COMMAND_SPECS, CommandSpec, PUBLIC_CODEX_COMMANDS
from .prompt_specs import render_codex_command_micro_prompt, render_command_contract_markdown


ROOT = Path(__file__).resolve().parent.parent
PLUGIN_NAME = "thoth"
PLUGIN_VERSION = "0.1.4"
PLUGIN_REPOSITORY = "https://github.com/SeeleAI/Thoth"
PLUGIN_PACKAGE_DIR = "plugins/thoth"
PLUGIN_SKILLS_PATH = "./skills"


def _frontmatter_allowed_tools(spec: CommandSpec) -> str:
    if not spec.allowed_tools:
        return ""
    return f"allowed-tools: {', '.join(spec.allowed_tools)}\n"


def _claude_bridge_rules(spec: CommandSpec) -> str:
    if spec.route_class == "mechanical_fast":
        return """- Treat the structured bridge payload above as the only authority for this invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result in one short receipt.
- Do not expand into runtime explanation, walkthroughs, or extra command execution."""
    rules = [
        "- Treat the structured bridge payload above as the only authority for this command invocation.",
        "- If `bridge_success` is `false`, report the exact bridge failure and stop.",
        "- If `run` or `loop` is missing `--work-id`, show the returned candidate work items exactly as provided and stop.",
        "- If `run` or `loop` is missing `--work-id`, do not invent, create, compile, or guess a work item.",
        "- If `bridge_success` is `true` and `packet.dispatch_mode` is `live_native`, fetch `packet.controller_commands.next_phase`, execute exactly that phase, and submit exactly one JSON object through `packet.controller_commands.submit_phase` until terminal state.",
        "- While executing a live packet, do not hand-edit `.thoth`; advance only through the Python controller commands included in `packet.controller_commands`.",
        "- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up only.",
        "- If you only summarize the packet, list the task, or describe what should happen next without executing it, treat that as failure.",
    ]
    if spec.command_id in {"run", "loop"}:
        rules.extend(
            (
                "- If `packet.executor == codex`, the substantive execution must really flow through Codex rather than being silently done by Claude.",
                "- Default child lifecycle is `execute -> validate`; `reflect` appears only after validator failure.",
                "- Use `packet.strict_task.goal_statement`, `packet.strict_task.implementation_recipe`, and `packet.strict_task.eval_entrypoint` as the only task authority.",
                "- Prefer running `packet.strict_task.eval_entrypoint.command` exactly as provided rather than inventing a parallel validator lifecycle.",
            )
        )
    if spec.command_id == "review":
        rules.append(
            "- For `review`, inspect `packet.target`, produce structured findings matching `packet.required_review_shape`, and finish through the review protocol rather than free-form prose."
        )
        rules.append(
            "- If `packet.review_mode` is `exact_match`, reproduce that exact structured result and do not add prose or extra findings."
        )
        rules.append(
            "- If `packet.protocol_commands.complete_exact` exists, execute that exact completion command rather than deriving your own variant."
        )
    return "\n".join(rules)


def render_claude_command(spec: CommandSpec) -> str:
    runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} $ARGUMENTS'
    live_packet_contract = spec.intelligence_tier == "high"
    disable_model_invocation = "false" if live_packet_contract else "true"
    if spec.command_id == "review":
        runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} --host claude $ARGUMENTS'
    elif spec.command_id in {"run", "loop"}:
        runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} --host claude $ARGUMENTS'
    response_contract = _claude_bridge_rules(spec)
    prompt_contract = render_command_contract_markdown(spec.command_id, heading_level=3).strip()
    return f"""---
name: thoth:{spec.command_id}
description: {spec.summary}
argument-hint: "{spec.argument_hint}"
disable-model-invocation: {disable_model_invocation}
{_frontmatter_allowed_tools(spec)}---

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

{response_contract}

## Authority Summary

{prompt_contract}
"""


def render_codex_skill() -> str:
    command_lines = "\n".join(f"- `$thoth {spec.command_id}`: {spec.summary}" for spec in COMMAND_SPECS)
    route_lines = "\n".join(
        f"- `{spec.command_id}` -> `{spec.route_class}` / `{spec.intelligence_tier}` / `{spec.packet_authority_mode}`"
        for spec in COMMAND_SPECS
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

## Dispatcher

- `.thoth` is the only runtime authority.
- Parse the requested `$thoth <command>`, then open only the matching micro prompt under `./commands/<command>.md`.
- Execute the literal shell command immediately; do not replace it with explanation.
- If the plugin-installed `thoth` wrapper is missing in a fresh environment, treat that as host install drift.
- Do not create alternative public Codex variants such as `run:codex` or `loop:codex`.

## Route Table

{route_lines}

## Shared Rules

- `init`, `status`, `doctor`, `dashboard`, `sync`, and `report` are mechanical fast-path commands and should return only short receipts.
- `discuss`, `extend`, `run`, `loop`, and open-ended `review` are high-intelligence paths.
- `review` exact-match/probe flows are protocol-fast: if the packet exposes an exact result, do not improvise.
- `run` and `loop` are validator-centered: default lifecycle is `execute -> validate`, and `reflect` appears only after validator failure.
- Host hooks and subagents may improve throughput but are never correctness requirements.
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


def render_codex_marketplace() -> dict:
    return {
        "name": PLUGIN_NAME,
        "interface": {
            "displayName": "Thoth",
        },
        "owner": {
            "name": "SeeleAI",
            "url": "https://github.com/SeeleAI",
        },
        "plugins": [
            {
                "name": PLUGIN_NAME,
                "source": {
                    "source": "local",
                    "path": f"./{PLUGIN_PACKAGE_DIR}",
                },
                "policy": {
                    "installation": "AVAILABLE",
                    "authentication": "ON_INSTALL",
                },
                "category": "Productivity",
            }
        ],
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

    plugin_root = repo_root / PLUGIN_PACKAGE_DIR
    plugin_skill_path = plugin_root / "skills" / "thoth" / "SKILL.md"
    plugin_skill_path.parent.mkdir(parents=True, exist_ok=True)
    plugin_skill_path.write_text(render_codex_skill(), encoding="utf-8")
    written.append(plugin_skill_path)

    plugin_commands_dir = plugin_root / "skills" / "thoth" / "commands"
    plugin_commands_dir.mkdir(parents=True, exist_ok=True)
    for spec in COMMAND_SPECS:
        command_path = plugin_commands_dir / f"{spec.command_id}.md"
        command_path.write_text(render_codex_command_micro_prompt(spec.command_id), encoding="utf-8")
        written.append(command_path)

    plugin_agent_metadata_path = plugin_root / "skills" / "thoth" / "agents" / "openai.yaml"
    plugin_agent_metadata_path.parent.mkdir(parents=True, exist_ok=True)
    plugin_agent_metadata_path.write_text(render_codex_agent_metadata(), encoding="utf-8")
    written.append(plugin_agent_metadata_path)

    plugin_path = plugin_root / ".codex-plugin" / "plugin.json"
    plugin_path.parent.mkdir(parents=True, exist_ok=True)
    plugin_path.write_text(json.dumps(render_plugin_manifest(), indent=2) + "\n", encoding="utf-8")
    written.append(plugin_path)

    marketplace_path = repo_root / ".agents" / "plugins" / "marketplace.json"
    marketplace_path.parent.mkdir(parents=True, exist_ok=True)
    marketplace_path.write_text(json.dumps(render_codex_marketplace(), indent=2) + "\n", encoding="utf-8")
    written.append(marketplace_path)
    return written
