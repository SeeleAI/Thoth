# AGENTS.md

This file is the long-term project operating contract for the Thoth repository. It applies to Codex, Claude Code, and other AI coding agents. Its purpose is to ensure that any long-running development effort can be recovered from repository files and always follows the single canonical architecture, rather than relying on chat history or reverse-engineering the product from the accidental shape of the current code.

Branches, commits, current implementation progress, the sole top next action, blockers, review entry points, and Release status change continuously. `.agent-os/project-index.md` is the single source of truth for all of them; they are not maintained redundantly in this file.

## 1. Mission

1. Thoth is a local-first AI task control plane, not an Agent Harness, hidden LLM API wrapper, or general-purpose chat product.
2. Thoth compiles ambiguous intent into a verifiable, recoverable, asynchronously executable, and reviewable Workspace / Task loop, while minimizing the user's cognitive burden and lowering the barrier to use.
3. The Provider Agent Harness provides all intelligence: reasoning, planning, tool selection, and execution.
4. Thoth owns only deterministic workflows, the prompt/runtime contract, task authority, Human Decision, frozen acceptance, evidence, session records, recovery, and multi-surface control.
5. All AI capabilities must come from a configured Provider session: ACP, Harness runtime, app-server, an official Harness SDK/control surface, or a local Harness CLI. Thoth must not privately call a general-purpose model API as a substitute for the Provider.
6. `Simply Is First` is the highest engineering priority: the final system must have one clear, general, and explainable architecture; simplicity does not mean reducing goals, downgrading semantics, retaining side paths, or shipping a one-off implementation first.

## 2. Recovery order

Before beginning a non-trivial task, recover context in the following order:

1. Read this file.
2. Read [`.agent-os/project-index.md`](.agent-os/project-index.md).
3. Read the entry corresponding to the top next action in [`.agent-os/todo.md`](.agent-os/todo.md).
4. Read the latest entry in [`.agent-os/run-log.md`](.agent-os/run-log.md).
5. When the goals and product design need to be understood, read these in order:
   - [`.agent-os/designs/core-design-principles.md`](.agent-os/designs/core-design-principles.md)
   - [`.agent-os/designs/thoth-high-level-design.md`](.agent-os/designs/thoth-high-level-design.md)
   - [`.agent-os/designs/thoth-mvp-user-journey.md`](.agent-os/designs/thoth-mvp-user-journey.md)
   - [`.agent-os/designs/thoth-app-runtime-contract.md`](.agent-os/designs/thoth-app-runtime-contract.md)
   - [`.agent-os/designs/thoth-engineering-architecture.md`](.agent-os/designs/thoth-engineering-architecture.md)
   - [`.agent-os/designs/thoth-prompt-contract-seeds.md`](.agent-os/designs/thoth-prompt-contract-seeds.md)
6. Before development, testing, packaging, or release, read the task-relevant documents:
   - [`docs/development.md`](docs/development.md)
   - [`docs/testing.md`](docs/testing.md)
   - [`docs/packaging.md`](docs/packaging.md)
   - [`docs/release.md`](docs/release.md)
7. When editing `packages/*`, also read that package's `AGENTS.md`. A local contract may tighten the root contract but may not rewrite global authority. If it contains historical implementation state that is liable to drift, use `project-index.md` and the current root scripts as the authority. Every package's `CLAUDE.md` must link to its `AGENTS.md`.

`.agent-os/designs/thoth-migration-architecture-20260625.md` is an early migration archive for historical reference only; it does not supersede the current canonical docs.

## 3. Authority and docs split

`.agent-os/` is the project authority and evidence ledger. Its responsibilities are fixed as follows:

