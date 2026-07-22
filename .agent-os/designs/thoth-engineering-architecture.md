# Thoth Engineering Architecture

## Status

1. 日期：`2026-06-29`
2. 性质：全新版本 Thoth 的工程架构文档
3. 范围：工程结构、运行拓扑、协议、daemon、authority、driver、ACP、多端打包、relay、git 模型、角色运行模型、参考项目映射
4. 边界：不重复 high-level 产品论证，不写用户点击教程，不放完整长 prompt
5. 原始归档：`.agent-os/designs/thoth-migration-architecture-20260625.md`
6. Reference HEADs:
   - Paseo: `507345dbee4a76df0b0ce42b98765c067623f28e`
   - Multica: `343ace89a7df30af42557e3fadd167db6196d30d`

## 1. Architecture Snapshot

Thoth is a local-first task control-plane runtime with shared protocol clients and multiple UI shells.

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
15. Thoth is a control plane, not a harness or hidden LLM API wrapper.
16. All AI execution runs through provider sessions: ACP, harness runtime, app-server, official harness SDK/control surface or local harness CLI.
17. Core and daemon must not call general model inference APIs directly as a substitute for harness/provider sessions.
18. Provider-visible output must stream through Thoth timeline in real time for Clarify, Quick, Plan+Exec and Review.
19. `Quick + dont_bother_me` is a provider passthrough path and should stay behaviorally close to a raw Paseo-style provider session.
20. Formal `loop` attempts run PlanExec inside one provider session using provider-native plan mode when available.
21. Foreground Workspace Secretary Clarify is a per-turn harness overlay on the topic's continuous provider session; only background Loop phase sessions such as Review are independent provider sessions.
22. Daemon authority metadata is never Agent Harness cognitive context: sessions receive the human task and relevant reality, while daemon retains IDs, budgets, manifests, receipts, phase state and recovery data.

The system has six primary layers:

1. Protocol and client SDK.
2. Local daemon and authority store.
3. Router and context resolution.
4. Task lifecycle runtime.
5. Harness driver layer.
6. UI shells and relay sync.

### 1.1 Architecture-First Delivery Rule

`Simply Is First` governs how this architecture is implemented. Simplicity means one final architecture with explicit ownership, not a reduced implementation that is expected to be replaced later.

For every nontrivial implementation slice:

1. Name the final architecture module being implemented, its production interface, its state owner and its independent acceptance boundary before writing code.
2. Use a rapid experiment only to retire a real risk inside that final boundary. The experiment must call the same public API and traverse the same state machine and lifecycle as production.
3. Implement the final module A and verify it before advancing to module B. Do not create a compressed `A' + B' + C'` path to simulate an end-to-end milestone.
4. Keep exactly one production authority path. Provider adapters may differ behind capability contracts, but product lifecycle semantics may not fork by provider name.
5. Treat an unmet metric as evidence, not permission to downgrade. Preserve the failing result, diagnose it and change the final implementation; do not lower acceptance or add a fallback.
6. If evidence invalidates the locked architecture, stop implementation and amend canonical architecture authority before coding the replacement. Do not let an expedient code path silently become architecture.

This rule permits incomplete milestone sequencing: A may be production-correct while B does not yet exist. It forbids disposable product architecture: a temporary implementation may not impersonate A, B and C merely to make the whole journey appear complete.

## 2. Monorepo Packages

The repository should use a `packages/` workspace layout.

### 2.1 `packages/protocol`

Responsibilities:

1. Shared message envelopes.
2. Request/response schema.
3. Event schema.
4. Timeline item schema.
5. Permission and approval card schema.
6. Composer task mode and strength schema.
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

1. Global chat can bind a workspace by explicit reference or provider-backed high-confidence context resolution.
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
5. Scriptable `quick` and `loop` commands.
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
4. Route decision, mode recommendation and routing override.
5. Quick request handling.
6. Loop task creation.
7. Clarification cards.
8. Contract freeze cards.
9. Permission and provider-question cards.
10. Queue operations.
11. Provider stream and timeline stream.
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
8. Provider stream events are appended to daemon-owned timeline before broadcast.
9. Provider question events and permission events share the approval-card transport but have different policies.

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
3. One workspace can have only one write PlanExec at a time.
4. Write PlanExec tasks run through a FIFO queue.
5. User can reorder the queue manually.

Dirty state handling:

1. Before execution, daemon records git baseline.
2. If workspace is dirty, daemon shows confirmation card.
3. Daemon distinguishes pre-existing user diff from Thoth-generated diff.
4. Daemon commits only Thoth-generated diff.
5. If Thoth changes overlap user dirty files or hunks, execution pauses for user decision.

Commit policy:

1. `loop` write execution defaults to a Thoth-created branch or worktree.
2. Review passed triggers daemon commit by default.
3. Commit happens on the task branch or task worktree.
4. No auto push.
5. Git push is a high-risk quick action that requires approval unless full access is enabled.
6. Commit message is generated from task goal, acceptance and evidence.
7. Failed or blocked task does not auto commit.

## 7. Task Lifecycle Runtime

Input modes:

1. `quick`
2. `loop`

Composer policy controls:

1. `provider_settings`
2. `task_mode`
3. `clarification_strength`
4. `loop_strength`

Minimal route types:

1. `TaskMode = quick | loop`
2. `QuickOutcome = answer_result | action_result | suggest_loop`
3. `ClarificationStrength = auto | dont_bother_me | light | balanced | deep`
4. `LoopStrength = auto | one_plan_one_do | light | balanced | run_until_stopped`
5. `PermissionMode = read_only | ask | full_access`

Composer control rules:

1. `+` supports only image attachment and file upload under `10MB` in MVP.
2. Scope has no separate button; users use `@` references.
3. Provider settings include provider profile, model id, provider-native thinking strength, permission mode and fast mode.
4. Clarification strength applies to both `quick` and `loop`.
5. Loop strength applies only to `loop`; it is disabled/greyed out for `quick`.
6. `run_until_stopped` is red, high-cost, and continues until the user manually stops it, while still respecting safety and permission boundaries.
7. UI labels show `Don't Bother Me`, `Balanced`, `One Plan, One Do` and `Run Until Stopped`; protocol enums use `dont_bother_me`, `balanced`, `one_plan_one_do` and `run_until_stopped`.

Semantic routing rule:

1. MVP must not use local deterministic heuristics to classify natural-language intent.
2. If the user selects `task_mode`, daemon honors that explicit control.
3. If a future UI adds recommended mode selection, the recommendation must be produced by a provider-backed Router session.
4. Local code may validate the selected mode, enforce permission policy, gather mechanical evidence and maintain authority state.
5. Local code must not infer `quick` or `loop` from prompt text.

`quick` behavior:

1. Covers question answering and fast bounded actions.
2. Handles status explanation, concept explanation, existing information queries, simple summaries, small edits, git commit/git push and one-shot commands.
3. May cite workspace reports, task state, memory, external sources or provider diagnostics.
4. Can be read-only or controlled write.
5. Uses permission preflight for high-risk operations according to provider settings.
6. When `clarification_strength = dont_bother_me`, runs as provider passthrough with no Thoth Clarify role.
7. When clarification is enabled, may run a short read-only Clarify session before the quick provider turn.
8. Streams provider-visible output to timeline in real time.
9. Records an `ActionRecord` only when an action is proposed or executed.
10. Does not create Draft Task.
11. Does not run contract freeze.
12. Does not enter Plan+Exec or Review.
13. Does not enter loop.
14. Does not auto commit.
15. Must keep trivial conversational inputs on the fast path; `hi`-level inputs should return in under `10s` from the user's perspective.

ActionRecord minimal fields:

1. User input.
2. Resolved scope and workspace.
3. Operation summary.
4. Approval reference if needed.
5. Evidence references.
6. Final status.
7. Upgrade suggestion if failed.

Loop lifecycle:

1. User input creates Draft Task.
2. Clarify role runs as an independent read-only provider session.
3. Clarify collects user discussion, assumptions, decisions, goal, constraints and acceptance.
4. Clarify writes a structured handoff packet.
5. Contract freeze card requires user confirmation.
6. Each execution attempt contains Plan+Exec -> Review.
7. Plan+Exec runs in one provider session and uses provider-native plan mode when available.
8. Review role runs as an independent provider session.
9. Passed review commits and reports.
10. Failed review creates the next attempt only when the retry policy allows a non-repeating strategy.
11. Under `balanced`, after the default 3 failed attempts, task blocks and reports; under `run_until_stopped`, normal attempt-count exhaustion is disabled until user stop or a hard stop.

Loop boundary:

1. Only `loop` enters Clarify -> Contract Freeze -> Attempt.
2. Each Attempt internally runs Plan+Exec -> Review.
3. Quick may suggest upgrade to Loop when failure requires multi-round diagnosis, validation matrix, broad writes or unclear acceptance.
4. A provider-backed session may recommend changing the selected task mode, but the user must see and accept the switch unless policy explicitly allows it.
5. After contract freeze, provider clarification questions raised inside Plan+Exec are auto-answered from the frozen contract or the first recommended option.
6. Provider permission requests inside Plan+Exec are never auto-approved by the provider-question rule.

Stop behavior:

1. User can stop a task anytime.
2. Current attempt and driver session stop.
3. Diff, logs, evidence and task state are preserved.
4. No automatic rollback.

## 8. Router

The Router is a provider-backed role contract when semantic judgment is needed. It implements private-secretary routing judgment without becoming a visible agent, squad, leader or team UI.

Local Router boundary:

1. Local code may honor an explicit `task_mode`.
2. Local code may bind the current workspace when the user is already inside a workspace page.
3. Local code may parse explicit `@workspace` mentions.
4. Local code may validate schema, provider availability, permission mode and workspace safety.
5. Local code must not classify natural-language intent by heuristic rules.
6. Local code must not perform zero-shot workspace/context inference.

Responsibilities:

1. Provider-backed intent classification when no explicit mode is accepted.
2. Provider-backed workspace and context resolution when not explicit.
3. Explicit mode handling.
4. Provider and driver capability selection.
5. Permission preflight.
6. Evidence and report condensation.
7. Upgrade recommendation from `quick` to `loop`.

Context resolution:

1. Explicit workspace mention wins.
2. Workspace chat is bound to its current workspace.
3. Global chat context resolution uses provider-backed judgment over recent conversation, active projects, workspace state, user habits and task history.
4. A single high-confidence candidate can be selected without asking.
5. Multiple plausible candidates require one golden question.
6. Low-confidence routing must not write to a workspace.
7. The system should trust high-confidence provider-backed judgment instead of asking defensive confirmation questions by default.

Multica comparison:

1. Multica exposes agent, squad and mode choices as product objects.
2. Thoth does not expose those objects to the user.
3. Thoth borrows the durable short-action record and notification idea, not the visible team-management model.
4. Terms such as `run_only`, `quick_create` and `squad leader` are reference vocabulary only, not Thoth user-facing concepts.

## 9. Role Runtime Model

Internal roles:

1. `Clarify`
2. `PlanExec`
3. `Review`

Logical sub-phases:

1. `PlanExec` may expose provider-native plan and execution sub-phases.
2. Those sub-phases stay in the same native provider session.
3. They are not separate Thoth role sessions in MVP.

Runtime rules:

1. Every role runs through a harness driver.
2. Roles may use independent native driver sessions.
3. Native session handles are driver metadata, not first-class authority objects.
4. Within the same task, the same role can resume through stored driver metadata when the provider supports it.
5. Different roles do not share full chat history by default.
6. Inter-role handoff uses structured context packets and artifacts.
7. User sees One Thoth, not separate roles.
8. Clarify and Review are always independent role sessions.
9. PlanExec is one role session even when the provider UI shows separate plan and implementation moments.

Role responsibilities:

1. `Clarify`: compile user intent into goal, constraints, acceptance and risk.
2. `PlanExec`: use provider-native plan mode when available, create a concrete plan, perform changes and produce evidence without redefining frozen authority.
3. `Review`: check evidence adversarially, without modifying code.

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

1. Recommend or validate `quick` or `loop` when semantic judgment is needed.
2. Resolve conversation scope and workspace context when not explicit.
3. Respect explicit user-selected `task_mode`.
4. Select provider/driver capability without exposing provider choice in normal chat.
5. Run permission preflight before quick action or loop execution.

Input packet:

1. User message.
2. Conversation scope.
3. User-selected task mode if present.
4. Recent conversation summary.
5. Workspace candidates and confidence signals.
6. Provider capability summary.
7. Permission mode.
8. Clarification strength.
9. Loop strength.

Output packet:

1. Route decision.
2. Route reason.
3. Resolved workspace or unresolved candidates.
4. Required golden question if ambiguous.
5. Suggested driver family.
6. Permission preflight result.
7. Upgrade note if `quick` should become `loop`.
8. Mode mismatch warning if the selected mode appears unsafe or inefficient.

Hard stops:

1. Do not write to a low-confidence workspace.
2. Do not expose internal agent/squad/leader choices.
3. Do not recommend `loop` for a clearly short quick action merely to simplify implementation.
4. Do not skip permission policy unless `PermissionMode = full_access`.
5. Do not pretend to be a local deterministic classifier; this contract runs only inside a provider session.

### 10.2 `Clarify` Contract

Purpose:

1. Convert natural-language intent into the minimum necessary clarification output for the selected mode.
2. For `quick`, identify the one material question, permission gap or safe default needed before answering or acting.
3. For `loop`, identify assumptions and human-decision blockers.
4. For `loop`, produce clarification cards and final contract freeze card.

Input packet:

1. User message.
2. Conversation scope.
3. Workspace summary if bound.
4. Relevant memory summary.
5. Existing draft task state.
6. Selected task mode.
7. Clarification strength.

Output packet:

1. Goal.
2. Constraints.
3. Acceptance.
4. Assumptions.
5. Questions.
6. Contract freeze proposal.
7. Quick clarification result when selected mode is `quick`.
8. User decisions and default choices made during clarification.
9. Read-only evidence and sources used to resolve ambiguity.
10. PlanExec handoff packet for `loop`.

Hard stops:

1. Do not invent missing high-impact user decisions.
2. Do not mark a task ready with unresolved blocking acceptance.
3. Do not push agent-discoverable facts back to the user.
4. Do not create a `loop` task from `quick` without an accepted mode switch.
5. Do not show a contract freeze card for `quick`.
6. Do not modify files.
7. Do not install dependencies.
8. Do not commit, push, delete, move or rewrite workspace content.
9. Do not run commands whose purpose is to mutate the workspace.

### 10.2.1 Clarify Decision-Tree Runtime

Clarify is a decision-tree walk, not a questionnaire.

Runtime principles:

1. Clarify must not dump all possible questions at the start.
2. Clarify first performs read-only investigation to remove facts that the agent can discover without bothering the user.
3. Clarify then identifies the root decision that most changes downstream execution, risk, acceptance, permission or cost.
4. Clarify exposes only the current highest-leverage human decision as a card.
5. Sibling and child questions are deferred until the parent decision is answered, defaulted or blocked.
6. A question is allowed only when its answer changes execution direction, risk boundary, acceptance, permission or cost.
7. Missing information is not enough to ask the user; only missing high-impact human judgment justifies a question.
8. If several small questions are really one higher-level decision, Clarify must collapse them into that parent decision.
9. Clarify levels control tree depth, not permission to ask low-value questions.
10. `deep` may walk more levels of the tree, but each level must still be the current highest-leverage question.

Clarify tree records:

1. Root decision.
2. Active node.
3. Active path.
4. Deferred nodes.
5. Nodes resolved by investigation.
6. Nodes skipped because they are low impact.
7. Nodes defaulted with explicit risk.
8. User decisions.
9. Default choices.
10. Blocking unresolved decisions.

Clarification card fields:

1. Card id.
2. Clarify session id.
3. Tree node id.
4. Decision dimension.
5. Title.
6. Question.
7. Why this question is being asked now.
8. The decision this answer changes.
9. Downstream branches affected by the answer.
10. Options.
11. Recommended option if any.
12. Freeform allowance.
13. Default if skipped.
14. Risk if defaulted or assumed.
15. Severity.

Hard quality rule:

1. If a question cannot explain the decision it changes, it must not be rendered to the user.
2. If the provider emits multiple unrelated questions at the same tree level, Thoth should ask the provider to collapse them into the current root or branch decision.
3. If the provider asks for facts it could inspect from workspace, memory, documents, git state or web research, Thoth should treat that as a Clarify quality failure and request repair or block the Clarify session.

### 10.2.2 Clarify Streaming And Card Validation

Clarify uses two separate runtime channels:

1. Visible provider stream.
2. Structured interaction candidates.

Visible provider stream:

1. Provider-visible text deltas are appended to the daemon timeline in real time.
2. Visible text deltas are streamed to desktop, mobile and TUI clients immediately.
3. Visible stream is allowed to show the provider's normal explanation and investigation progress.
4. Visible stream must not show card JSON envelopes, validation errors or format-repair prompts.

