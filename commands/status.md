---
name: thoth:status
description: Show repo status and active durable runs from the shared ledger.
argument-hint: "[--json]"
disable-model-invocation: true
---

# /thoth:status

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" status $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result.

## Scope Guard

**CAN:**
- Read .thoth authority and machine-local registry

**CANNOT:**
- Infer runtime state from chat history

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: read -> summarize
- Acceptance: Status reports repo health plus active/stale run summaries without replacing attach/watch.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