| Document                     | Responsibility                                                             |
| ---------------------------- | -------------------------------------------------------------------------- |
| `project-index.md`           | Current truth, sole top next action, blockers, and recovery entry point    |
| `requirements.md`            | User-locked goals, hard constraints, acceptance criteria, and non-goals    |
| `change-decisions.md`        | Append-only decisions subsequently made by the user                        |
| `architecture-milestones.md` | Workstreams, milestones, and acceptance boundaries                         |
| `todo.md`                    | `backlog / ready / doing / blocked / done / verified / abandoned` status   |
| `acceptance-report.md`       | Passing, failing, and evidence index                                       |
| `lessons-learned.md`         | Failed explorations, pitfalls, and retry conditions                        |
| `run-log.md`                 | Recent work sessions and handoff                                           |
| `designs/`                   | Product, user journey, architecture, and prompt/runtime contract authority |

`docs/` is the executable development handbook. It explains how to develop, test, package, and release; it must not silently change the goals, ownership, decisions, or acceptance semantics in `.agent-os/`.

Local exceptions: `.agent-os/paper-notes/` contains ignored, unpublished research material and is not canonical authority; `.agent-os/upstreams/` is an ignored raw reference cache and is not authority either.

## 4. Stable project facts

1. Project name: Thoth; license: `AGPL-3.0-or-later`.
2. Technology stack: TypeScript / Node, npm workspaces, and the `packages/` monorepo.
3. Locked development toolchain: Node `24.14.0`, npm `11.9.0`; exception runtimes may be used only through an explicit root script.
4. Root workspaces must remain `['packages/*']` with the following 10-package ownership model.
5. The Thoth direct daemon listens on `127.0.0.1:6688` by default.
6. The local Paseo/legacy daemon at `127.0.0.1:6767` is a reserved parallel service; Thoth must not probe, reuse, stop, restart, or fall back to it.
7. The archived plugin runtime is sealed and is no longer maintained or supported: Release `thoth-plugin-final-archive`, branch `archive/main-20260627`.

## 5. System overview

```text
App / Desktop / Mobile / OpenTUI / CLI
                    |
          semantic @thoth/client
                    |
 Protocol RPC Registry + binary codecs
                    |
        Daemon application use cases
          /                       \
 pure @thoth/core          ToolGateway / HarnessAdapter
          |                       |
 Repository / UoW         Provider Agent Harnesses
          |
 Workspace SQLite authority shards
```

The sole production main chain is:

```text
Clients -> @thoth/client -> @thoth/protocol -> @thoth/daemon
        -> @thoth/core + ToolGateway/HarnessAdapter + query projections
        -> Workspace SQLite shards
```

Provider owns cognition. Thoth owns truth. Adapter owns translation. ToolGateway owns callback fencing. Workspace owns isolation. Task owns lifecycle. HumanDecision owns user authority. Evidence owns completion. UI owns presentation only.

## 6. Package map

| Package             | Ownership                                                                               | Must not own                                            |
| ------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `packages/protocol` | Wire schemas, RPC Registry, message types, binary codecs, compatibility                 | Daemon implementation, Provider calls, UI               |
| `packages/client`   | Semantic daemon SDK, direct/Relay transports, request correlation                       | Task authority, SQLite, Provider logic                  |
| `packages/core`     | Pure deterministic authority transitions and domain policy                              | IO, UI, Provider SDK, process globals                   |
| `packages/daemon`   | Local authority runtime, application use cases, Workspace stores, Provider coordination | Hidden LLM calls, Provider cognition                    |
| `packages/drivers`  | Provider-neutral `HarnessAdapter` and Provider transport translation                    | Task truth, acceptance, product branching               |
| `packages/tui`      | OpenTUI shell                                                                           | Textual, independent backend, durable authority         |
| `packages/app`      | Expo/React Native mobile/web shell, read-only projection, AgentTimeline UI              | Task truth, optimistic Timeline authority               |
| `packages/desktop`  | Electron shell, managed daemon, native integration, packaging                           | Desktop-only Protocol or Task path                      |
| `packages/relay`    | Zero-knowledge E2EE transport                                                           | Plaintext, offline queue, cloud task truth              |
| `packages/cli`      | Human/automation command surface                                                        | Direct SQLite, Provider SDK, independent business logic |

