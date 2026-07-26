# Thoth: Migration Control Plane Architecture

## Status

- Date: `2026-06-25`
- Scope: Condense the user's original goals, inputs, reference materials, research conclusions, and current design proposal for a "completely new version of Thoth" from this round into a single detailed document
- Nature: planning/design artifact, no implementation in this document
- Intended follow-up: feed `TD-003` and future `MS-004` design freeze / migration planning

## 1. Original User Goals and Inputs

The user did not want minor incremental changes to the existing Thoth in this round, but a "completely new version" of `Thoth`. The goal is not to follow any particular generation of harness, but to start from value that will still hold in `5` years and minimize human cognitive burden as much as possible.

The user explicitly provided the following goals and constraints.

### 1.1 Top-Level Goals

1. Work backward from the desired outcome to design a `Thoth` that will still be useful `5` years from now
2. Make "minimizing human cognitive burden as much as possible" the first principle
3. Make Thoth more like a "digital employee control plane" rather than a UI wrapper around a single coding agent

### 1.2 Product Form Requirements

1. Provide both `TUI` and `APP` forms
2. The underlying interfaces must be completely identical
3. The `UI` is only a shell and must not own business semantics
4. The `TUI` must explicitly use `OpenTUI`
5. The `APP` form had not yet been decided and should be recommended after researching the reference projects

### 1.3 User Entry Points and Working Model

1. User entry points include:
   - Starting a conversation within each workspace
   - A global chat
2. Users can speak freely about requirements, ideas, and background all at once, as they would when addressing a digital employee
3. Thoth is responsible for proactively decomposing, questioning, and clarifying the request, rather than requiring users to write a structured prompt in advance
4. Clarification must focus on:
   - Assumptions
   - Goals
   - Constraints
   - Acceptance criteria
5. Only after the task has been sufficiently decomposed should it be registered as a task, similar to an `issue`
6. Once registered, it is executed asynchronously by agents with fixed roles
7. Users do not care about the exact execution time; the experience should resemble "a boss assigning work to a digital employee"
8. The AI should continue running while the user sleeps

### 1.4 Loop Requirements

1. The executor should be built around the concept of "current loop engineering"
2. Registering a task is, in essence, also registering a `loop`
3. A task is not a single turn, but a long-running, recoverable, reviewable loop contract

### 1.5 Multi-Device Synchronization Requirements

1. The APP side should be similar to `Paseo`
2. Phone and computer clients must be able to synchronize sessions and progress
3. Users want to view, follow up on, and approve work remotely, without requiring the full desktop development experience to be transferred to the phone

### 1.6 Host-Neutrality Requirements

The user explicitly required Thoth to be host-neutral and to support at least:

- `cc` / Claude Code
- `codex`
- `opencode`
- `hermes`
- `openclaw`
- `qwencode` / QwenCode-like harnesses

This does not mean "surface-level support"; it requires a real understanding of:

1. How to make the system agent- and harness-tool-neutral
2. How to integrate this many harnesses
3. How to allocate roles
4. How to do prompt engineering

### 1.7 Lifecycle and Adversarial Requirements

The user explicitly required each task lifecycle to have at least three independent phases, with each phase using an independent role and independent session, and with adversarial review.

It must include at least:

1. A phase for clarifying requirements and assumptions with the user and guiding the user
2. A phase for executing the task loop
3. A phase for review, validation, and reflection

The user emphasized:

- Each phase should have an independently designed role
- Each phase should have an independent session
- There must be adversarial review; do not treat "the executor self-assessing success" as system success

### 1.8 Topics the User Asked to Discuss and Research in Depth

The user asked for focused discussion and design of:

1. All preset prompts
2. Memory and context design
3. How to achieve host neutrality
4. How to achieve multi-device synchronization
5. How to pass context and memory between phases
6. Architecture design

### 1.9 Reference Materials and Areas of Focus Provided by the User

#### Reference One: Digital Employees / Multiple Harnesses / Agent Control Plane

- Upstream: `https://github.com/multica-ai/multica`
- Local clone: `<harness-workspace>/multica`
- Local HEAD: `343ace8`

The user asked for focused examination of:

1. How to make the system agent- and harness-tool-neutral
2. How to invoke this many harness tools
3. Role allocation
4. Prompt engineering

#### Reference Two: Remote APP / Phone Synchronization / Multiple Providers / Multi-Platform Packaging

- Upstream: `https://github.com/getpaseo/paseo`
- Local clone: `<harness-workspace>/paseo`
- Local HEAD: `507345d`

The user asked for focused examination of:

1. How to support this many harness tools
2. How to package apps for Windows, macOS, Android, and iOS
3. Which framework is used
4. How multi-device synchronization is implemented

#### Reference Three: TUI Approach

- Skill path: `<codex-skills>/opentui`
- Core docs:
  - `<codex-skills>/opentui/docs/getting-started.mdx`
  - `<codex-skills>/opentui/docs/bindings/react.mdx`

The user explicitly required:

- Use `OpenTUI` for the `TUI`

## 2. Current Thoth Baseline

This design is not speculation detached from the current repository state; it must start from the parts of the current Thoth that have already converged and are expected to remain valid over the long term.

According to the current repository state documents, the existing Thoth has established the following important baselines:

1. `.thoth/objects` has been established as the basic direction for authority
2. The execution model for `work_id@revision`, `run`, `controller`, `phase_result`, and `artifact` already exists
3. The fixed phase chain for `run` has converged to `plan -> execute -> validate -> reflect`
4. `auto` is no longer a one-off command, but a durable controller worker service
5. `Observe` has been clearly defined as a read-only derived layer of authority
6. `argue` has introduced the adversarial concepts of attacker / adjudicator
7. The current repository has begun distinguishing:
   - authority truth
   - runtime ledger
   - read model / docs / dashboard

The baseline facts of the current repository are available in [architecture-milestones.md](<thoth-repo>/.agent-os/architecture-milestones.md:16) and [todo.md](<thoth-repo>/.agent-os/todo.md:19).

The parts that have long-term value for Thoth and should be carried forward are:

1. `work_item` as the core unit of task authority
2. `acceptance_spec` as the center of acceptance truth
3. Layering `run` and `controller/loop`
4. `Observe` being read-only and forbidden from secretly repairing authority
5. A systematic entry point for `argue` / adversarial review
6. Separating the host adapter from runtime truth

The parts that Thoth needs to significantly upgrade or replace are:

1. The entry point can no longer be command-centered; it must center on conversation / digital employee intake
2. The lifecycle cannot stop at `plan/execute/validate/reflect`; "clarification and contract freeze" must also be made explicit before execution
3. The current TUI / dashboard / host projection is more like a tool surface; Thoth needs multiple shell clients under a unified daemon protocol
4. Current host support is mainly centered on Claude/Codex; Thoth must advance to a harness-neutral driver layer

## 3. Research Conclusions from Reference Materials

### 3.1 Multica: Parts Worth Adopting

#### 3.1.1 Product Positioning

Multica treats a coding agent as a real "colleague / teammate" rather than a one-off prompt runner.

It emphasizes:

1. `Agents as Teammates`
2. `Squads`
3. `Autonomous Execution`
4. `Autopilots`
5. `Reusable Skills`
6. `Unified Runtimes`
7. `Multi-Workspace`

See [Multica README](<harness-workspace>/multica/README.md:30).

This is highly consistent with the user's desired direction of "digital employees."

#### 3.1.2 The Actual Approach to Supporting Multiple Harnesses

Multica's provider matrix is highly important because it shows that "host neutrality" does not mean eliminating differences, but limiting them to the adapter/capability layer.

It explicitly supports multiple tools, while its documentation also emphasizes:

1. They all implement the same upper-layer interface
2. But their capability details differ substantially
3. Differences include:
   - session resumption
   - MCP support
   - Skill injection path
   - Model selection

See [providers.mdx](<harness-workspace>/multica/apps/docs/content/docs/providers.mdx:8).

This means:

1. Thoth cannot pretend that all harnesses are identical
2. A capability matrix is required
3. Provider-specific behavior must be confined to the driver adapter

#### 3.1.3 Unified Interface at the Technical Implementation Layer

In `server/pkg/agent/agent.go`, Multica defines a simple but effective unified interface:

1. `Backend.Execute(ctx, prompt, opts)`
2. `ExecOptions` contains:
   - `Cwd`
   - `Model`
   - `SystemPrompt`
   - `ThreadName`
   - `MaxTurns`
   - `Timeout`
   - `SemanticInactivityTimeout`
   - `ResumeSessionID`
   - `ExtraArgs`
   - `CustomArgs`
   - `McpConfig`
   - `ThinkingLevel`
   - `OpenclawMode`
3. `Session` provides:
   - `Messages <-chan Message`
   - `Result <-chan Result`

See [agent.go](<harness-workspace>/multica/server/pkg/agent/agent.go:15).

This shows that the upper-layer semantics must unify at least:

1. Execution entry point
2. Session resumption
3. Streaming
4. Final result
5. MCP/materialization
6. Reasoning/effort
7. Provider-specific runtime knobs

#### 3.1.4 Handling Host Configuration Files

Multica makes a very important design choice in `runtime_config.go`:

1. It does not directly overwrite the user's existing `AGENTS.md` / `CLAUDE.md`
2. It injects its managed runtime brief using a marker block
3. It performs an idempotent replacement on the next run
4. During cleanup, it restores the user's original files byte for byte

It also clearly distinguishes:

1. Claude / CodeBuddy write `CLAUDE.md`
2. Codex / Copilot / OpenCode / OpenClaw / Hermes / Pi / Cursor / Kimi / Kiro / Antigravity / Qoder write `AGENTS.md`

See [runtime_config.go](<harness-workspace>/multica/server/internal/daemon/execenv/runtime_config.go:156).

The implications for Thoth are:

1. Host neutrality does not mean "one unified file"
2. Provider-native context should be materialized at the driver layer
3. Never crudely overwrite the user's existing repo-local instruction files
4. Injection and cleanup must be designed as a pair

### 3.2 Multica: Parts That Should Not Be Copied Directly

1. Its strengths lie more in task queues, issue boards, and runtime dispatch
2. But its "requirements clarification -> acceptance freeze -> authority graph" is not its core moat
3. To users, it is more like a managed agents platform than a "system that compiles ambiguous boss intent into a loop contract"

Therefore:

1. Its task board / runtime / agent teammate model is worth adopting
2. But Thoth's core cannot be reduced to an "issue board"
3. Thoth's real value should lie in the `clarification compiler + acceptance compiler + loop controller + evidence authority`

### 3.3 Paseo: Parts Worth Adopting

#### 3.3.1 Architectural Layers

Paseo's overall structure is very clear:

1. `daemon`
2. `app`（Expo）
3. `cli`
4. `desktop`（Electron）
5. `relay`
6. `protocol`
7. `client`

All clients are also organized around the same daemon and protocol.

See [architecture.md](<harness-workspace>/paseo/docs/architecture.md:3).

The implications for Thoth are direct:

1. `TUI` and `APP` should not be two separate products
2. They should be two clients of the same `thothd`
3. Business semantics must be owned by the daemon / authority / protocol

#### 3.3.2 Abstraction for Multiple Providers

Paseo distinguishes two provider integration patterns:

1. `ACP` provider：
   - Recommended
   - Reuse `ACPAgentClient`
   - The base class handles process spawn, stdio transport, session lifecycle, streaming, permissions, and model discovery
2. `Direct` provider：
   - Directly implement `AgentClient` and `AgentSession`
   - Fully manage process, stream, permission, history, and session persistence themselves

See [providers.md](<harness-workspace>/paseo/docs/providers.md:5).

This shows that the most reasonable approach for Thoth is not to invent a "super-unified provider standard," but to:

1. Use an ACP adapter for harnesses that support ACP
2. Use a direct adapter for highly distinctive providers
3. Have the upper layer consume only unified session/timeline/permission/capability interfaces

#### 3.3.3 AgentClient / AgentSession Model

Paseo's direct provider checklist presents two very practical abstractions:

1. `AgentClient`
   - createSession
   - resumeSession
   - fetchCatalog
   - listImportableSessions
   - importSession
   - isAvailable
2. `AgentSession`
   - run
   - startTurn
   - subscribe
   - streamHistory
   - getRuntimeInfo
   - getAvailableModes
   - getCurrentMode
   - setMode
   - getPendingPermissions
   - respondToPermission
   - describePersistence
   - interrupt
   - close

See [providers.md](<harness-workspace>/paseo/docs/providers.md:321).

This abstraction is better suited to Thoth than Multica's because Thoth does not merely "dispatch tasks"; it must truly manage sessions, permissions, history, resumption, and review across phases.

#### 3.3.4 Timeline Sync Invariants

Paseo's `timeline-sync.md` contains an invariant that must be adopted:

1. The live stream is responsible only for immediacy
2. Authoritative history is responsible for correctness
3. Presence is not delivery
4. Catch-up may be paginated, but must be complete
5. When resuming with a cursor, fill in everything after the cursor rather than simply fetching the tail

See [timeline-sync.md](<harness-workspace>/paseo/docs/timeline-sync.md:3).

This design is critical because Thoth's loops will likely run in the background for long periods, while phone, desktop, and TUI clients repeatedly attach and detach. Without this invariant, the following can occur:

1. Messages from intermediate phases being lost
2. Permission blockers being invisible
3. The final report not matching the intermediate timeline

#### 3.3.5 Agent lifecycle / subagent / archive

Paseo's handling of the agent lifecycle is also worth studying:

1. An agent has explicit states:
   - `initializing`
   - `idle`
   - `running`
   - `error`
   - `closed`
2. An agent can have:
   - `subagent`
   - `detached`
3. Archiving is a global lifecycle action, not a single-client action
4. Closing a tab is decoupled from archiving

See [agent-lifecycle.md](<harness-workspace>/paseo/docs/agent-lifecycle.md:5).

The implications for Thoth are:

1. A role session / subagent session must be a lifecycle object
2. Closing a view in the UI does not mean destroying the task
3. Review/verifier/adversary can be `subagent-like` sessions, but authority still belongs to the task system

#### 3.3.6 APP and Desktop Technology Paths

Paseo's existing implementation has validated a practical and feasible technology path:

1. `packages/app` uses `Expo`
2. It covers:
   - iOS
   - Android
   - Web
3. `packages/desktop` uses `Electron`
4. It uses `electron-builder` to produce:
   - macOS: `dmg` / `zip`
   - Linux: `AppImage` / `deb` / `rpm` / `tar.gz`
   - Windows: `nsis` / `zip`

See [package.json](<harness-workspace>/paseo/packages/app/package.json:7) and [electron-builder.yml](<harness-workspace>/paseo/packages/desktop/electron-builder.yml:27).

This means that for Thoth:

1. The APP path should prioritize `Expo React Native`
2. The Desktop path should prioritize `Electron`
3. Do not invent a new APP technology stack first

### 3.4 Paseo: Parts That Should Not Be Copied Directly

1. Paseo's authority is primarily daemon session / timeline / runtime state
2. It natively understands "agent sessions," not the `.thoth` authority graph
3. It does not natively understand:
   - `work_id@revision`
   - `acceptance_spec`
   - `phase_result`
   - `validate.passed`
   - `artifact provenance`

Therefore:

1. Paseo's protocol, provider adapter, and multi-device synchronization are worth adopting
2. But Thoth must not reduce its authority to "merely a prettier agent session manager"

### 3.5 OpenTUI: Parts Worth Adopting

OpenTUI's role is clear:

1. It is a high-performance TUI renderer/core
2. Zig native core + TypeScript bindings
3. It can build a TUI from the React binding
4. It provides:
   - layout
   - input
   - diff/code/markdown
   - keyboard hooks

See [getting-started.mdx](<codex-skills>/opentui/docs/getting-started.mdx:13) and [react.mdx](<codex-skills>/opentui/docs/bindings/react.mdx:10).

But it also has runtime realities:

1. Actually creating the native renderer requires FFI
2. The primary documented path leans toward Bun / Node 26.3 + experimental FFI

