---
name: thoth:sync
description: Synchronize generated surfaces and project projections from their canonical sources.
argument-hint: ""
disable-model-invocation: true
---

# /thoth:sync

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" sync $ARGUMENTS
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

Report whether generated surfaces are in sync and what changed.

### Hard Stops

- Do not narrate unchanged surfaces.
- Do not hand-maintain generated semantics.

### Reply Contract

- reply_budget_utf8: `60`
- result_style: brief sync receipt
- validator_policy: canonical renderers define parity
