# Thoth App Runtime Contract

## Status

1. Date: `2026-07-27`
2. Nature: Thoth APP information architecture, runtime skill, runtime tool bridge, AgentTimeline, and authority card contract
3. Scope: `packages/app`, `packages/desktop`, `packages/daemon`, `packages/drivers`, `packages/protocol`, `packages/client`
4. Code contract: `packages/protocol/src/thoth-runtime-contract.ts`, `packages/protocol/src/agent-types.ts`, `packages/protocol/src/messages.ts`
5. Status: canonical design authority; `NTH-CD-041` locks the restored Paseo production app surface, `NTH-CD-042` locks the Quick / Clarify / Loop phase split, `NTH-CD-045` locks the Loop background main path as Goals Card -> durable Task -> PlanExec / Review phases, `NTH-CD-053` locks one continuous foreground provider thread for each visible Agent, `NTH-CD-054` locks a frozen control snapshot for each send, `NTH-CD-060` upgrades the Runtime Tool Bridge to a shared HarnessAdapter + RuntimeBundle + ToolGateway for all providers/ACP, `NTH-CD-077` through `NTH-CD-085` add Forge, scoped Browser automation, Workspace Schedule, bounded Timeline, Provider portfolio, read-only Files/Changes, Desktop lifecycle and durable Host resource leases, and `NTH-CD-090` through `NTH-CD-095` complete `Tasks | Schedules`, scoped Workspace scripts, atomic transport, Driver-owned Provider/runtime behavior, strict forwarded authority and the persistent-daemon default without changing Workspace / Task / Execution authority.
6. Replaced scope: this document supersedes the former three-view toy shell, assistant JSON/outputSchema packet, `submit_clarify_packet` main path, Workspace Secretary `liveEvents` summary stream, fake background running/review semantics, and the former Pyramid Plan / `registered_pending` semantics as the Loop main path. Old packet / state-code / golden materials may serve only as legacy/internal evidence or Loop-1 history and do not drive current Loop acceptance.

## 0. Current Highest-Level Contract

### 0.1 Frontend Surface

`NTH-CD-041` remains the highest constraint on the APP main interface:

1. The Loop-2 main entry point must be the restored Paseo production app surface.
2. Paseo is the frontend substrate, not a temporary reference or toy shell.
3. The main path must retain stream, timeline, composer, card, settings, host/provider, attachments, file links, terminal/browser/file panes, desktop/mobile responsive layout, keyboard/focus/accessibility, and the e2e/test substrate.
4. A toy shell such as `packages/app/src/thoth-app/thoth-app-shell.tsx` must not serve as the user's main entry point.
5. The composer's original `Models` / `Think` / `Feature` controls map to Thoth `Provider` / `Clarify` / `Mode`.
6. The user-visible product mental model is the Thoth Workspace Secretary / task loop, not a Paseo agent manager and not a debug protocol viewer.

### 0.2 Runtime Phase

`NTH-CD-042` continues to define the phase boundary between Quick / Clarify / Loop:

1. One Workspace Secretary topic always corresponds to one continuous foreground provider conversation; Thoth toggle, Clarify strength, and Quick/Loop only determine the harness policy for the next turn and must never serve as provider session identity.
2. `Quick + none` is a bare provider / Paseo foreground turn: it does not load `thoth.clarify`, wrap a Clarify envelope, expect structured output, enter Clarify repair, or create a card, Task/Goals authority, or Loop registration.
3. `Quick + clarify` reuses this same Workspace Secretary topic/provider session and enters `thoth.clarify` during structured phases.
4. `Quick + clarify` phases: `clarify`, `approval_task`, `approval_breakdown`, `quick_exec`, `repair`.
5. `quick_exec` is an ordinary provider execution stream and is not packetized; it must continue to display provider reasoning, shell, edit, read, write, search, fetch, web, todo, error, permission, and other AgentTimeline events.
6. Under `NTH-CD-045`, `Loop` registers a durable Loop task after Clarify and two confirmation cards, then starts PlanExec / Review in the background scheduler; old `registered_pending` is retained only for legacy/recovery compatibility.
7. On every user send, the daemon persists the effective `mode / clarifyStrength / loopStrength` for that turn as turn controls. They are runtime truth and only determine the Clarify, Task Card, Goals Card, and Quick/Loop handoff in this turn's authority flow; they do not enter the Agent Harness task semantics.
8. Switching Thoth, Clarify, or Quick/Loop while a Card is pending changes only the preference for the next send. The Task/Goals Card's own frozen turn controls take precedence over the current composer or a late clean model; refresh, reconnection, daemon restart, and provider session recovery must not rewrite them.
9. Quick-owned Task/Goals Cards may continue only in the foreground; Loop-owned Task/Goals Cards may only register background tasks. The App is responsible for presenting the correct action from the Card, while the daemon still validates intent and Loop strength against the same Card snapshot; any contrary intent remains pending and returns an explicit conflict.

