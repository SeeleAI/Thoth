---
name: thoth:run
description: Create one durable run under the shared runtime and attach in the foreground by default.
argument-hint: "[--executor claude|codex] [--host claude|codex] [--detach] [--attach <run_id>] [--watch <run_id>] [--stop <run_id>] <task>"
disable-model-invocation: true
---

# /thoth:run

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" run $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result.

## Scope Guard

**CAN:**
- Create a durable run and attach to it
- Delegate execution to Codex through the shared runtime path
- Write run/state/events/acceptance/artifacts ledgers
- Stop or watch an existing run

**CANNOT:**
- Use host session state as runtime truth
- Create a non-durable foreground-only pseudo run

## Runtime Contract

- Durable: yes
- Codex executor allowed: yes
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: create -> lease -> supervise -> attach/watch/stop -> acceptance
- Acceptance: A durable run ledger exists under .thoth/runs/<run_id> with machine-local supervisor state and mechanical acceptance placeholders.

## Interaction Gaps

- Task text or task id

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
