---
name: thoth:run
description: Start one validator-centered strict run, or use `--sleep` to hand the same controller to an external worker.
argument-hint: "[--executor claude|codex] [--host claude|codex] [--sleep] [--attach <run_id>] [--watch <run_id>] [--stop <run_id>] --task-id <task_id>"
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Edit, Write, Bash, Task
---

# /thoth:run

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" run --host claude $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `run` or `loop` is missing `--task-id`, show the returned candidate tasks exactly as provided and stop.
- If `run` or `loop` is missing `--task-id`, do not invent, create, compile, or guess a task.
- If `bridge_success` is `true` and `packet.dispatch_mode` is `live_native`, fetch `packet.controller_commands.next_phase`, execute exactly that phase, and submit exactly one JSON object through `packet.controller_commands.submit_phase` until terminal state.
- While executing a live packet, do not hand-edit `.thoth`; advance only through the Python controller commands included in `packet.controller_commands`.
- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up only.
- If you only summarize the packet, list the task, or describe what should happen next without executing it, treat that as failure.
- If `packet.executor == codex`, the substantive execution must really flow through Codex rather than being silently done by Claude.
- Default child lifecycle is `execute -> validate`; `reflect` appears only after validator failure.
- Use `packet.strict_task.goal_statement`, `packet.strict_task.implementation_recipe`, and `packet.strict_task.eval_entrypoint` as the only task authority.
- Prefer running `packet.strict_task.eval_entrypoint.command` exactly as provided rather than inventing a parallel validator lifecycle.

## Authority Summary

### Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

### Objective

Finish the current strict task through the validator-centered controller.

### Hard Stops

- Do not invent or compile a new task when --task-id is missing.
- Do not stop after reading the packet; terminalize through controller commands only.
- Do not hand-edit .thoth ledgers.

### Reply Contract

- reply_budget_utf8: `36`
- result_style: terminal receipt only
- validator_policy: execute first, validator decides completion, reflect only after validator failure
