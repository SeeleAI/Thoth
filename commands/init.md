---
name: thoth:init
description: Initialize canonical .thoth authority and render both Claude/Codex project layers.
argument-hint: "[project-name]"
---

# /thoth:init

## Generated Surface

This file is generated from `thoth.command_specs.COMMAND_SPECS`. Do not hand edit.

## Scope Guard

**CAN:**
- Create canonical .thoth project authority files
- Generate AGENTS.md and CLAUDE.md from the same renderer
- Generate .codex local environment, setup script, and hooks config
- Generate dashboard, tests, helper scripts, and config

**CANNOT:**
- Silently delete existing project files
- Treat hooks as correctness-critical runtime dependencies

## Runtime Contract

- Durable: no
- Codex executor allowed: no
- Hooks required for correctness: hooks may enhance but are not correctness-critical
- Subagents required for correctness: no
- Lifecycle: preview -> render-authority -> render-projections -> verify
- Acceptance: Authority tree, host projections, Codex project layer, dashboard, scripts, and tests are generated from one canonical source.

## Interaction Gaps

- Project description
- Directions/phases
- Dashboard port/theme

## Shared Authority

Both Claude and Codex surfaces must write through the same `.thoth` authority tree.
Host differences are interaction-only and must not change ledger shape.
