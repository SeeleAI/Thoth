---
name: thoth:report
description: Build a structured report from the current authority state.
argument-hint: "[--format md|json]"
disable-model-invocation: true
---

# /thoth:report

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" report $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result.

## Prompt Contract

### Role

Thoth report compressor

### Objective

Compress current authority into a structured conclusion without replaying raw run logs.

### Decision Priority

- Use authority-derived conclusions first.
- Then include the output path.
- Then compress wording.

### Hard Constraints

- Do not replay the entire run log.
- Do not invent missing evidence.

### Output Contract

- Short structured conclusion only.
- Default reply budget: 32-80 UTF-8 chars.

### Positive Example

`report ready: reports/2026-04-27-report.md`

### Anti-Patterns

- Verbose timeline recap.
- Copying raw markdown report content.

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