Structured interaction candidates:

1. Provider questions, native provider question events and Clarify-generated golden questions are normalized into `ClarificationCardCandidate`.
2. A card candidate is not user-visible authority.
3. A card candidate must pass validation before becoming a renderable `ClarificationCard`.
4. Desktop, mobile and TUI must render only validated `ClarificationCard` records from daemon state.
5. Invalid candidates are recorded as hidden timeline/debug evidence, not as user-facing messages.

Validation boundary:

1. `packages/protocol` owns the card schema and validation error shape.
2. `packages/daemon` runs the canonical validator and controls provider repair.
3. `packages/app`, `packages/tui` and `packages/desktop` run lightweight defensive render validation so malformed cards cannot break UI.
4. Client-side validation is not the authority for repair loops.
5. The daemon remains the authority because Clarify may continue while no UI client is connected.

Minimal card validation:

1. Candidate parses as structured data.
2. `kind` and `schemaVersion` are recognized.
3. Required fields are present.
4. Text fields needed for rendering are non-empty.
5. Options are a bounded array.
6. Option ids are stable and unique within the card.
7. At most one option is recommended.
8. Severity is a known enum.
9. `treeNodeId` matches the active Clarify tree node.
10. The card contains `decisionItChanges`.
11. The card contains `riskIfAssumed` when it uses a default or recommendation.
12. Text length fits expected card rendering bounds.
13. The candidate does not contain executable UI instructions or command injection fields.

Invalid card repair:

1. When validation fails, the daemon creates a hidden `InvalidCardReport`.
2. The invalid report includes field paths, error codes, expected shape, received shape and a concise repair instruction.
3. The daemon sends the repair instruction back into the same Clarify provider session.
4. The repair instruction must require the provider to repair the same card and the same tree node.
5. The provider must not change the question, change branches or ask a new question during format repair.
6. Format repair is a protocol repair loop, not a business task loop.
7. The default repair budget should be small, for example 2 or 3 attempts per card.
8. If the provider still cannot emit a valid card, Clarify stops with `clarify_format_failed` and preserves hidden evidence.
9. The user sees a calm Clarify failure or retry state, not JSON parse details or schema diagnostics.

Timeline event split:

1. `provider_text_delta`: visible.
2. `card_candidate_received`: hidden.
3. `card_validation_failed`: hidden.
4. `card_repair_prompt_sent`: hidden.
5. `clarification_card_ready`: visible.
6. `clarification_answer_recorded`: visible.
7. `clarify_format_failed`: visible summary plus hidden diagnostics.

Provider prompt contract requirement:

1. When the provider needs a user decision, it should briefly explain the current decision point in natural language if useful.
2. It must then emit exactly one structured clarification card candidate for the active tree node.
3. If Thoth reports a format repair, the provider must repair only the same candidate.
4. The provider must not reveal card validation errors, JSON issues or repair mechanics to the user.
5. The provider must not apologize to the user for internal schema failures.

### 10.3 `PlanExec` Contract

Purpose:

1. Convert frozen task and Clarify handoff into a concrete execution plan.
2. Execute the plan in the same provider session.
3. Use provider-native plan mode when available.
4. Identify execution risks and required evidence.
5. Preserve frozen goal, constraints and acceptance.
6. Produce diff, logs, receipts and other artifacts.

Input packet:

1. Frozen task.
2. Acceptance spec.
3. Clarify handoff packet.
4. Workspace facts.
5. Permission policy.
6. Relevant prior Review direction if retry.
7. Relevant inspectable work/evidence entry points.

Daemon-only attachment rules:

1. Workspace baseline, manifest/hash, phase/run id, task revision, budget envelope, retry count, receipt storage and session handle remain daemon authority records.
2. PlanExec may receive a human-readable summary of relevant workspace facts and prior Review direction, but not those mechanical records as prompt fields or obligations to repeat.

Agent Harness semantic result:

1. Execution plan and concise execution report.
2. Validation actually attempted and inspectable evidence offered to Review.
3. Known risks and the focus Review should investigate next.

Daemon-owned evidence attachment:

1. Changed-path/diff summary, command receipts, provider usage and timeline references are captured
   from the phase stream and workspace by the daemon.
2. These records support audit, recovery and UI projection; PlanExec is not asked to reproduce their
   identifiers, hashes or storage shape.

Hard stops:

1. Do not change goal.
2. Do not change acceptance.
3. Do not declare final success.
4. Do not exceed permission policy.
5. Do not modify outside workspace without approval.
6. Do not overwrite user dirty changes.
7. If provider asks a clarification question after contract freeze, answer from frozen contract or the first recommended option and record it.
8. Do not auto-approve provider permission requests.
9. If frozen authority is truly insufficient, stop with a blocked status instead of inventing a new product decision.

### 10.4 `Review` Contract

Purpose:

1. Independently judge whether the current direction genuinely advances the frozen human task.
2. Challenge PlanExec's problem framing, method, architecture, evidence and conclusion rather than following its checklist.
3. Diagnose the true obstacle and, when necessary, prescribe a non-local change of direction instead of incremental repair.
4. Produce a clear review direction for the next PlanExec or a justified conclusion that the goal is complete.

Input packet:

1. Approved human task contract: target, constraints and acceptance.
2. Current goal and the relevant context from already-passed goals.
3. The real work produced so far: workspace state, implementation, tests, artifacts and observable behavior.
4. Prior substantive Review direction when retrying the same goal.

Review sequence:

1. First investigate from the approved contract and reality above, then record an independent assessment.
2. Only after that assessment may daemon reveal PlanExec's semantic account as one fallible source for
   comparison. It must not anchor the initial investigation.

Review must not receive as cognitive context:

1. Task/goal/phase/run identifiers, task revision, session handles or event causation IDs.
2. Failed-review counts, loop-strength budget, envelope dimensions, timeout counters or retry quotas.
3. Baseline/phase manifest hashes, raw receipt schemas, storage paths or daemon repair state.
4. A mechanical acceptance matrix, field-completion requirement or a daemon-authored verdict template.

Output packet:

1. A concise independent review memo: current conclusion, strongest supporting/contradicting reality, and the real diagnosis.
2. A directional decision: pass, continue, reframe the current goal, replan only unstarted goals,
   return a real user-owned decision, or explain a real blocker.
3. When not passing, what must be abandoned, what must be understood differently, and the next highest-leverage direction.
4. A minimal semantic conclusion for daemon lifecycle routing. Daemon attaches it to mechanical task state; Review does not supply phase/round/budget/receipt fields.

Hard stops:

1. Do not modify files.
2. Do not accept missing evidence.
3. Do not redefine acceptance.
4. Do not treat executor self-report as proof.
5. Do not reduce Review to running tests, comparing a checklist or extending PlanExec's local strategy without independent judgment.

## 11. Harness Driver Layer

Unified driver interface should expose:

1. `createSession`
2. `resumeSession`
3. `startTurn`
4. `streamEvents`
5. `streamHistory`
6. `respondPermission`
7. `respondQuestion`
8. `interrupt`
9. `close`
10. `fetchCatalog`
11. `describeCapabilities`
12. `materializeSkills`
13. `materializeMcp`
14. `materializeSystemContext`

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
12. `supports_native_plan_mode`
13. `supports_question_events`
14. `requires_file_context`
15. `skill_path_strategy`
16. `mcp_injection_strategy`
17. `permission_model`

Driver rules:

1. Drivers adapt provider-native events into Thoth timeline events.
2. Drivers preserve provider-native handles for resume.
3. Drivers report capability gaps explicitly.
4. Drivers do not own task lifecycle decisions.
5. Drivers do not write authority directly.
6. Drivers do not own route decisions.
7. Provider settings come from App settings and workspace policy.
8. Provider capability differences surface through diagnostics/settings, not normal chat.
9. Drivers may start, resume and observe provider sessions through provider-supported harness interfaces.
10. Drivers must not implement raw OpenAI, Anthropic or other model API execution as a replacement for a provider session.
11. Drivers stream provider-visible text, tool calls, question events, permission events and completion events to the daemon as they happen.
12. Drivers must distinguish provider question events from provider permission events.
13. Drivers must expose native plan mode when the provider supports it.

Execution boundary:

1. Thoth is not the harness.
2. The driver layer is the only boundary where Thoth touches AI execution.
3. Allowed execution surfaces are ACP adapter sessions, harness runtime sessions, app-server sessions, official harness SDK/control surface sessions and local harness CLI sessions.
4. Forbidden shortcuts include calling general model inference APIs directly from `packages/core` or `packages/daemon` to replace a missing provider.
5. A raw LLM completion cannot be treated as a Thoth role session unless it is mediated by an approved harness/provider adapter.
6. Provider-native conversation state cannot become task authority.
7. Thoth may pass structured prompt contracts, context packets, role instructions, acceptance criteria and permission decisions into provider sessions.
8. Provider owns AI execution; Thoth owns task truth, lifecycle state, evidence and handoff records.

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
5. Map Claude `AskUserQuestion` into Thoth provider-question cards.
6. Support role-specific session creation and resume.
7. Support provider-native plan mode for PlanExec when available.

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
6. Question event support.
7. Native plan mode support when available.

## 14. Codex Driver

Main path:

1. Use Codex app-server provider.
2. Preserve native thread/session handle.
3. Stream app-server notifications into Thoth timeline events.
4. Map Codex questions and permission events into Thoth cards.
5. Support role-specific session creation and resume.
6. Support Codex plan mode for PlanExec when available.

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
7. Question event support.
8. Native plan mode support when available.

## 15. Permission And Approval System

Provider question sources:

1. Codex `request_user_input`.
2. Claude `AskUserQuestion`.
3. ACP or provider-native question events.
4. Clarify role generated golden questions.

Provider question policy:

1. During Clarify, provider questions become user-facing clarification cards.
2. During Quick passthrough, provider questions are forwarded like the native provider would ask them.
3. During PlanExec after contract freeze, provider clarification questions are auto-answered from the frozen contract or the first recommended option.
4. Auto-answered questions are recorded in timeline and attempt evidence.
5. Provider questions do not grant permission to run risky tools.

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

Loop task shape:

1. Applies only to `loop`.
2. Clarify creates the task-ready contract.
3. Contract freeze confirms the task before execution.
4. Each Attempt runs PlanExec -> Review.
5. Passed Review commits and reports.
6. Failed Review creates another attempt or blocks.

Review policy:

1. Review uses same provider by default but independent role runtime.
2. Review is adversarial and intellectually independent from PlanExec.
3. Review may inspect PlanExec report, implementation, diff, logs, receipts and artifacts, but no one of these defines its reasoning frame.
4. Review does not modify files.
5. Review returns a direction memo and minimal semantic conclusion, not a completed daemon form.

Failure focus:

1. `failure_focus` is a daemon-private recovery/index record, not a Review prompt concept or PlanExec instruction format.
2. Daemon may derive a short, human-readable Review Direction Memo from the independent review conclusion for the next PlanExec session.
3. The memo captures the diagnosed obstacle, the strategy change and what not to repeat without exposing phase, budget, receipt or storage mechanics.

Retry policy:

1. Every new attempt must target the previous failure point.
2. If `failure_focus` has no strategy change, do not retry.
3. If evidence was insufficient, the next attempt prioritizes evidence production.
4. If direction was wrong, the next attempt replans before executing.
5. If implementation quality was the blocker, the next attempt fixes the critical path instead of only adding tests.
6. Repeating the same command or small patch without a new strategy blocks the task.

