---
name: thoth:review
description: Review code or plans through the shared Thoth surface.
argument-hint: "[--executor claude|codex] [--host claude|codex] <target>"
---

# /thoth:review

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Scope Guard

**CAN:**
- Read code and documents
- Delegate review to Codex

**CANNOT:**
- Modify project code
- Claim acceptance without evidence

## Runtime Contract

- Durable: no
- Codex executor allowed: yes
- Hooks required for correctness: no
- Subagents required for correctness: no
- Lifecycle: analyze -> report
- Acceptance: Findings are reported without mutating source code, while preserving executor parity.

## Interaction Gaps

- (none)

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
