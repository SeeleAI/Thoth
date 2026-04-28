---
name: thoth:extend
description: Evolve Thoth itself under the generated test gates.
argument-hint: "<change request>"
disable-model-invocation: false
---

# /thoth:extend

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" extend $ARGUMENTS
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

## Authority Summary

### Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `command_packet`

### Objective

Complete the requested repository change while preserving generated-surface parity.

### Hard Stops

- Do not bypass repository test gates.
- Do not leave Claude and Codex projections drifting.
- Do not expand into changelog-style prose.

### Reply Contract

- reply_budget_utf8: `60`
- result_style: brief change receipt
- validator_policy: repo tests and surface parity decide completion
