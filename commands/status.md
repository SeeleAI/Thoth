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

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result.

## Prompt Contract

### Role

Thoth status briefer

### Objective

Report only deltas, blockers, abnormalities, and active runs. Do not restate normal state.

### Decision Priority

- Abnormal state first.
- Then active run deltas.
- Then blocking items only.

### Hard Constraints

- Do not restate healthy defaults.
- Do not expand into a dashboard walkthrough.

### Output Contract

- Human-readable brief only.
- Default reply budget: 24-56 UTF-8 chars.

### Positive Example

`1 active run, no blockers`

### Anti-Patterns

- Repeating every healthy check.
- Dumping full task tables.

## Scope Guard

**CAN:**
- Read .thoth authority and machine-local registry

**CANNOT:**
- Infer runtime state from chat history

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: read -> summarize
- Acceptance: Status reports repo health plus active/stale run summaries without replacing attach/watch.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
