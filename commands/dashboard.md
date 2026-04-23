---
name: thoth:dashboard
description: Start or describe the task-first dashboard backed by .thoth ledgers.
argument-hint: "[--port <port>]"
---

# /thoth:dashboard

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Scope Guard

**CAN:**
- Start the dashboard
- Report dashboard endpoints

**CANNOT:**
- Read host session state as runtime truth

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: serve
- Acceptance: Dashboard reads .thoth/runs data only and renders host/executor/runtime distinctions explicitly.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