`packages/app/highlight` is a nested package, not the 11th root workspace.

## 7. Authority ownership

The following boundaries are locked by `NTH-CD-060`, `NTH-CD-061`, `NTH-CD-063`, `NTH-CD-066`, and `NTH-CD-067`:

| Concept          | Owner                          | Rule                                                                                                   |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| Workspace        | Daemon Workspace authority     | Smallest isolation/resource/scheduling/recovery domain; a worktree is an independent Workspace         |
| Task             | Workspace authority            | Smallest user-controllable execution unit, owning the contract, goals, decisions, memory, and evidence |
| ExecutionAttempt | Daemon Runtime Truth           | Exactly one Provider run; not the same as a Task                                                       |
| ProviderThread   | Provider/Adapter               | Opaque context/resume metadata; it can never become task authority                                     |
| Card             | Workspace authority            | Durable suspension; not a process-local Promise or a long-suspended tool call                          |
| HumanDecision    | Workspace authority            | Append-only and CAS-fenced; Provider output and UI state cannot overwrite it                           |
| Task Blackboard  | Task authority                 | Semantic intent/contract/decision/report/evidence; contains no runtime bookkeeping                     |
| RuntimeBundle    | Drivers + daemon content store | Immutable `thoth.clarify` / `thoth.loop` instructions, tools, scope, and digest                        |
| HarnessAdapter   | Drivers                        | Sole Provider execution SPI; the business layer does not inspect provider id                           |
| ToolGateway      | Daemon                         | Runtime tool callback normalization, scope/generation fencing, and authority commit                    |
| Timeline         | Daemon Workspace authority     | Canonical identity, timestamp, sequence, epoch, and replay                                             |
| App projection   | App                            | Normalized read-only view; it cannot become a second authority                                         |

Task Truth and Runtime Truth must be physically and conceptually separate. Provider auth, home, native transcript, and KV/tool cache remain in the Provider's own storage; they must not be copied into `.thoth`. Foreground `@Task` resolves only structured Blackboard context from the same Workspace; it must not concatenate or merge Provider sessions.

Native dynamic tools, MCP, and ACP are merely transport mappings of the same RuntimeBundle semantic tool catalog, not three product paths. Provider-native Plan is a capability-based Harness contract; when native Plan is unavailable, report it honestly as unsupported and do not simulate it with a prompt or use a provider-name fallback. Plan is an Agent-scoped `Provider Features` capability, not an independent Composer/Run Mode authority.

## 8. Non-negotiable rules

1. Without a user decision, do not rewrite Thoth's core goals, constraints, ownership, main chain, or acceptance meaning.
2. Use Thoth IDs for durable entries, such as `NTH-OBJ-001`, `NTH-REQ-001`, `NTH-MS-001`, `NTH-TD-001`, `NTH-EV-001`, and `NTH-CD-001`.
3. Do not claim completion, passage, implementation, or goal satisfaction without evidence. `done` does not mean `verified`.
4. Preserve failed explorations in `lessons-learned.md`; do not delete evidence, flaky tests, or below-target results for the sake of tidiness.
5. `project-index.md` must always contain exactly one global top next action.
6. All tracked project documentation and documentation filenames use English. Code comments and script output also use English.
7. Do not reintroduce the archived Python runtime, Claude/Codex plugin projection, dashboard template, or Textual TUI.
8. `packages/tui` uses OpenTUI only. Fixtures may replace external uncertainty but may not replace OpenTUI, the formal API, the state machine, or the product entry point.
9. Voice, speech, dictation, and audio are not current product capabilities; do not add permissions, dependencies, UI, or runtime paths for them.
10. Do not copy Multica source into this repository; it may be used only as a design and engineering-governance reference.
11. The Dev UI must reuse the real experience of the currently releasable full UI; do not create a mock/debug-only/agent-facing primary entry point.
12. `localhost:6767` / `127.0.0.1:6767` may be used only for fixtures, historical notes, or the Paseo isolation guard; it must not become a Thoth runtime endpoint.
13. A Relay pairing token is an automatic-pairing credential, not a manual login token; it must not be written to URL queries, ordinary logs, documentation examples, Telemetry, or final reports.
14. `protocol` is the wire source of truth; `client` is the semantic SDK; `core` is the pure domain; `daemon` is the local authority; `drivers` is Provider translation; all UI is a shell.
15. Every package must directly declare the external packages it imports.

