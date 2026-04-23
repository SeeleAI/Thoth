---
name: thoth:status
description: Show repo status and active durable runs from the shared ledger.
argument-hint: "[--json]"
---

# /thoth:status

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

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
