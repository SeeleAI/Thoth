# New Thoth Engineering Architecture

## Status

1. 日期：`2026-06-28`
2. 性质：全新版本 Thoth 的工程架构文档
3. 范围：工程结构、运行拓扑、协议、daemon、authority、driver、ACP、多端打包、relay、git 模型、角色运行模型、参考项目映射
4. 边界：不重复 high-level 产品论证，不写用户点击教程，不放完整长 prompt
5. 原始归档：`.agent-os/designs/new-thoth-migration-architecture-20260625.md`
6. Reference HEADs:
   - Paseo: `507345dbee4a76df0b0ce42b98765c067623f28e`
   - Multica: `343ace89a7df30af42557e3fadd167db6196d30d`

## 1. Architecture Snapshot

New Thoth is a local-first task control-plane runtime with shared protocol clients and multiple UI shells.

Engineering inputs fixed for MVP:

1. Main stack: TypeScript / Node.
2. New core: no Python in the main product runtime.
3. Repo layout: `packages/` monorepo.
4. Authority storage: local app-owned SQLite.
5. Workspace policy: workspace is operated on, not authority storage.
6. UI shells: TUI, desktop app, mobile app, CLI.
7. TUI: OpenTUI-based, single-workspace control surface.
8. Desktop: Electron wrapper around the shared app client and daemon lifecycle manager.
9. Mobile: Expo / React Native client paired to the local daemon through direct or relay transport.
10. Relay: zero-knowledge E2EE WebSocket relay.
11. MVP harnesses: Claude Code and Codex.
12. Claude Code main path: Agent SDK / direct provider.
13. Codex main path: app-server provider.
14. ACP: first-version full adapter path with capability contract and conformance tests.

The system has six primary layers:

1. Protocol and client SDK.
2. Local daemon and authority store.
3. Router and context resolution.
4. Task lifecycle runtime.
5. Harness driver layer.
6. UI shells and relay sync.

## 2. Monorepo Packages

The repository should use a `packages/` workspace layout.

### 2.1 `packages/protocol`

Responsibilities:

1. Shared message envelopes.
2. Request/response schema.
3. Event schema.
4. Timeline item schema.
5. Permission and approval card schema.
6. Input route and routing override schema.
7. Action summary and report summary schema.
8. Task summary and report summary schema.
9. E2EE transport frame metadata.

Rules:

1. Protocol changes are append-only where possible.
2. Optional fields must not become required without migration.
3. UI shells must not define private task lifecycle schema.

### 2.2 `packages/client`

Responsibilities:

1. WebSocket client.
2. Relay E2EE client transport.
3. Direct localhost transport.
4. Reconnect and cursor catch-up.
5. Typed request helpers.
6. Subscription helpers for timeline, action list, task list, permissions, reports, provider health.

Rules:

1. Desktop, mobile, TUI and CLI share this client layer.
2. UI code cannot bypass `packages/client` to mutate daemon state.

### 2.3 `packages/core`

Responsibilities:

1. Pure domain types.
2. Task lifecycle state machine.
3. Role definitions.
4. Contract freeze model.
5. Loop policy.
6. Review verdict model.
7. Permission risk model.
8. Router decision model.
9. Action record model.
10. Context packet model.

Rules:

1. No UI dependencies.
2. No provider-specific process spawning.
3. No filesystem side effects except explicit pure serialization helpers if needed.

### 2.4 `packages/daemon`

Responsibilities:

1. Local authority server.
2. SQLite persistence.
3. Workspace registry.
4. Task registry.
5. Queue management.
6. Action execution record.
7. Router orchestration.
8. Role runtime orchestration.
9. Harness driver invocation.
10. Git baseline/diff/commit manager.
11. Timeline commit and broadcast.
12. Pairing endpoint.
13. Relay connection.

Rules:

1. Daemon owns task truth.
2. Daemon owns timeline timestamps.
3. Daemon owns write concurrency for workspaces.
4. Daemon is the only component allowed to move task lifecycle state.

### 2.5 `packages/drivers`

Responsibilities:

1. Shared `HarnessDriver` contract.
2. Claude Code direct provider.
3. Codex app-server provider.
4. ACP provider.
5. Provider capability detection.
6. Provider materialization helpers.
7. Permission bridge between provider and Thoth permission cards.
8. Provider conformance tests.

Rules:

1. Driver-specific behavior cannot leak into task authority.
2. Every driver must expose capabilities.
3. Every driver must support structured driver session metadata for role execution even if native runtime has different concepts.

### 2.6 `packages/tui`

Responsibilities:

1. OpenTUI app.
2. Single-workspace startup flow.
3. Current directory workspace adoption card.
4. Workspace chat.
5. Task queue.
6. Clarification and permission cards.
7. Task detail.
8. Provider health.

Rules:

1. No global home.
2. No direct authority writes.
3. No direct workspace mutation outside daemon protocol.

### 2.7 `packages/app`

Responsibilities:

1. Expo / React Native app.
2. Shared desktop web UI surface.
3. Global home.
4. Global chat.
5. Workspace pages.
6. Mobile pairing.
7. Cached read-only offline state.

Rules:

1. Global chat can bind a workspace by explicit reference or high-confidence context resolution.
2. Mobile cannot add local folders.
3. Offline mobile cannot send instructions or approvals.

### 2.8 `packages/desktop`

Responsibilities:

1. Electron shell.
2. Desktop packaging.
3. Managed daemon process.
4. Tray/background behavior.
5. Local pairing UI.
6. Desktop settings bridge.

MVP daemon lifecycle:

1. Desktop app detects daemon at startup.
2. Desktop app starts daemon if missing.
3. Closing main window may keep daemon in tray/background.
4. User can manually stop daemon.
5. MVP does not default to OS boot auto-start.

### 2.9 `packages/relay`

Responsibilities:

1. E2EE WebSocket relay.
2. Daemon channel.
3. Client channel.
4. Pairing session routing.
5. Ciphertext forwarding.

Rules:

1. Relay stores no task truth.
2. Relay stores no message plaintext.
3. Relay provides no offline queue.
4. MVP deployment can use a Cloudflare Worker route.
5. Medium-term deployment target includes seeles.ai hosted or self-hosted relay.

### 2.10 `packages/cli`

Responsibilities:

1. Daemon start/stop/status.
2. Workspace attach helper.
3. Pairing helper.
4. Diagnostics.
5. Scriptable `answer`, `direct_action` and `formal_task` commands.
6. Scriptable read-only task/status/report commands.

Rules:

1. CLI is an advanced surface, not the primary MVP user flow.
2. CLI uses the same protocol as other clients.

## 3. Runtime Topology

Runtime components:

1. UI shell.
2. Shared client SDK.
3. Local daemon.
4. SQLite authority store.
5. Workspace filesystem.
6. Harness process or harness app-server.
7. Optional relay.

Local desktop path:

1. Desktop app starts or connects to daemon.
2. Desktop app uses shared client transport.
3. Daemon reads/writes SQLite authority.
4. Daemon operates on selected workspace through controlled execution.
5. Daemon invokes harness drivers.
6. Timeline events are committed before broadcast.

TUI path:

1. TUI starts in a current working directory.
2. TUI connects to or starts daemon.
3. TUI binds to exactly one workspace.
4. TUI renders workspace read models and cards from daemon.

Mobile path:

1. Mobile pairs with daemon.
2. Mobile uses direct WebSocket when reachable.
3. Mobile uses relay when remote.
4. Mobile receives history catch-up by cursor.
5. Mobile submits instructions only when online.

## 4. Protocol And Client Layer

Protocol categories:

1. Session handshake.
2. Workspace registry.
3. Conversation messages.
4. Route decision and routing override.
5. Direct action execution.
6. Formal task creation.
7. Clarification cards.
8. Contract freeze cards.
9. Permission cards.
10. Queue operations.
11. Timeline stream.
12. Action detail.
13. Task detail.
14. Artifact summary.
15. Report summary.
16. Provider health.
17. Pairing and relay.

Required protocol invariants:

1. All task state changes flow through daemon.
2. All timeline events are daemon-owned.
3. Route decisions are daemon-owned.
4. Every streaming client can reconnect and catch up by cursor.
5. UI optimistic messages are never authoritative.
6. Direct and relay transports expose the same logical client API.
7. Mobile cached state is read-only when disconnected.

## 5. Daemon And Authority Store

Authority store is local app-owned SQLite.

Core tables or equivalent persisted collections:

1. `workspace`
2. `conversation`
3. `event`
4. `action`
5. `task`
6. `attempt`
7. `evidence_artifact`
8. `approval_request`
9. `memory_item`

Payload-first MVP rule:

1. `route_decision`, `clarification_session`, `decision`, `assumption`, `acceptance_spec`, `phase_result`, `role_session` and provider-native handles start as structured payloads or events.
2. They should become independent tables only after query, migration or durability requirements prove that the split is necessary.
3. `run` is driver/session implementation metadata, not a first-class authority object.
4. `loop` is task retry policy, not a first-class authority object.

Authority rules:

1. SQLite is the primary local truth.
2. Workspace directories do not contain the new authority store.
3. Workspace paths are referenced as operated resources.
4. Every task is reconstructable from persisted authority and timeline.
5. Every action is reconstructable from persisted operation records, evidence and timeline.
6. Every report links back to attempts and evidence artifacts.
7. SQLite backup and migration design is out of this MVP revision.

Read models:

1. Global home summary.
2. Workspace summary.
3. Action history.
4. Task queue.
5. Task detail.
6. Pending cards.
7. Provider health.
8. Mobile offline cache snapshot.

## 6. Workspace And Git Model

MVP uses a linear local-directory-like model.

Workspace identity:

1. One workspace maps to one real local directory.
2. A separate git worktree opened as another directory is treated as another workspace.
3. Same-path identity edge cases are intentionally weak in MVP.

Execution concurrency:

1. One workspace can have multiple task drafts in clarification.
2. One workspace can have multiple planning or review activities.
3. One workspace can have only one write Execute at a time.
4. Write execute tasks run through a FIFO queue.
5. User can reorder the queue manually.

Dirty state handling:

1. Before execution, daemon records git baseline.
2. If workspace is dirty, daemon shows confirmation card.
3. Daemon distinguishes pre-existing user diff from Thoth-generated diff.
4. Daemon commits only Thoth-generated diff.
5. If Thoth changes overlap user dirty files or hunks, execution pauses for user decision.

