# Requirements

## Objective

`NTH-OBJ-001`: New Thoth must become a host-neutral task control plane for AI work. It should behave like a reliable private secretary for a high-authority user: remember context, understand vague intent, ask only the important golden questions, register durable tasks when needed, run asynchronous loops, and report results with evidence.

## Goals

1. `NTH-REQ-001`: Reduce user cognitive burden and entry barrier as the first design principle.
2. `NTH-REQ-002`: Compile natural-language intent into clear task contracts with goal, non-goals, constraints, assumptions, risks and acceptance.
3. `NTH-REQ-003`: Treat formal tasks as recoverable, reviewable, long-running loops rather than one-off agent runs.
4. `NTH-REQ-004`: Make success depend on frozen acceptance and evidence, not executor self-report.
5. `NTH-REQ-005`: Keep Thoth host-neutral across Claude Code, Codex, ACP-compatible tools and future harnesses.
6. `NTH-REQ-006`: Keep UI shells thin. TUI, desktop app, mobile app and CLI must see the same authority.
7. `NTH-REQ-007`: Use OpenTUI for the TUI shell.
8. `NTH-REQ-008`: Use a TypeScript / Node monorepo for the new runtime. The new core must not use Python as the main product runtime.
9. `NTH-REQ-009`: Preserve old plugin history through archive release and archive branch, not through legacy code in the active working tree.

## Acceptance Criteria

1. `NTH-AC-001`: The active working tree no longer contains old Python runtime, plugin projection, dashboard template, Textual TUI or old tests.
2. `NTH-AC-002`: The active working tree contains exactly the 10 approved package skeletons under `packages/`.
3. `NTH-AC-003`: Root and package metadata use `GPL-3.0-only`, package version `0.0.0`, and `npm workspaces`.
4. `NTH-AC-004`: The recovery path from `AGENTS.md` to `.agent-os/project-index.md` to `.agent-os/todo.md` can explain the current New Thoth state without the chat transcript.
5. `NTH-AC-005`: The canonical design set is present under `.agent-os/designs/`.
6. `NTH-AC-006`: The old plugin archive release and branch are documented for traceability.
7. `NTH-AC-007`: No document claims the current checkout provides a runnable Thoth product.

## Hard Constraints

1. Do not push unless explicitly requested.
2. Do not touch `main`, archive branches, release tags, GitHub release assets or marketplace installs in this reset.
3. Do not reintroduce old plugin runtime compatibility.
4. Do not add fake build/test/typecheck scripts before implementation exists.
5. Do not add a new package outside the approved 10 packages without a tracked decision.
6. Do not expose internal multi-agent/team/squad concepts to the user-facing product model.

## Non-Goals

1. Implementing daemon, SQLite authority, drivers, TUI, desktop app, mobile app, relay or CLI.
2. Producing runnable MVP behavior.
3. Porting old plugin commands.
4. Preserving old 0.4.x changelog as the active product history.
5. Maintaining the old Python package for compatibility.
