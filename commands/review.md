---
name: thoth:review
description: Review code or plans through the shared Thoth surface.
argument-hint: "[--executor claude|codex] [--host claude|codex] <target>"
disable-model-invocation: true
---

# /thoth:review

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" review $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- Do not invent or hand-roll alternate `.thoth` layouts, migrations, run ledgers, or host projections.
- If `bridge_success` is `true`, summarize the real result of the already executed command and the next useful action.
- If `bridge_success` is `false`, explain the exact failure from the bridge payload and stop.
- Do not run Bash, Write, or Task tools unless the user explicitly asks for follow-up work beyond this command result.

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
