---
name: thoth:status
description: Show repo status and active durable runs from the shared ledger.
argument-hint: "[--json]"
disable-model-invocation: true
---

# /thoth:status

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" status $ARGUMENTS
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

Report only abnormal state, blockers, and active run deltas.

### Hard Stops

- Do not restate healthy defaults.
- Do not expand into a dashboard walkthrough.

### Reply Contract

- reply_budget_utf8: `56`
- result_style: brief receipt
- validator_policy: runtime truth comes from current authority only