## 9. Architecture-first development

### Think before coding

1. Before starting, identify which final module this change belongs to, which formal interface it uses, who owns its state, and how it will be independently accepted.
2. When multiple interpretations are reasonable, state the divergence; do not silently choose one that changes the goals or ownership.
3. If information is unclear or the current implementation has a high-impact conflict with the canonical docs, expose the conflict before implementing.
4. Keep very small and explicit tasks lightweight; do not create meaningless process for its own sake.

### One final path

1. Code must first obey the canonical architecture; the current code shape cannot retroactively become an unapproved architecture.
2. Quick experiments may validate only the final module, interface, state machine, and real product path; do not build a shrunken `A' + B' + C'`.
3. Every completed module must be retainable as part of the final system.
4. Cutover must switch every consumer and delete the replaced path within the same controlled scope.
5. Do not introduce dual read/write, a compatibility router, a provider-specific business branch, a hidden fallback, a hidden LLM call, a semantic downgrade, fake success, or a second production path.
6. Use compositional OOP for stateful domain/application/repository/adapter/controller/lifecycle boundaries; keep stateless transformations as pure functions. Prefer composition; prohibit giant base classes, service locators, and interface-for-every-class ceremony.
7. If evidence proves that the architecture cannot support the goal, stop production implementation and form a canonical decision; do not bypass it with temporary code or by lowering the acceptance bar.

### Surgical changes

1. Modify only what can be traced to the current request, TODO, or design authority.
2. Do not opportunistically refactor, format, delete unrelated code, or remove user changes.
3. Clean up only unused code caused by this change; adjacent pre-existing problems may be recorded but must not expand the scope.
4. When the current task explicitly replaces an architecture boundary, deleting the old path within that boundary is necessary and should not be retained as a “local” conflicting implementation.

## 10. Command discipline

1. Root `package.json` scripts are the sole standard entry points.
2. Do not directly run `npx oxfmt`, `npx oxlint`, `npx vitest`, or `npx tsc` in normal workflows; use the root npm scripts.
3. A lower-level command may be run temporarily to locate a root-script failure, but the update/final report must state that it was debug-only and not a formal gate.
4. Prefer narrow checks; do not default to heavy full-repository tests. Before handoff, run at least the root gate relevant to this change.
5. The foundation gate is `npm run check:foundation`. After it fails, fix it before continuing business implementation.
6. The combined gate for the current feature-zero-loss architecture refactor is `npm run accept:refactor:fast`, with a shared hard limit of `300s`; its exact current scope is defined by the root script and canonical decision.
7. `npm install` is governed by the root `.npmrc`, with `ignore-scripts=true`, `audit=false`, and `fund=false` by default; native or toolchain initialization must use an explicit root script.
8. Human review uses the real dogfood UI; agent acceptance uses root scripts, tests, typechecking, builds, and explicit smoke tests.
9. For private GitHub repositories or workflows, use only `npm run gh -- ...`, which fixes `GH_CONFIG_DIR` at the ignored `.dev/gh`. Do not run the global `gh auth login` or modify `~/.config/gh`.
10. For parallel isolation smoke tests, use `npm run smoke:isolation`; confirm Paseo is on `6767`, Thoth is on `6688`, and their PIDs differ.
11. For manual Web review, first run `npm run build:web`, then use the formal `serve:web` / `dev:web:demo` entry points as described in [`docs/development.md`](docs/development.md).

Recommended minimum execution plan:

```text
1. [Final module step] -> verify: [behavioral check]
2. [Cutover step] -> verify: [single-path guard]
3. [Closeout step] -> verify: [root gate + evidence]
```

