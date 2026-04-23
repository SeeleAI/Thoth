---
name: thoth:loop
description: Create one durable autonomous loop under the shared runtime and attach in the foreground by default.
argument-hint: "[--executor claude|codex] [--host claude|codex] [--detach] [--attach <run_id>] [--resume <run_id>] [--watch <run_id>] [--stop <run_id>] [--goal <text>]"
---

# /thoth:loop

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Scope Guard

**CAN:**
- Create or resume a durable loop run
- Attach/watch/stop through the same runtime state machine
- Delegate work to Codex without changing authority write shape

**CANNOT:**
- Run as a best-effort background loop without supervisor state
- Depend on subagents or hooks for correctness

## Runtime Contract

- Durable: yes
- Codex executor allowed: yes
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: create -> lease -> supervise -> attach/resume/watch/stop -> acceptance
- Acceptance: Loop lifecycle is durable and recoverable through attach/resume/watch/stop backed by the same run ledger shape as run.

## Interaction Gaps

- Goal or mode details

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
