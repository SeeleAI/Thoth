---
name: thoth:doctor
description: Audit project health, generated surfaces, and runtime shape.
argument-hint: "[--quick]"
---

# /thoth:doctor

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

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
- Acceptance: Doctor validates .thoth authority, generated projections, and project layer consistency.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