This means Thoth should:

1. Use OpenTUI for the TUI shell
2. Keep daemon/core from depending on the OpenTUI runtime
3. Make the TUI a separate client package

## 4. Core Judgments of the Current Proposal

### 4.1 Thoth's Real Moat

Over the next `5` years, what will be hardest for harnesses to replace is not "execution capability," but the following capabilities:

1. `clarification compiler`
2. `acceptance compiler`
3. `durable authority graph`
4. `loop controller`
5. `multi-role adversarial lifecycle`
6. `evidence/provenance ledger`
7. `host-neutral driver layer`
8. `multi-device evidence cockpit`

In other words:

- Execution agents will become increasingly capable
- Single conversations will also become increasingly capable
- What is truly scarce is a system that "stably compiles ambiguous boss goals into recoverable, verifiable, auditable loop contracts"

### 4.2 What Thoth Is Not

Thoth should not be positioned as:

1. Another coding agent
2. Another IDE
3. A polished log viewer
4. A plugin that supports only one host
5. A tool centered on manually written prompts

### 4.3 What Thoth Should Be

Thoth should be:

1. `digital employee control plane`
2. `clarification-to-loop compiler`
3. `validator-first orchestration system`
4. The unified holder of truth for `authority + timeline + artifact + report`

## 5. Product Experience Goals

### 5.1 The Ideal User Experience

1. The user opens a workspace chat or global chat
2. The user directly describes goals, ideas, background, and concerns
3. Thoth proactively clarifies
4. Thoth freezes the task into a structured contract
5. The user makes decisions only at high-risk / high-impact / irreversible decision points
6. Thoth executes asynchronously
7. Phone, desktop, and TUI clients can all see the progress of the same task
8. Once complete, Thoth provides a boss-style report rather than a pile of agent chatter

### 5.2 Cognitive Burden the User Should Not Bear

The user should not be forced to manage:

1. Provider differences
2. session resume
3. MCP injection
4. skill path
5. The exact prompt wording
6. Which agent saw which context
7. Which log entry matters
8. Whether to retry
9. Which run to inspect now

The user should mainly manage:

1. Goals
2. Boundaries
3. Risks
4. Acceptance
5. Decisions that require their approval

## 6. Recommended High-Level Thoth Architecture

Thoth should be divided into the following top-level modules.

### 6.1 Protocol

Responsibilities:

1. Define the unified protocol for all clients and the daemon
2. Codify request/response/event schemas
3. Codify timeline items, permissions, artifact summaries, and report summaries

Requirements:

1. `TUI` / `APP` / `CLI` / `Desktop` all use the same protocol
2. The UI must not bypass the daemon to write `.thoth` directly

### 6.2 Daemon

Suggested name: `thothd`

Responsibilities:

1. Local authority server
2. Manage workspaces, tasks, loops, role sessions, and provider sessions
3. Commit the timeline / event log
4. Broadcast the live stream
5. Provide history catch-up
6. Provide permission/approval/decision interfaces
7. Provide relay / pairing / notification

### 6.3 Authority Store

Responsibilities:

1. Maintain durable truth
2. Support recovery, auditing, and read-model reconstruction

Suggested form:

1. Append-only event log
2. Object snapshots
3. Read-model projections

Recommended persistence combination:

1. Use `SQLite` locally in the daemon
2. Retain `.thoth/objects` / `.thoth/events` / `.thoth/artifacts` under the workspace as auditable exports

### 6.4 Clarification Compiler

Responsibilities:

1. Extract structured tasks from natural-language conversations
2. Track assumptions, conflicts, and open questions
3. Form `work_item + acceptance_spec + loop_contract`

This is one of Thoth's core moats.

### 6.5 Loop Controller

Responsibilities:

1. Registering a task also registers a loop
2. Control each execution cycle:
   - Continue
   - Retry
   - Switch driver
   - Enter validation
   - Escalate to the user
   - Stop
3. Do not allow the executor to determine final task success on its own

### 6.6 Role Session Runtime

Responsibilities:

1. Provide independent role sessions for different phases
2. Use structured context packets instead of injecting the entire conversation history
3. Preserve isolation between roles while connecting them through handoff artifacts

### 6.7 Harness Driver Layer

Responsibilities:

1. Abstract Claude Code, Codex, OpenCode, Hermes, OpenClaw, QwenCode, and others behind a unified upper-layer interface
2. Confine differences to the capability matrix and adapters

### 6.8 Observe / Sync / UI Shells

Responsibilities:

1. Provide:
   - TUI
   - APP
   - Desktop
   - CLI
2. Consume only the protocol and read models
3. Own no business authority

## 7. Suggested Object Model

The suggested core objects are as follows.

### 7.1 Workspace-Related Objects

#### `workspace`

Suggested fields:

1. `workspace_id`
2. `root_path`
3. `repo_summary`
4. `trusted_tools`
5. `provider_profiles`
6. `workspace_memory_policy`
7. `default_autonomy_policy`

#### `conversation`

Purpose:

1. global chat
2. workspace chat

Notes:

1. It is only an entry point
2. It is not the final execution authority

### 7.2 Clarification- and Contract-Related Objects

#### `clarification_session`

Suggested states:

1. `inquiring`
2. `ready_to_freeze`
3. `frozen`
4. `abandoned`

#### `assumption`

Suggested fields:

1. `assumption_id`
2. `statement`
3. `source`
4. `confidence`
5. `impact_if_wrong`
6. `default_if_unanswered`
7. `needs_user_decision`

#### `decision`

Purpose:

1. User approvals
2. The formal record of high-impact system decisions

#### `acceptance_spec`

Suggested fields:

1. `acceptance_kind`
2. `validator_type`
3. `validator_command`
4. `required_artifacts`
5. `required_metrics`
6. `service_state_requirements`
7. `manual_review_requirements`
8. `thresholds`

#### `work_item`

Suggested fields:

1. `work_id`
2. `goal`
3. `non_goals`
4. `context`
5. `constraints`
6. `acceptance_spec`
7. `risk_policy`
8. `autonomy_policy`
9. `approach_notes`
10. `missing_questions`
11. `status`

#### `loop_contract`

Suggested fields:

1. `bound_work_ref`
2. `max_iterations`
3. `max_wall_time`
4. `retry_policy`
5. `stop_conditions`
6. `escalation_conditions`
7. `driver_selection_policy`
8. `validator_policy`

### 7.3 Execution-Related Objects

#### `role_session`

Suggested fields:

1. `role_session_id`
2. `role`
3. `provider`
4. `native_session_handle`
5. `context_packet_ref`
6. `status`

#### `run`

Notes:

1. One loop child attempt
2. Permanently bound to `work_id@revision`
3. Does not accept free-text execution authority

#### `phase_result`

Suggested coverage:

1. `clarify_result`
2. `contract_freeze_result`
3. `plan_result`
4. `execute_result`
5. `validate_result`
6. `adversarial_review_result`
7. `judge_result`
8. `reflect_result`
9. `report_result`

#### `artifact`

Suggested contents:

1. diff
2. file
3. metric
4. log
5. receipt
6. screenshot
7. benchmark report
8. service endpoint / health evidence

Every artifact should carry provenance:

1. `producer_role`
2. `run_id`
3. `phase`
4. `timestamp`
5. `hash`
6. `source_path_or_uri`

### 7.4 Synchronization- and Memory-Related Objects

#### `timeline_event`

Purpose:

1. Live streaming
2. History catch-up
3. Multi-device rendering

#### `memory_item`

Purpose:

1. Store reusable knowledge
2. Do not directly equal prompt context

## 8. Lifecycle Design

### 8.1 Three User-Visible Phases

1. `Clarify / Contract`
2. `Execute Loop`
3. `Review / Validate / Reflect`

### 8.2 Suggested Eight-Phase Internal Breakdown

1. `intake`
2. `clarify`
3. `contract_freeze`
4. `plan`
5. `execute_loop`
6. `validate`
7. `adversarial_review`
8. `reflect_and_report`

### 8.3 Every Phase Should Have an Independent Role + Independent Session

Benefits:

1. Reduce context contamination
2. Make the "executor" and "reviewer" genuinely adversarial
3. Make resume / replay / audit easier
4. Make it easier to preserve structured handoffs when switching drivers

## 9. Role Design

### 9.1 Clarification-Phase Roles

#### `Intake Analyst`

Responsibilities:

1. Extract candidate goals, scope, risks, and resources from the user's original words
2. Form a draft first; do not ask questions immediately

#### `Clarification Interviewer`

Responsibilities:

1. Ask only questions that genuinely affect execution decisions
2. Control the question budget

#### `Assumption Adversary`

Responsibilities:

1. Specifically attack implicit assumptions
2. Find conflicts, ambiguities, and scope substitutions

#### `Acceptance Compiler`

Responsibilities:

1. Translate "done" into evidence
2. Form a structured `acceptance_spec`

#### `Contract Freezer`

Responsibilities:

1. Output `work_item + loop_contract`
2. Give the user a decision card they can confirm

### 9.2 Execution-Phase Roles

#### `Planner`

Responsibilities:

1. Translate the contract into an execution plan
2. Must not rewrite the goals or acceptance criteria

#### `Executor`

Responsibilities:

1. Code
2. Debug
3. Run commands
4. Produce artifacts

#### `Loop Controller`

Responsibilities:

1. Decide whether to continue the loop
2. Decide whether to switch drivers / retry / escalate
3. Do not write code directly

#### `Tool Specialist`

Responsibilities:

1. Provide specialized support for GPU / ML / frontend / release / benchmark work
2. Do not own task authority

### 9.3 Review-Phase Roles

#### `Verifier`

Responsibilities:

1. Run the `acceptance_spec`
2. Make a mechanical determination based on evidence

#### `Adversarial Reviewer`

Responsibilities:

1. Assume that the executor may be wrong
2. Find scope drift, false evidence, regressions, and missing evidence

#### `Judge`

Responsibilities:

1. Consolidate the verifier and adversary
2. Form the final verdict

#### `Reflector`

Responsibilities:

1. Summarize failure patterns
2. Form memory candidates

#### `Reporter`

Responsibilities:

1. Report to the boss
2. Compress complexity rather than dumping large amounts of logs

## 10. Key Design for the Clarification Phase

The user explicitly emphasized that this area must receive focused design, so it is recorded separately.

### 10.1 Assumption Ledger

The system must explicitly maintain every key assumption rather than hiding it in a prompt.

Each record should contain at least:

1. `statement`
2. `source`
3. `confidence`
4. `impact_if_wrong`
5. `ask_user | default | reject | defer`
6. `default_if_unanswered`

### 10.2 Question Budget

The goal is not to ask many questions, but to ask questions that are worth asking.

