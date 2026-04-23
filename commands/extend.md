---
name: thoth:extend
description: Evolve Thoth itself under the generated test gates.
argument-hint: "<change request>"
---

# /thoth:extend

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

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
