---
name: thoth:dashboard
description: Start or describe the task-first dashboard backed by .thoth ledgers.
argument-hint: "[--port <port>]"
disable-model-invocation: true
---

# /thoth:dashboard

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" dashboard $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result.

## Scope Guard

**CAN:**
- Start the dashboard
- Report dashboard endpoints

**CANNOT:**
- Read host session state as runtime truth

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: serve
- Acceptance: Dashboard reads .thoth/runs data only and renders host/executor/runtime distinctions explicitly.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
