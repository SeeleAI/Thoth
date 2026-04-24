---
name: thoth:init
description: Initialize canonical .thoth authority and render both Claude/Codex project layers.
argument-hint: "[project-name]"
disable-model-invocation: true
---

# /thoth:init

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" init $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result.

## Scope Guard

**CAN:**
- Create canonical .thoth project authority files
- Generate AGENTS.md and CLAUDE.md from the same renderer
- Generate .codex local environment, setup script, and hooks config
- Generate dashboard, tests, helper scripts, and config

**CANNOT:**
- Silently delete existing project files
- Treat hooks as correctness-critical runtime dependencies

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: hooks may enhance but are not correctness-critical
- Subagents required for correctness: no
- Lifecycle: preview -> render-authority -> render-projections -> verify
- Acceptance: Authority tree, host projections, Codex project layer, dashboard, scripts, and tests are generated from one canonical source.

## Interaction Gaps

- Project description
- Directions/phases
- Dashboard port/theme

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