Suggested rules:

1. Ask at most `3` high-value questions per round
2. Handle low-risk and reversible decisions by default
3. Ask about high-risk or irreversible decisions, and decisions that change acceptance
4. Do not ask the user for information that the executor can clearly obtain by inspecting the repository

### 10.3 Ready Gate

Only when the following conditions are met may a conversation be frozen into `ready` work:

1. Goals are clear
2. Non-goals are clear
3. Workspace / repo / path boundaries are clear
4. Acceptance evidence is clear
5. Risks and escalation strategy are clear
6. Automation permission boundaries are clear
7. Remaining open questions will not block execution

### 10.4 Decision Card

The user should see a concise but complete confirmation card, not a long prompt.

The card should contain at least:

1. The goals as I understand them
2. What I believe is out of scope
3. What I will do by default
4. Items requiring your decision
5. The acceptance method
6. The main risks

### 10.5 No Fake Clarity

If the acceptance criteria are unclear, the system must not pretend to be ready.

Allowed states:

1. `draft`
2. `needs_input`
3. `blocked`

Not allowed:

1. Registering as ready with ambiguous acceptance
2. Allowing the executor to redefine the success criteria during execution

## 11. Suggested Prompt Suite

Thoth should not depend on one extremely long system prompt, but should use:

1. `PromptSpec`
2. `InputSchema`
3. `OutputSchema`
4. `HardStops`
5. `ContextPolicy`

The suggested preset prompt suite is as follows.

### `P0 Global Digital Employee`

Responsibilities:

1. Set "reducing the boss's cognitive burden" as the highest goal
2. Decide whether the current state should enter clarification, registration, execution, review, or reporting

Hard limits:

1. Must not pretend that the task is complete
2. Must not make the user manage providers/sessions/logs
3. Must not bypass acceptance

### `P1 Workspace Intake Analyst`

Inputs:

1. User's original words
2. Workspace summary
3. Most recent relevant memory

Outputs:

1. `intent_candidates`
2. `scope_candidates`
3. `risk_flags`
4. `missing_info`

### `P2 Clarification Interviewer`

Output rules:

1. At most `3` questions
2. Each question must explain:
   - Why it needs to be asked
   - What will happen by default if it is unanswered
   - What the answer will affect

### `P3 Assumption Adversary`

Inputs:

1. draft contract

Outputs:

1. `attack_findings`
2. Sort by `blocker/high/medium`

### `P4 Acceptance Spec Compiler`

Responsibilities:

1. Translate the user's language into an `acceptance_spec`

Examples of supported acceptance types:

1. `script`
2. `metric`
3. `artifact`
4. `service_state`
5. `benchmark`
6. `visual`
7. `mixed`

### `P5 Work Registrar / Loop Compiler`

Responsibilities:

1. Output `work_item`
2. Output `loop_contract`
3. Output a role plan

### `P6 Planner`

Responsibilities:

1. Output a concrete execution plan
2. Identify authority gaps
3. Return `needs_input` when a gap is found

### `P7 Executor`

Responsibilities:

1. Implement
2. Debug
3. Produce artifacts
4. Leave auditable receipts

Limit:

1. Must not claim final approval
2. May claim only "executed / produced"

### `P8 Loop Controller`

Responsibilities:

1. Read the results of this execution cycle
2. Decide the next step:
   - `continue`
   - `retry`
   - `switch_driver`
   - `validate`
   - `needs_input`
   - `stop_failed`
   - `stop_success`

### `P9 Verifier`

Responsibilities:

1. Run the validator
2. Determine whether the evidence is sufficient

### `P10 Adversarial Reviewer`

Responsibilities:

1. Review the execution results from the opposite direction
2. Find vulnerabilities, drift, and false success

### `P11 Judge / Reflector`

Responsibilities:

1. Form the final verdict
2. Form a retry hint
3. Produce memory candidates

### `P12 Reporter`

Responsibilities:

1. Translate the technical execution process into a report readable by the boss

### `P13 Memory Curator`

Responsibilities:

1. Extract reusable knowledge from completed/failed tasks
2. Do not directly contaminate long-term memory

### `P14 Context Compiler`

Responsibilities:

1. Compile minimally sufficient context packets for different roles
2. Strictly control tokens and contamination

## 12. Memory and Context Design

### 12.1 Memory Layers

At least seven layers are recommended.

#### `Global User Memory`

Contains:

1. User preferences
2. Style preferences
3. Risk preferences
4. Reporting style

#### `Workspace Memory`

Contains:

1. Repository structure
2. Common commands
3. Test entry points
4. Deployment/runtime constraints
5. Common pitfalls

#### `Authority Memory`

Contains:

1. Decisions
2. Assumptions
3. Work items
4. Acceptance specs

Note:

1. This is the highest-trust layer

#### `Run Memory`

Contains:

1. Execution plans
2. Retry history
3. Failure reasons
4. Artifact index

#### `Artifact Memory`

Contains:

1. Key files
2. Logs
3. Screenshots
4. Metrics
5. Receipts
6. Hash / provenance

#### `Provider Capability Memory`

Contains:

1. The current harness's capabilities, modes, limitations, and availability

Requirements:

1. Include a TTL
2. Support refresh

#### `Lessons / Skill Memory`

Contains:

1. Reusable experience
2. Failure patterns
3. Task-archetype-level experience

### 12.2 Context Is Not Memory

It must be clear that:

1. Memory is long-term retrievable information
2. A context packet is the minimally sufficient input for a particular role/session

Suggested packet structure:

```json
{
  "role": "executor",
  "work_ref": "WORK-123@rev7",
  "goal": "...",
  "non_goals": ["..."],
  "constraints": ["..."],
  "acceptance_spec": {},
  "relevant_decisions": ["DEC-..."],
  "relevant_workspace_facts": ["..."],
  "forbidden_assumptions": ["..."],
  "required_evidence": ["..."]
}
```

### 12.3 How to Pass Context Between Phases

Use handoff artifacts rather than sharing entire conversations.

For example:

1. Clarification-phase output: `contract_freeze.json`
2. Plan-phase output: `plan.json`
3. Execute-phase output: `execute_receipt.json`
4. Validate-phase output: `validate_result.json`
5. Adversarial-phase output: `review_findings.json`
6. Judge-phase output: `verdict.json`
7. Report-phase output: `boss_report.md`

## 13. Host-Neutral Design

### 13.1 Principles

Host neutrality does not mean flattening differences; it means:

1. Define a unified upper-layer contract
2. Explicitly model capability differences
3. Confine differences to adapters

### 13.2 Suggested Unified Upper-Layer Interface

The upper layer should unify at least these semantics:

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

### 13.3 Capability Matrix

Each driver should expose explicit capabilities:

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

### 13.4 Driver Integration Pattern

Paseo is a useful model:

1. Harnesses that support ACP:
   - Use `ACPAdapter`
2. Highly distinctive harnesses:
   - Use `DirectAdapter`

### 13.5 The Reality of Provider Materialization

Evidence from the reference projects shows:

1. `Claude Code` / `CodeBuddy` favor `CLAUDE.md + .claude/skills + --mcp-config`
2. `Codex` favors `AGENTS.md + $CODEX_HOME + config.toml`
3. `OpenCode` has its own dynamic MCP and variant model system
4. The skill path for `Hermes` / `OpenClaw` may even be a fallback path
5. `Pi` uses a file path as its resume ID, not an ordinary string

Therefore:

1. Thoth should not assume uniform materialization behavior at the authority layer
2. The driver should handle:
   - Skill writing
   - AGENTS/CLAUDE injection
   - MCP writing
   - Model/mode/thinking parameter mapping

## 14. Multi-Device Synchronization Design

### 14.1 Core Invariants

The following invariants should be adopted directly:

1. The live stream provides immediacy
2. Authoritative history provides correctness
3. Presence is not delivery
4. Catch-up may be paginated, but nothing may be lost
5. A resumed client must be able to fill in the complete history

### 14.2 The Daemon as Authority Server

Recommendations:

1. Commit every timeline event to the daemon first
2. Then broadcast it to each client
3. Every client can reconnect after disconnection and catch up by cursor

### 14.3 Relay and Remote Access

Recommendations:

1. Prefer direct connections on the same network
2. Use a relay for remote connections
3. The relay forwards ciphertext only
4. The phone obtains the daemon public key by scanning a code
5. Establish communication over an E2EE channel

### 14.4 What the Phone Client Should Do

The phone client should initially prioritize:

1. Viewing the task list
2. Viewing phase progress
3. Viewing the key timeline
4. Answering clarification questions
5. Approving permissions / decisions
6. Viewing the final report

It is not recommended to build initially:

1. Heavy code-diff editing
2. Extensive terminal interaction
3. Full IDE-level operations

## 15. Recommended TUI and APP Paths

### 15.1 TUI

Recommendations:

1. Use `OpenTUI`
2. Prefer `@opentui/react`
3. Have the TUI consume only `@thoth/client`
4. Do not read `.thoth` directly

Suggested core TUI views:

1. Global Inbox
2. Workspace Chat
3. Clarification Queue
4. Work Items
5. Loops / Runs
6. Evidence / Artifacts
7. Permissions / Decisions
8. Reports
9. Provider Health

### 15.2 APP

Recommendations:

1. Use `Expo React Native` for the first version
2. Cover simultaneously:
   - iOS
   - Android
   - Web
3. Use `Electron` for Desktop to wrap the web/app client and manage the daemon

Reasons for this path:

1. The reference project has demonstrated that multi-platform packaging is feasible
2. The protocol and TypeScript types can be reused
3. It is the fastest way to achieve the goal of "phone synchronization + desktop management"

### 15.3 The Concrete Meaning of UI as a Shell

The following must be upheld:

1. The TUI must not own independent business rules
2. The APP must not own an independent task state machine
3. The semantics of every phase, permission, verdict, and report may be owned only by the daemon / authority layer

## 16. Recommended Technology Stack

Suggested new repository structure:

1. `packages/protocol`
2. `packages/client`
3. `packages/daemon`
4. `packages/drivers`
5. `packages/core`
6. `packages/tui`
7. `packages/app`
8. `packages/desktop`
9. `packages/mcp`

Suggested language choices:

1. `TypeScript`：
   - protocol
   - client
   - daemon
   - app
   - desktop
   - tui
2. `Python`：
   - validator / benchmark / repo-local execution helper
   - Not the UI/protocol mainline

Reasons:

1. Sharing types across driver adapters, multi-device clients, and protocol schemas is most important
2. The existing reference projects are also largely part of the TS/Node daemon ecosystem

## 17. Suggested MVP Path

### `V0` Design Freeze

Deliverables:

1. authority schema
2. protocol schema
3. role lifecycle
4. prompt suite spec

