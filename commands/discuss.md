---
name: thoth:discuss
description: Discuss or record planning decisions without entering implementation execution.
argument-hint: "<topic>"
disable-model-invocation: false
---

# /thoth:discuss

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" discuss $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `run` or `loop` is missing `--work-id`, show the returned candidate work items exactly as provided and stop.
- If `run` or `loop` is missing `--work-id`, do not invent, create, compile, or guess a work item.
- If `bridge_success` is `true` and runtime events are present, summarize progress, terminal status, and risk from those events only.
- Do not hand-edit `.thoth` or manually call runtime protocol commands; the Thoth RuntimeDriver advances phases.
- If `packet.dispatch_mode` is `external_worker`, do not duplicate the work locally; report the run id, worker mode, and the correct follow-up only.
- If you only describe what should happen next instead of reporting the executed runtime result, treat that as failure.

## Authority Summary

### Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `command_packet`

### Objective

Make the smallest correct planning-authority update and recompile tasks.

### Hard Stops

- Do not modify source code.
- Do not fabricate ready execution tasks from unresolved decisions.
- Do not repeat the packet or decision payload verbatim.

### Reply Contract

- reply_budget_utf8: `64`
- result_style: brief planning receipt
- validator_policy: planning authority plus compiler output decide completion
