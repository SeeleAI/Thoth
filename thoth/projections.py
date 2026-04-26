"""Render host-specific projections from the host-neutral Thoth command specs."""

from __future__ import annotations

import json
from pathlib import Path

from .command_specs import COMMAND_SPECS, CommandSpec, PUBLIC_CODEX_COMMANDS


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


def render_claude_command(spec: CommandSpec) -> str:
    lifecycle = " -> ".join(spec.lifecycle) if spec.lifecycle else "n/a"
    runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} $ARGUMENTS'
    live_packet_contract = spec.command_id in {"run", "loop", "review"}
    disable_model_invocation = "false" if live_packet_contract else "true"
    if spec.command_id == "review":
        runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} --host claude $ARGUMENTS'
    elif spec.command_id in {"run", "loop"}:
        runtime_invocation = f'"${{CLAUDE_PLUGIN_ROOT}}/scripts/thoth-claude-command.sh" {spec.command_id} --host claude $ARGUMENTS'
    response_contract = """- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result."""
    if live_packet_contract:
        response_contract = """- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- If `bridge_success` is `true` and `packet.dispatch_mode` is `live_native`, the command is NOT finished yet: execute `packet` in this Claude session using native tool use or subagents as needed.
- For `run` and `loop`, use `packet.strict_task.goal_statement`, `packet.strict_task.implementation_recipe`, and `packet.strict_task.eval_entrypoint` as the task contract; do real code edits, run the relevant validators, and do not stop after merely restating the packet.
- Prefer running `packet.strict_task.eval_entrypoint.command` exactly as provided; do not hand-roll a parallel service lifecycle when the packet already gives a validator entrypoint.
- If `packet.executor` is `codex`, the substantive execution must really flow through Codex from this Claude session. Do not silently do the work yourself and then claim Codex parity.
- For `packet.executor == codex`, use the installed Codex surface or `codex exec` from Bash to perform the requested run/review work, keep the Thoth ledger writes in this session, and preserve the same `packet` / acceptance shape.
- While executing a live packet, keep `.thoth` updated only through the internal runtime protocol commands included in `packet.protocol_commands`.
- End the command only after the protocol reaches a terminal state via `complete` or `fail`; leaving the run in `prepared` or `running` without a terminal protocol write is a contract violation.
- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up (`status`, `watch`, `dashboard`, or `report`).
- For `review`, inspect `packet.target`, produce structured findings matching `packet.required_review_shape`, and finish by writing them through the protocol rather than free-form narration only.
- For `review` with `packet.executor == codex`, make Codex inspect `packet.target`, then write the resulting structured findings through `packet.protocol_commands.complete` instead of returning prose only.
- If you only summarize the packet, list the task, or say what should happen next without executing it, treat that as failure and call `fail` with the exact blocker."""
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
- `run` and `loop` are durable by default, prepare live packets in-session, and only switch to a background worker with `--sleep`.
- `review` also uses a live packet and must end with structured findings, not vague prose.
- Host hooks and subagents may enhance throughput but are never correctness requirements.
- Do not create alternative public Codex skill variants such as `run:codex` or `loop:codex`.

## Execution Guidance

- When the current workspace is this Thoth repository itself, prefer the repo-local CLI implementation over any globally installed `thoth` binary.
- In that case, invoke commands from the repository root with `python -m thoth.cli <command>` and ensure `PYTHONPATH` includes the repository root.
- Only rely on a PATH-level `thoth` binary when you have already verified it resolves to the same checked-out repository code.
- For `run`, `loop`, and `review`, treat the printed JSON packet as an execution contract: keep progress/heartbeat/events synced with the internal protocol commands until you call `complete` or `fail`.
- A live packet is incomplete until it reaches a terminal protocol write; printing or paraphrasing the packet alone is a failure, not a success.
- For `run` and `loop`, execute the strict task recipe and validator entrypoint rather than stopping at task interpretation.
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