Commit policy:

1. `formal_task` write execution defaults to a Thoth-created branch or worktree.
2. Review passed triggers daemon commit by default.
3. Commit happens on the task branch or task worktree.
4. No auto push.
5. Git push is a high-risk direct action that requires approval unless full access is enabled.
6. Commit message is generated from task goal, acceptance and evidence.
7. Failed or blocked task does not auto commit.

## 7. Task Lifecycle Runtime

Input routes:

1. `answer`
2. `direct_action`
3. `formal_task`

Routing modes:

1. `auto`
2. `force_answer`
3. `force_direct_action`
4. `force_formal_task`

Minimal route types:

1. `InputRoute = answer | direct_action | formal_task`
2. `RoutingMode = auto | force_answer | force_direct_action | force_formal_task`
3. `PermissionMode = normal_approval | full_access`

`answer` behavior:

1. Handles status explanation, concept explanation, existing information queries and simple summaries.
2. May cite workspace reports, task state, memory, external sources or provider diagnostics.
3. Does not create an action or formal task unless the response includes a user-approved follow-up.
4. Must keep trivial conversational inputs on the fast path; `hi`-level inputs should return in under `10s` from the user's perspective.

Direct action behavior:

1. Runs for clear, short, low-clarification operations.
2. Can be read-only or controlled write.
3. Supports examples such as weekly report drafting, web news search, small copy edits and git push.
4. Uses permission preflight for high-risk operations.
5. Skips approval cards when `PermissionMode = full_access`.
6. Records an `ActionRecord`.
7. Does not create Draft Task.
8. Does not run contract freeze.
9. Does not enter the formal task attempt lifecycle.
10. Does not auto commit.

ActionRecord minimal fields:

1. User input.
2. Resolved scope and workspace.
3. Operation summary.
4. Approval reference if needed.
5. Evidence references.
6. Final status.
7. Upgrade suggestion if failed.

Formal task lifecycle:

1. User input creates Draft Task.
2. Clarify role collects goal, constraints and acceptance.
3. Contract freeze card requires user confirmation.
4. Each execution attempt contains Plan -> Execute -> Review.
5. Plan role creates execution plan from frozen task.
6. Execute role performs implementation or operation.
7. Review role checks evidence against frozen task.
8. Passed review commits and reports.
9. Failed review creates the next attempt only when the retry policy allows a non-repeating strategy.
10. After the default 3 failed attempts, task blocks and reports.

Formal task boundary:

1. Only `formal_task` enters Clarify -> Contract Freeze -> Attempt.
2. Each Attempt internally runs Plan -> Execute -> Review.
3. Direct action may suggest upgrade to formal task when failure requires multi-round diagnosis, validation matrix, broad writes or unclear acceptance.
4. Forced routing can override the automatic classification, but permission policy still applies.

Stop behavior:

1. User can stop a task anytime.
2. Current attempt and driver session stop.
3. Diff, logs, evidence and task state are preserved.
4. No automatic rollback.

## 8. Router

The Router is internal. It implements the private-secretary routing judgment without becoming a visible agent, squad, leader or team UI.

Responsibilities:

1. Intent classification.
2. Workspace and context resolution.
3. Routing override handling.
4. Provider and driver capability selection.
5. Permission preflight.
6. Evidence and report condensation.
7. Upgrade recommendation from direct action to formal task.

Context resolution:

1. Explicit workspace mention wins.
2. Workspace chat is bound to its current workspace.
3. Global chat uses recent conversation, active projects, workspace state, user habits and task history.
4. A single high-confidence candidate can be selected without asking.
5. Multiple plausible candidates require one golden question.
6. Low-confidence routing must not write to a workspace.
7. The system should trust high-confidence agent judgment instead of asking defensive confirmation questions by default.

Multica comparison:

1. Multica exposes agent, squad and mode choices as product objects.
2. New Thoth does not expose those objects to the user.
3. New Thoth borrows the durable short-action record and notification idea, not the visible team-management model.
4. Terms such as `run_only`, `quick_create` and `squad leader` are reference vocabulary only, not New Thoth user-facing concepts.

## 9. Role Runtime Model

Internal roles:

1. `Clarify`
2. `Plan`
3. `Execute`
4. `Review`

Runtime rules:

1. Every role runs through a harness driver.
2. Roles may use independent native driver sessions.
3. Native session handles are driver metadata, not first-class authority objects.
4. Within the same task, the same role can resume through stored driver metadata when the provider supports it.
5. Different roles do not share full chat history by default.
6. Inter-role handoff uses structured context packets and artifacts.
7. User sees One Thoth, not separate roles.

Role responsibilities:

1. `Clarify`: compile user intent into goal, constraints, acceptance and risk.
2. `Plan`: create a concrete plan without rewriting frozen authority.
3. `Execute`: perform changes and produce evidence, without declaring final success.
4. `Review`: check evidence adversarially, without modifying code.

## 10. Prompt Contracts

This document stores prompt contracts, not full prompt text.

Every role prompt contract must define:

1. Purpose.
2. Input packet.
3. Output packet.
4. Hard stops.
5. Context policy.
6. Evidence requirements.
7. Forbidden behavior.

### 10.1 `Router` Contract

Purpose:

1. Classify input into `answer`, `direct_action` or `formal_task`.
2. Resolve conversation scope and workspace context.
3. Respect routing overrides.
4. Select provider/driver capability without exposing provider choice in normal chat.
5. Run permission preflight before direct action or formal task execution.

Input packet:

1. User message.
2. Conversation scope.
3. Routing mode.
4. Recent conversation summary.
5. Workspace candidates and confidence signals.
6. Provider capability summary.
7. Permission mode.

Output packet:

1. Route decision.
2. Route reason.
3. Resolved workspace or unresolved candidates.
4. Required golden question if ambiguous.
5. Suggested driver family.
6. Permission preflight result.
7. Upgrade note if direct action should become formal task.

Hard stops:

1. Do not write to a low-confidence workspace.
2. Do not expose internal agent/squad/leader choices.
3. Do not route a clearly short direct action into formal task just to simplify implementation.
4. Do not skip permission policy unless `PermissionMode = full_access`.

### 10.2 `Clarify` Contract

Purpose:

1. Convert natural-language intent into a task-ready contract.
2. Identify assumptions and human-decision blockers.
3. Produce clarification cards and final contract freeze card.
4. Run only for `formal_task`.

Input packet:

1. User message.
2. Conversation scope.
3. Workspace summary if bound.
4. Relevant memory summary.
5. Existing draft task state.

Output packet:

1. Goal.
2. Constraints.
3. Acceptance.
4. Assumptions.
5. Questions.
6. Contract freeze proposal.

Hard stops:

1. Do not invent missing high-impact user decisions.
2. Do not mark a task ready with unresolved blocking acceptance.
3. Do not push agent-discoverable facts back to the user.
4. Do not run for `answer` or `direct_action`.

### 10.3 `Plan` Contract

Purpose:

1. Convert frozen task into a concrete execution plan.
2. Identify execution risks and required evidence.
3. Preserve frozen goal, constraints and acceptance.

Input packet:

1. Frozen task.
2. Acceptance spec.
3. Workspace facts.
4. Prior review findings if retry.

Output packet:

1. Execution plan.
2. Validation plan.
3. Risk notes.
4. Required artifacts.

Hard stops:

1. Do not change goal.
2. Do not change acceptance.
3. Return `needs_input` if frozen authority is insufficient.

### 10.4 `Execute` Contract

Purpose:

1. Execute the plan.
2. Produce diff, logs, receipts and other artifacts.
3. Report what was done and what evidence exists.

Input packet:

1. Frozen task.
2. Plan.
3. Workspace baseline.
4. Permission policy.
5. Prior retry hints if present.

Output packet:

1. Execution report.
2. Changed files summary.
3. Evidence artifacts.
4. Validator receipts if run.
5. Known risks.

Hard stops:

1. Do not declare final success.
2. Do not exceed permission policy.
3. Do not modify outside workspace without approval.
4. Do not overwrite user dirty changes.

### 10.5 `Review` Contract

Purpose:

1. Check execution against frozen task.
2. Identify missing evidence, regressions, scope drift and fake success.
3. Produce verdict and retry hint.

Input packet:

1. Frozen task.
2. Acceptance spec.
3. Plan.
4. Execution report.
5. Diff summary.
6. Logs and receipts.
7. Artifact summaries.

Output packet:

1. Passed or failed verdict.
2. Findings.
3. Evidence sufficiency judgment.
4. Retry hint if failed.
5. Human review requirement if needed.

Hard stops:

1. Do not modify files.
2. Do not accept missing evidence.
3. Do not redefine acceptance.
4. Do not treat executor self-report as proof.

## 11. Harness Driver Layer

Unified driver interface should expose:

1. `createSession`
2. `resumeSession`
3. `startTurn`
4. `streamEvents`
5. `streamHistory`
6. `respondPermission`
7. `interrupt`
8. `close`
9. `fetchCatalog`
10. `describeCapabilities`
11. `materializeSkills`
12. `materializeMcp`
13. `materializeSystemContext`

Capability matrix:

1. `supports_session_resume`
2. `supports_streaming`
3. `supports_mcp`
4. `supports_skill_injection`
5. `supports_system_prompt`
6. `supports_permissions`
7. `supports_model_switch`
8. `supports_thinking_level`
9. `supports_import_sessions`
10. `supports_background_safe`
11. `supports_structured_output`
12. `requires_file_context`
13. `skill_path_strategy`
14. `mcp_injection_strategy`
15. `permission_model`

Driver rules:

1. Drivers adapt provider-native events into Thoth timeline events.
2. Drivers preserve provider-native handles for resume.
3. Drivers report capability gaps explicitly.
4. Drivers do not own task lifecycle decisions.
5. Drivers do not write authority directly.
6. Drivers do not own route decisions.
7. Provider settings come from App settings and workspace policy.
8. Provider capability differences surface through diagnostics/settings, not normal chat.

## 12. ACP Support

ACP is a first-version MVP adapter path.

Implementation scope:

1. Implement `ACPAdapter`.
2. Define ACP capability mapping.
3. Define ACP session lifecycle mapping.
4. Define permission request mapping.
5. Define model/mode discovery mapping.
6. Define conformance tests.
7. Keep at least one real ACP harness path viable.

Relationship to Claude/Codex:

1. Claude Code MVP main path remains Agent SDK / direct provider.
2. Codex MVP main path remains app-server provider.
3. ACP is not a fallback-only footnote.
4. ACP is the first-version host-neutral adapter family for ACP-capable harnesses.

Future providers:

1. OpenCode can be direct or ACP depending on runtime capability.
2. Hermes should use ACP when available.
3. OpenClaw and QwenCode should enter through ACP first if they expose compliant servers.
4. Non-ACP providers can still use direct adapters.

## 13. Claude Code Driver

Main path:

1. Use Claude Agent SDK / direct provider style.
2. Preserve native session handle.
3. Stream model output, tool calls, permission requests and completion events.
4. Map Claude permission requests into Thoth permission cards.
5. Support role-specific session creation and resume.

Materialization:

1. Workspace context may require `CLAUDE.md`.
2. Skills and MCP config must be materialized by driver policy.
3. System prompts must be injected through provider-supported channels.

Driver must expose:

1. Session resume support.
2. Streaming support.
3. Permission support.
4. MCP support.
5. Catalog or availability status.

## 14. Codex Driver

Main path:

1. Use Codex app-server provider.
2. Preserve native thread/session handle.
3. Stream app-server notifications into Thoth timeline events.
4. Map Codex questions and permission events into Thoth cards.
5. Support role-specific session creation and resume.

Materialization:

1. Workspace context may require `AGENTS.md`.
2. Codex configuration may require managed config entries.
3. MCP config must be isolated from user unmanaged config where possible.
4. Reasoning effort and model selection are provider settings, not normal chat controls.

Driver must expose:

1. App-server availability.
2. Session/thread resume support.
3. Streaming support.
4. Structured event support.
5. Permission support.
6. Known timeout diagnostics.

## 15. Permission And Approval System

Permission sources:

1. Thoth policy.
2. Harness runtime prompts.
3. Workspace risk detection.
4. Git dirty state detection.
5. User approvals.
6. Permission mode.

High-risk operations requiring cards:

1. Write outside workspace.
2. Delete or overwrite important files.
3. Large file moves.
4. Dependency installation.
5. Network publishing.
6. Secret read/write.
7. Git push.
8. Long-running or high-cost task.

Card fields:

1. Request id.
2. Action id or Task id.
3. Operation summary.
4. Scope.
5. Risk.
6. Consequence of deny.
7. Allowed choices.
8. Expiration or stale marker.

Permission modes:

1. `normal_approval`
2. `full_access`

MVP rule:

1. No persistent "always allow".
2. Approval applies to the current request.
3. Denial is recorded as timeline and may block the task.
4. `full_access` skips approval cards.
5. `full_access` does not skip timeline, evidence, risk detection or final reporting.
6. Switching out of `full_access` restores approval cards for future high-risk operations.

## 16. Review And Attempt Control

Formal task shape:

1. Applies only to `formal_task`.
2. Clarify creates the task-ready contract.
3. Contract freeze confirms the task before execution.
4. Each Attempt runs Plan -> Execute -> Review.
5. Passed Review commits and reports.
6. Failed Review creates another attempt or blocks.

Review policy:

1. Review uses same provider by default but independent role runtime.
2. Review is adversarial against Execute.
3. Review may inspect execution report, diff, logs, receipts and artifacts.
4. Review does not modify files.
5. Review returns verdict and retry hint.

Failure focus:

1. `failure_focus` is the compact internal record that drives the next attempt.
2. It captures the failed point, root cause judgment, strategy change, evidence to produce and invalid action to avoid.
3. It replaces separate retry fields in the MVP object model.

Retry policy:

1. Every new attempt must target the previous failure point.
2. If `failure_focus` has no strategy change, do not retry.
3. If evidence was insufficient, the next attempt prioritizes evidence production.
4. If direction was wrong, the next attempt replans before executing.
5. If implementation quality was the blocker, the next attempt fixes the critical path instead of only adding tests.
6. Repeating the same command or small patch without a new strategy blocks the task.

Attempt exhaustion:

1. Default max failed attempts: 3.
2. After exhaustion, task becomes blocked.
3. Daemon preserves diff, evidence and state.
4. Report includes failure cause, repeated blockers, preserved evidence and next options.

## 17. Memory And Context Packets

Memory layers:

1. Global memory.
2. Workspace memory.
3. Task memory.
4. Provider capability memory.
5. Lessons memory.

Write policy:

1. Long-term memory writes happen after Review.
2. Memory candidates should cite evidence.
3. Failed tasks can produce lessons but not fake success.

Context packet rules:

1. Context packet is not full memory.
2. Context packet is role-specific.
3. Context packet is the minimum sufficient input for the role.
4. Context packet includes forbidden assumptions.
5. Context packet links to artifacts rather than pasting all logs.

Example packet fields:

1. `role`
2. `task_ref`
3. `goal`
4. `constraints`
5. `acceptance`
6. `relevant_decisions`
7. `workspace_facts`
8. `forbidden_assumptions`
9. `required_evidence`
10. `artifact_refs`

