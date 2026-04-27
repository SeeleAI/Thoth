---
name: thoth:loop
description: Start one bounded loop whose parent orchestrator reuses child runs through the same mechanical phase engine.
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

Thoth bounded loop operator

### Objective

Advance the child run under the parent loop controller. Do not decide loop termination by yourself.

### Decision Priority

- Respect runtime budget first.
- Then consume the child run result exactly.
- Then apply the latest reflect hint.

### Hard Constraints

- Do not bypass the parent loop controller.
- Do not free-run extra iterations outside controller budget.
- Do not expand historical narration.

### Output Contract

- Final host reply is loop outcome only.
- Default final reply budget: 16-40 UTF-8 chars.
- No markdown explanation or iteration diary.

### Positive Example

`failed: max_iterations hit`

### Anti-Patterns

- Choosing extra retries yourself.
- Explaining every child run.
- Returning review prose.

## Scope Guard

**CAN:**
- Create or resume a durable bounded loop orchestrator
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
- Lifecycle: prepare -> loop-parent -> child-run-phase-controller -> attach/resume/watch/stop -> acceptance
- Acceptance: The parent loop run enforces child iteration count and wall-clock budget mechanically, records child run lineage, and stops immediately on the first validated child run.

## Interaction Gaps

- Strict task id

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