### `V1` Local Daemon + Store

Capabilities:

1. `thothd`
2. event log
3. workspace registry
4. timeline
5. read model
6. mock driver

### `Thoth` Clarification Compiler

Capabilities:

1. workspace/global chat
2. assumption ledger
3. question budget
4. acceptance compiler
5. work registration

### `V3` One Real Driver

Initially integrate only:

1. `Codex` or `Claude Code`

Goal:

1. Run the complete contract-to-execution-to-validation loop end to end

### `V4` OpenTUI

Goal:

1. Provide a genuinely usable first-version TUI control plane

### `V5` APP + Desktop

Goal:

1. Connect to the daemon by scanning a code on the phone
2. View the timeline
3. Approve permissions
4. View reports

### `V6` Multi-provider

Goal:

1. Gradually integrate OpenCode, Hermes, OpenClaw, QwenCode, and others
2. Every provider must have a capability contract and conformance tests

### `V7` Autopilot / Night Runs

Goal:

1. Recurring loops
2. Nightly background work
3. Digest reports
4. Memory curation

## 18. Risks and Boundaries

### 18.1 Greatest Risks

1. Asking too many questions during clarification and annoying the user
2. Weak acceptance criteria making it easy for the system to "look successful"
3. Losing history during multi-device synchronization
4. Context bloat contaminating role sessions
5. Supporting too many providers too early and destabilizing core authority

### 18.2 Design Boundaries

1. First build `clarification -> loop contract -> validator-first run`
2. Do not pursue complete UI feature coverage first
3. Do not pursue complete provider coverage first
4. Do not mistake a "polished dashboard" for the core value

## 19. Final Judgment on the Current Proposal

### 19.1 One-Sentence Version

Thoth's core should not be "how many more harnesses it supports," but rather:

**Compile the boss's vague natural-language intent into a verifiable, recoverable, asynchronously executable, auditable loop contract, and implement it using any harness.**

### 19.2 Composed Adoption from the Reference Projects

Suggested combination:

1. Adopt from `Multica`:
   - agent teammate / issue / runtime / multi-workspace / managed daemon
2. Adopt from `Paseo`:
   - The daemon/client/relay/protocol/provider adapter/timeline sync/app+desktop path
3. Adopt from the current `Thoth`:
   - `.thoth` authority
   - `work_id@revision`
   - `acceptance_spec`
   - `phase_result`
   - `artifact ledger`
   - adversarial review

### 19.3 Principles That Must Not Be Lost

1. `UI is a shell`
2. `Registering a task is registering a loop`
3. `At least three phases, with an independent role + independent session for each phase`
4. `Acceptance must precede the declaration of success`
5. `Multi-device synchronization must follow authority/history`
6. `Host neutrality must be implemented through adapters + a capability matrix`
7. `Reducing human cognitive burden takes priority over exposing internal system complexity`

## 20. Questions Still Requiring a Decision

The following questions should still be decided separately before implementation:

1. Whether `thothd` should use `TypeScript/Node` entirely, or whether the authority/store kernel should be moved separately to Rust
2. The relationship between `.thoth` and the daemon's internal database:
   - A single source of truth in SQLite, then projected to `.thoth`
   - Or `.thoth` as the source of truth, with SQLite used only as a cache/index
3. Whether to build the APP in the first phase, or first connect OpenTUI + CLI end to end
4. Whether the initial provider should be `Codex` or `Claude Code`
5. Whether to introduce a dedicated "different-provider adversarial" strategy for review/verifier/judge
6. Whether memory curation should be fully automatic or should by default require user confirmation before writing to long-term memory

## 21. Local Reference Materials

The local materials directly referenced for this round's design are as follows.

### Current Thoth Repository State

1. `<thoth-repo>/.agent-os/project-index.md`
2. `<thoth-repo>/.agent-os/todo.md`
3. `<thoth-repo>/.agent-os/architecture-milestones.md`
4. `<thoth-repo>/.agent-os/run-log.md`

### Multica

1. `<harness-workspace>/multica/README.md`
2. `<harness-workspace>/multica/CLI_AND_DAEMON.md`
3. `<harness-workspace>/multica/apps/docs/content/docs/providers.mdx`
4. `<harness-workspace>/multica/server/pkg/agent/agent.go`
5. `<harness-workspace>/multica/server/internal/daemon/execenv/runtime_config.go`

### Paseo

1. `<harness-workspace>/paseo/docs/architecture.md`
2. `<harness-workspace>/paseo/docs/providers.md`
3. `<harness-workspace>/paseo/docs/custom-providers.md`
4. `<harness-workspace>/paseo/docs/agent-lifecycle.md`
5. `<harness-workspace>/paseo/docs/timeline-sync.md`
6. `<harness-workspace>/paseo/packages/app/package.json`
7. `<harness-workspace>/paseo/packages/desktop/electron-builder.yml`

### OpenTUI

1. `<codex-skills>/opentui/docs/getting-started.mdx`
2. `<codex-skills>/opentui/docs/bindings/react.mdx`

## 22. Document Purpose

This document is used to:

1. Codify the user's original goals and constraints for Thoth from this round
2. Codify the key research conclusions about `Multica`, `Paseo`, and `OpenTUI`
3. Provide a unified entry point for the subsequent decision-complete migration mainline of `TD-003`
4. Prevent the highest-level product principle of "reducing human cognitive burden" from being lost during subsequent implementation phases
