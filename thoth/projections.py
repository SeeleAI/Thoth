"""Render host-specific projections from the host-neutral Thoth command specs."""

from __future__ import annotations

import json
from pathlib import Path

from .command_specs import COMMAND_SPECS, CommandSpec, PUBLIC_CODEX_COMMANDS
from .prompt_specs import render_command_contract_markdown


ROOT = Path(__file__).resolve().parent.parent
PLUGIN_NAME = "thoth"
PLUGIN_VERSION = "0.1.4"
PLUGIN_REPOSITORY = "https://github.com/SeeleAI/Thoth"
PLUGIN_PACKAGE_DIR = "plugins/thoth"
PLUGIN_SKILLS_PATH = "./skills"


def _bullet_lines(items: tuple[str, ...]) -> str:
    if not items:
        return "- (none)\n"
    return "".join(f"- {item}\n" for item in items)


def _frontmatter_allowed_tools(spec: CommandSpec) -> str:
    if not spec.allowed_tools:
        return ""
    return f"allowed-tools: {', '.join(spec.allowed_tools)}\n"


def _claude_bridge_rules(spec: CommandSpec) -> str:
    if spec.command_id not in {"run", "loop", "review"}:
        return """- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result."""
    rules = [
        "- Treat the structured bridge payload above as the only authority for this command invocation.",
        "- If `bridge_success` is `false`, report the exact bridge failure and stop.",
        "- If `run` or `loop` is missing `--task-id`, show the returned candidate tasks exactly as provided and stop.",
        "- If `run` or `loop` is missing `--task-id`, do not invent, create, compile, or guess a task.",
        "- If `bridge_success` is `true` and `packet.dispatch_mode` is `live_native`, fetch `packet.controller_commands.next_phase`, execute exactly that phase, and submit exactly one JSON object through `packet.controller_commands.submit_phase` until terminal state.",
        "- While executing a live packet, do not hand-edit `.thoth`; advance only through the Python controller commands included in `packet.controller_commands`.",
        "- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up only.",
        "- If you only summarize the packet, list the task, or describe what should happen next without executing it, treat that as failure.",
    ]
    if spec.command_id in {"run", "loop"}:
        rules.extend(
            (
                "- If `packet.executor == codex`, the substantive execution must really flow through Codex rather than being silently done by Claude.",
                "- Use `packet.strict_task.goal_statement`, `packet.strict_task.implementation_recipe`, and `packet.strict_task.eval_entrypoint` as the only task authority.",
                "- Prefer running `packet.strict_task.eval_entrypoint.command` exactly as provided rather than inventing a parallel validator lifecycle.",
            )
        )
    if spec.command_id == "review":
        rules.append(
            "- For `review`, inspect `packet.target`, produce structured findings matching `packet.required_review_shape`, and finish through the review protocol rather than free-form prose."
        )
        rules.append(
            "- If `packet.strict_task.review_expectation` exists, reproduce that exact structured result and do not add prose or extra findings."
        )
        rules.append(
            "- If `packet.protocol_commands.complete_exact` exists, execute that exact completion command rather than deriving your own variant."
        )
        rules.append(
            "- For `review`, do not write `.thoth/runs/*/result.json`, `state.json`, or other ledger files directly; only use `packet.protocol_commands.heartbeat`, `packet.protocol_commands.complete`, or `packet.protocol_commands.fail`."
        )
        rules.append(
            "- When finishing a review run, call `packet.protocol_commands.complete` with `--result-json` set to the final review object and `--checks-json` marking the exact-match review check as passing."
        )
        rules.append(
            "- For `review`, `--summary` must stay a short plain string only; never put the structured review JSON into `--summary`."
        )
        rules.append(
            "- Do not inspect Thoth CLI source, help text, or protocol implementation files; the packet and target file already define the contract."
        )
        rules.append(
            "- If `packet.strict_task.review_expectation` exists, do not inspect or invoke Codex CLI; submit that exact review object through the packet protocol and stop."
        )
        rules.append(
            "- If `packet.strict_task.review_expectation` exists, do not run `--help`, `which`, `codex`, `grep`, or any extra discovery command; only use the packet protocol command(s), the strict task eval entrypoint, and minimal target reads."
        )
    return "\n".join(rules)


def _codex_command_contracts() -> str:
    sections = []
    for spec in COMMAND_SPECS:
        sections.append(f"### `$thoth {spec.command_id}`")
        sections.append(render_command_contract_markdown(spec.command_id, heading_level=4).strip())
    return "\n\n".join(sections)


def render_claude_command(spec: CommandSpec) -> str:
    lifecycle = " -> ".join(spec.lifecycle) if spec.lifecycle else "n/a"
    runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} $ARGUMENTS'
    live_packet_contract = spec.command_id in {"run", "loop", "review"}
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

## Prompt Contract

{prompt_contract}

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
    command_contracts = _codex_command_contracts()
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
- `run` and `loop` are durable by default, expose a Python phase controller in-session, and only switch to a background worker with `--sleep`.
- `review` also uses a live packet and must end with structured findings, not vague prose.
- Host hooks and subagents may enhance throughput but are never correctness requirements.
- Do not create alternative public Codex skill variants such as `run:codex` or `loop:codex`.

## Execution Guidance

- In an ordinary plugin-installed environment, the install should provide a PATH-level `thoth` wrapper that resolves back to the installed plugin payload.
- Use that wrapper for shell execution in fresh repos or empty directories, including `thoth init` and `thoth dashboard start`.
- When the current workspace is this Thoth source repository itself, prefer the repo-local CLI implementation over the installed wrapper so execution stays pinned to the checked-out code.
- In that source-repo case, invoke commands from the repository root with `python -m thoth.cli <command>` and ensure `PYTHONPATH` includes the repository root.
- If the plugin-installed wrapper is missing from PATH in a fresh environment, treat that as host install drift rather than silently rewriting the public surface into a different entrypoint.
- If `run` or `loop` is called without `--task-id`, do not create a task, do not guess a task id, and do not touch code. Surface the returned candidate tasks and stop.
- For `run` and `loop`, treat the printed JSON packet as a phase controller contract: repeatedly fetch the next phase, execute exactly that phase, and submit one JSON object back through the controller until it terminalizes.
- A live packet is incomplete until the controller reaches a terminal state; printing or paraphrasing the packet alone is a failure, not a success.
- For `run` and `loop`, execute the strict task recipe and validator entrypoint rather than stopping at task interpretation.

## Command Contracts

{command_contracts}
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
