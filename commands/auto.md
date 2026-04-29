---
name: thoth:auto
description: Create a linear controller queue for multiple ready work items.
argument-hint: "--mode run|loop --work-id <work_id> [--work-id <work_id> ...]"
disable-model-invocation: true
---

# /thoth:auto

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" auto $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result in one short receipt.
- Do not expand into runtime explanation, walkthroughs, or extra command execution.

## Authority Summary

### Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

### Objective

Create a linear controller queue over ready work items.

### Hard Stops

- Do not create private queue files.
- Do not execute work while creating the controller.

### Reply Contract

- reply_budget_utf8: `56`
- result_style: brief queue receipt
- validator_policy: controller object cursor defines queue state
