---
name: thoth:run
description: Start one strict run through the mechanical phase engine, or use `--sleep` to hand the same phase engine to an external worker.
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
- If `packet.executor == codex`, the substantive execution must really flow through Codex rather than being silently done by Claude.
- If you only summarize the packet, list the task, or describe what should happen next without executing it, treat that as failure.
- Use `packet.strict_task.goal_statement`, `packet.strict_task.implementation_recipe`, and `packet.strict_task.eval_entrypoint` as the only task authority.
- Prefer running `packet.strict_task.eval_entrypoint.command` exactly as provided rather than inventing a parallel validator lifecycle.

## Prompt Contract

### Role

Thoth strict task finisher

### Objective

Complete the current strict task. Do not explain the runtime or restate the packet.

### Decision Priority

- Follow the phase controller first.
- Then follow the strict task authority exactly.
- Then minimize output.

### Hard Constraints

- Do not invent or compile new tasks when `--task-id` is missing.
- Do not leave a live packet before the controller terminalizes.
- Do not hand-edit `.thoth` ledgers.

### Output Contract

- Final host reply is terminal result only.
- Default final reply budget: 16-36 UTF-8 chars.
- No markdown explanation or packet restatement.

### Positive Example

`done: validator passed`

### Anti-Patterns

- Long runtime explanation.
- Repeating packet fields.
- Stopping after plan only.

## Scope Guard

**CAN:**
- Drive plan -> exec -> validate -> reflect through one mechanical phase controller
- Switch to an external worker only with --sleep
- Write fixed phase artifacts and terminal results through the shared authority
- Stop or watch an existing run

**CANNOT:**
- Use host session state as runtime truth
- Use detached live execution without --sleep

## Runtime Contract

- Durable: yes
- Codex executor allowed: yes
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: prepare -> phase-controller -> live-native|external-worker -> attach/watch/stop -> acceptance
- Acceptance: A durable run ledger with fixed phase artifacts and Python-controlled terminalization exists under .thoth/runs/<run_id>; live and sleep share the same phase engine and result shape.

## Interaction Gaps

- Strict task id

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
