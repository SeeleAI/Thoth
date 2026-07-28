# Thoth Architecture

Thoth is a local-first AI task control plane. It organizes user intent into recoverable, reviewable, asynchronously executable
Workspace / Task lifecycles, and uses a locally configured Agent Harness for intelligent reasoning and code execution.

Thoth does not participate in intelligence. The Provider Agent Harness owns reasoning, planning, tool selection, and execution; Thoth owns only
deterministic product flows, task authority, user decisions, permission boundaries, evidence, recovery, and multi-device control. Thoth does not directly call
general-purpose model APIs or simulate Provider intelligence with local heuristics.

This document is the engineering architecture authority. It describes the final single production path, package ownership, and current formal modules. Implementation progress, the current
branch, the sole top next action, blockers, and acceptance evidence are governed by
[`../project-index.md`](../project-index.md) and
[`../acceptance-report.md`](../acceptance-report.md); this document does not carry fast-changing project status.

## System overview

```text
+----------------+  +---------------+  +---------------+  +---------------+
| Expo App       |  | Desktop       |  | OpenTUI / CLI |  | Remote Client |
| Web / Mobile   |  | Electron      |  | Terminal      |  | via Relay     |
+-------+--------+  +-------+-------+  +-------+-------+  +-------+-------+
        |                   |                  |                  |
        +-------------------+------------------+------------------+
                            |
                   semantic @thoth/client
                            |
          Protocol RPC Registry + JSON / binary codecs
                            |
                  WebSocket direct or E2EE relay
                            |
                 +----------v-----------+
                 | Thoth Daemon         |
                 | application use cases|
                 +----+------------+----+
                      |            |
          deterministic|            | provider execution
                      |            |
              +-------v------+  +--v------------------+
              | @thoth/core  |  | ToolGateway         |
              | transitions  |  | + HarnessAdapter    |
              +-------+------+  +--+------------------+
                      |            |
            Repository / UoW       +------------------------------+
                      |            |          |         |         |
       +--------------v--------+   v          v         v         v
       | Workspace SQLite shard| Codex   Claude Code OpenCode  ACP / Pi
       | + blobs + artifacts   | app-     Agent SDK   harness   harness
       +-----------------------+ server
```

The sole production main chain is:

```text
App / Desktop / Mobile / TUI / CLI
  -> semantic @thoth/client
  -> Protocol RPC Registry and binary codecs
  -> Daemon application use cases
  -> pure @thoth/core + ToolGateway / HarnessAdapter + query projections
  -> Workspace SQLite shards
```

This chain is locked by `NTH-CD-060`, `NTH-CD-063`, `NTH-CD-066`, and `NTH-CD-067`. Any dual read/write,
compatibility routing, provider-name business branch, hidden fallback, or second authority is not part of the Thoth architecture.

## Components at a glance

- **Clients:** App, Desktop, TUI, and CLI are different interaction shells over the same daemon authority.
- **Client SDK:** `@thoth/client` provides semantic methods and direct / Relay transports; it does not persist task truth.
- **Protocol:** `@thoth/protocol` is the sole source of truth for RPC, wire schemas, Timeline types, and binary frames.
- **Daemon:** The local composition root, application use cases, Workspace scheduling, persistence, provider coordination, and projection publication.
- **Core:** IO-free deterministic authority transitions and domain policy.
- **Drivers:** A provider-neutral `HarnessAdapter` SPI and each Provider's capability and transport mappings.
- **ToolGateway:** The sole generation-scoped facade through which Provider runtime tool callbacks enter Thoth authority.
- **Workspace store:** One global catalog plus one SQLite authority shard per Workspace, storing durable truth.
- **Relay:** An optional zero-knowledge E2EE byte-forwarding layer that does not read, interpret, or queue task content.

## Architectural invariants

1. **Provider owns cognition.** The Provider Harness decides how to reason, plan, invoke tools, and execute tasks.
2. **Thoth owns truth.** Thoth owns the authority for Workspace, Task, Card, Human Decision, Timeline, and Evidence.
3. **Adapter owns translation.** Provider-specific session, event, tool-attachment, and approval semantics exist only in the Driver.
4. **ToolGateway owns callback fencing.** Runtime tool callbacks first verify the attempt, generation, scope, and current authority.
5. **Workspace owns isolation.** Workspace is the boundary for paths, capabilities, resources, scheduling, mutation leases, and crash recovery.
6. **Task owns lifecycle.** Task is the smallest user-controllable, pausable, recoverable, reviewable execution unit.
7. **HumanDecision owns user authority.** User decisions are append-only and cannot be overwritten by Provider text or client-local state.
8. **Evidence owns completion.** Without persisted evidence, a Task cannot be claimed complete or accepted.
9. **UI owns presentation only.** App projections may cache and normalize presentation but do not create durable task truth.
10. **One path owns production.** Each behavior has exactly one formal state machine, Repository, RPC, Timeline, and Provider SPI.

`Simply Is First` means that the final system has simple concepts, clear ownership, and one main path; it does not mean reducing product semantics, first building a one-off
implementation, or substituting `A' + B' + C'` for final modules A, B, and C.

## Packages

Root npm workspaces are fixed to 10 formal packages under `packages/*`. `packages/app/highlight` is an App
nested package, not an 11th root workspace.

### `packages/protocol` - Wire contracts

`@thoth/protocol` is the shared protocol source at the daemon, client, App, CLI, and Relay boundaries. It owns schemas, message
names, compatibility rules, and the binary frame codec, but not business execution, storage, or Provider calls.

**Key modules:**

| Module                               | Responsibility                                                                                             |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `src/messages.ts`                    | WebSocket envelopes, session message schemas, 131-operation RPC Registry, and derived input/output schemas |
| `src/rpc-registry.ts`                | Public entry point for `rpcRegistry`, protocol version, and typed RPC request/response                     |
| `src/task-authority.ts`              | Durable authority shapes for Task, Execution, Human Decision, Blackboard, approval, and more               |
| `src/thoth-runtime-contract.ts`      | Semantic tool input/output contracts for the Clarify / Loop RuntimeBundle                                  |
| `src/thoth/rpc-schemas.ts`           | Thoth foreground authority, Card, and Task RPC schemas                                                     |
| `src/provider-control.ts`            | Agent-scoped Provider features, native Plan capability, run mode, and receipt schemas                      |
| `src/agent-types.ts`                 | Canonical AgentTimeline entries and Provider-facing presentation types                                     |
| `src/agent-turn-queue.ts`            | Shared wire contract for Queue / Interrupt send policy                                                     |
| `src/binary-frames/terminal.ts`      | Terminal stream binary frame codec                                                                         |
| `src/binary-frames/file-transfer.ts` | Workspace file transfer binary frame codec                                                                 |
| `src/client-capabilities.ts`         | Client capability negotiation keys                                                                         |
| `src/provider-manifest.ts`           | Provider manifest and public Provider metadata schemas                                                     |
| `src/forge.ts`                       | Forge identity, clone, Workspace lifecycle, and change-request URL semantics                               |
| `src/browser-automation/`            | Provider-neutral Browser command, target, result, and typed error schemas                                  |
| `src/schedule/types.ts`              | Workspace-owned Schedule and real Task / Execution run receipts                                            |
| `src/messages.ts` checkout entries   | Read-only Files/Changes, commit history, commit diff, and terminal-size RPC contracts                      |

