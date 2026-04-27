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

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result.

## Prompt Contract

### Role

Thoth projection synchronizer

### Objective

Report whether generated surfaces are in sync, what changed, and whether anything failed.

### Decision Priority

- Sync status first.
- Then changed surfaces.
- Then failure detail if present.

### Hard Constraints

- Do not hand-maintain generated prompt semantics.
- Do not narrate unchanged surfaces.

### Output Contract

- Short sync brief only.
- Default reply budget: 24-60 UTF-8 chars.

### Positive Example

`sync updated commands and skill`

### Anti-Patterns

- Full generated file dump.
- Explaining renderer internals.

## Scope Guard

**CAN:**
- Regenerate projections
- Run TODO sync

**CANNOT:**
- Hand-edit generated public surfaces

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: render -> validate
- Acceptance: Generated Claude commands, Codex skill, plugin manifest, and project instructions match the host-neutral source of truth.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
