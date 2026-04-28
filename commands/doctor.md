---
name: thoth:doctor
description: Audit project health, generated surfaces, and runtime shape.
argument-hint: "[--quick]"
disable-model-invocation: true
---

# /thoth:doctor

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" doctor $ARGUMENTS
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

Report only failing, drifting, or missing checks.

### Hard Stops

- Do not pad with passing checks.
- Do not claim repo health without checks.

### Reply Contract

- reply_budget_utf8: `64`
- result_style: brief defect receipt
- validator_policy: authority and generated surfaces decide health
