# Project Index

## Current Truth

1. Objective: `NTH-OBJ-001`
2. Top next action: `NTH-TD-002`
3. Active workstreams: `NTH-WS-001`, `NTH-WS-002`, `NTH-WS-003`, `NTH-WS-004`
4. Active blockers: None
5. Current branch: `port/from-old-thoth-plugin`
6. Current implementation state: New Thoth monorepo skeleton only

## Objective Summary

`NTH-OBJ-001`: Build New Thoth as a local-first AI task control plane that reduces user cognitive burden and entry barrier, compiles vague intent into clear tasks, runs recoverable asynchronous loops, verifies results with evidence, and remains host-neutral across future harness tools.

## Active Workstreams

1. `NTH-WS-001` `[active]`: Preserve New Thoth product authority and decision boundaries.
2. `NTH-WS-002` `[active]`: Establish the TypeScript / Node monorepo skeleton.
3. `NTH-WS-003` `[active]`: Design the clarify-to-task and aggressive loop runtime before implementation.
4. `NTH-WS-004` `[active]`: Keep harness, relay, mobile, desktop, TUI and ACP references current enough for implementation.

## Top Next Action

`NTH-TD-002` `[ready]`: Design the first implementation slice for Router, Clarify, authority store and task lifecycle without reintroducing old plugin runtime compatibility.

## Active Blockers

None.

## Recent Important Changes

1. `NTH-CD-001`: User decided New Thoth will not continue old plugin compatibility. The old plugin line is archived at release `thoth-plugin-final-archive` and branch `archive/main-20260627`.
2. `NTH-CD-002`: User approved a full repo reset on `port/from-old-thoth-plugin`: delete old Python/plugin runtime, keep only design authority and a TypeScript / Node monorepo skeleton.
3. `NTH-CD-003`: User selected `GPL-3.0-only`, `npm workspaces`, package namespace `@thoth/*`, and OpenTUI as the fixed TUI framework.
4. `NTH-CD-004`: User selected docs-only prompt seed extraction. Old prompt assets are summarized in `.agent-os/designs/new-thoth-prompt-contract-seeds.md`, not retained as Python code.

## Read Next

1. [requirements.md](requirements.md)
2. [architecture-milestones.md](architecture-milestones.md)
3. [todo.md](todo.md)
4. [run-log.md](run-log.md)
5. [designs/最核心的设计理念.md](designs/最核心的设计理念.md)