Attempt exhaustion:

1. Strength limits, failed-review counts and envelope exhaustion are daemon-only control policy.
2. They decide whether daemon may schedule another phase; they are never presented to Review as a target, explanation or pressure to pass/fail.
3. After exhaustion or hard stop, daemon preserves diff, evidence and state, then reports the independent Review direction and user options.

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
6. Clarify handoff packet is the authoritative input to PlanExec after contract freeze.
7. PlanExec should not recover missing product decisions by asking the user again after contract freeze.
8. Review receives both Clarify handoff and PlanExec evidence.
9. Context packets never include daemon-only phase IDs, run IDs, revisions, session handles, budget counters, envelope limits, receipt hashes, manifest payloads or raw repair state unless a human explicitly asks to inspect system diagnostics.

Example packet fields:

1. `role_mission`
2. `approved_task`
3. `current_goal`
4. `constraints`
5. `acceptance`
6. `relevant_decisions`
7. `workspace_facts`
8. `observable_work_and_evidence`
9. `clarify_discussion_summary`
10. `user_decisions`
11. `prior_review_direction`
12. `permission_boundary`

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
3. Can pass explicit task mode when requested.

Claude/Codex/ACP:

1. Host surfaces call the same daemon authority.
2. Host surfaces do not own lifecycle semantics.
3. Host surfaces can create `quick` or `loop` inputs through the same route layer.

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
   - Thoth should absorb the control-plane framing, not copy product terminology.
2. `/mnt/cfs/5vr0p6/yzy/harness/multica/CLI_AND_DAEMON.md`
   - Shows daemon-centered CLI and task execution model.
   - Thoth should keep daemon as control point while making UI shells first-class.
3. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/migrations/001_init.up.sql`
   - Shows relational tables for workspace, agent, issue, comment, inbox, queue, daemon connection and activity log.
   - Thoth should use this as evidence that task control-plane data benefits from durable relational modeling.
4. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/agent.go`
   - Defines unified backend shape around `Backend.Execute`, `ExecOptions`, `Session`, message stream and result stream.
   - Thoth should absorb the idea of a small upper interface with explicit capability differences.
5. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/claude.go`
   - Shows Claude Code CLI execution, stream JSON handling, prompt input and environment isolation concerns.
   - Thoth should not use this as its Claude main path, but should learn from its runtime isolation and permission handling.
6. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/codex.go`
   - Shows Codex app-server behavior, session/thread handling, MCP config materialization, timeout diagnostics and token usage scanning.
   - Thoth should use app-server as Codex main path and keep diagnostics first-class.
7. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/opencode.go`
   - Shows provider-specific project discovery and config injection needs.
   - Thoth should model provider materialization as driver-owned behavior.
8. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/hermes.go`
   - Shows ACP-style session/new and session/resume behavior, MCP translation and provider edge cases.
   - Thoth should use this as a cautionary reference for ACP session semantics and provider-specific quirks.
9. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/execenv/runtime_config.go`
   - Shows runtime configuration injection for different harnesses.
   - Thoth should keep provider setup in drivers, not in task authority.
10. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/execenv/execenv.go`
    - Shows execution environment preparation.
    - Thoth should keep workspace execution environment explicit and auditable.
11. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/local_directory.go`
    - Shows local directory execution model.
    - Thoth MVP uses a similar linear local-directory-like workspace model.
12. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/daemon.go`
    - Shows daemon orchestration responsibilities.
    - Thoth daemon should own queue, process orchestration and timeline truth.
13. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/repocache/cache.go`
    - Shows repository cache/worktree concerns.
    - Thoth should avoid over-expanding this in MVP and keep one local directory as one workspace.
14. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/service/task.go`
    - Shows quick-create task context, enqueue, completion and failure inbox handling.
    - Thoth should absorb the idea that short natural-language work can be queued and recorded without creating a full loop task.
15. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/handler/issue.go`
    - Shows quick-create request validation, actor resolution and immediate 202 response.
    - Thoth should keep server-side trust boundaries for quick actions, but should not require the user to pick an actor.
16. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/handler/squad_briefing.go`
    - Shows squad leader briefing, routing protocol and no-action evaluation.
    - Thoth should translate this into an internal private-secretary Router, not a visible squad UI.
17. `/mnt/cfs/5vr0p6/yzy/harness/multica/server/internal/daemon/execenv/context.go`
    - Shows distinct context rendering for normal task, quick-create and run-only autopilot.
    - Thoth should keep `quick` requests and `loop` tasks distinct, while allowing `QuickOutcome` to separate answer results, action results and loop suggestions internally.
18. `/mnt/cfs/5vr0p6/yzy/harness/multica/docs/product-overview.md`
    - Shows the product distinction between issue-backed work and run-only background work.
    - Thoth should use user-facing words such as 直接处理 and 正式任务, not Multica's internal mode names.
19. `/mnt/cfs/5vr0p6/yzy/harness/multica/docs/docs-outline.md`
    - Shows the documentation decision to describe internal run-only/create-issue modes with user mental-model words.
    - Thoth should follow that principle and keep internal routing terms out of user-facing copy.

## 23. Reference Map: Paseo

Local reference root:

1. `/mnt/cfs/5vr0p6/yzy/harness/paseo`
2. HEAD: `507345dbee4a76df0b0ce42b98765c067623f28e`

Reference files and extracted lessons:

1. `/mnt/cfs/5vr0p6/yzy/harness/paseo/docs/architecture.md`
   - Defines client/server daemon architecture, mobile app, CLI, desktop app, relay, protocol and provider layout.
   - Thoth should absorb the daemon/client/relay topology and shared WebSocket protocol approach.
