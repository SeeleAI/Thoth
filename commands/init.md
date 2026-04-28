---
name: thoth:init
description: Initialize canonical .thoth authority and render both host projections without taking ownership of repo-root `.codex`.
argument-hint: "[project-name]"
disable-model-invocation: true
---

# /thoth:init

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" init $ARGUMENTS
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

Report audit-first adopt/init outcome, generated artifacts, and blockers only.

### Hard Stops

- Do not assume the repo is blank.
- Do not narrate the full migration procedure.

### Reply Contract

- reply_budget_utf8: `60`
- result_style: brief outcome receipt
- validator_policy: preview and generated artifacts define success
