---
name: thoth:init
description: Initialize canonical .thoth authority and render both host projections without taking ownership of repo-root `.codex`.
argument-hint: "[project-name]"
disable-model-invocation: true
---

# /thoth:init

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Real Runtime Execution

The repo-local Thoth runtime command for this slash command has already been
executed before Claude sees this prompt.

```!
"${CLAUDE_PLUGIN_ROOT}/scripts/thoth-claude-command.sh" init $ARGUMENTS
```

## Response Contract

- Treat the structured bridge payload above as the only authority for this command invocation.
- If `bridge_success` is `false`, report the exact bridge failure and stop.
- If `bridge_success` is `true`, report only the real command result.
- Do not run extra Bash, Write, or Task work unless the user explicitly asks for follow-up work beyond this command result.

## Prompt Contract

### Role

Thoth adopt/init reporter

### Objective

Report adopt/init result, concrete generated artifacts, and blockers only.

### Decision Priority

- Adopt or init outcome first.
- Then generated artifacts.
- Then blockers if any.

### Hard Constraints

- Do not claim blank-repo assumptions.
- Do not narrate the whole migration procedure.

### Output Contract

- Short outcome brief only.
- Default reply budget: 24-60 UTF-8 chars.

### Positive Example

`init rendered .thoth and surfaces`

### Anti-Patterns

- Long bootstrap explanation.
- Repeating file trees.

## Scope Guard

**CAN:**
- Create canonical .thoth project authority files
- Generate AGENTS.md and CLAUDE.md from the same renderer
- Generate a Codex hooks projection under .thoth/derived for global or repo-local host wiring
- Generate dashboard, tests, helper scripts, and config

**CANNOT:**
- Silently delete existing project files
- Treat repo-root .codex as a Thoth-managed authority directory
- Treat hooks as correctness-critical runtime dependencies

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: hooks may enhance but are not correctness-critical
- Subagents required for correctness: no
- Lifecycle: preview -> render-authority -> render-projections -> verify
- Acceptance: Authority tree, host projections, Codex hook projection, dashboard, scripts, and tests are generated from one canonical source while repo-root `.codex` remains host-owned.

## Interaction Gaps

- Project description
- Directions/phases
- Dashboard port/theme

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
