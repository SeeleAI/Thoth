---
name: thoth:loop
description: Create one durable autonomous loop under the shared runtime and attach in the foreground by default.
argument-hint: "[--executor claude|codex] [--host claude|codex] [--detach] [--attach <run_id>] [--resume <run_id>] [--watch <run_id>] [--stop <run_id>] --task-id <task_id>"
disable-model-invocation: true
---

# /thoth:loop

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" loop $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result.

## Scope Guard

**CAN:**
- Create or resume a durable loop run
- Attach/watch/stop through the same runtime state machine
- Delegate work to Codex without changing authority write shape

**CANNOT:**
- Run as a best-effort background loop without supervisor state
- Depend on subagents or hooks for correctness

## Runtime Contract

- Durable: yes
- Codex executor allowed: yes
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: create -> lease -> supervise -> attach/resume/watch/stop -> acceptance
- Acceptance: Loop lifecycle is durable and recoverable through attach/resume/watch/stop, and loop creation only starts from a compiler-generated strict task.

## Interaction Gaps

- Strict task id

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