### 0.3 Runtime Tool Bridge

`NTH-CD-043` supersedes the former description in `NTH-CD-042` that treated `submit_clarify_packet` as the main path:

1. The structured Workspace Secretary main path uses a provider-neutral HarnessAdapter; Codex `dynamicTools`, Claude/OpenCode/Pi MCP, and ACP tool surfaces are merely driver mappings of the same semantic tool catalog.
2. During structured phases, the model calls Thoth semantic runtime tools rather than outputting assistant JSON, markdown packets, native `outputSchema` packets, or `submit_clarify_packet`.
3. Current Codex main-path tool names:
   - `thoth_submit_clarify_card`
   - `thoth_submit_task_card`
   - `thoth_submit_pyramid_plan`
   - `thoth_report_blocked`
4. After receiving tool-call input, the daemon validates schema, phase, authority, provenance, permission, and pending-decision state, then constructs an internal authority event / card model.
5. After the user answers a Card, the daemon first appends the Human Decision, then starts a new continuation ExecutionAttempt in the same ProviderThread; it must not resume an old tool-call Promise or depend on an old call stack remaining alive.
6. `submit_clarify_packet` / `submit_runtime_packet` may exist only as legacy/internal/test-isolated compatibility terms; they must not be the Loop-2 acceptance main path or appear in user-visible UI.
7. The current Codex, Claude Code, OpenCode, Pi, and ACP adapters must implement and pass complete bridge conformance; if a future provider lacks a declared required capability, it must honestly report unsupported and must not fall back to outputSchema/assistant markdown JSON as a substitute for passing.

### 0.4 Operational Product Surfaces

1. Forge clone, PR/MR creation, archive/restore/import, and open-in-agent actions enter through semantic Client RPCs;
   App does not own Git or Workspace lifecycle. Import binds an existing Workspace and cannot mint one.
2. Files and Changes are read-only projections over daemon file/Git use cases: file tree, line navigation, commit
   history, commit diff, and adding a Workspace file to Composer. Editor/save/conflict/BOM/line-ending write paths
   remain deferred.
3. Browser tools are Provider capabilities translated by Drivers and fenced by ToolGateway. Desktop owns trusted
   Chromium execution with one Host-wide persistent profile; every tab-scoped operation carries `browserId`, while
   App coordinates duplicate/replayed request IDs without becoming durable authority.
4. Schedule belongs to Workspace authority. The top-level entry is `Tasks`, with `Tasks | Schedules` tabs. Every
   run exposes its owner Workspace, actual execution Workspace, real `taskId` and `executionId`; Schedule-to-Task
   and Task-to-Schedule navigation comes from canonical origin receipts rather than App inference or an optimistic
   local run. Legacy unknown execution Workspace remains visibly unavailable.
5. Pin is a device-local presentation preference. Provider-suggested initial titles may be accepted, but a user
   rename is permanently authoritative over later suggestions.
6. Workspace scripts are read and controlled only through semantic Client list/start/stop calls. The App renders
   configured command identity, lifecycle, terminal, service port/proxy, health and typed errors; it never owns the
   process, port lease or command authorization.
7. Direct and Relay file reads expose one bounded transfer result after advertised size/revision validation. The
   App cannot observe partial success, infer encrypted frame kind, or create a second file-transfer queue.

## 1. Core Judgment

Thoth APP is not a dashboard, not a Paseo reskin, and not an agent/session manager.

On the restored Paseo surface, Thoth provides a task control plane:

1. The user enters a workspace.
2. The user sends a prompt in the current Workspace Secretary topic.
3. `Provider` selects a real HarnessAdapter/ProviderThread; Codex undergoes real authentication acceptance, while Claude Code, OpenCode, Pi, and ACP undergo their respective transport-level end-to-end conformance.
4. `Clarify` selects a strength such as `none` / `light` / `balanced` / `dive`.
5. `Mode` selects `Quick` or `Loop`.
6. `Quick + none` follows the bare provider stream.
7. `Quick + clarify` enters Clarify Card -> Task Card -> Goals Card -> same-session `quick_exec` through runtime tools.
8. `Loop` enters Clarify Card -> Task Card -> Goals Card -> durable background Loop task through runtime tools; legacy Pyramid Plan / `registered_pending` is no longer the main path.

The user does not need to understand provider sessions, PlanExec, Review, skills, packets, state codes, repair, authority stores, drivers, MCP, dynamic tools, or raw tool calls.

## 2. RuntimeToolBridge Contract

The Thoth product layer depends only on provider capabilities, not on a transport name.

Current capability model:

```ts
type ClarifyTransport =
  | "codex_dynamic_tool"
  | "native_question"
  | "mcp_runtime_tool"
  | "output_schema_degraded"
  | "unsupported";
```

Loop-2 verification passes only through `codex_dynamic_tool`.

Provider-neutral bridge responsibilities:

1. Register or enable provider session-scoped runtime tools.
2. Normalize provider-native questions, custom tools, MCP tools, or dynamic tool calls.
3. Convert Thoth-owned card submissions into persisted pending authority decisions.
4. Block or persist waiting for the user's answer.
5. Serialize the user's answer back into a provider-specific tool result.
6. Record capability, pending id, provider agent id, topic id, call id, phase, tool name, validated card, status, timestamps, and a redacted raw input hash.

Current Codex adapter responsibilities:

1. For a Workspace Secretary provider thread that supports native tools, register session-level `dynamicTools` at thread/start so that the same topic can subsequently enter a Thoth turn from a raw Provider turn without switching sessions.
2. Handle `item/tool/call`.
3. Accept only semantic tools allowed by the current phase: the Clarify phase uses `thoth_submit_clarify_card`, `thoth_submit_task_card`, `thoth_submit_goals_card`, and `thoth_report_blocked`; the Loop phase uses PlanExec / Review / blocked tools. `thoth_submit_pyramid_plan` is legacy only.
4. Return `DynamicToolCallResponse`.
5. Even when a raw `Quick + none` turn occurs in a thread with session-level tools already registered, it must be rejected by the daemon's per-turn authority fence; it cannot create a card, pending decision, Task/Goals authority, or Loop task.
6. In a Clarify structured session, treat Codex native `request_user_input` as a violating question path and repair or block it rather than converting it into a Thoth card.

Claude/OpenCode direction:

1. Claude `AskUserQuestion` and OpenCode `question` are provider-native question transports and are not equivalent to Thoth-owned authority submission.
2. Claude SDK custom tools / in-process MCP and OpenCode custom tools / MCP may serve as future `RuntimeToolBridge` adapters.
3. They are not included in the Loop-2 verified scope; the UI/daemon must honestly report unsupported or degraded and must not pretend to pass.

## 3. Authority And Pending Decisions

Clarify / Task / Goals all follow the same lifecycle:

1. The Provider model calls a semantic runtime tool.
2. The daemon validates the tool input.
3. The daemon persists the pending decision.
4. The frontend renders a typed authority card inside AgentTimeline.
5. The user selects, annotates, accepts, cancels, or requests modification.
6. The daemon records the authority event.
7. The daemon returns the provider tool result.
8. The Provider continues in the same topic/session.

Pending decision status:

```text
pending
answered
rejected
expired
blocked
```

Not allowed:

1. The frontend locally generates a Task / Goals Card.
2. The frontend locally modifies authority card content.
3. The frontend chooses the first option on the user's behalf.
4. The daemon defaults to acceptance without a user action.
5. The Provider advances directly after natural-language self-reporting that it is “confirmed.”
6. Assistant text / markdown JSON / code fences are parsed as authority.

## 4. AgentTimeline Contract

The Loop-2 realtime UI stream is AgentTimeline, not the Workspace Secretary `liveEvents` summary main path.

AgentTimeline must retain the provider's original lifecycle semantics:

1. `user_message`
2. `assistant_message`
3. `reasoning` / thought
4. `tool_call`
5. shell / command
6. edit / file change
7. read / write / search / fetch / web
8. todo
9. error / activity
10. compaction
11. permission / provider-native question
12. Thoth authority cards

A tool call is a lifecycle update: the same `callId` updates from running to completed / failed / canceled, and the frontend merges it into the same badge rather than adding separate start/end rows.

Thoth authority cards are also timeline items:

1. `clarify_card`
2. `task_card`
3. `goal_card`, with Goals Card as the user-visible main path and the wire retaining the legacy name for compatibility
4. `registered_task`

Workspace Secretary may retain snapshot/model fields for recovery and compatibility, but the user-facing main path must not depend on a degraded summary stream such as `liveEvents` in place of the provider timeline.

### 4.1 Foreground Delivery And Rewind Identity

1. Each Send is first accepted by the daemon Workspace authority as a complete frozen snapshot; the App does not write an optimistic `user_message` and does not maintain a second Queue.
2. Each Agent has at most one active foreground execution. `queue` waits for terminal/fence; `interrupt` persists first and then stops the old turn, prohibiting two provider streams from running in parallel.
3. The canonical `messageId` belongs to the Thoth Timeline. HarnessAdapter binds it to a versioned opaque provider anchor receipt; the daemon and App do not interpret the provider-native id.
4. Conversation/both rewind truncates from the target canonical user row and creates a new Timeline epoch; the App clears the old cursor/head/tail and fully reads the new epoch. An old anchor whose identity cannot be determined is explicitly non-rewindable.
5. Workspace images are always read by the current daemon/Relay binary. Previews use only temporary Blob/data URI values and release them when switching, closing, or unmounting; they must not be copied into the attachment persistence directory.
6. Timeline reads are bounded and cursor/epoch ordered. Text enters live and durable Timeline through one UTF-8-safe
   64 KiB truncation object with explicit byte metadata; Provider subagents render only as nested read-only traces.

## 5. Cards And Contracts

### 5.1 Clarify Card

Clarify Card is a Thoth decision card, not a reskin of provider-native `request_user_input` / `AskUserQuestion` / permission questions.

Constraints:

1. One card contains 2-4 closely related questions.
2. Each question has 2-4 options.
3. An option label is no more than 15 characters.
4. An option description is no more than 30 characters.
5. Per-option notes are supported.
6. Note-only is supported.
7. “What do you recommend?” is supported as structured user intent, not as a frontend default selection; `You decide` is legacy only.
8. Do not preselect or recommend by default.
9. Immediately after submission, collapse into a readonly/submitted summary.
10. Multi-round Clarify Cards remain in the same topic timeline and do not overwrite history.

### 5.2 Task Card

Task Card is a compact CEO overview.

Only the following are allowed:

1. `title`
2. `goal`
3. `constraints`
4. `acceptance`

Not allowed:

1. A risk field.
2. A why_loop field.
3. An implementation plan.
4. File paths.
5. Commands.
6. Code-level steps.

Task Card must include complete Clarify transcript provenance. User annotations or modification requests must return to the agent harness; the frontend cannot modify authority locally.

### 5.3 Goals Card

Goals Card is the second confirmation card. It replaces the old user-visible “Pyramid Plan Card” mental model, while the wire may continue to support the `goal_card` / `C_GOAL_CARD` names for compatibility; the old Pyramid Plan is parse-only legacy.

It expresses:

1. Linear ordered goals.
2. Each goal's title / goal / constraints / acceptance.
3. Goal provenance.
4. Execution order.

Not allowed:

1. Repeating the full Task Card.
2. A risk field.
3. An implementation plan.
4. File paths.
5. Shell commands.
6. Code steps.

Goals Card must include the complete Clarify transcript plus confirmed Task Card provenance.

## 6. Mode Semantics

### 6.1 Quick + none

`Quick + none` is a bare Provider / Paseo foreground turn:

1. Reuse the provider session, context, and provider-native conversation state already associated with the current topic.
2. Do not mount `thoth.clarify`, require `outputSchema` or a packet, or enter Clarify repair.
3. Do not create a Thoth authority card, Task/Goals authority, or Loop task.
4. The provider's session-level tool catalog may remain available for future Thoth turns; the daemon must reject any remembered Thoth authority tool call according to the current raw-turn fence.
5. Ordinary assistant text, reasoning, tools, and permissions are displayed through AgentTimeline.
6. If the bare provider itself triggers Provider-native `request_user_input`, render it according to the native Paseo permission/question lifecycle.

### 6.2 Quick + clarify

`Quick + clarify` is a phase-aware secretary session:

1. `clarify`: the Provider calls `thoth_submit_clarify_card`, or determines that it should enter Task.
2. `approval_task`: the Provider calls `thoth_submit_task_card`.
3. `approval_breakdown`: the Provider main path calls `thoth_submit_goals_card`; `thoth_submit_pyramid_plan` is legacy only.
4. `quick_exec`: the Provider executes normally using the confirmed Task + Goals Card and displays the native AgentTimeline.
5. `repair`: the Provider repairs tool input shape / phase / provenance without reinterpreting the user's goal.

After both cards are confirmed, enter `quick_exec` in the same topic/provider session; do not register a background task.

### 6.3 Loop

Loop path after `NTH-CD-045`:

```text
clarify -> Task Card -> Goals Card -> durable Loop task -> current goal PlanExec -> Review -> pass/retry/block -> next goal
```

Old Loop-2 `registered_pending` is retained only for legacy recovery compatibility; the current main path must start real background PlanExec / Review task state, but must still not display fake running, fake review, or fake evidence.

Minimum UI after registration:

1. The main timeline displays Goals approval / background task handoff.
2. The `Tasks` tab can view real Loop, manual background and Schedule-origin Tasks.
3. Task detail presents status by linear goals, with a spinner for the current goal/phase and the others grayed out.
4. Phase detail embeds the corresponding PlanExec / Review agent's AgentTimeline.
5. It remains recoverable after refresh, reconnection, and a mobile deep link.
6. Review constitutes a failed Review only after `continue` / `reframe_current_goal` is submitted, and automatically returns to the next PlanExec round for the same goal; startup, configuration, or transport errors before the Provider has formed a verdict are not Review failures.
7. Provider infrastructure failure enters `interrupted`, does not consume the failed-Review budget, and Resume continues from the current phase cursor. After the user repairs the real prerequisite, the user may also explicitly Resume a `blocked` phase.
8. After successful Goals Card registration, the Workspace Secretary foreground must project `background_handoff + ready`. A hot composer switch or a lingering running tool in historical timeline data must not recreate a foreground spinner.

## 7. Daemon Mechanical Responsibilities

The daemon performs only mechanical authority work and no semantic intelligence:

1. Select the bare stream or runtime tool bridge according to Mode / Clarify / phase.
2. Register Codex `dynamicTools`.
3. Validate tool input schemas.
4. Validate phase transitions.
5. Validate Task / Goals provenance.
6. Validate the user approval gate.
7. Persist pending decisions and authority events.
8. Broadcast AgentTimeline updates.
9. Return the user's answer to the provider runtime.
10. Display honestly blocked for unsupported bridges.

The daemon must not:

1. Privately call a general-purpose LLM API.
2. Use local natural-language heuristics to infer user intent.
3. Use the Provider's natural-language self-report as a substitute for a tool call.
4. Pretend to provide a runtime tool bridge through an outputSchema / assistant JSON fallback.
5. Skip user confirmation when creating a background task.
6. Expose packet/schema/repair/tool internals to the user.
7. Inject task/goal/phase/run id, session handle, event revision, budget, retry count, envelope, receipt hash, manifest/baseline, or recovery state into the cognitive context of a Clarify, PlanExec, Review, or audit session.
8. Treat an independent Review's semantic judgment as invalid because an agent omitted mechanical fields or failed to repeat a PlanExec checklist; the daemon may bind only the minimal semantic conclusion to the authority state it already knows.

Agent Harness context boundary:

1. Clarify, PlanExec, Review, and audit sessions face the user's goals, confirmed contracts, relevant workspace reality, inspectable work products, and necessary historical judgments.
2. Review faces an independent corrective task: challenge the current approach, identify the real crux, reject an incorrect path when necessary, and indicate the next direction; it is not a daemon checklist executor.
3. Runtime tool transport may return Review's minimal semantic conclusion to the daemon, but the tool schema/prompt must not require the agent to transmit or reason about daemon recovery, budget, phase, receipt, or manifest fields.

