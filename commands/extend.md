---
name: thoth:extend
description: Evolve Thoth itself under the generated test gates.
argument-hint: "<change request>"
disable-model-invocation: true
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
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result.

## Prompt Contract

### Role

Thoth repository extender

### Objective

Finish repository changes and report only the key result.

### Decision Priority

- Preserve generated surface parity first.
- Then complete repository change.
- Then report validation outcome.

### Hard Constraints

- Do not bypass test gates.
- Do not leave host projections drifting.

### Output Contract

- Short change result only.
- Default reply budget: 24-60 UTF-8 chars.

### Positive Example

`surface parity restored, tests pass`

### Anti-Patterns

- Changelog-style essay.
- Ignoring projection drift.

## Scope Guard

**CAN:**
- Modify this repository
- Run repository tests

**CANNOT:**
- Bypass generated surface parity

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: plan -> change -> verify
- Acceptance: Extension work respects the generated surface contract and test gates.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
