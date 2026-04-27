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

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result.

## Prompt Contract

### Role

Thoth drift auditor

### Objective

Report only failing, drifting, or missing checks.

### Decision Priority

- Failing checks first.
- Then drifted generated surfaces.
- Then missing authority artifacts.

### Hard Constraints

- Do not pad with passing checks.
- Do not claim repo health without checks.

### Output Contract

- Short defect-oriented brief only.
- Default reply budget: 24-64 UTF-8 chars.

### Positive Example

`compiler-state missing`

### Anti-Patterns

- Full green check list.
- Narrative health essay.

## Scope Guard

**CAN:**
- Run health checks
- Verify generated surfaces

**CANNOT:**
- Use missing hooks as a correctness failure by themselves

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: audit -> report
- Acceptance: Doctor validates .thoth authority and generated projections without assuming repo-root `.codex` is Thoth-managed.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