Protocol must remain a dependency leaf: it cannot import daemon, drivers, App, or platform runtimes. New wire fields
should be optional/defaultable; compatibility must be handled explicitly at the serialization boundary, not guessed by clients.

### `packages/client` - Semantic daemon SDK

`@thoth/client` converts Protocol RPCs into caller-facing semantic methods and provides direct WebSocket and Relay
E2EE transports. It may maintain connection state and request correlation, but cannot become Workspace or Task
authority.

**Key modules:**

| Module                                      | Responsibility                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `src/daemon-client.ts`                      | Typed semantic SDK facade, RPC broker, subscriptions, and daemon operations |
| `src/daemon-client-transport.ts`            | Transport-neutral request, response, and event dispatch                     |
| `src/daemon-client-websocket-transport.ts`  | Direct WebSocket connection, handshake, liveness, and reconnect             |
| `src/daemon-client-relay-e2ee-transport.ts` | Relay-backed encrypted transport                                            |
| `src/daemon-client-transport-types.ts`      | Transport SPI and connection contracts                                      |
| `src/terminal-stream-router.ts`             | Routing binary terminal frames to terminal subscriptions                    |
| `src/index.ts`                              | Public SDK exports; callers should use the semantic API from here           |

Client does not copy wire schemas, write Workspace SQLite, interpret Provider events, or hold optimistic
task truth detached from the daemon. Offline caches may only provide read-only presentation and must not submit new Task, Card answers, or approvals.

### `packages/core` - Deterministic authority kernel

`@thoth/core` is the headless domain layer. It transforms validated commands and the current authority state into the next state,
without accessing databases, filesystems, processes, networks, UI, or Provider SDKs.

**Key modules:**

| Module                  | Responsibility                                                                                |
| ----------------------- | --------------------------------------------------------------------------------------------- |
| `src/authority.ts`      | Deterministic transitions for Task, Execution, approval, Card, and Human Decision             |
| `src/index.ts`          | Core public surface                                                                           |
| `src/authority.test.ts` | Behavioral proofs for pure state transitions, conflicts, idempotency, and invalid transitions |

Core accepts typed input whose schema validation was completed by the boundary layer; nondeterministic inputs such as time and IDs must be passed explicitly. Core
may return a transition result or domain error, but cannot perform IO, retry Providers, or publish WebSocket events itself.

### `packages/daemon` - Local authority runtime

`@thoth/daemon` is the system's local authority process. It composes Protocol, Core, Drivers, and persistence, implements
application use cases, and publishes the canonical projection to all clients. The Daemon is not a hidden model client.

**Process and session modules:**

| Module                           | Responsibility                                                                               |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/server/bootstrap.ts`        | Lazy composition root; assembles HTTP/WS, stores, use cases, Drivers, Relay, and supervisors |
| `src/server/websocket-server.ts` | WebSocket handshake, client session establishment, JSON/binary frame routing                 |
| `src/server/session.ts`          | Per-connection RPC handler dispatch, subscriptions, terminal, and file operations            |
| `src/server/checkout/`           | Git checkout, diff, PR, and repository use cases                                             |
| `src/server/file-*/`             | Workspace file reading, preview, and transfer handling                                       |
| `src/server/managed-processes/`  | Managed subprocess lifecycle and cleanup                                                     |
| `src/server/worktree/`           | Worktree creation, registration, and archive flow                                            |
| `src/server/forge/`              | Forge URL normalization and infrastructure adapters for GitHub/GitLab/Gitea/Forgejo/Codeberg |
| `src/server/browser-tools/`      | Logical Browser Host broker, reconnect-safe request correlation, and tab affinity            |
| `src/server/schedule/`           | Workspace-owned Schedule triggers that create real Task and ExecutionAttempt records         |
| `src/terminal/`                  | PTY lifecycle, snapshots, and binary stream integration                                      |

**Workspace authority modules:**

| Module                                                  | Responsibility                                                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `workspace-authority/workspace-authority-store.ts`      | `WorkspaceAuthorityStore`: per-Workspace SQLite Repository / UoW; commits current rows and incremental records in one transaction |
| `workspace-authority/workspace-authority-manager.ts`    | `WorkspaceAuthorityManager`: lazy-open, caching, closing, and store lifecycle per Workspace                                       |
| `workspace-authority/catalog-store.ts`                  | Global catalog: settings, provider profiles, Workspace Registry, and rebuildable Task locator                                     |
| `workspace-service-port-registry.ts`                    | Host-runtime SQLite `reserve -> spawn -> activate` service-port lease lifecycle and generation fencing                            |
| `workspace-authority/coordination-repository.ts`        | Workspace-level commands, leases, cursors, and coordination records                                                               |
| `workspace-authority/foreground-authority.ts`           | Durable foreground transitions for Agent / Turn / Card                                                                            |
| `workspace-authority/foreground-projection.ts`          | Stable mapping from foreground authority to client projection                                                                     |
| `workspace-authority/task-coordinator.ts`               | Task command scheduling, state transitions, and execution coordination                                                            |
| `workspace-authority/task-orchestrator.ts`              | `WorkspaceTaskOrchestrator`：Clarify / Loop / PlanExec / Review orchestration                                                     |
| `workspace-authority/task-context-broker.ts`            | `TaskContextBroker`: resolves same-Workspace `@Task` into semantic Blackboard context                                             |
| `workspace-authority/tool-gateway.ts`                   | `ToolGateway`: tool-call validation, generation fencing, authority commit, and normalized result                                  |
| `workspace-authority/runtime-bundle-store.ts`           | `RuntimeBundleStore`: content-addressed bundle persistence and digest verification                                                |
| `workspace-authority/execution-runtime-registry.ts`     | Active execution handles for the process lifetime only; not durable Task Truth                                                    |
| `workspace-authority/execution-approval-controller.ts`  | Provider approval windows, CAS resolution, and daemon actor receipts                                                              |
| `workspace-authority/blob-store.ts`                     | SHA-256 addressed immutable payloads                                                                                              |
| `workspace-authority/workspace-agent-storage.ts`        | Storage boundary for Agent metadata on the Workspace shard                                                                        |
| `workspace-authority/workspace-agent-timeline-store.ts` | Canonical AgentTimeline persistence and replay                                                                                    |

**Execution application modules:**

| Module                                          | Responsibility                                                                             |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `agent/execution-service.ts`                    | `ExecutionService`: shared foreground/background execution lifecycle and event ingestion   |
| `agent/foreground-turn-coordinator.ts`          | `ForegroundTurnCoordinator`: Queue / Interrupt, Turn generation, dispatch, and settlement  |
| `agent/foreground-thoth-session-provisioner.ts` | Foreground Thoth runtime attachment and Provider thread provisioning                       |
| `agent/provider-snapshot-manager.ts`            | Provider availability, capabilities, and model snapshot refresh                            |
| `agent/runtime-tool-decisions.ts`               | Typed translation from runtime tool results to application decisions                       |
| `agent/tools/thoth-tools.ts`                    | `thoth.clarify` / `thoth.loop` semantic tool catalog                                       |
| `agent/runtime-mcp-config.ts`                   | Execution-scoped configuration for MCP transport bindings                                  |
| `agent/provider-registry-wrap.test.ts`          | Architecture guard preventing reintroduction of the Driver Registry through an old wrapper |

Stateful boundaries in the Daemon use compositional OOP: application services, Repositories, controllers, adapters, and
lifecycle owners may be objects; stateless transformations remain private pure functions. Giant base classes, service locators,
and interface-for-every-class ceremony are prohibited.

### `packages/drivers` - Provider Harness adapters

`@thoth/drivers` is the sole Provider integration layer. Every Provider implements the same `HarnessAdapter` contract;
business layers read only capabilities and receipts and do not change Clarify, Loop, Task, or approval semantics by provider ID.

**Key modules:**

| Module                                        | Responsibility                                                                            |
| --------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/harness/types.ts`                        | Harness capabilities, thread, execution, event, approval, tool binding, and receipt types |
| `src/harness/capabilities.ts`                 | Capability validation, feature checks, and unsupported-state normalization                |
| `src/harness/runtime-bundle.ts`               | RuntimeBundle digests, attachment compatibility, and immutable bundle helpers             |
| `src/harness/thoth-runtime-bundle-catalog.ts` | Built-in `thoth.clarify` / `thoth.loop` bundle catalog                                    |
| `src/server/agent/harness-contract.ts`        | Provider-neutral Harness execution SPI                                                    |
| `src/server/agent/provider-registry.ts`       | Lazy Provider manifests and adapter construction                                          |
| `src/server/agent/provider-launch-config.ts`  | Provider process/session launch configuration                                             |
| `src/server/agent/timeline-projection.ts`     | Adapter mapping from Provider-native events to canonical Timeline events                  |
| `src/runtime-skills/thoth-clarify/SKILL.md`   | Clarify semantic instruction artifact                                                     |
| `src/runtime-skills/thoth-loop/SKILL.md`      | Loop semantic instruction artifact                                                        |
| `src/clarify/`                                | Clarify golden data, simulation, and independent evaluation harness                       |
| `src/loop/`                                   | Loop golden data, simulation, and independent evaluation harness                          |