## 8. Frontend Responsibilities

The frontend only renders typed AgentTimeline items and authority card models provided by the protocol / daemon.

The frontend may:

1. Render the provider assistant / reasoning / tool timeline.
2. Render Clarify / Task / Goals / background task cards.
3. Collect user selections, annotations, acceptance, cancellation, and modification requests.
4. Send structured answers back to the daemon.
5. Immediately collapse a card into readonly/submitted status after submission.
6. Render read-only Files/Changes/commit history, scoped Browser tabs, and Workspace Schedule receipts returned by
   the semantic Client.
7. Keep device-local pin, layout, draft checkpoint, focus, and scroll preferences that cannot alter daemon truth.
8. Render and control Workspace scripts through the semantic list/start/stop API after the Tasks surface is closed
   or arranged so the script control is interactable; never force an obscured control or call daemon internals.

The frontend must not:

1. Infer state from assistant text.
2. Parse markdown JSON / code fences / raw packets.
3. Generate Task / Goals Cards.
4. Modify authority card content.
5. Choose a default item on the user's behalf.
6. Wrap `Quick + none` as Clarify.
7. Display `submit_clarify_packet`, `dynamicTools`, MCP tools, raw JSON, schema errors, repair prompts, skill names, provider roles, or state codes.
8. Access SQLite, Git, Provider SDKs, or Browser process state directly, or create a SessionContext/directory replica
   authority for Files, Schedule, Browser, or Timeline.

## 9. Verification Boundary

`NTH-EV-029` verifies the strengthened Loop-2 Clarify path, with known remaining gaps.
`NTH-EV-030` code-verifies the merged Loop background implementation, but real-provider local/public
acceptance is still pending.

`NTH-EV-071` verifies and publicly closes the Paseo v0.2.2 operational surfaces. `NTH-EV-072` verifies and publicly
closes the v0.2.3 additions through focused owner tests, all five root gates, real Web Schedule/script interaction,
Android Debug APK, real Codex, hosted Relay v3 E2EE/multi-chunk transfer, exact-SHA native publication and a
downloaded-public-AppImage real-window journey.

1. The restored Paseo surface is the main path.
2. Quick+none `hi` is a bare provider stream with no Clarify Card.
3. Quick+Dive uses Codex `dynamicTools` and produces multi-round Clarify Cards.
4. Task Card is compact.
5. Goals Card is linear in the current main path; legacy Pyramid Plan is parse-only compatibility.
6. Quick approvals continue into same-session `quick_exec`.
7. `quick_exec` shows real Shell/Edit timeline rows.
8. Loop approvals create a durable Loop task and enqueue the scheduler in the current main path.
9. The `Tasks` list/detail exposes Loop, manual and Schedule-origin tasks, goals, PlanExec/Review phases, Schedule
   origin navigation, and embedded AgentTimeline; the sibling `Schedules` tab owns Schedule management/history.
10. Mobile deep-link recovery works.
11. `npm --workspace=@thoth/app run test`, daemon focused tests, `npm run build:web`, `npm run check:foundation`, and `git diff --check` passed.
12. Independent `codex exec` UI/runtime mental-model review passed.

Not fully verified yet:

1. Real Codex local/public Loop background acceptance for PlanExec / Review execution.
2. Golden/judge evidence for `thoth.loop` PlanExec / Review quality.
3. Non-Codex provider runtime-tool adapters.
4. Fixed-Beta exact-SHA workflow and downloaded public asset verification for the Paseo v0.2.3 integration.

## 10. Minimal Next Implementation Order

After `NTH-EV-030`, the next top action is `NTH-TD-019` real-provider acceptance:

1. Run real Codex Loop+Single and Loop+Light in throwaway `/tmp` workspaces.
2. Capture local `8082` and public `8148` screenshots/trace/video/log summaries outside the git repository.
3. Verify that Goals Card approval creates a durable Loop task, not legacy `registered_pending`.
4. Verify that PlanExec and Review phase timelines stream real provider AgentTimeline events.
5. Verify failed Review budget, pass advancement, pause/resume/stop, and restart recovery behavior.
6. Promote stable real-provider coverage after acceptance.
