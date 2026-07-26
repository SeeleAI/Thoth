# Architecture Milestones

## Current Architecture State

Current state is promoted source substrate with first-day foundation infrastructure, verified runtime isolation and a verified Loop-2 web test app path. It is still not a complete Thoth MVP product because Task Contract hardening, PlanExec / Review and final dogfood task mapping remain open.

1. Root package manager: `npm workspaces`.
2. Runtime language direction: TypeScript / Node.
3. Package namespace: `@thoth/*`.
4. License: `AGPL-3.0-or-later`.
5. Active package layout:
   - `packages/protocol`
   - `packages/client`
   - `packages/core`
   - `packages/daemon`
   - `packages/drivers`
   - `packages/tui`
   - `packages/app`
   - `packages/desktop`
   - `packages/relay`
   - `packages/cli`
6. Formal package source trees contain promoted upstream-derived implementation substrate.
7. No tracked `_paseo/` directories should remain after `NTH-MS-008`.
8. Foundation packages now have a required green gate: `packages/app/highlight`, `packages/relay`, `packages/protocol` and `packages/client`.
9. Android Debug APK packaging is available as a local infrastructure artifact through root scripts.
10. Thoth direct daemon default is `127.0.0.1:6688`; local Paseo/legacy daemon on `127.0.0.1:6767` is reserved and must not be touched.
11. Real web review currently serves on `http://127.0.0.1:8082/` with public mapping `http://180.76.242.105:8148/`.
12. Test relay deployment is live at `relay.test.thoth.seeles.ai` from independent repository `SeeleAI/Thoth-Relay`.
13. Desktop Linux AppImage and Android Debug APK can be produced as local/dev artifacts.
14. Broader MVP behavior is now decomposed into the six Codex goal-mode loops `NTH-MS-012` through `NTH-MS-017`, centered on agent harness / prompt engineering / eval harness rather than daemon-first implementation.

## Workstreams

1. `NTH-WS-001`: Product authority and decision preservation.
2. `NTH-WS-002`: Monorepo skeleton and metadata.
3. `NTH-WS-003`: Clarify, provider-backed Router, task contract and loop runtime design.
4. `NTH-WS-004`: Harness, ACP, relay and multi-device implementation research.
5. `NTH-WS-005`: Release, packaging and deployment automation.
6. `NTH-WS-006`: Upstream implementation seed import and migration substrate.

## Milestones

### `NTH-MS-001` Repo Reset

State: `done`

Goal: Remove archived plugin runtime from the active working tree and establish the Thoth skeleton.

Acceptance:

1. Archived Python/plugin/runtime paths are gone.
2. `packages/` contains exactly the 10 approved packages.
3. Root metadata reflects `npm workspaces` and the current active license.
4. Recovery docs explain current truth.

### `NTH-MS-002` Authority And Router Slice

State: `in_progress`

Goal: Design and implement the first real Thoth slice: local authority store, explicit task mode, provider-backed Router, workspace registry and loop task draft creation.

Acceptance:

1. `quick` and `loop` task modes exist as real protocol inputs.
2. `hi`-level input in `quick` mode stays under the `10s` user-perceived response target.
3. Provider-backed high-confidence workspace context can resolve without defensive confirmation.
4. Low-confidence workspace writes are blocked by one golden question.

### `NTH-MS-003` Clarify-To-Contract Slice

State: `backlog`

Goal: Implement the private-secretary clarify flow and contract freeze model.

Acceptance:

1. Clarify asks only material golden questions.
2. Agent-discoverable facts are not pushed back to the user.
3. Loop task readiness requires goal, constraints, risk and acceptance.

### `NTH-MS-004` Attempt Loop Slice

State: `backlog`

Goal: Implement Plan -> Execute -> Review attempts with aggressive retry policy.

Acceptance:

1. Review cannot modify files.
2. Failed review produces a non-repeating next attempt focus.
3. Default max failed attempts is 3.
4. Success requires evidence tied to frozen acceptance.

### `NTH-MS-005` Multi-Surface Skeleton Activation

State: `backlog`

Goal: Add first runnable TUI, desktop/mobile client and relay paths after authority loop semantics are stable.

Acceptance:

1. UI shells use the same protocol and authority.
2. TUI uses OpenTUI.
3. Mobile remains read-only when offline.
4. Relay remains zero-knowledge E2EE transport only.

### `NTH-MS-006` Release And Packaging Pipeline