Built-in adapters cover Claude Agent SDK, Codex app-server, OpenCode, Pi, ACP/generic ACP, Copilot ACP, and
Cursor ACP. Provider-owned auth, configuration, native transcripts, KV caches, tool caches, and home directories
remain in the Provider's own storage; Thoth does not copy, merge, or take them over.

Provider catalog and default truth is expressed as capability/default receipts. Claude, Codex, ACP, OpenCode, Pi,
and OMP use the same SPI; the daemon may not branch on provider ID. Only provider profiles declared
`source=custom` may be deleted. Deletion atomically updates config and catalog, prevents new sessions, and returns a
typed unavailable result for later resume without terminating an already-running session; builtin providers cannot
be deleted.

Provider-native Plan is a capability-based Harness contract, not prompt simulation. A `plan` execution must
produce a verifiable run-mode receipt; a Provider without native Plan support may still be used for raw/Quick, but must honestly report Plan
and Loop as unsupported. Authority for the Plan feature belongs to the visible Agent, and capability truth comes from the live Harness session;
it is displayed in the App under `Provider Features` and does not create a separate Run Mode product path.

### `packages/app` - Expo mobile and web shell

`@thoth/app` is the React Native / Expo client and the Web UI reused by Desktop. It reads the daemon projection,
sends semantic commands, and handles cross-platform interaction; it does not own Task, Card, Agent archive, or Timeline authority.

**Key modules:**

