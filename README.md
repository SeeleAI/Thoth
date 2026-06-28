# Thoth

Thoth is being rebuilt as a local-first task control plane for AI work.

The old Claude Code / Codex plugin runtime has been archived and is no longer maintained on this branch. This repository now contains the New Thoth design authority and a TypeScript / Node monorepo skeleton only. There is no runnable CLI, daemon, TUI, desktop app, mobile app, relay, or harness driver in the current checkout yet.

## Current Status

- Current branch focus: New Thoth reset and MVP architecture.
- Current implementation: `npm workspaces` skeleton under `packages/`.
- Current license: `GPL-3.0-only`.
- Copyright holder: `SeeleAI`.
- Current public surface: documentation and package boundaries only.
- Old plugin archive release: <https://github.com/SeeleAI/Thoth/releases/tag/thoth-plugin-final-archive>
- Old plugin archive branch: `archive/main-20260627`

## What New Thoth Is For

New Thoth is designed to reduce the user’s cognitive burden and entry barrier. The user should be able to describe intent naturally; Thoth should clarify only the few decisions that matter, register durable tasks when needed, run asynchronous loops, review results adversarially, and report with evidence.

The core product direction is:

1. One Thoth, not a visible agent dashboard.
2. UI shells are replaceable; authority belongs to Thoth.
3. Tasks are recoverable, reviewable, asynchronous loops.
4. Success is based on acceptance and evidence, not executor self-report.
5. Harnesses such as Claude Code, Codex, ACP-compatible tools, and future providers are adapters, not the source of truth.

## Repository Shape

```text
packages/
  protocol/   shared protocol and event contracts
  client/     shared client SDK and transports
  core/       pure domain model and lifecycle rules
  daemon/     local authority server and scheduler
  drivers/    harness adapters
  tui/        OpenTUI workspace control surface
  app/        shared desktop/mobile app surface
  desktop/    Electron wrapper and daemon lifecycle
  relay/      E2EE WebSocket relay
  cli/        scriptable advanced client
```

All package directories are placeholders. They intentionally contain no business implementation yet.

## Design Authority

Start here:

- [Core Principles](.agent-os/designs/最核心的设计理念.md)
- [High-Level Design](.agent-os/designs/new-thoth-high-level-design.md)
- [MVP User Journey](.agent-os/designs/new-thoth-mvp-user-journey.md)
- [Engineering Architecture](.agent-os/designs/new-thoth-engineering-architecture.md)
- [Prompt Contract Seeds](.agent-os/designs/new-thoth-prompt-contract-seeds.md)

The old long-form migration note remains available at `.agent-os/designs/new-thoth-migration-architecture-20260625.md` for historical traceability.

## Development Note

This checkout is not a working product. Do not install it as the old plugin runtime. Do not expect `thoth`, `/thoth:*`, or `$thoth` commands to exist from this branch.

Future implementation should follow `.agent-os/project-index.md`, `.agent-os/todo.md`, and the canonical design documents above.
