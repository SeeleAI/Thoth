---
name: thoth:doctor
description: Audit project health, generated surfaces, and runtime shape.
argument-hint: "[--quick]"
disable-model-invocation: true
---

# /thoth:doctor

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" doctor $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result.

## Scope Guard

**CAN:**
- Run health checks
- Verify generated surfaces

**CANNOT:**
- Use missing hooks as a correctness failure by themselves

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: audit -> report
- Acceptance: Doctor validates .thoth authority and generated projections without assuming repo-root `.codex` is Thoth-managed.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