State: `verified`

Goal: Maintain the decision-locked `v0.0.0-mvp-beta` GitHub Release pipeline without merging or modifying `main`.

Acceptance:

1. Pushes to the dedicated `release/mvp-actions` branch build all artifacts and replace only the fixed MVP prerelease after every required build and smoke passes.
2. Native Electron Builder jobs produce macOS arm64/x64 DMG and ZIP, Windows arm64/x64 NSIS and ZIP, and Linux x64 AppImage, DEB, RPM and tar.gz artifacts.
3. A universal `sh.thoth` Android Release APK is signed by the dedicated ignored MVP key and checked for package identity, version, signature and forbidden permissions.
4. A GitHub-hosted server CLI tgz installs on Linux, macOS and Windows, carries runtime skills and starts/stops its daemon without publishing any `@thoth/*` package to npm.
5. Release publication preserves checksums, updater manifests, source commit identity, the historical archive release and the starting `main` SHA; only the publish job receives `contents: write`.
6. Production web/Relay deploy, EAS cloud build, commercial desktop signing/notarization, app-store submission and iOS distribution remain separate decisions.

Current result:

Verified by `NTH-EV-037`. GitHub Actions run `29551530114` passed every preflight, native build, CLI smoke and live Relay job before publishing the public prerelease, and selected downloaded assets passed independent secondary verification.

### `NTH-MS-007` Upstream Implementation Seed Import

State: `done`

Goal: Import broad upstream implementation seed material into tracked package-local `_paseo/` directories while keeping raw cache ignored, provenance explicit and runtime behavior unwired.

Acceptance:

1. Raw upstream cache is local-only, ignored and tied to a recorded commit SHA.
2. Tracked seed directories exist under the approved package set only.
3. Voice, audio, speech and dictation material is excluded.
4. Root workspaces and scripts are not widened to match upstream.
5. Seed code is documented as expected-broken until future migration tasks digest it.

### `NTH-MS-008` Promote Seed To Formal Source

State: `done`

Goal: Move tracked `_paseo` implementation seed material into formal package source trees, delete `_paseo`, and preserve Thoth package identity without claiming runtime readiness.

Acceptance:

1. No tracked `_paseo` paths remain.
2. Formal `packages/*` source trees contain the promoted implementation substrate.
3. Root workspace boundary remains `packages/*` with exactly 10 formal packages.
4. Formal packages keep `@thoth/*`, `private: true` and `AGPL-3.0-or-later`. This milestone's original `0.0.0` substrate version was superseded by the decision-locked `0.0.0-mvp-beta` release version in `NTH-CD-056`.
5. `packages/app/highlight` remains nested and does not become an 11th workspace package.
6. Expected broken compile state is documented.

### `NTH-MS-009` Development Infrastructure Gate

State: `done`

Goal: Establish the first-day development infrastructure that lets future agents develop from stable commands, package contracts, docs and local packaging evidence.

Acceptance:

1. Root `npm install` is stable under the project install policy.
2. Root validation scripts cover package boundaries, package metadata, AGENTS/CLAUDE links, docs, install policy, generated/raw path hygiene, voice/audio config residue and secret-like content.
3. `npm run check:foundation` passes.
4. Android local toolchain is installed under ignored `.dev/` and `npm run package:android:debug-apk` produces a real Debug APK.
5. iOS scripts behave truthfully on Linux by reporting the macOS/Xcode requirement.
6. Root and all 10 packages have local agent contracts.
7. Development, testing, packaging and release docs exist under `docs/`.

### `NTH-MS-010` Relay Security V3 And Preview Path

State: `done`

Goal: Replace the upstream-style unauthenticated relay with Thoth v3 security, validate relay behavior under load, produce a real web preview build and establish a hosted test relay path.

Acceptance:

1. Relay accepts only v3 sockets with role-scoped capability tokens in `Sec-WebSocket-Protocol`.
2. Relay rejects v1/v2, missing token, token-in-query, malformed IDs and disallowed browser origins.
3. Relay stores only token hashes, expiry and connection metadata and remains zero-knowledge for task/message content.
4. Daemon/app/client/protocol paths understand v3 connection offers, pairing token and device token metadata.
5. Web app can be exported and served locally through the real product UI.
6. Local relay E2E and 200-client / 10-minute load test pass.
7. Hosted test relay deployment is attempted or blocked with exact governance evidence.

Current result:

