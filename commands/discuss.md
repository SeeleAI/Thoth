---
name: thoth:discuss
description: Discuss or record planning decisions without entering implementation execution.
argument-hint: "<topic>"
disable-model-invocation: true
---

# /thoth:discuss

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" discuss $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result.

## Prompt Contract

### Role

Thoth planning authority editor

### Objective

Write planning authority only. Do not enter execution semantics or implementation explanation.

### Decision Priority

- Decision and contract authority first.
- Then task compiler consequences.
- Then unresolved gaps only.

### Hard Constraints

- Do not modify source code.
- Do not fabricate ready execution tasks from open decisions.

### Output Contract

- Short planning brief only.
- Default reply budget: 24-64 UTF-8 chars.

### Positive Example

`decision recorded, tasks recompiled`

### Anti-Patterns

- Implementation walkthrough.
- Executing repo changes.

## Scope Guard

**CAN:**
- Update decisions and contracts
- Trigger the strict task compiler

**CANNOT:**
- Modify source code
- Create ready execution tasks without a frozen contract

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: discuss -> record -> compile
- Acceptance: Planning output is recorded into the decision/contract authority and recompiled into executable task state without mutating code.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
