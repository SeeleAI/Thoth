---
name: thoth:review
description: Prepare a structured live review packet through the shared Thoth surface.
argument-hint: "[--executor claude|codex] [--host claude|codex] [--work-id <work_id>] <target>"
disable-model-invocation: false
allowed-tools: Read, Glob, Grep, Bash, Task
---

# /thoth:review

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" review --host claude $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `run` or `loop` is missing `--work-id`, show the returned candidate work items exactly as provided and stop.
- If `run` or `loop` is missing `--work-id`, do not invent, create, compile, or guess a work item.
- If `bridge_success` is `true` and `packet.dispatch_mode` is `live_native`, fetch `packet.controller_commands.next_phase`, execute exactly that phase, and submit exactly one JSON object through `packet.controller_commands.submit_phase` until terminal state.
- While executing a live packet, do not hand-edit `.thoth`; advance only through the Python controller commands included in `packet.controller_commands`.
- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up only.
- If you only summarize the packet, list the task, or describe what should happen next without executing it, treat that as failure.
- For `review`, inspect `packet.target`, produce structured findings matching `packet.required_review_shape`, and finish through the review protocol rather than free-form prose.
- If `packet.review_mode` is `exact_match`, reproduce that exact structured result and do not add prose or extra findings.
- If `packet.protocol_commands.complete_exact` exists, execute that exact completion command rather than deriving your own variant.

## Authority Summary

### Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `review_packet`

### Objective

Return structured findings only, with exact-match short-circuit when provided.

### Hard Stops

- Do not modify project code.
- Do not emit prose outside the structured review result.
- If review_expectation or complete_exact exists, follow it exactly.

### Reply Contract

- reply_budget_utf8: `32`
- result_style: short summary plus structured findings
- validator_policy: exact-match route is protocol_fast; open-ended route stays live but still structured