Items 1-6 are verified by `NTH-EV-005`. The original Code4Agent mirror deploy path was blocked by protected paths and then abandoned after the user moved deployment authority to independent repository `SeeleAI/Thoth-Relay`. Hosted test relay deployment and live load validation are verified by `NTH-EV-006`.

### `NTH-MS-011` Runtime Isolation And Dogfood Entry

State: `done`

Goal: Let Thoth daemon, relay, web app, desktop app, Android app and Codex provider smoke run side by side with the existing local Paseo daemon without stopping, reusing or migrating Paseo.

Acceptance:

1. Thoth direct daemon defaults to `127.0.0.1:6688`.
2. Local Paseo/legacy daemon remains on `127.0.0.1:6767` and is not killed, restarted or reused.
3. Web human review serves the real product UI on `8082` with current public mapping `8148`.
4. Test relay service responds at `relay.test.thoth.seeles.ai` and keeps v3 token enforcement.
5. Linux AppImage package smoke uses an isolated desktop-managed daemon, not Paseo or the user's live Thoth daemon.
6. Android Debug APK uses Thoth package identity and does not request microphone permission.
7. Codex provider smoke runs through the Thoth daemon/provider path.

Current result:

Verified by `NTH-EV-006`.

### `NTH-MS-012` Backend Clarify Agent Harness And Convergence Contract

State: `verified`

Goal: Design and implement the first `thoth.clarify` agent harness so provider-backed secretary sessions ask high-value behavior-tree branch questions, avoid low-value questioning and fallback-scope goal downgrades, distinguish discoverable facts from human judgment, and decide whether an intent should remain bare Quick, active-Clarify direct answer, continue Clarify, produce Overview / Task Card, produce Breakdown / Goal Card or block.

Constraints:

1. Clarify is not `request_user_input`, `AskUserQuestion` or a missing-field questionnaire.
2. Semantic judgment happens inside provider-backed secretary sessions, not local deterministic code.
3. Agent-discoverable facts are not pushed to the user.
4. User questions are reserved for behavior-tree branch decisions that affect target route, risk, resource boundary, preference, acceptance and irreversible choice.
5. Questions should reduce cognitive load through context and narrow branch choices, not through unsolicited default recommendations.
6. Packet/schema/daemon repair are mechanical guardrails, not the product target.
7. Skill quality is judged from golden Clarify transcripts, not from packet validity alone.
8. The main development session must use an independent `codex exec` judge to review whether questions meet behavioral-psychology, behavior-tree convergence and low-cognitive-load criteria.
9. `C_TASK_CARD` content must mechanically carry the prior Clarify Q&A transcript verbatim.
10. `C_GOAL_CARD` content must mechanically carry both the prior Clarify Q&A transcript verbatim and the exact user-approved CEO Task Card from the first confirmation round.
11. Clarify must not downgrade the user's stated target into an easier MVP, demo, mock, partial implementation or alternative target.
12. `thoth.clarify` is a standard, cross-provider `SKILL.md` artifact created through the standard
    skill-create / skill creator workflow. `SKILL.md` is canonical; TypeScript code loads,
    validates, hashes, mounts, invokes or fallback-renders it.
13. Thoth internal runtime skills are mounted only into Thoth-owned provider session scope and must
    not be installed into user global provider skill dirs such as `~/.codex/skills`,
    `~/.claude/skills` or `~/.agents/skills`.
14. Clarify strength is behaviorally significant: `none` means the runtime does not load
    `thoth.clarify` and stays on bare provider stream; `light` asks the core fork, `balanced` asks core
    plus 1-2 material leaves, and `dive` walks material assumptions while still filtering low-value
    questions.
15. Clarify must classify assumption owners as `user_must_decide`, `agent_can_decide`,
    `agent_can_discover` or `standard_answer/common_sense`, and ask only high-impact
    `user_must_decide` assumptions.
16. Normal same-state provider input packets carry runtime data only, including controls,
    `effective_clarify_strength`, transcript refs, assumption ledger refs and decision-tree frontier
    refs when available; they do not repeat Skill rules and do not include `skill_ref`.
17. Session start, state transition, skill digest/version changes, context loss and repeated repair
    failure may carry `skill_ref` / digest markers, but must not copy the full rules. Strength changes
    may carry `controls_changed`.
18. Repair packets repair shape/state/provenance only and must not reinterpret user intent, change
    transcript, change target or change the approved CEO Task Card.