| Module                                        | Responsibility                                                                                         |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/projection/authority-projection.ts`      | `AuthorityProjectionStore` and `DaemonProjectionService`; the sole normalized read-only App projection |
| `src/projection/workspace-selectors.ts`       | Workspace/Agent authority-backed selectors                                                             |
| `src/agent-stream/`                           | Canonical AgentTimeline rendering, virtualization, layout, and turn boundaries                         |
| `src/agent-stream/timeline-view-registry.tsx` | Declarative registry from Timeline entry types to the sole view component                              |
| `src/composer/`                               | Drafts, attachments, send, Queue/Interrupt, Thoth controls, and `@Task` reference UI                   |
| `src/composer/agent-controls/`                | Provider/model/features and Agent-scoped Plan presentation                                             |
| `src/agent-thoth/`                            | Clarify / Task / Goals Cards and Thoth lifecycle presentation                                          |
| `src/workspace-tabs/`                         | Authority-filtered Workspace tab identity and visibility                                               |
| `src/timeline/`                               | Timeline query/catch-up policy and supporting presentation helpers                                     |
| `src/tool-calls/`                             | Canonical tool-call display and details                                                                |
| `src/git/`, `src/review/`                     | Git diff, PR, and review surfaces; mutations still go through the daemon                               |
| `src/attachments/`                            | Workspace-scoped attachment presentation and upload workflow                                           |
| `src/terminal/`                               | Terminal UI and binary-stream consumption                                                              |
| `src/browser-automation/`                     | Request coordination and at-most-once response delivery across Client reconnect                        |
| `src/components/browser-*`                    | In-app Browser presentation over Desktop's scoped Host implementation                                  |
| `src/file-explorer/`, `src/git/`              | Read-only file tree, line navigation, commit history, and commit-file diff presentation                |
| `src/screens/`                                | Route-level screen composition; does not establish a second domain store                               |

`AuthorityProjectionStore` is written only by `DaemonProjectionService`. Host runtime owns connection and server info,
TanStack Query owns the server query/pending overlay, and UI preferences own focus/layout preferences; none may
be elevated to durable authority. Immediate AgentTimeline events provide low latency, while authoritative fetch/catch-up provides correctness.

### `packages/desktop` - Electron shell

`@thoth/desktop` combines the App Web export, local daemon, and operating-system capabilities into the desktop product. Desktop may manage its own
daemon subprocesses, but cannot define desktop-only Task or Protocol branches.

**Key modules:**

| Module                                   | Responsibility                                                    |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `src/main.ts`                            | Electron composition root, IPC, window, and native feature wiring |
| `src/desktop-startup.ts`                 | App startup sequencing and failure reporting                      |
| `src/daemon/daemon-manager.ts`           | Bundled daemon subprocess lifecycle                               |
| `src/daemon/node-entrypoint-launcher.ts` | Packaged Node entrypoint launch                                   |
| `src/daemon/quit-lifecycle.ts`           | Window/app quit and managed daemon settlement                     |
| `src/window/window-manager.ts`           | Multi-window lifecycle and ownership                              |
| `src/pending-open-project-store.ts`      | Per-window pending project intent                                 |
| `src/open-project-routing.ts`            | Routing OS/CLI open-project requests into the App flow            |
| `src/features/menu.ts`                   | Native Thoth menus                                                |
| `src/features/auto-updater.ts`           | Build-identity update manifest, download, and installer handoff   |
| `src/features/browser-profile.ts`        | One Host-wide persistent Chromium profile and explicit data clear |
| `src/features/browser-automation/`       | Trusted Chromium operations and scoped Browser Host registration  |
| `src/features/browser-webviews/`         | Tab registry, OAuth/popup handling, and renderer presentation     |
| `src/settings/`                          | Desktop-local settings and window state                           |
| `src/preload.cts`                        | Narrow renderer IPC bridge                                        |

Signing, notarization, asset upload, and Release are all explicitly authorized operations. Desktop release artifacts are written to ignored
`packages/desktop/release/` and must not be committed to the repository.

### `packages/relay` - Zero-knowledge E2EE transport

`@thoth/relay` allows the daemon and remote clients to establish encrypted connections without exposing the local listening port. The Relay server only
sees the metadata and ciphertext required to establish the bridge; it owns no offline queue, message semantics, or task truth.

**Key modules:**

| Module                      | Responsibility                                                 |
| --------------------------- | -------------------------------------------------------------- |
| `src/crypto.ts`             | Key agreement, nonces, and authenticated encryption primitives |
| `src/e2ee.ts`               | Client/daemon E2EE session establishment                       |
| `src/encrypted-channel.ts`  | Encrypted duplex channel abstraction                           |
| `src/cloudflare-adapter.ts` | Cloudflare runtime transport adapter                           |
| `src/types.ts`              | Relay channel contracts                                        |
| `src/index.ts`              | Public relay exports                                           |

Pairing token is a short-lived automatic-pairing credential, not a manual login token. It must not enter URL queries, ordinary logs, documentation examples,
Telemetry, or final reports. After Relay disconnection, the client/daemon catches up using the authority cursor; Relay itself does not cache
plaintext or decide replay order.

### `packages/tui` - OpenTUI shell

`@thoth/tui` is a terminal UI over the same Client/Protocol authority. It uses only OpenTUI and must not restore Textual, archived
Python TUI, or create a fake renderer as a production path.

**Key modules:**

| Module                    | Responsibility                                                  |
| ------------------------- | --------------------------------------------------------------- |
| `src/runtime.ts`          | Daemon-backed TUI runtime lifecycle                             |
| `src/surface.ts`          | Route-level surface model derived from client snapshots         |
| `src/interaction.ts`      | Pure interaction state for focus, routes, and composer controls |
| `src/keyboard.ts`         | Mapping key bindings to semantic actions                        |
| `src/opentui-renderer.ts` | OpenTUI renderer integration                                    |
| `src/render.ts`           | Stable terminal frame rendering helpers                         |
| `src/index.ts`            | Public TUI entry                                                |

TUI may display cached snapshots and disconnected recovery states, but cannot fabricate Task,
approval, provider readiness, or success results without daemon authority.

### `packages/cli` - Command and automation surface

`@thoth/cli` provides daemon, agent/import, task, schedule, loop, permit, provider, terminal, and worktree commands for human and automated callers.
CLI uses the same RPC through `@thoth/client` and does not open the Workspace authority database directly.

**Key modules:**

| Module                  | Responsibility                                         |
| ----------------------- | ------------------------------------------------------ |
| `src/cli.ts`            | Commander command tree and public command registration |
| `src/run.ts`            | CLI bootstrap, dispatch, and exit semantics            |
| `src/commands/`         | Onboarding, open, TUI, and domain commands             |
| `src/utils/client.ts`   | Daemon connection and semantic Client construction     |
| `src/utils/timeline.ts` | Timeline output and follow helpers                     |
| `src/output/`           | Human/table/JSON/YAML/quiet output strategies          |
| `src/classify.ts`       | Command invocation classification                      |
| `src/version.ts`        | Build identity and version display                     |

Outputs consumed by automation must be stable, offer a selectable structured format, and express failure through exit codes. CLI must not restart the daemon
directly because of a timeout; first distinguish RPC failure, socket liveness, daemon process, and Provider execution states.

## Dependency direction

The allowed core dependency directions are:

```text
protocol <- core
protocol <- relay <- client
protocol <- drivers
protocol + core + drivers + client <- daemon
protocol + client <- app <- desktop
protocol + client <- tui <- cli
```

Actual packages may have additional controlled edges for builds and shared helpers, but must not reverse authority ownership:

- Protocol depends on no upper-layer package.
- Core does not depend on daemon, drivers, client, or UI.
- Drivers do not depend on daemon application authority.
- Client does not depend on daemon internals.
- App, Desktop, TUI, and CLI do not access SQLite or Provider SDKs directly.
- Every package must directly declare the external dependencies it imports.

## Authority model

### Durable units

| Unit                  | Owner                            | Meaning                                                                                                                                         |
| --------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `Workspace`           | Daemon Workspace authority       | Smallest isolation, path/capability, resource, scheduling, mutation-lease, and crash-recovery domain; each worktree is an independent Workspace |
| `Agent`               | Workspace authority              | Thoth identity, controls, and canonical Timeline owner for a user-visible Provider conversation/topic                                           |
| `Turn`                | Workspace authority              | One user send and its durable foreground lifecycle; freezes Queue/Interrupt, Thoth controls, and Provider features                              |
| `Task`                | Workspace authority              | Smallest user-controllable Quick/Loop execution unit; owns contract, goals, decisions, memory, and evidence                                     |
| `PhaseRun`            | Task authority                   | Semantic phase intent for PlanExec, Review, or audit                                                                                            |
| `ExecutionAttempt`    | Runtime Truth + durable receipts | Exactly one Provider run; may fail, be canceled, become orphaned, or be replaced by a new attempt                                               |
| `ProviderThread`      | Provider/Adapter                 | Opaque native handle, persistence, and lineage metadata; never equivalent to Task                                                               |
| `Card`                | Workspace authority              | Durable suspension boundary awaiting a user decision                                                                                            |
| `HumanDecision`       | Workspace authority              | Append-only user command with actor and provenance                                                                                              |
| `TaskBlackboardEntry` | Task authority                   | Reusable semantic facts, contract, decisions, reports, and blockers                                                                             |
| `Evidence`            | Task authority                   | Unambiguous record supporting completion, failure, Review, and acceptance judgments                                                             |

Loss of a ProviderThread affects only how the next ExecutionAttempt is created; it cannot invalidate Task Truth, a pending Card, a Human
Decision, or a completed Review. Provider sessions are not copied or merged, and Thoth authority cannot be reconstructed backward from a native transcript.

### Task Truth and Runtime Truth

The two kinds of information must be physically and conceptually separated:

| Task Truth                                       | Runtime Truth                                                  |
| ------------------------------------------------ | -------------------------------------------------------------- |
| User intent and frozen contract                  | attempt id, generation, and native turn id                     |
| goals, constraints, and acceptance               | leases, deadlines, budgets, and retry bookkeeping              |
| Human Decisions                                  | Provider cursor, opaque thread handle, and persistence receipt |
| semantic Task Blackboard                         | RuntimeBundle digest and attachment receipt                    |
| PlanExec report and Review Direction Memo        | tool-call correlation, approval timers, and callback fences    |
| evidence meaning, blockers, and completion state | process handles, stream buffers, and active execution registry |

Runtime Truth supports safe execution and recovery but must not be written into a Provider prompt as semantic memory. Task Blackboard retains only
what the Provider genuinely needs to understand for its next execution and does not expose internal attempt, lease, cursor, or hash bookkeeping.

### Human Decision

All user decisions are submitted as append-only records and must include at least command identity, actor/client identity, target
authority revision, original answer, and time. Duplicate commands must be idempotent; revision conflicts must return an explicit conflict, not
last-write-wins.

Recommendations, plans, or text generated by the Provider are not Human Decisions. UI optimistic state is not a Human
Decision either. Cards, approvals, Plan implementation, or Task controls take effect only after the daemon completes the CAS commit.

## Workspace and Task lifecycle

### Workspace lifecycle

```text
registered -> active -> archiving -> archived
                  \-> error/recovery -> active