## 18. Multi-Device Sync

Sync invariants:

1. Live stream handles immediacy.
2. Authoritative history handles correctness.
3. Presence is not delivery.
4. Cursor catch-up must fill gaps.
5. Clients do not infer missing task states.
6. Desktop, mobile, TUI, CLI, Claude, Codex and ACP consume the same event semantics.
7. Conversation, action, task, attempt and approval request events share one authority stream.

Desktop:

1. Owns local daemon lifecycle.
2. Can show global home and workspace pages.
3. Can pair mobile clients.

Mobile:

1. Can read global and workspace summaries.
2. Can create tasks for existing workspaces while online.
3. Can answer clarification cards.
4. Can approve permission cards.
5. Can read reports.
6. Cannot add local folders.
7. Offline is cached read-only.

TUI:

1. Single-workspace view.
2. Starts from current working directory.
3. Can adopt current directory as workspace after confirmation.
4. Shares daemon protocol with app clients.

CLI:

1. Advanced local entry.
2. Uses the same daemon protocol.
3. Can force routing mode when explicitly requested.

Claude/Codex/ACP:

1. Host surfaces call the same daemon authority.
2. Host surfaces do not own lifecycle semantics.
3. Host surfaces can create `answer`, `direct_action` or `formal_task` inputs through the same route layer.

## 19. E2EE WebSocket Relay

Full name:

1. End-to-End Encrypted WebSocket Relay.

Relay responsibilities:

1. Forward encrypted frames between daemon and remote client.
2. Route by pairing/session metadata.
3. Sync authority state, conversation events, action events, task/attempt events and approval requests.
4. Keep no plaintext.
5. Keep no task truth.
6. Keep no offline message queue.

Pairing:

1. QR code primary.
2. One-time code fallback.
3. Pairing transfers daemon public key to client.
4. Client and daemon establish E2EE channel.

Deployment:

1. MVP prototype uses Cloudflare Worker route, following the Paseo relay shape.
2. seeles.ai can later provide hosted or self-hosted relay deployment.
3. Relay service remains zero-knowledge even when hosted.

## 20. TUI Implementation

Implementation stack:

1. `packages/tui`
2. OpenTUI runtime.
3. Shared `packages/client`.
4. Shared `packages/protocol`.

Startup:

1. Resolve current working directory.
2. Connect to daemon or request daemon start.
3. Check whether current directory is registered workspace.
4. If not registered, render adoption confirmation card.
5. After confirmation, bind TUI to that workspace.

Views:

1. Workspace chat.
2. Draft and ready tasks.
3. Queue.
4. Active task.
5. Pending cards.
6. Timeline.
7. Evidence and report summaries.
8. Provider health.

Rules:

1. No global home.
2. No direct SQLite access.
3. No direct workspace mutation.
4. No independent task state.

## 21. Desktop And Mobile App Packaging

Desktop:

1. `packages/desktop` uses Electron.
2. It wraps the shared app web client.
3. It manages daemon as a subprocess.
4. It supports macOS, Windows and Linux packaging.
5. It exposes pairing and daemon controls.

Mobile/web app:

1. `packages/app` uses Expo / React Native.
2. It supports iOS, Android and web.
3. It uses the same client protocol.
4. It supports direct and relay transports.
5. It caches read-only offline state.

Packaging policy:

1. Shared protocol types prevent UI drift.
2. Desktop and mobile differ in capabilities, not task semantics.
3. Mobile cannot perform local filesystem folder selection.

## 22. Reference Map: Multica

Local reference root:

1. `/mnt/cfs/5vr0p6/yzy/harness/multica`
2. HEAD: `343ace89a7df30af42557e3fadd167db6196d30d`

Reference files and extracted lessons:

1. `/mnt/cfs/5vr0p6/yzy/harness/multica/README.md`
   - Product framing for managed agents, teams, autonomous execution and multi-workspace usage.
   - New Thoth should absorb the control-plane framing, not copy product terminology.
2. `/mnt/cfs/5vr0p6/yzy/harness/multica/CLI_AND_DAEMON.md`
   - Shows daemon-centered CLI and task execution model.
   - New Thoth should keep daemon as control point while making UI shells first-class.
3. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/migrations/001_init.up.sql`
   - Shows relational tables for workspace, agent, issue, comment, inbox, queue, daemon connection and activity log.
   - New Thoth should use this as evidence that task control-plane data benefits from durable relational modeling.
4. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/agent.go`
   - Defines unified backend shape around `Backend.Execute`, `ExecOptions`, `Session`, message stream and result stream.
   - New Thoth should absorb the idea of a small upper interface with explicit capability differences.
5. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/claude.go`
   - Shows Claude Code CLI execution, stream JSON handling, prompt input and environment isolation concerns.
   - New Thoth should not use this as its Claude main path, but should learn from its runtime isolation and permission handling.
6. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/codex.go`
   - Shows Codex app-server behavior, session/thread handling, MCP config materialization, timeout diagnostics and token usage scanning.
   - New Thoth should use app-server as Codex main path and keep diagnostics first-class.
7. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/opencode.go`
   - Shows provider-specific project discovery and config injection needs.
   - New Thoth should model provider materialization as driver-owned behavior.
8. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/hermes.go`
   - Shows ACP-style session/new and session/resume behavior, MCP translation and provider edge cases.
   - New Thoth should use this as a cautionary reference for ACP session semantics and provider-specific quirks.
9. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/execenv/runtime_config.go`
   - Shows runtime configuration injection for different harnesses.
   - New Thoth should keep provider setup in drivers, not in task authority.
10. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/execenv/execenv.go`
    - Shows execution environment preparation.
    - New Thoth should keep workspace execution environment explicit and auditable.
11. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/local_directory.go`
    - Shows local directory execution model.
    - New Thoth MVP uses a similar linear local-directory-like workspace model.
12. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/daemon.go`
    - Shows daemon orchestration responsibilities.
    - New Thoth daemon should own queue, process orchestration and timeline truth.
13. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/repocache/cache.go`
    - Shows repository cache/worktree concerns.
    - New Thoth should avoid over-expanding this in MVP and keep one local directory as one workspace.
14. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/service/task.go`
    - Shows quick-create task context, enqueue, completion and failure inbox handling.
    - New Thoth should absorb the idea that short natural-language work can be queued and recorded without creating a full formal issue/task.
15. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/handler/issue.go`
    - Shows quick-create request validation, actor resolution and immediate 202 response.
    - New Thoth should keep server-side trust boundaries for direct action, but should not require the user to pick an actor.
16. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/handler/squad_briefing.go`
    - Shows squad leader briefing, routing protocol and no-action evaluation.
    - New Thoth should translate this into an internal private-secretary Router, not a visible squad UI.
17. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/execenv/context.go`
    - Shows distinct context rendering for normal task, quick-create and run-only autopilot.
    - New Thoth should keep `answer`, `direct_action` and `formal_task` packets distinct.
18. `/mnt/cfs/5vr0p6/yzy/harness/multica/docs/product-overview.md`
    - Shows the product distinction between issue-backed work and run-only background work.
    - New Thoth should use user-facing words such as 直接处理 and 正式任务, not Multica's internal mode names.
19. `/mnt/cfs/5vr0p6/yzy/harness/multica/docs/docs-outline.md`
    - Shows the documentation decision to describe internal run-only/create-issue modes with user mental-model words.
    - New Thoth should follow that principle and keep internal routing terms out of user-facing copy.

## 23. Reference Map: Paseo

Local reference root:

1. `/mnt/cfs/5vr0p6/yzy/harness/paseo`
2. HEAD: `507345dbee4a76df0b0ce42b98765c067623f28e`

Reference files and extracted lessons:

1. `/mnt/cfs/5vr0p6/yzy/harness/paseo/docs/architecture.md`
   - Defines client/server daemon architecture, mobile app, CLI, desktop app, relay, protocol and provider layout.
   - New Thoth should absorb the daemon/client/relay topology and shared WebSocket protocol approach.
2. `/mnt/cfs/5vr0p6/yzy/harness/paseo/docs/providers.md`
   - Distinguishes ACP provider path and direct provider path.
   - New Thoth should implement both: ACP as first-version adapter path, direct providers for Claude/Codex.
3. `/mnt/cfs/5vr0p6/yzy/harness/paseo/docs/custom-providers.md`
   - Shows how user-defined ACP-compatible providers can be configured.
   - New Thoth should use this as reference for future OpenCode/Hermes/QwenCode style extensibility.
4. `/mnt/cfs/5vr0p6/yzy/harness/paseo/docs/data-model.md`
   - Shows daemon identity, daemon keypair, persisted data, provider handles and client-side storage.
   - New Thoth should adapt daemon identity and E2EE keypair ideas while using SQLite as authority store.
5. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/protocol/src/messages.ts`
   - Source of protocol messages.
   - New Thoth should keep protocol as shared source of truth for clients and daemon.
6. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/client/src/daemon-client-websocket-transport.ts`
   - Direct daemon WebSocket transport reference.
   - New Thoth should provide equivalent direct transport in `packages/client`.
7. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/client/src/daemon-client-relay-e2ee-transport.ts`
   - Relay E2EE transport reference.
   - New Thoth should provide equivalent encrypted relay transport.
8. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/agent-sdk-types.ts`
   - Defines `AgentClient` and `AgentSession` interfaces.
   - New Thoth should adapt this style into `HarnessDriver` and role runtime abstractions.
9. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/provider-registry.ts`
   - Provider registry reference.
   - New Thoth should keep driver registration centralized and capability-aware.
10. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/claude/agent.ts`
    - Claude direct provider using Anthropic Agent SDK.
    - New Thoth Claude driver should follow this main path.
11. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/codex-app-server-agent.ts`
    - Codex app-server provider.
    - New Thoth Codex driver should follow this main path.
12. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/acp-agent.ts`
    - ACP base provider.
    - New Thoth should implement an ACP adapter with comparable session, streaming and permission responsibilities.
13. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/generic-acp-agent.ts`
    - Generic ACP provider.
    - New Thoth should use this as reference for user-defined or future ACP harnesses.
14. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/opencode-agent.ts`
    - OpenCode provider.
    - New Thoth should use this as a direct-provider reference for non-ACP provider-specific differences.
15. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/relay/src/`
    - Relay implementation directory.
    - New Thoth should use this as source reference for E2EE relay shape.
16. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/relay/wrangler.toml`
    - Cloudflare Worker relay deployment reference.
    - New Thoth MVP relay prototype should follow this deployment route.
17. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/app/package.json`
    - Expo / React Native app package reference.
    - New Thoth app should follow this multi-platform package style.
18. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/desktop/electron-builder.yml`
    - Desktop app packaging reference.
    - New Thoth desktop app should follow the Electron packaging route.

## 24. MVP Implementation Order

1. Create monorepo scaffolding and shared TypeScript config.
2. Define protocol schemas and SQLite authority store.
3. Implement daemon bootstrap.
4. Implement workspace registry plus global/workspace conversations.
5. Implement Router and context resolution.
6. Implement `answer`, `direct_action` and `formal_task` route inputs.
7. Implement fast-path `answer` latency guard.
8. Implement formal task draft, confirmation and queue.
9. Implement Clarify role quality gate and golden-question card path.
10. Implement Attempt plus Plan/Execute/Review role runtime.
11. Implement `failure_focus` and aggressive attempt policy.
12. Implement ActionRecord and direct action execution path.
13. Implement evidence artifacts, approval requests and full access mode.
14. Implement task branch/worktree dirty baseline and Thoth-generated diff commit policy.
15. Implement desktop app daemon lifecycle management.
16. Implement TUI single-workspace shell.
17. Implement CLI advanced entry.
18. Implement Claude direct driver.
19. Implement Codex app-server driver.
20. Implement E2EE relay prototype.
21. Implement mobile pairing and read/write online flows.
22. Implement ACP full adapter and conformance tests.
23. Implement report view and memory candidate write after Review.

MVP priority note:

1. Surface software development is not the hardest part of New Thoth.
2. The two hardest product/architecture gates are Clarify and aggressive loop behavior.
3. UI shells and harness drivers must not pull focus away from those two gates.

## 25. Test And Acceptance Plan

Protocol tests:

1. Schema parse tests for every request, response and event.
2. Backward-compatible optional field tests.
3. Direct and relay transport parity tests.
4. Route decision schema tests.
5. Routing override schema tests.
6. ActionRecord schema tests.
7. Permission mode schema tests.

Daemon tests:

1. Workspace add/list/remove.
2. Global chat high-confidence workspace resolution.
3. Global chat ambiguous workspace golden question.
4. High-confidence workspace resolution proceeds without defensive confirmation.
5. `answer` route does not create action or `formal_task`.
6. `answer` route returns `hi`-level inputs within `10s`.
7. `direct_action` route creates ActionRecord.
8. Direct action failure can suggest `formal_task` upgrade.
9. Draft Task creation.
8. Clarification card lifecycle.
9. Contract freeze confirmation.
10. Queue ordering.
11. Single write Execute lock per workspace.
12. Stop task preserves state.
13. Timeline cursor catch-up.

Driver tests:

1. Claude direct provider availability.
2. Claude driver session create/resume for role runtime.
3. Codex app-server availability.
4. Codex driver session create/resume for role runtime.
5. ACP adapter session lifecycle.
6. ACP permission mapping.
7. Capability matrix snapshots.
8. Provider error normalization.

Git tests:

1. Clean workspace auto commit after passed Review.
2. Dirty workspace baseline confirmation.
3. Commit only Thoth-generated diff.
4. Overlap with user dirty hunk blocks and asks.
5. No auto push.
6. `formal_task` writes happen on task branch or worktree.
7. Git push direct action requires approval in normal mode.
8. Git push direct action skips approval but records evidence in full access mode.

Review tests:

1. Executor self-report is insufficient without evidence.
2. Review passes with sufficient evidence.
3. Review fails with missing validator or artifact.
4. Failed Review creates the next Attempt when strategy changes.
5. 3 failed attempts block and report.
6. Reviewer cannot mutate files.
7. Failed Review records `failure_focus`.
8. Empty strategy change blocks instead of retrying.
9. Repeating the same failed action blocks instead of manufacturing progress.

UI tests:

1. Desktop starts daemon when missing.
2. Desktop global chat can bind explicit workspace.
3. Desktop global chat can bind one high-confidence implicit workspace.
4. Desktop global chat asks one golden question for ambiguous workspace.
5. TUI has no global home.
6. TUI adopts current directory after confirmation.
7. Mobile online can create direct action or `formal_task` for existing workspace.
8. Mobile offline is read-only.
9. Pending cards render consistently across desktop, mobile and TUI.
10. CLI, Claude, Codex and ACP surface the same action/task status.

Relay tests:

1. Pairing by QR payload.
2. E2EE direct payload cannot be read by relay.
3. Relay forwards ciphertext only.
4. No offline queue.
5. Cursor catch-up after reconnect.
6. Relay forwards conversation, action, task/attempt and approval request events with identical logical semantics.

Documentation acceptance:

1. High-level design contains no code-level architecture details.
2. User journey contains no code paths or schema terms.
3. Engineering architecture contains Multica and Paseo file-level reference maps.
4. Original source archive remains unchanged.