19. `Quick + clarify` uses `turn_phase=clarify|approval_task|approval_breakdown|quick_exec|repair`;
    all structured phases call `submit_clarify_packet` exactly once, while `quick_exec` streams normally.
20. Loop execution does not run in the secretary session; after Clarify plus two approvals, daemon
    registers a background task and starts separate PlanExec / Review sessions under `thoth.loop`.

Acceptance:

1. `thoth.clarify` skill/prompt contract exists with state-code-specific behavior.
2. Convergence rubric defines continue, stop, Quick answer, Task Card and blocked conditions.
3. High-value behavior-tree question rubric exists and rejects form-like questioning, target downgrades and unsolicited defaults.
4. Eval harness can simulate multi-round Clarify with deterministic provider or transcript fixtures.
5. Clarify golden data records expected behavior tree nodes, acceptable outputs, forbidden low-value questions and cognitive-load expectations.
6. Eval cases cover `hi`, vague large task, low-risk small task, unclear acceptance, missing risk/resource boundary, repeated ambiguity, enough information, user asks recommendation or says "you decide", high-risk demand, contradictory demands and fallback-scope downgrade rejection.
7. Independent `codex exec` judge evidence reviews golden transcripts for behavioral psychology, convergence, goal/constraint/acceptance fit and user cognitive burden.
8. Golden eval proves `C_ASK` packets use titled cards with 2-4 tightly related questions, short
   branch choices, choice labels no longer than 10 Chinese characters, choice explanations no longer
   than 20 Chinese characters, per-choice notes and note-only answers.
9. Golden eval proves the same PathTracing prompt behaves differently under `none` / `light` /
   `balanced` / `dive`, where `none` is bare provider stream rather than active Clarify packet, and
   that `C_ASK` internal meta records effective strength, tree depth, QA round count, remaining
   material assumptions and question value reason.
10. Golden eval proves `C_TASK_CARD` includes the full Clarify transcript and `C_GOAL_CARD` includes both the full Clarify transcript and the confirmed CEO Task Card.
11. Golden eval proves standard Skill artifact, no global install, session-scoped visibility, bare
    provider invisibility, compact normal turns, transition `skill_ref` markers and repair boundary.
12. Independent `codex exec` judge reviews `SKILL.md`, invocation packet, transition packet, repair
    packet and golden outputs.
13. Independent `codex exec` user simulation proves a Thoth-launched provider session can use the
    internal `thoth.clarify` Skill under realistic multi-turn interactions, while bare provider skill
    homes remain unpolluted.
14. Golden eval proves `submit_clarify_packet` is the Clarify-specific bridge, structured phases use
    exactly one tool submission, `quick_exec` does not require a packet, and `submit_runtime_packet` is
    not the Clarify contract.
15. Golden eval proves Quick after two approvals enters same-session `quick_exec`, while Loop after two
    approvals enters `C_REGISTER` and separate PlanExec / Review sessions.
16. Final eval evidence shows questions behave like a secretary, reduce user burden and converge,
    Quick+none remains bare, final confirmation cards preserve provenance, and runtime skill mounting
    stays session-scoped.

Current result:

Verified by `NTH-EV-025`, which supersedes `NTH-EV-024` for the pre-`NTH-CD-042` Loop-1 acceptance by
adding the clarify strength strategy, assumption-owner ledger, decision-tree frontier refs,
multi-question `C_ASK` card shape and internal meta checks. `NTH-CD-042` and `NTH-CD-043` add the later
phase/tool refinement for Quick+none, semantic runtime tools, Quick `quick_exec` and Loop
`registered_pending`; `NTH-MS-013` is now verified by `NTH-EV-029` for the Codex/AgentTimeline
Loop-2 integration.

### `NTH-MS-013` Runtime Tool Bridge + AgentTimeline Workspace Secretary Clarify Experience

State: `verified`

Goal: Restore the original production-grade Paseo app surface and layout as the primary Thoth frontend substrate, keep the mature session/workspace/task/detail UI capabilities intact, remove or isolate the current self-written Thoth toy shell from the main entry, and connect Thoth Clarify through Codex app-server `dynamicTools`, persisted pending authority decisions and AgentTimeline authority cards.

Constraints:

1. Paseo is a necessary frontend substrate, not a temporary reference.
2. The main APP path must preserve the original Paseo stream, timeline, composer, cards, settings, host/provider, relay pairing, diagnostics, attachments, file drop, assistant file links, markdown/code/diff/highlighted content, terminal/browser/file panes, desktop/mobile responsive layout, keyboard/focus/accessibility behavior and e2e/test harness.
3. Do not create or keep a parallel Thoth app shell as the primary user entry. `packages/app/src/thoth-app/thoth-app-shell.tsx` and related toy shell routes/tests must be deleted, reverted or isolated as legacy/deprecated non-main-path code if short-term type dependencies remain.
4. Do not keep the current toy-shell production copy such as `WORKSPACE SECRETARY`, `Current Requirement Convergence`, `Quick Foreground · Loop Background`, `Real Provider Connected`, `Current Secretary Topic`, `New Secretary Topic`, full `/mnt/cfs/...` path hero text, provider-backed clean UI model wording, packet/repair/schema/raw JSON/provider-role state and similar internal contract language in the primary UI.
5. Do not fake a complete Background Tasks product in Loop-2. A minimal registered-task browser may show durable `registered_pending` tasks, but it must not show fake running, review or evidence.
6. Composer control semantics are remapped on top of the original Paseo composer: `Models` -> `Provider`, `Think` -> `Clarify`, `Feature` -> `Mode` with `Quick` and `Loop`; attachments, slash commands, drafts, keyboard handling, focus and mobile behavior must remain intact.
7. UI consumes AgentTimeline items and typed authority card models; it must not parse assistant text, markdown JSON, code fences, snippets or raw packets, infer convergence, generate Task/Pyramid Plan Cards, mutate authority or choose a default for the user.
8. `Quick + none` bare provider replies, thinking/progress and tool/progress/evidence events stream progressively through AgentTimeline; they are not Clarify authority cards.
9. Clarify cards, Task Cards and Pyramid Plan Cards render only after validated semantic runtime tool submission plus daemon schema/provenance/authority validation; no partial question, option or approval action may stream into the UI.
10. Clarify cards must live inside the restored Paseo transcript / agent-stream path and support title, why-now, 2-4 tightly related questions, 2-4 short options, short explanations, per-option notes, note-only, "you recommend" and "you decide" without default preselection.
11. Quick/no-clarify stays natural bare provider chat; `hi` must come from the configured real provider session and must not open a Clarify card, submit packet or enter repair.
12. Voice/audio/dictation visible capability, Paseo `6767` fallback, fake relay URLs, mock connected states and `.agent-os/upstreams/paseo` staging remain forbidden.
13. Fixture/mock adapters, if needed, must be explicitly named as development-only and cannot become production authority or substitute for real provider and `relay.test.thoth.seeles.ai` acceptance.
14. Honest unavailable/blocked/needs-provider/unsupported-bridge/needs-relay states are allowed, but they must block the action instead of pretending success.
15. Quick+clarify must support Clarify -> Task Card -> Pyramid Plan Card -> same-session `quick_exec`; Loop must support Clarify -> two cards -> durable `registered_pending` without fake PlanExec / Review.

Acceptance:

1. Anti-toy-shell / anti-internal-copy residual scan passes for active user-visible UI, route labels, i18n, test IDs, accessibility labels, screenshots and e2e copy.
2. Paseo capability retention scan/source review proves the primary path still uses agent-stream, bottom anchor, turn boundary, virtualization/native-web render strategy, original composer, attachments/file drop/file links, markdown/code/diff/highlighted content, adaptive sheets/cards, settings, host/provider, relay pairing, diagnostics, workspace/session list/detail layout, terminal/browser/file panes, responsive layout and e2e/test harness.
3. Composer controls render as Provider / Clarify / Mode and map to provider session, clarify strength and Quick/Loop mode without degrading attachments, slash commands, draft, keyboard, focus or mobile behavior.
4. Clarify card renders inside the restored Paseo transcript / agent-stream path as a Thoth decision card, not a separate page, toy-shell card, `request_user_input` mental model or permission prompt.
5. Source review proves AgentTimeline/card authority boundaries: no natural-language parsing, no raw packet display, no markdown JSON/code-fence/snippet parsing, no local Task/Pyramid Plan Card generation and no front-end semantic fallback.
6. Stream/render source review proves Quick+none provider replies/progress render progressively without packetization, while Clarify / Task / Pyramid Plan cards are atomic after semantic runtime tool submission and daemon validation.
7. E2E covers real provider-backed Quick+none streaming `hi`, no card/no packet/no repair, Quick+clarify -> Task Card -> Pyramid Plan Card -> same-session `quick_exec`, Loop -> Clarify -> two approvals -> `registered_pending`, submitted readonly cards and Settings real relay status.
8. Unit/component/e2e tests, `npm --workspace=@thoth/app run test`, Loop-2 narrow real-provider e2e, `npm run build:web`, real `relay.test.thoth.seeles.ai` validation and `npm run check:foundation` pass with recorded evidence.
9. Desktop/mobile screenshots and Playwright trace/video prove original Paseo layout retention, Provider / Clarify / Mode composer controls, Quick+none bare stream, Clarify atomic cards, Task/Pyramid Plan approval, submitted readonly card, same-session quick_exec Shell/Edit timeline, `registered_pending` and Settings real relay status.
10. Screenshots are actually opened with `view_image` and reviewed.
11. Independent `codex exec` UI mental-model review passes against screenshots, trace, key code summaries and the checklist; any toy shell, broken Paseo capability, degraded composer, Quick+none being protocolized, unstable Clarify card, non-atomic authority card, raw packet/markdown parsing, fake provider/relay/mock success, user-visible debug copy or fake Background Tasks running/review view is a FAIL.