```

Workspace registration establishes catalog identity and opens an independent authority shard on demand. Archive first commits authority, then stops
new mutations, settles active executions, releases the store, and updates the client projection. Client layout deletion cannot
precede archive authority, and a missing entity cannot be treated as an operable Workspace.

### Foreground Agent lifecycle

```text
initializing -> idle -> queued/running -> idle
                    \-> awaiting_user -> idle
                    \-> stopping -> idle/error
          idle/running -> archived
```

Each Send freezes the following in the daemon:

- the current visible Agent and Workspace;
- `queue | interrupt` delivery policy；
- the current Provider/model/features;
- Agent-scoped `default | plan` run mode；
- Thoth on/off, Clarify, and Quick/Loop controls;
- attachments and structured `@Task` references.

`Queue` is the default behavior; one Agent runs only one foreground execution at a time. `Interrupt` must persist the new send first,
then fence the old generation before starting the new Turn. App does not maintain an independent queue or optimistic user Timeline authority.

### Task lifecycle

The canonical Task lifecycle is executed jointly by Core transitions and the Workspace Repository:

```text
draft/clarifying
      |
      v
contract_pending -> ready -> running -> reviewing -> succeeded
        |             |        |           |
        +-> canceled  +-> paused|           +-> revise -> running
                               +-> blocked
                               +-> failed
```

The exact wire enum is governed by `packages/protocol/src/task-authority.ts`; the diagram expresses ownership and primary directions and does not allow
UI, Driver, or scheduler to invent additional authoritative states.

### Clarify and Loop

Thoth supports three product semantics on the same Agent main path:

1. **Raw foreground turn:** Does not attach a Thoth RuntimeBundle; the Provider Harness executes according to native session behavior.
2. **Clarify/Quick turn:** Attaches `thoth.clarify` to the same visible ProviderThread and uses semantic tools to form
   a durable Clarify, Task, or Goals Card; after confirmation, it executes one contract-constrained Quick work unit.
3. **Loop:** After Clarify completes the Task/Goals contract, registers a durable background Task and cycles through PlanExec, Implement,
   Review, and necessary revise attempts until success, blockage, failure, pause, or user stop.

Loop PlanExec must start in verified native Plan mode and produce durable Plan output and normalized Implement
approval. After the user or policy selects Implement, the Adapter continues implementation on the same ProviderThread; Review is an independent
Provider execution that produces a structured judgment and Direction Memo. Thoth does not judge code quality itself or replace Review intelligence
with string rules.

## HarnessAdapter, RuntimeBundle and ToolGateway

### HarnessAdapter

`HarnessAdapter` is the sole Provider execution SPI. It covers these capability families:

- capability discovery；
- ProviderThread create/resume/replace/persist/archive；
- instructions and runtime tool attachment;
- execution start/event stream/replay/settlement；
- cooperative/forceful interrupt；
- permission, question, and native Plan approval;
- attachment and native anchor receipts；
- legacy provider session offline adoption。

Application code depends only on typed capabilities and receipts. For example, native Plan is proven by `ProviderPlanCapability` and
`ProviderRunModeReceipt`; it must not write `if (provider === "codex")` to change product flow. Provider-specific
errors are normalized at the Adapter boundary while raw diagnostics are retained as execution evidence.

### RuntimeBundle

RuntimeBundle is a content-addressed immutable artifact:

```text
RuntimeBundle {
  id: "thoth.clarify" | "thoth.loop"
  digest: "sha256:..."
  instructions: string
  tools: RuntimeBundleTool[]
  scopes: string[]
  sourceName: string
}
```

Before execution, the Daemon resolves the bundle, verifies its digest, selects instruction/tool attachment declared supported by the Adapter,
and first persists the `RuntimeAttachmentReceipt`. The same digest is stored only once; Task/Attempt reference the receipt rather than copying the Skill
directory, Prompt packet, or Provider home into the Workspace.

`SKILL.md` is a built-in behavioral instruction artifact; the runtime packet carries only this round's data. Business contracts do not identify tool calls through pseudo-packets in preset
prompts; structured tool schemas and ToolGateway are the callback boundary.

### ToolGateway

`ToolGateway` converts Provider runtime tool calls into Thoth durable commands:

```text
Provider tool call
  -> Adapter normalizes name/input/call receipt
  -> ToolGateway resolves active Workspace/Task/Turn
  -> validate bundle digest + tool scope
  -> verify attempt + generation + phase + authority revision
  -> Core transition + Workspace Repository/UoW commit
  -> publish canonical projection/event
  -> return normalized tool result through Adapter
```

`taskId`, `stateId`, generation, or phase submitted in Provider payloads cannot be trusted directly; Gateway uses the current active
execution binding as authority. Late, duplicate, out-of-scope, or old-generation callbacks must be idempotently rejected and must not restore an old
Turn, overwrite a new decision, or create a phantom Card.

### Native tools, MCP and ACP

Native dynamic tools, MCP, and ACP are merely three Provider transports for the same semantic tool catalog:

```text
                    one semantic RuntimeBundle tool
                               |
               +---------------+---------------+
               |               |               |
          native tool         MCP tool        ACP tool
               |               |               |
               +--------- HarnessAdapter ------+
                               |
                          ToolGateway
```

MCP does not own Thoth clarify architecture or store Card continuation. When a Provider supports only MCP, the Adapter
may start an execution-scoped MCP binding; when native registration is supported, it may register directly; the same applies to ACP. All three must produce
the same normalized call, authority transition, and result and must not evolve into three product behaviors.

### Durable Card suspension

Card is neither an in-memory suspended Promise nor a Provider tool call that waits for hours:

1. A runtime tool requests creation of a Card.
2. ToolGateway validates and commits the Card, Turn/Task suspension, and Timeline item in a Workspace transaction.
3. The current ExecutionAttempt is fenced and ended; late reasoning/text/tool events are rejected.
4. UI renders the Card from the daemon projection; the Provider process stack no longer bears responsibility for waiting.
5. The user submits answer/cancel as an append-only Human Decision through semantic RPC using CAS.
6. The Daemon waits for the old run to actually release, then starts continuation on the same ProviderThread or an explicit replacement lineage.

`You recommend` is a real answer command. Only explicit Cancel/Stop can resolve an unanswered Card; restart, disconnection,
or page unload must not lose it.

## Protocol and RPC Registry

All clients use the same WebSocket connection. Text frames carry JSON handshake, events, and RPC; binary frames carry terminal
and file streams, avoiding base64 encoding of high-frequency bytes.

### Handshake

```text
Client -> Daemon: hello {
  clientId,
  clientType,
  protocolVersion,
  appVersion?,
  capabilities?
}