2. `/mnt/cfs/5vr0p6/yzy/harness/paseo/docs/providers.md`
   - Distinguishes ACP provider path and direct provider path.
   - Thoth should implement both: ACP as first-version adapter path, direct providers for Claude/Codex.
3. `/mnt/cfs/5vr0p6/yzy/harness/paseo/docs/custom-providers.md`
   - Shows how user-defined ACP-compatible providers can be configured.
   - Thoth should use this as reference for future OpenCode/Hermes/QwenCode style extensibility.
4. `/mnt/cfs/5vr0p6/yzy/harness/paseo/docs/data-model.md`
   - Shows daemon identity, daemon keypair, persisted data, provider handles and client-side storage.
   - Thoth should adapt daemon identity and E2EE keypair ideas while using SQLite as authority store.
5. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/protocol/src/messages.ts`
   - Source of protocol messages.
   - Thoth should keep protocol as shared source of truth for clients and daemon.
6. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/client/src/daemon-client-websocket-transport.ts`
   - Direct daemon WebSocket transport reference.
   - Thoth should provide equivalent direct transport in `packages/client`.
7. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/client/src/daemon-client-relay-e2ee-transport.ts`
   - Relay E2EE transport reference.
   - Thoth should provide equivalent encrypted relay transport.
8. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/agent-sdk-types.ts`
   - Defines `AgentClient` and `AgentSession` interfaces.
   - Thoth should adapt this style into `HarnessDriver` and role runtime abstractions.
9. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/provider-registry.ts`
   - Provider registry reference.
   - Thoth should keep driver registration centralized and capability-aware.
10. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/claude/agent.ts`
    - Claude direct provider using Anthropic Agent SDK.
    - Thoth Claude driver should follow this main path.
11. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/codex-app-server-agent.ts`
    - Codex app-server provider.
    - Thoth Codex driver should follow this main path.
12. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/acp-agent.ts`
    - ACP base provider.
    - Thoth should implement an ACP adapter with comparable session, streaming and permission responsibilities.
13. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/generic-acp-agent.ts`
    - Generic ACP provider.
    - Thoth should use this as reference for user-defined or future ACP harnesses.
14. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/opencode-agent.ts`
    - OpenCode provider.
    - Thoth should use this as a direct-provider reference for non-ACP provider-specific differences.
15. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/relay/src/`
    - Relay implementation directory.
    - Thoth should use this as source reference for E2EE relay shape.
16. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/relay/wrangler.toml`
    - Cloudflare Worker relay deployment reference.
    - Thoth MVP relay prototype should follow this deployment route.
17. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/app/package.json`
    - Expo / React Native app package reference.
    - Thoth app should follow this multi-platform package style.
18. `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/desktop/electron-builder.yml`
    - Desktop app packaging reference.
    - Thoth desktop app should follow the Electron packaging route.

## 24. MVP Implementation Order

1. Create monorepo scaffolding and shared TypeScript config.
2. Define protocol schemas and SQLite authority store.
3. Implement daemon bootstrap.
4. Implement workspace registry plus global/workspace conversations.
5. Implement provider-backed Router and context resolution.
6. Implement `quick` and `loop` route inputs.
7. Implement provider stream timeline plumbing before hiding any provider output behind summaries.
8. Implement fast-path `quick + dont_bother_me` provider passthrough and latency guard for `hi`-level inputs.
9. Implement optional quick Clarify path.
10. Implement loop task draft, confirmation and queue.
11. Implement read-only Clarify role quality gate and golden-question card path.
12. Implement Clarify handoff packet and contract freeze.
13. Implement PlanExec role runtime with provider-native plan mode.
14. Implement Review role runtime.
15. Implement provider question auto-answer policy for PlanExec after contract freeze.
16. Implement `failure_focus` and aggressive attempt policy.
17. Implement ActionRecord and quick action execution path.
18. Implement evidence artifacts, approval requests and full access mode.
19. Implement task branch/worktree dirty baseline and Thoth-generated diff commit policy.
20. Implement desktop app daemon lifecycle management.
21. Implement TUI single-workspace shell.
22. Implement CLI advanced entry.
23. Implement Claude direct driver.
24. Implement Codex app-server driver.
25. Implement E2EE relay prototype.
26. Implement mobile pairing and read/write online flows.
27. Implement ACP full adapter and conformance tests.
28. Implement report view and memory candidate write after Review.

MVP priority note:

1. Surface software development is not the hardest part of Thoth.
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
2. Global chat provider-backed high-confidence workspace resolution.
3. Global chat ambiguous workspace golden question.
4. High-confidence workspace resolution proceeds without defensive confirmation.
5. `quick` answer result does not create an ActionRecord or task.
6. `quick + dont_bother_me` behaves as provider passthrough and does not run Clarify.
7. `quick` returns `hi`-level inputs within `10s` using a provider-backed session when semantic response is needed.
8. `quick` action result creates ActionRecord when an action is proposed or executed.
9. `quick` action failure can suggest `loop` upgrade.
10. Draft Task creation from `loop`.
11. Clarification card lifecycle.
12. Clarify read-only guard blocks file mutations.
13. Clarify handoff packet is persisted.
14. Contract freeze confirmation.
15. Queue ordering.
16. Single write PlanExec lock per workspace.
17. Stop task preserves state.
18. Timeline cursor catch-up.
19. Provider stream events are appended before broadcast.
20. Foreground Queue/Interrupt is stored in the owning Workspace shard; App shells render its projection and never schedule from local status transitions.
21. Canonical user-message ids bind to adapter-owned, versioned opaque rewind receipts with provider-thread lineage and supported scopes.
22. Conversation rewind replaces the Timeline epoch; image preview bytes remain daemon-owned and use only transient client URLs.

Driver tests:

1. Claude direct provider availability.
2. Claude driver session create/resume for role runtime.
3. Codex app-server availability.
4. Codex driver session create/resume for role runtime.
5. ACP adapter session lifecycle.
6. ACP permission mapping.
7. Capability matrix snapshots.
8. Provider error normalization.
9. Claude `AskUserQuestion` maps to provider-question event.
10. Codex `request_user_input` maps to provider-question event.
11. PlanExec provider-question auto-answer returns the first recommended option.
12. Permission requests are not auto-approved by question auto-answer policy.
13. Native plan mode is enabled for PlanExec when the provider supports it.

Git tests:

1. Clean workspace auto commit after passed Review.
2. Dirty workspace baseline confirmation.
3. Commit only Thoth-generated diff.
4. Overlap with user dirty hunk blocks and asks.
5. No auto push.
6. `loop` writes happen on task branch or worktree.
7. Git push quick action requires approval in normal mode.
8. Git push quick action skips approval but records evidence in full access mode.

Review tests:

1. Executor self-report is insufficient without evidence.
2. Review passes with sufficient evidence.
3. Review fails with missing validator or artifact.
4. Failed Review creates the next Attempt when strategy changes.
5. `balanced` default 3 failed attempts block and report.
6. Reviewer cannot mutate files.
7. Failed Review records `failure_focus`.
8. Empty strategy change blocks instead of retrying.
9. Repeating the same failed action blocks instead of manufacturing progress.
10. `one_plan_one_do` blocks after one failed Review.
11. `run_until_stopped` continues until user stop or hard stop.

UI tests:

1. Desktop starts daemon when missing.
2. Desktop global chat can bind explicit workspace.
3. Desktop global chat can bind one provider-backed high-confidence implicit workspace.
4. Desktop global chat asks one golden question for ambiguous workspace.
5. TUI has no global home.
6. TUI adopts current directory after confirmation.
7. Mobile online can create `quick` or `loop` for existing workspace.
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

## 26. Workspace / Task Authority And HarnessAdapter Reset

`NTH-CD-060` supersedes every implementation detail in this document that treats a provider session,
hidden Agent, Codex home, topic snapshot, global Loop database or copied Skill directory as durable
task authority.

### 26.1 Durable units

1. `Workspace` is the physical authority shard, path/capability boundary, mutation lease domain and
   unit of crash recovery. A worktree is a separate Workspace.
2. `Task` is the user-visible schedulable unit for both Quick and Loop work. It owns contracts,
   goals, semantic memory, decisions, lifecycle and evidence.
3. `PhaseRun` expresses PlanExec, Review or audit intent. `ExecutionAttempt` expresses exactly one
   provider run. `ProviderThread` stores only an opaque native handle and resume/retention metadata.
4. ProviderThread loss may require a replacement ExecutionAttempt, but it cannot invalidate Task
   Truth, a pending Card, a human decision or completed Review direction.

### 26.2 Storage topology

```text
~/.thoth/
  catalog.sqlite
  runtime-bundles/sha256/<digest>/bundle.json
  workspaces/<workspaceId>/authority.sqlite
  workspaces/<workspaceId>/blobs/sha256/<prefix>/<digest>
  workspaces/<workspaceId>/artifacts/<taskId>/<phaseRunId>/
  runtime/
  logs/
  secrets/
```

`catalog.sqlite` owns only global settings, provider profiles, Workspace Registry and a rebuildable
Task locator. A Workspace authority shard owns normalized Agent, thread, turn, Card, human decision,
Task, Goal, PhaseRun, ExecutionAttempt, attachment, Task Blackboard, context binding, timeline,
evidence, command, lease and incremental event tables. Current rows and append-only deltas are
written in one transaction; events never repeat the complete projection. Immutable large payloads
are addressed by SHA-256 and referenced from SQL. Provider authentication, configuration, native
transcript, KV cache and tool cache stay in provider-owned storage.

### 26.3 RuntimeBundle and HarnessAdapter

`packages/drivers` owns one `HarnessAdapter` contract for Codex, Claude Code, OpenCode, Pi, ACP and
future providers. It exposes structured capabilities and thread, attachment, execution, event,
interrupt, persistence, archive and legacy-adoption operations. Provider-specific tool and
instruction transport belongs only inside an adapter. Daemon Task/Clarify/Loop code consumes
capabilities and receipts and may not inspect a provider id.

`thoth.clarify` and `thoth.loop` are immutable RuntimeBundles containing semantic instructions,
tool schemas and phase scope. The daemon stores each digest once and records an attachment receipt
before an eligible execution starts. Native dynamic tools, MCP and ACP are transport mappings of
the same semantic catalog, not alternate product paths.

### 26.4 Task Truth and runtime truth

Task Blackboard entries contain only user intent, approved contracts, human decisions, workspace
facts, PlanExec reports, Review Direction Memos, evidence meaning and blockers. Attempt ids,
generations, leases, budgets, cursors, receipts and hashes remain daemon-only Runtime Truth. A
foreground `@Task` context reference resolves through `TaskContextBroker` to same-Workspace semantic
Blackboard content; it never concatenates or merges provider transcripts.

### 26.5 Cancellation and suspension

A Card is a durable Task/Turn suspension, not an open provider call stack. Committing a Card ends and
fences the current ExecutionAttempt; answering it appends an exact Human Decision and starts a new
continuation on the same ProviderThread or an explicit replacement lineage. Stop first commits
`stopping` and `cancel_requested`, fences all callbacks and returns the new projection, then asks the
adapter to interrupt. Unconfirmed cancellation becomes an orphaned execution under Workspace
quarantine; UI phase activity comes from ExecutionProjection, never a hidden Agent snapshot.
