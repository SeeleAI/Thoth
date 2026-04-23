---
name: thoth:sync
description: Synchronize generated surfaces and project projections from their canonical sources.
argument-hint: ""
---

# /thoth:sync

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

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