Daemon -> Client: server_info {
  serverId,
  version,
  capabilities,
  features
}
```

Connection liveness and RPC timeout are separate: RPC timeout means only that the operation did not complete and cannot directly imply that the socket
or daemon has died. After reconnect, the client rehydrates snapshots and catches up on missing increments through the Timeline cursor.

### RPC Registry

`rpcRegistry` defines the name, input schema, output schema, and handler contract for each operation. The Client typed
broker, daemon handler table, and outbound schema are derived from the same Registry; parallel switches must not be handwritten in three places.

The process for adding an operation is:

1. Define the unique semantic name and schemas in the Protocol Registry.
2. Bind one use case in the daemon application handler table.
3. Expose a semantic method from Client rather than leaking a raw envelope to UI.
4. Add parse, dispatch, error, and capability compatibility tests.

Binary terminal/file codecs remain in an independent registry because they are high-frequency stream protocols, not JSON RPC.

### Compatibility rules

- Wire schemas are append-only by default; new fields are optional/defaultable.
- Removing or tightening old fields requires an explicit migration decision and compatibility test.
- New enum/value entries are capability-gated at the sender; old clients must not be required to guess.
- Requests/responses use request-id correlation; failures use typed RPC errors, and the stack is not a protocol.
- Provider-native payloads do not pass directly through the public protocol; they are first normalized to Thoth semantic types, with raw data only as evidence/details.
- RPC name, Timeline view, and VCS action each have exactly one declarative registry.

## Timeline and projection

Canonical AgentTimeline is persisted by daemon Workspace authority. It records unified timeline items including user messages, assistant output,
reasoning, tool calls, permissions, Plan, Cards, system notices, Task state, and evidence links.

```text
Provider events / Human commands / Task transitions
                        |
                 daemon normalization
                        |
           WorkspaceAgentTimelineStore
                        |
             sequence + epoch + cursor
                   /             \
             live events    authoritative pages
                   \             /
            DaemonProjectionService
                        |
             AuthorityProjectionStore
                        |
                 AgentTimeline UI
```

Rules:

- Daemon timestamp, sequence, message identity, and epoch are canonical.
- Live streams provide immediacy; bounded paged fetch/catch-up provides correctness. `limit=0` cannot create an
  unbounded production read.
- Client deduplicates by identity/sequence/cursor, not by textual similarity.
- Canonical ingress truncates textual content once at a UTF-8-safe boundary of at most 64 KiB and records
  truncated/original/retained byte metadata. Live and durable projections use the same object, and no complete
  output copy is retained elsewhere in Thoth authority.
- Provider-native subagents appear only as bounded nested read-only traces under their parent AgentTimeline; they
  do not mint Agent, Task, or Workspace authority.
- Rewind binds the canonical Thoth message id to a versioned adapter-owned opaque Provider anchor receipt.
- Successful Conversation/both rewind resets the canonical Timeline epoch.
- Unknown or ambiguous legacy anchors display unavailable; Provider position must not be guessed.
- App's Timeline model is a read-only projection and is not dual-written with the daemon Timeline.

## Data flow

### Running a raw foreground turn

```text
1. User presses Send
2. App -> Client.send(... queue|interrupt, Agent controls)
3. Protocol validates RPC
4. ForegroundTurnCoordinator commits Turn and delivery policy
5. ExecutionService asks HarnessAdapter to run without Thoth RuntimeBundle
6. Adapter events -> daemon normalization -> canonical Timeline/store
7. Live projection streams to every subscribed client
8. Settlement commits idle/error and final execution receipt
```

Raw turns preserve Provider-native intelligence and session continuity; Thoth does not perform Clarify repair, structured cards, or hidden routing.

### Running Clarify or Quick

```text
1. Send freezes Clarify/Quick controls
2. Daemon resolves thoth.clarify RuntimeBundle by digest
3. HarnessAdapter attaches instructions + semantic tools
4. Provider reasons and may call thoth.clarify.*
5. ToolGateway validates and commits Card/contract/decision
6. Card suspends the attempt or confirmed contract continues execution
7. Output, tool receipts and evidence append to canonical Timeline
```

Clarify question quality comes from the Provider Harness plus RuntimeBundle instructions; the Daemon handles only schema, provenance,
state, generation, and mechanical convergence guards. It does not use local semantic heuristics to replace the Provider's judgment of what to ask.

### Running a Loop

```text
Clarify
  -> Task Card confirmed
  -> Goals Card confirmed
  -> durable Task registered
  -> PlanExec in verified native Plan
  -> normalized Implement approval
  -> implementation on same ProviderThread
  -> independent Review
       -> pass: evidence + succeeded
       -> revise: Direction Memo -> new PlanExec/implementation attempt
       -> blocked: durable blocker / user decision
```

Each PhaseRun may have multiple ExecutionAttempts, but one attempt belongs to only one phase/generation. Review cannot modify the
PlanExec transcript; it reads necessary context through Task Blackboard and artifacts and writes an independent assessment/evidence.

### Answering a Card after restart

```text
1. Daemon opens catalog and Workspace shard
2. Rebuilds pending Card/Turn/Task projection before live Agent state
3. Client fetches authority and renders the same Card
4. User answer commits HumanDecision with expected revision
5. Scheduler provisions same or replacement ProviderThread
6. New attempt receives semantic continuation context
```

Recovery does not depend on callbacks in an old process, page state, or a copy of the Provider transcript.

## Storage

Canonical topology：

```text
~/.thoth/
  catalog.sqlite
  runtime-bundles/
    sha256/<digest>/bundle.json
  workspaces/<workspaceId>/
    authority.sqlite
    blobs/sha256/<prefix>/<digest>
    artifacts/<taskId>/<phaseRunId>/
  runtime/
  logs/
  secrets/