Current result:

Verified by `NTH-EV-029`. The current evidence proves restored Paseo main path, capability retention,
Codex `dynamicTools` semantic runtime tools, persisted pending decisions, AgentTimeline Clarify / Task /
Pyramid / registered cards, Quick+none bare provider stream, Quick+Dive same-session `quick_exec`,
Loop `registered_pending`, Background Tasks recovery, mobile deep-link recovery, required tests and an
independent `codex exec` UI/runtime mental-model review PASS.

Not covered by this milestone:

1. Full Task Card / Pyramid Plan edit-loop polish beyond the accepted/annotated authority-card boundary.
2. `thoth.loop` PlanExec / Review execution runtime.
3. Non-Codex provider runtime-tool adapters.

### `NTH-MS-014` Backend Task Contract Compiler And Approval Harness

State: `ready`

Goal: Implement the agent harness that compiles converged Clarify output into a CEO-readable Task Card and a Pyramid Plan Card without turning either into an implementation plan.

Constraints:

1. Task Card is approval material, not an implementation plan.
2. Pyramid Plan Card is a target / stages / subgoals / acceptance evidence hierarchy, not execution steps.
3. Task Card contains only `title`, `goal`, `constraints` and `acceptance`.
4. Agent must recommend Quick rather than Loop when a small task should stay foreground.
5. Agent may clarify missing acceptance instead of forcing a contract.
6. Contract quality comes from agent harness; daemon confirmation gates are only mechanical guarantees.

Unblocked by:

1. `NTH-EV-029` verified `NTH-MS-013` / `NTH-TD-016`, including restored Paseo surface, Codex runtime-tool bridge, AgentTimeline cards, stable Clarify transcript/card substrate and Quick / Loop phase boundaries.

Acceptance:

1. Task Contract Compiler prompt/rubric exists.
2. Task Card rubric covers title, goal, constraints and acceptance only; no risk, why_loop or implementation plan fields.
3. Pyramid Plan Card rubric proves target / stages / subgoals / acceptance evidence are hierarchical, traceable and not implementation plans.
4. Eval covers Quick recommendation, Task Card generation, return to Clarify, large-task Pyramid Plan split, no implementation plan leakage, user modifications and runtime tool/card schema compatibility.

### `NTH-MS-015` Frontend Task And Pyramid Plan Approval Experience

State: `backlog`

Goal: Render Task Card and Pyramid Plan Card as clear, lightweight secretary-prepared approval artifacts that users can approve, modify, cancel or keep in Quick without understanding schemas.

Constraints:

1. Task Card stays compact and does not become a PRD or plan.
2. Pyramid Plan Card shows target / stages / subgoals / acceptance evidence, not execution steps.
3. Both confirmations are clear user actions.
4. User edits go back through agent harness, not local UI authority mutation.
5. After approval the user returns to Workspace Secretary and Quick remains available.

Acceptance:

1. Workspace Secretary shows Task Card.
2. Task Card supports register as background task, keep Quick, modify and cancel.
3. User modification regenerates a better Task Card through agent harness.
4. First confirmation shows Pyramid Plan Card.
5. Pyramid Plan Card shows hierarchical stages and subgoals with acceptance evidence.
6. Pyramid Plan Card supports confirm registration, modify and cancel.
7. Confirming Pyramid Plan Card shows Registered Card and Background Task link.
8. Composer returns to Quick and user can continue chatting.
9. E2E covers Task Card modify/cancel/confirm, Pyramid Plan Card modify/cancel/confirm and return to Quick.

### `NTH-MS-016` Backend Loop Execution And Review Agent Harness

State: `backlog`

Goal: Implement `thoth.loop` agent harness so PlanExec and Review provider sessions execute from frozen contracts, request permissions, produce evidence, self-advance, receive independent review and generate non-repeating retry guidance.

Constraints:

1. PlanExec advances only the current goal.
2. High-risk actions require permission.
3. Frozen Clarify decisions are not repeatedly pushed back to the user.
4. Missing execution details use frozen contract or recommended defaults and are recorded.
5. Review is independent and cannot modify workspace.
6. Review judges the approved human task against reality, not merely whether tests ran, fields were filled or PlanExec says the acceptance is met.
7. Review must independently challenge the current route and may require abandoning a locally plausible but conceptually wrong incremental approach.
8. Retry must follow a new Review Direction Memo and avoid repeating the failed approach.
9. Daemon handles orchestration, repair, permission gate, evidence landing, recovery and all phase/budget/receipt mechanics; those mechanics do not enter Agent Harness cognitive context.
10. Skill quality is judged from golden Loop transcripts, not from command execution, packet validity or schema completeness alone.
11. The main development session must use an independent `codex exec` judge to review PlanExec, Review and retry behavior against frozen contracts, independent diagnosis and next-direction quality.

Acceptance:

1. `thoth.loop` skill/prompt contract exists.
2. PlanExec, Review and retry/non-repetition rubrics exist.
3. Loop golden data records frozen contracts, observable work, expected reasoning behavior, forbidden strategies and evidence requirements for success, permission, Review, retry, blocked and done cases; it does not make daemon state fields the expected Review output.
4. Harness covers single-goal success, multi-goal current-goal isolation, permission request, defaulting from frozen contract, Review pass, Review fail with root-direction correction, retry strategy change, Review cannot modify workspace, task blocked and task done evidence summary.
5. Independent `codex exec` judge evidence reviews golden transcripts for frozen-contract compliance, independent Review judgment, root-cause insight, non-incremental correction, non-repeating retry and user cognitive burden.
6. Final evidence shows background agent does more than run commands: it advances under contract, verifies, lets independent Review redirect a wrong path and leaves reviewable evidence without exposing daemon mechanics to the sessions.

### `NTH-MS-017` Frontend Loop/Task Dogfood Mapping

State: `backlog`

Goal: Integrate Clarify, Contract, Loop and Review harness outputs into a user-visible MVP dogfood loop across the restored Paseo session/workspace/task/detail view system.

Constraints:

1. Do not introduce a separate Background Tasks toy main view as the primary loop surface.
2. Default display is CEO-readable: task goal, constraints, acceptance, current goal, latest Review direction and whether user action is needed; phase/round/budget mechanics remain diagnostics, not the main task narrative.
3. Provider stream may be expandable detail but cannot become the main surface.
4. Review verdict is translated into user-understandable status.
5. Permission requests emphasize risk and decision, not technical logs.
6. Done shows evidence summary; blocked explains the user's next decision.
7. Web/Desktop are the same APP experience with different packaging.
8. TUI is not part of this APP MVP loop.
9. No relay token, raw offer, credential or `6767` fallback leakage.

Acceptance:

1. Dogfood smoke covers Settings provider/daemon/runtime skill state.
2. Dogfood smoke covers Clarify inside the restored session/workspace transcript.
3. Dogfood smoke covers Task Card approval.
4. Dogfood smoke covers Pyramid Plan Card approval.
5. Dogfood smoke covers a registered task and running current goal inside the restored session/workspace/task/detail view system.
6. Dogfood smoke covers expandable stream, permission handling, Review direction/status, an intelligible retry change, passed goal and done or blocked state.
7. Web static export and Desktop dev/review entry each produce real smoke or screenshot evidence.
8. UI does not expose packet, skill or provider role concepts.
9. Relevant UI tests, daemon/client tests and `npm run check:foundation` pass.
10. `.agent-os/acceptance-report.md`, `.agent-os/project-index.md` and `.agent-os/run-log.md` record the MVP closure evidence.

