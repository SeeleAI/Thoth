---
name: thoth:report
description: Build a structured report from the current authority state.
argument-hint: "[--format md|json]"
---

# /thoth:report

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Scope Guard

**CAN:**
- Read project authority and ledgers

**CANNOT:**
- Invent missing evidence

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: collect -> render
- Acceptance: Report is derived from current ledgers and project docs rather than session memory.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
