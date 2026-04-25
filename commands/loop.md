---
name: thoth:loop
description: Prepare one strict loop packet for live in-session iteration, or use `--sleep` to hand it to an external worker.
argument-hint: "[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--resume <run_id>] [--watch <run_id>] [--stop <run_id>] --task-id <task_id>"
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Edit, Write, Bash, Task
---

# /thoth:loop

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" loop --host claude $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
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
- If you only summarize the packet, list the task, or say what should happen next without executing it, treat that as failure and call `fail` with the exact blocker.

## Scope Guard

**CAN:**
- Create or resume a durable loop packet
- Attach/watch/stop through the same runtime state machine
- Delegate work to Codex without changing authority write shape

**CANNOT:**
- Use detached live execution without --sleep
- Depend on subagents or hooks for correctness

## Runtime Contract

- Durable: yes
- Codex executor allowed: yes
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: prepare -> live-native|external-worker -> protocol-update -> attach/resume/watch/stop -> acceptance
- Acceptance: Loop lifecycle is durable and recoverable through attach/resume/watch/stop, live mode stays inside the current host session, and heavy acceptance expects bounded rounds/time rather than unbounded supervisor churn.

## Interaction Gaps

- Strict task id

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
