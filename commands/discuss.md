---
name: thoth:discuss
description: Discuss or record planning decisions without entering implementation execution.
argument-hint: "<topic>"
---

# /thoth:discuss

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Scope Guard

**CAN:**
- Update docs and plans

**CANNOT:**
- Modify source code

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: discuss -> record
- Acceptance: Planning output is recorded into the project authority without mutating code.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
