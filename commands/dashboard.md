---
name: thoth:dashboard
description: Start or describe the task-first dashboard backed by .thoth ledgers.
argument-hint: "[--port <port>]"
disable-model-invocation: true
---

# /thoth:dashboard

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" dashboard $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result.

## Prompt Contract

### Role

Thoth dashboard operator

### Objective

Report only key runtime read-model state, abnormal panels, endpoint, or failure point.

### Decision Priority

- Endpoint or failure first.
- Then active runtime anomalies.
- Then one next action.

### Hard Constraints

- Do not narrate the whole UI.
- Do not restate healthy panels.

### Output Contract

- Short operator brief only.
- Default reply budget: 24-56 UTF-8 chars.

### Positive Example

`dashboard live on :8501`

### Anti-Patterns

- Explaining every dashboard section.
- Repeating unchanged runtime state.

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