```

### Global catalog

`catalog.sqlite` owns only:

- global settings；
- Provider profiles and non-secret references;
- Workspace Registry；
- Task locators rebuildable from Workspace shards;
- Host-runtime service-port leases and their generation/activation receipts;
- storage schema/version and migration bookkeeping.

It does not store complete Task authority, become a global Loop database, or place all Workspaces in one shared contention
domain.

### Workspace authority shard

Each Workspace's `authority.sqlite` owns normalized Agent, ProviderThread reference, Turn, Card, Human
Decision, Task, Goal, PhaseRun, ExecutionAttempt, attachment, Blackboard, context binding, Timeline,
evidence, command, lease, and incremental event tables.

Repository/UoW commits current rows and necessary increments in one SQLite transaction. Incremental records express what happened,
without duplicating the entire projection. SQLite schema/migration is managed uniformly by the store lifecycle; DDL is not executed temporarily in each use-case constructor.

### Blobs and artifacts

Large payloads are stored by SHA-256 content address; SQL stores only digest, size, media type, ownership, and lifecycle
references. Task artifacts are organized by Task/PhaseRun, but completion is still referenced by an Evidence record and cannot be inferred merely from file existence.

Workspace image previews use daemon/Relay binary reads; the client creates only transient Blob/data URIs; preview
bytes must not be covertly copied into durable attachments.

### Provider-owned storage

The following explicitly do not enter `~/.thoth/workspaces/*`:

- Provider auth tokens and login state;
- Codex/Claude/OpenCode/Pi/ACP homes；
- Provider native transcripts；
- Provider KV, prompt, tool, and model caches;
- session retention data that the Provider can manage itself.

Thoth stores only opaque handles, Adapter persistence receipts, and necessary evidence. Migration from an old installation must be offline, atomic,
and one-way: remove the old layout on success; retain the source and reject runtime fallback on failure.

## Concurrency, fencing and recovery

### Revisions and idempotency

- Workspace authority has a monotonic revision.
- User commands carry a command ID and expected revision.
- Repository performs CAS, transition, record append, and projection update in a transaction.
- Duplicate commands return the same committed result; conflicting commands return conflict without partial writes.

### Attempt generations

Each Provider execution is bound to `workspaceId + task/turnId + attemptId + generation + bundle/scope`. Every Provider
event, tool call, approval, and settlement must match the active binding. Interrupt, Stop, Card suspension, rewind,
or a replacement attempt fences the old generation.

### Schedule and Host resource leases

- A Schedule belongs to one Workspace. Each trigger creates a real Task and ExecutionAttempt and publishes the
  same canonical Timeline/Evidence lifecycle as an interactive run.
- Schedule mutation is serialized by the existing Workspace mutation lease unless the user explicitly selected a
  worktree Workspace. A trigger never creates an Agent-only shadow run.
- Host service ports use durable `reserve -> spawn -> activate` leases. Spawn failure, cancellation, stale
  generation, and crash recovery roll back or reclaim the lease; two Workspaces cannot activate the same port.
- Daemon PID locks carry heartbeat and instance fencing. Shutdown rejects new session/provider registrations before
  draining in-flight registration; failed initialization releases processes, handles, and leases.

### Tasks, Schedules and Workspace scripts

- `TaskProjection.origin` is nullable and, when present, identifies the owner Workspace, Schedule and run. A
  Schedule run separately records nullable actual execution Workspace, Task and ExecutionAttempt identifiers.
  These are canonical contract projections, not App-computed links; pre-v4 rows with unprovable execution
  Workspace stay `null`.
- The product presents one `Tasks` entry with `Tasks | Schedules`. The Tasks projection includes Loop, manual
  background and Schedule-origin Tasks. Schedules management never creates a parallel list authority.
- Protocol Registry and Client expose only Workspace-script list/start/stop. Workspace authority validates the
  configured script; Host runtime SQLite stores the generation-fenced process/terminal/route/port receipt; the
  in-memory process handle is rebuildable. Start/stop use the existing service-port `reserve -> spawn -> activate`
  transaction and release every acquired resource on failure, abort or stop.
- Provider tools do not accept `workspaceId`. ToolGateway derives Workspace, Agent, execution/turn and generation
  from the current binding. Clarify may list only; eligible Quick/Loop execution requires explicit permission for
  start/stop. Raw Thoth-off execution receives no RuntimeBundle tool.

### Physical transport, E2EE and file streaming

- One Daemon-owned physical socket carries a maximum 8 MiB queued-byte high-water and a 45-second application
  lease scanned every 10 seconds. Valid application activity/heartbeat renews the current physical connection;
  replacement sockets cannot be killed by a stale lease. Expiry closes only that socket and is reported in
  diagnostics.
- E2EE hello/ready negotiates `binaryCiphertext`. Negotiated text remains encrypted base64 text; negotiated binary
  application payloads remain encrypted binary WebSocket frames. A legacy peer uses the one explicit base64
  compatibility branch until the supported peer floor permits removal after `2027-01-27`. Frame identity comes
  from the physical callback, never from decrypted UTF-8 guessing.
- File transfer advertises size and optional revision from one read-only handle, then awaits independent 256 KiB
  sends. Growth sends only the advertised prefix but a changed final revision aborts; shrink, overwrite,
  premature EOF, read/send error or byte-count mismatch cannot emit or expose success. Client aggregates by
  `requestId` and reveals no partial result.
- Relay forwards opaque text/binary ciphertext and owns no plaintext, offline queue, Task state or global send
  queue. Direct and Relay transports normalize `void | Promise<void>` send completion at the same boundary.

### Provider usage and runtime ancestry

- Drivers own the `ProviderUsageReader` SPI, credentials/API parsing, model/surface-scoped Claude windows, OMP
  effort metadata and Provider-native ancestry. Daemon registers normalized readers, performs TTL cache/in-flight
  deduplication and aggregates receipts without importing parsers or inspecting Provider identity.
- Idle release uses a 30-minute policy. A running or pending managed/provider-native descendant pins its ancestor;
  completed/canceled/error descendants do not. Parent close drains child events, and forced termination
  canonicalizes any still-running child to canceled. Child traces remain bounded, nested, read-only Timeline data
  and never create Agent, Task or Workspace authority.

### Stop and cancellation

Stop order is fixed:

1. Commit `stopping` / `cancel_requested` authority;
2. Fence all old callbacks;
3. Return the new projection to the client;
4. Request an Adapter interrupt;
5. Record the Provider confirmation, timeout, or orphan receipt.

Executions with unconfirmed cancellation enter Workspace quarantine/orphaned state and cannot continue writing Task Truth. UI activity comes from the canonical
ExecutionProjection, not from hidden Agent snapshots or process presence.

### Crash recovery

Daemon startup opens the catalog first, then opens Workspace shards on demand, restores durable Agent/Turn/Card/Task authority,
and only then accepts live Provider events. The Runtime registry can be rebuilt; pending Cards, Human Decisions, Task state, and
Timeline do not depend on reconstruction.

When a ProviderThread is recoverable, the Adapter uses opaque persistence; when it is not, it creates an explicit replacement lineage and writes
the reason to attempt evidence. The system must not silently fall back to a copied Provider home or legacy database.

## Permissions and security

Permissions have three distinct levels and must not be conflated:

| Boundary                              | Authority                             | Rule                                                                                                           |
| ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Provider tool/file/command permission | Provider + daemon approval controller | Retain the original request and resolve by policy or user decision                                             |
| Provider question                     | Provider Harness                      | Normalize presentation; never answer automatically via a background approval timer                             |
| Thoth Card / contract decision        | Workspace HumanDecision               | Must be submitted by the user or an explicit Card command; never auto-approved as ordinary Provider permission |

Eligible Provider approvals for background PlanExec, Review, and audit have a durable 20-second human window, after which the
daemon actor approves them only once through CAS, including policy-compliant write permission. Provider questions and Thoth authority
Cards are never auto-approved. Permissions for ordinary foreground Agents continue to follow user/Provider policy.

Other security rules:

- Daemon resolves the Workspace canonical cwd from `workspaceId`; a remote client path cannot override it.
- ToolGateway does not trust authority identifiers submitted by the Provider.
- Secrets are not written to Timeline, ordinary logs, URLs, Relay payload metadata, or release receipts.
- Relay pairing credentials are not long-lived login tokens.
- Provider auth is managed by the Provider's official control surface; Thoth does not fake auth tests.
- Workspace file/path operations must pass daemon boundary validation.
- HTTP service proxy and WebSocket upgrade share one `ForwardedAuthorityResolver`. Direct `Host` and
  `X-Forwarded-*` input is untrusted; only a configured trusted peer may forward proto/host/port, and the result
  must match registered route or configured `publicBaseUrl` authority with a valid non-conflicting port.

## Relay and multi-device sync

Direct clients and Relay clients use the same semantic Client and Protocol. Relay changes only the transport:

```text
Client <-> encrypted channel <-> zero-knowledge relay <-> encrypted channel <-> Daemon
```

The Daemon is always the authority publisher. Multiple devices may observe, issue commands, and answer Cards simultaneously, but revision/CAS determines the single
result. After a device disconnects, it recovers through snapshots, cursors, and paged Timeline catch-up; there is no Relay cloud truth or
offline mutation queue.

## Deployment models

### Direct daemon

CLI, Web, or a development App connects directly to the local daemon. Thoth listens on `127.0.0.1:6688` by default. The local Paseo/legacy
`127.0.0.1:6767` is a reserved parallel port; Thoth does not probe, reuse, stop, restart, or fall back to it.

### Desktop

The Electron bundle contains the App Web export and a managed daemon entrypoint. Desktop manages only the daemon it starts and uses
the same Client/Protocol; native menus, windows, installers, and file integration do not change the authority chain.

### Remote via Relay

The Daemon connects to Relay proactively; remote App/CLI uses the same API through an E2EE channel. Relay deployment authority is in a separate
repository; changing this repository's Relay package does not mean the service has been deployed.

### Mobile, Web, TUI and CLI

These surfaces are all thin clients of the same daemon. Current release platforms, review URLs, build artifacts, and release scope are dynamic
project state and should be read from `project-index.md`, `docs/packaging.md`, and `docs/release.md`, not hard-coded into the architecture.

## Testing and conformance

Tests are layered by risk and ownership:

| Layer               | Proof                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------- |
| Protocol            | Schema parse、compatibility、Registry derivation、binary codec round-trip                               |
| Core                | Pure transitions, invalid state, conflicts, idempotency, and deterministic replay                       |
| Repository          | SQLite transactions, migrations, rollback, shard isolation, and crash reopen                            |
| HarnessAdapter      | Capability, thread, execution, event, interrupt, approval, tool attachment, and persistence conformance |
| ToolGateway         | Scope/generation fencing, duplicate calls, late callbacks, CAS conflicts, and normalized results        |
| Application         | Raw/Clarify/Quick/Loop/Card/PlanExec/Review/Stop/rewind behavior                                        |
| Client              | Semantic API, direct/Relay parity, reconnect, RPC errors, and binary routing                            |
| App/TUI/CLI/Desktop | User-visible behavior, projection correctness, visual/interaction, and packaged lifecycle               |
| Real Provider       | Real capability/receipt and end-to-end behavior of the official Harness; explicit opt-in                |

Unit tests use `*.test.ts(x)`; local-resource e2e tests use `*.local.e2e.test.ts`; real Providers use
`*.real.e2e.test.ts` or an explicit real-provider project and do not enter the default Foundation gate.

Standard root gates:

- `npm run check:foundation`: repository validation, format, lint, build, typecheck, and default tests.
- `npm run accept:refactor:fast`: the sole five-minute comprehensive gate for the current feature-zero-loss refactor.
- Narrow package/root scripts: run the affected boundary first for behavior changes, then decide whether to expand.
- `git diff --check`: whitespace hygiene before handoff.

Gates prove only the scope actually executed in this round. Failures must preserve evidence and root causes; do not delete flaky tests, lower thresholds, replace samples,
enable fallbacks, or treat `done` as `verified`.

## Paseo and Multica reference boundary

### Paseo

Paseo is an important source and continuing reference for Thoth's current production-grade frontend, desktop, transport, and Provider integration,
but is not Thoth product authority. Thoth retains and adapts its mature experience without inheriting Paseo's AgentManager,
file-backed JSON, or provider-session-as-truth mental model.

| Reference area                                           | Thoth use                                                         | Boundary                                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Paseo `packages/app` AgentTimeline/composer/workspace UI | Real releasable UI substrate and interaction-quality baseline     | App may consume only the Thoth daemon projection                                |
| Paseo daemon WebSocket/terminal/file flows               | Protocol and local-tool capability reference                      | RPC is normalized to the Thoth Registry; authority enters Workspace shards      |
| Paseo Provider integrations                              | Driver transport and event-coverage reference                     | Must implement the unified HarnessAdapter; retain no Provider business branches |
| Paseo Desktop                                            | Reference for Electron packaging, windows, and native integration | Desktop does not own task truth                                                 |
| Paseo Relay                                              | E2EE transport reference                                          | Relay remains ciphertext-only, with no cloud truth                              |

The local Paseo/legacy daemon on `127.0.0.1:6767` is an independent service and cannot be used as a Thoth runtime fallback.

### Multica

Multica is used only to understand agent-product organization, engineering governance, and interaction design. Its source must not be copied into this repository or become a runtime
dependency. Any reference must be re-expressed as Thoth's own requirement, decision, interface, and acceptance, and
must follow the Workspace/Task authority established after `NTH-CD-060`.

## Historical documents

- [Core Design Principles](./core-design-principles.md): highest-level product and authority design principles.
- [thoth-high-level-design.md](./thoth-high-level-design.md): product-level system boundaries.
- [thoth-mvp-user-journey.md](./thoth-mvp-user-journey.md): user journey; does not own code ownership.
- [thoth-app-runtime-contract.md](./thoth-app-runtime-contract.md): product runtime contract for App, Clarify, Quick, and Loop.
- [thoth-prompt-contract-seeds.md](./thoth-prompt-contract-seeds.md): semantic seeds of archived prompt assets.
- [thoth-migration-architecture-20260625.md](./thoth-migration-architecture-20260625.md): early long-form migration document, for historical tracing only.
- [`../../docs/runtime-tool-bridge-clarify-research.md`](../../docs/runtime-tool-bridge-clarify-research.md): factual research on Claude Code, Codex, and OpenCode runtime tool / clarify behavior.

If older documents or historical commits still contain provider session authority, global Loop database, copied Provider home,
copied Skill directory, process-local Card Promise, provider-name recovery, full-projection event duplication, or
dual runtime paths, all have been superseded by `NTH-CD-060`, `NTH-CD-061`, `NTH-CD-063`, `NTH-CD-066`, and `NTH-CD-067`;
they must not be used to restore old implementations.
