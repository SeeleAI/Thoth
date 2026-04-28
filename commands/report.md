---
name: thoth:report
description: Build a structured report from the current authority state.
argument-hint: "[--format md|json]"
disable-model-invocation: true
---

# /thoth:report

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" report $ARGUMENTS
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

Compress the current authority state into one short report outcome.

### Hard Stops

- Do not replay the full run log.
- Do not invent missing evidence.

### Reply Contract

- reply_budget_utf8: `80`
- result_style: brief receipt with output path
- validator_policy: report must stay authority-derived