### `NTH-MS-018` Final Production Main-Chain Architecture And 50k Refactor

State: `doing`

Goal: Replace the repeated Paseo-derived production layers with one final Thoth main chain, preserve all current
public semantics and user experience, and remove at least `50,000` real production lines before the deferred
performance milestone.

Architecture:

1. Pure deterministic Core transitions own Task, Turn, Card, HumanDecision, ExecutionAttempt and Evidence rules.
2. Daemon application use cases transact through one Workspace Repository/Unit of Work and publish normalized
   projection deltas; SQLite shards are adapters, not business authority.
3. Drivers expose direct capability-segregated HarnessAdapters with lazy manifests; one ExecutionService and
   ToolGateway fence all foreground/background provider work.
4. Protocol owns one Zod RPC Registry plus binary codecs; Client and Daemon dispatch derive from that registry.
5. App consumes normalized authority projection, QueryClient server state and versioned local UI preferences;
   React Context injects dependencies only.
6. Timeline views and VCS actions each use one declarative registry and one shared responsive component/service
   path.
7. One lazy composition root and ServiceSupervisor own process, provider, shard, terminal, MCP, GitHub and Relay
   lifecycle.

Atomic sequence:

1. `NTH-TD-031` `[verified]`: freeze source, behavior, visual, storage and performance baselines plus the shared 300-second gate.
2. `NTH-TD-032` `[verified]`: pure Core, Repository/UoW and lossless SQLite authority cutover.
3. `NTH-TD-033` `[verified]`: direct capability HarnessAdapter, ExecutionService and ToolGateway cutover.
4. `NTH-TD-034` `[verified]`: single Protocol RPC Registry and derived Client/Daemon dispatch.
5. `NTH-TD-035` `[verified]`: App authority projection, query state and UI preference separation.
6. `NTH-TD-036` `[doing]`: shared Timeline/View Registry and responsive composition with an independent `20,000` production-LOC reduction, without a performance/lazy-loading cut. The published Stage 4 intermediate proves `-4,557`; the remaining `15,443` must be removed before Stage 5 can close.
7. `NTH-TD-037`: VcsRepository, VcsApplicationService and VcsActionRegistry convergence.
8. `NTH-TD-040`: capability-composed Provider adapter mechanical convergence.
9. `NTH-TD-041`: CLI, Desktop controller and Terminal control/data-plane convergence.
10. `NTH-TD-042`: fixed-order residual controller/query/transport convergence.
11. `NTH-TD-039`: final LOC, migration, behavior, visual and Relay closure.

Intermediate promotion transaction: `NTH-TD-043` is verified by `NTH-EV-065`. Source `198562296` passed the
complete local contract, exact-SHA native workflow and downloaded public AppImage journey, then replaced the fixed
Beta. This does not advance the atomic sequence, verify `NTH-TD-036`, switch Stage 4 or reduce the `50,000`-LOC
completion requirement.

Acceptance:

1. Every cut is one local atomic commit containing final module, full consumer switch, old-path deletion, tests and
   bookkeeping; no commit contains old/new runtime dual paths.
2. Every cut passes `npm run accept:refactor:fast` inside one shared `300s` deadline and reduces production LOC,
   scanner tokens, AST nodes and non-type static import edges without increasing runtime dependencies.
3. Public Client/Protocol/Provider/AgentTimeline/VCS semantics, Release `05775486` data, screenshots, keyboard,
   focus, a11y, responsive behavior and TUI frame remain equivalent.
4. Final production LOC is at least `50,000` below the clean baseline and the complete Feature Lock passes without
   touching Paseo `127.0.0.1:6767`; performance is deferred by `NTH-CD-067` without weakening its later targets.
5. No push, merge, native package, real Provider, tag, Release or publication occurs without a new explicit user
   authorization.

### `NTH-MS-019` Deferred Performance Optimization

State: `backlog`

Goal: After `NTH-MS-018` reaches the final smaller single-path architecture, optimize and verify the locked daemon
cold-ready, idle RSS, App interaction and local response-overhead targets without changing product behavior.

Scope: Existing performance scripts and baselines, `NTH-TD-038` lazy composition root/ServiceSupervisor work and
`NTH-EV-059` lifecycle/performance evidence move here unchanged. This milestone is not active during the 50k source
reduction and must not be used to reintroduce old paths or pre-empt functional convergence.