## 11. Test and verification discipline

1. Tests prove behavior, not an accidental implementation shape.
2. For behavior changes, add or update tests at the correct ownership layer first.
3. Unit tests use `*.test.ts(x)`; local resource tests use `*.local.e2e.test.ts`; real Provider tests use `*.real.e2e.test.ts` or an explicitly configured real-provider project.
4. Real Provider tests are not part of the default Foundation gate; they must isolate auth, home, port, and workspace.
5. Do not write fake tests for Provider auth. The Provider handles auth; Thoth tests the capability, permission, event, receipt, and recovery boundary.
6. Golden/fixture/mock implementations may replace only external uncertainty and must pass through the same public API, state machine, and lifecycle.
7. Do not delete a test because it is flaky; first identify the source of variance and preserve the failure receipt.
8. Do not claim that a gate passed unless it was actually run in this round, its exit code was obtained, and the evidence was recorded.
9. When acceptance is below target, analyze the root cause and correct the final path; do not lower the goal, rewrite the criteria, switch to a fallback, or select substitute samples.

## 12. Generated and ignored paths

The following directories must not be staged or committed:

- `.agent-os/upstreams/`
- `.agent-os/artifacts/`
- `.agent-os/paper-notes/`
- `.dev/`
- `packages/app/android/`
- `packages/app/ios/`
- `packages/desktop/release/`

Android toolchain and local infrastructure artifacts belong in `.dev/`. An Android Debug APK is not a Release; its package ID must retain the Thoth identity and it must not request `android.permission.RECORD_AUDIO`. An iOS build requires macOS/Xcode; Linux scripts must explicitly skip/fail and must not imply that a build succeeded. A Linux AppImage is ignored by default as a local/dev artifact.

## 13. GitHub, release and destructive operations

1. Whether a Commit is allowed is determined by the current TODO/decision; push, merge, tag, Release, publish, cloud deployment, store submission, and system-level installation always require explicit user authorization.
2. A Release preview, local package, or passing gate is not authorization to publish.
3. Do not use destructive commands such as `git reset --hard` or `git checkout --` to restore user changes unless the user explicitly requests it.
4. The worktree may contain user changes; preserve and work with them, and do not roll back unrelated files.
5. Do not automatically stop, restart, or take over the user's daemon. On timeout, first check the log, process, port, protocol, and Provider state.
6. Relay deployment authority belongs to a separate repository; passing tests in this repository do not mean that Relay has been deployed.

## 14. Update discipline

Update the corresponding ledger when any of the following occurs:

- A TODO is created or its status changes;
- A blocker appears or disappears;
- A milestone is completed or reordered;
- New acceptance evidence is obtained;
- A failed exploration is abandoned, or its retry conditions change;
- An autonomous work session ends;
- The user decides to change an interpretation or architecture boundary;
- New external official material is added or reverified.

Minimum closeout:

1. Update `.agent-os/run-log.md` before the work session ends.
2. When the top next action changes, update `.agent-os/project-index.md` and ensure that there is still exactly one.
3. When the user decides to change a boundary, append to `.agent-os/change-decisions.md`.
4. Write new evidence to `.agent-os/acceptance-report.md` and associate it with `NTH-EV-*`.
5. Write failed explorations to `.agent-os/lessons-learned.md`.
6. When adding or reverifying external material, update `.agent-os/official-sources/platform-index.md`.

## 15. Escalation conditions

Escalate to the user only in the following situations:

1. A goal, authority, license, branch, resource, or acceptance decision requires the user's ruling.
2. A high-impact checkout fact cannot be reconciled with the canonical docs independently.
3. A hard external blocker prevents continuation, or multiple real paths have failed consecutively and the project is clearly stalled.
4. A push, merge, tag, Release, publish, cloud deployment, store submission, or system-level installation is about to be performed.
5. An operation could damage the user's work, stop an active Provider/daemon, or change an independent Paseo/Relay service.
