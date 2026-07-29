# TODO

## Backlog

1. `NTH-TD-003` `[backlog]`: Write the first SQLite authority schema and migration policy.
   - Related: `NTH-MS-002`, `NTH-REQ-002`, `NTH-REQ-004`
2. `NTH-TD-004` `[backlog]`: Design the first Claude Code, Codex and ACP driver capability contract.
   - Related: `NTH-MS-004`, `NTH-REQ-005`
3. `NTH-TD-006` `[backlog]`: Design E2EE relay deployment path for Cloudflare prototype and seeles.ai hosted/self-hosted service.
   - Related: `NTH-MS-005`, `NTH-REQ-006`
4. `NTH-TD-037` `[backlog]`: Converge Git, Worktree and GitHub through VcsRepository, VcsApplicationService and one VcsActionRegistry; delete duplicate RPC/actions/results/polling while preserving every current capability.
   - Related: `NTH-MS-018`, `NTH-CD-066`, `NTH-CD-067`, `NTH-REQ-026`, `NTH-AC-021`, `NTH-EV-058`
5. `NTH-TD-038` `[backlog]`: Install one lazy composition root and ServiceSupervisor, open Workspace shards and Provider/GitHub/MCP/Terminal/Relay resources on demand, and delete eager heavy imports, duplicate controllers and idle polling.
   - Related: `NTH-MS-019`, `NTH-CD-067`, `NTH-REQ-025`, `NTH-AC-020`, `NTH-EV-059`
6. `NTH-TD-039` `[backlog]`: Close the final feature-zero-loss 50k production reduction, public capability, Release migration, visual/interaction, source Relay and 300-second functional gate; remove every architecture-guarded dual path.
   - Related: `NTH-MS-018`, `NTH-CD-066`, `NTH-CD-067`, `NTH-REQ-026`, `NTH-AC-021`, `NTH-EV-060`
7. `NTH-TD-040` `[backlog]`: Converge duplicated Provider permission/question, tool lifecycle, usage, interrupt and unknown-event mechanics through capability-composed objects while preserving every adapter capability.
   - Related: `NTH-MS-018`, `NTH-CD-067`, `NTH-REQ-026`, `NTH-AC-021`, `NTH-EV-061`
8. `NTH-TD-041` `[backlog]`: Converge CLI command registration, Desktop daemon controllers and Terminal JSON/binary subscription lifecycle without changing any public shell capability.
   - Related: `NTH-MS-018`, `NTH-CD-067`, `NTH-REQ-026`, `NTH-AC-021`, `NTH-EV-062`
9. `NTH-TD-042` `[backlog]`: Apply the fixed residual order for App controllers, file/attachment queries, Direct/Relay framing and Desktop feature glue until the final 50k target is met without deleting public behavior.

- Related: `NTH-MS-018`, `NTH-CD-067`, `NTH-REQ-026`, `NTH-AC-021`, `NTH-EV-063`

## Ready

1. `NTH-TD-021` `[doing]`: Harden Loop background into Loop Engineering authority.
   - Goal: Promote the verified Codex Loop path into a replayable SQLite authority/event ledger with Task Memory, sealed evidence, independent audits and budget envelopes, then close the remaining restart/control/browser recovery evidence.
   - Constraints: Do not reintroduce fake running/review/evidence; captures stay outside the git repo under `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/`; local Paseo/legacy `127.0.0.1:6767` remains untouched.
   - Progress: SQLite event/projection/CAS/lease persistence, Task Memory, baseline and phase evidence manifests, budget wait, phase isolation and scoped Codex dynamicTools are implemented. The scripted native-Codex flow suite passed all five journeys on `2026-07-11`: Quick direct, Quick Clarify foreground, cancel/recover/resume, Loop+Single all-goals pass and Loop+Light fail/retry/pass. The fixture gives literal tool payloads to each independent phase session so it does not evaluate provider creativity. On `2026-07-14`, idempotent registration, native-provider turn fencing, scheduler re-entry after PlanExec, no-terminal-timeout waiting, foreground background-handoff and full deterministic UT-01..UT-05 regression coverage were repaired. Review runs independent assessment before receiving PlanExec's semantic account; live phase tools now carry semantic task truth only, while attempt/generation/call ids and resource accounting remain daemon-only. Review workspace mutation/evidence manifests are audit and UI material under the locked Provider Trust policy, not automatic lifecycle blockers. On `2026-07-16`, `NTH-EV-035` repaired false foreground spinner after background handoff, isolated writable provider-session config, reclassified provider startup failures as resumable interruptions and live-resumed an affected task through G1 Review pass into G2 without consuming failed-Review budget. `NTH-EV-036` then added per-WebSocket scoped observation for viewed internal Loop phases and verified in a real Chromium/Codex Review that `Apply file changes` approval resolved in `242ms`, `apply_patch` completed and later reasoning streamed without refresh, while the internal agent remained absent from the foreground agent list and Review workspace receipts stayed unchanged. On `2026-07-19`, `NTH-EV-040` removed process-local Card waiters, parked each Card provider turn, fenced its late output and made answer continuation wait for actual run cleanup; the public foreground journey now advances Clarify -> Task -> Goals -> Quick without a manual `continue` prompt.
   - Acceptance: Remaining verification must still add real browser/device evidence for `budget_wait`, pause/resume/stop and daemon restart/reconnect, including Background Task detail and phase AgentTimeline restoration. Deterministic unit coverage exists for those state transitions; they are not yet claimed as full browser/provider acceptance.
   - Depends on: `NTH-TD-019`
   - Related: `NTH-CD-045`, `NTH-CD-047`, `NTH-CD-055`, `NTH-EV-030`, `NTH-EV-031`, `NTH-EV-035`, `NTH-EV-036`
2. `NTH-TD-022` `[doing]`: Refactor Loop Agent Harness context and Review semantics around `NTH-CD-050`.
   - Goal: Remove daemon recovery/accounting fields from Clarify, PlanExec, Review and audit cognitive context/tool obligations; replace mechanical Review verdict/checklist framing with an independent Review Direction Memo and minimal semantic lifecycle conclusion.
   - Constraints: Preserve daemon-owned durability, evidence, permission, budget and recovery behavior; do not turn daemon into an LLM or weaken user contract/provenance authority; do not fake semantic routing with local heuristics.
   - Progress: `thoth.loop`, live PlanExec/Review/blocked tool schemas, Codex dynamic-tool schemas, task-service hidden binding, deterministic five-journey contracts and Loop golden eval now remove phase/round/id/budget/checklist obligations from Agent Harness input. Review is two-stage and stale independent assessment callbacks are fenced by provider-native turn identity. Remaining: extend the independent quality judge with a non-local corrective Review holdout and gather browser/device control/recovery evidence under the new Provider Trust semantics.
   - Acceptance: update `thoth.loop` Skill, runtime tool contracts, context-pack builders, golden data and independent judges; prove Review can reject a locally plausible PlanExec path, identify a non-incremental root correction and give actionable next direction without seeing phase/round/budget/manifest/receipt mechanics.
   - Depends on: `NTH-CD-050`, `NTH-TD-021`
3. `NTH-TD-002` `[ready]`: Umbrella MVP implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle without reintroducing archived plugin runtime compatibility.
   - Scope: include a stable Thoth I human dogfood entry whose development build uses the same UI/UX as the releasable product UI; agents validate code through standard repository tests and gates.
   - Operational decomposition: execute `NTH-TD-015` through `NTH-TD-020` in order instead of treating this as one large loop.
   - Related: `NTH-MS-002`, `NTH-MS-003`, `NTH-REQ-001`, `NTH-REQ-002`, `NTH-REQ-017`
4. `NTH-TD-010` `[ready]`: Run remaining dependency and compile triage on the non-foundation promoted source substrate.
   - Scope: resolve package-lock/dependency inconsistencies, remove or quarantine remaining broad-source voice references, decide first buildable package order, and record exact compile blockers without claiming runtime readiness.
   - Related: `NTH-MS-008`, `NTH-REQ-011`, `NTH-REQ-015`

## Doing

1. `NTH-TD-036` `[doing]`: Atomically converge AgentTimeline/tool rendering, Workspace/Sidebar responsive composition, Composer/Overlay, Settings/Panel/Card primitives and proven private UI glue into one final presentation path.
   - Acceptance: no public semantic or UX change; no VCS/Provider/RPC/authority/performance work; App suite remains at least `331 files / 2,582 tests`; after the approved `NTH-CD-087`, `NTH-CD-097` and `NTH-CD-098` capability translation, Stage 5 source is at most `301,445` production LOC with tokens/AST/imports below Stage 4 and dependencies no higher; the shared `300s` gate passes.
   - Current result: after the approved Provider interaction correction, production is `316,951` LOC, `1,353,705` tokens, `1,391,743` AST nodes, `5,221` imports and `165` runtime dependency edges. `DeltaP50=1,189` translates the prior `300,256` Cut B ceiling to `301,445` and the final ceiling to `279,045` without counting new capability as refactor regression or progress. The remaining independent gap is exactly `15,506` LOC; Stage stays 4 and `NTH-TD-036` remains open.
   - Related: `NTH-MS-018`, `NTH-CD-066`, `NTH-CD-067`, `NTH-REQ-026`, `NTH-AC-021`, `NTH-EV-057`
2. `NTH-TD-016` `[doing]`: Repair reopened Loop-2 Quick+Clarify regression.
   - Goal: Keep restored Paseo surface and Codex dynamicTools path, but make Clarify behave like a pending authority decision lifecycle with intelligent timeline badges and model-submitted frontier ledger.
   - Scope: `thoth_submit_clarify_card` carries `public_badge_summary` and `frontier_ledger`; `thoth_submit_task_card` carries convergence review; `balanced` has a 5-10 card soft range and `dive` has a 10-20 card soft range; cards must not show completed/idle footer before user submission; `decision_it_changes` is legacy optional input only. Under `NTH-CD-052`, raw Provider conversation is an explicit Thoth-off state rather than an ambiguous `Quick + Direct` sub-selection; only Thoth-on exposes structured Clarify and Loop controls. Under `NTH-CD-053`, that off/on choice is strictly per turn: one Workspace Secretary topic reuses one foreground provider session, and a daemon authority fence blocks remembered runtime tools during raw turns instead of using historical `bare` / `structured` sessions.
   - Verification: Reopened under `NTH-EV-029`; unit/build/foundation gates and most real Codex web paths now pass after the frontier-ledger repair, including local/public Balanced sort, local Dive sort, local Balanced PathTracing and local Loop `registered_pending`. Under `NTH-CD-057` / `NTH-EV-038`, ordinary Agent sends now reuse the visible provider session for Thoth Clarify/Quick, remote workspace identity overrides client cwd, and packaged Clarify/Loop skills were confirmed in the public Linux `app.asar`. Do not return this TODO to verified until installed/Relay real-provider behavior is exercised from the replacement build.
   - Related: `NTH-MS-013`, `NTH-CD-041`, `NTH-CD-042`, `NTH-CD-043`

## Blocked

None.

## Done

1. `NTH-TD-001` `[done]`: Reset the active working tree from archived plugin runtime to Thoth monorepo skeleton.
   - Related: `NTH-MS-001`
   - Verification: See `NTH-EV-001` after reset checks.
2. `NTH-TD-008` `[done]`: Adopt AGPL policy and import upstream implementation seed material into ignored raw cache plus tracked `_paseo/` seed directories.
   - Related: `NTH-MS-007`, `NTH-REQ-015`, `NTH-CD-017`
   - Verification: See `NTH-EV-002`.
3. `NTH-TD-009` `[done]`: Promote tracked `_paseo` implementation seeds into formal package source trees and delete `_paseo`.
   - Related: `NTH-MS-008`, `NTH-CD-018`
   - Verification: See `NTH-EV-003`.
4. `NTH-TD-005` `[done]`: Run an OpenTUI spike to decide Node FFI vs Bun runtime for `packages/tui`.
   - Result: Current reproducible renderer smoke path uses pinned `node-linux-x64@26.4.0` with `--experimental-ffi` through the root `smoke:tui:renderer` script. The locked repository developer toolchain remains Node `24.14.0`; Bun was not selected because the npm `bun` package requires postinstall under the current install policy and `@oven/bun-linux-x64` did not expose a `bun` executable through `npm exec`.
   - Related: `NTH-MS-005`, `NTH-REQ-007`
   - Verification: See `NTH-EV-011`.

## Verified

1. `NTH-TD-011` `[verified]`: Add first-day development infrastructure for long-running agent development.
   - Scope: root validation scripts, foundation build/typecheck/test gate, `oxfmt`/`oxlint`, stable npm install policy, package AGENTS contracts, docs, local Android Debug APK packaging, iOS Linux-safe scripts and `.agent-os` bookkeeping.
   - Related: `NTH-MS-009`, `NTH-CD-019`, `NTH-REQ-016`
   - Verification: See `NTH-EV-004`.
2. `NTH-TD-012` `[verified]`: Harden relay v3 security locally and provide a real web preview build.
   - Scope: v3-only relay protocol, subprotocol token transport, room registration hashes, pairing/device token path, strict origin and parameter validation, seeles relay/app defaults, local Code4Agent mirror export script, web export and local static serve.
   - Related: `NTH-MS-010`, `NTH-CD-021`
   - Verification: See `NTH-EV-005`.
3. `NTH-TD-014` `[verified]`: Isolate Thoth runtime from the local Paseo daemon and prove daemon, relay, web app, desktop app, Android app and Codex provider smoke can run side by side.
   - Scope: Thoth direct daemon defaults to `127.0.0.1:6688`; local Paseo/legacy `127.0.0.1:6767` remains untouched; real web review serves at `8082 -> 8148`; independent `SeeleAI/Thoth-Relay` deploys `relay.test.thoth.seeles.ai`; Linux AppImage and Android Debug APK are produced; Codex provider smoke runs through Thoth paths.
   - Related: `NTH-MS-010`, `NTH-MS-011`, `NTH-CD-022`
   - Verification: See `NTH-EV-006`.
4. `NTH-TD-015` `[verified]`: Loop Goal 1, backend Clarify Agent Harness and Convergence Contract.
   - Scope: Implemented standard `thoth.clarify` `SKILL.md` artifact as canonical source, reserved
     `thoth.loop` `SKILL.md`, session-scoped runtime skill mount/no-global-install contract,
     compact normal/transition/repair input packets with controls/effective clarify strength,
     mechanical transition table, `C_ASK` multi-question card plus internal meta schemas,
     answer/provenance schemas, 21-case golden dataset including `none` / `light` / `balanced` /
     `dive` behavior differences, deterministic eval harness, independent `codex exec` golden judge
     and independent `codex exec` user simulation judge.
   - Related: `NTH-MS-012`, `NTH-CD-027`, `NTH-CD-028`, `NTH-CD-030`, `NTH-CD-031`,
     `NTH-CD-032`, `NTH-CD-033`, `NTH-CD-034`, `NTH-CD-035`
   - Verification: See `NTH-EV-025`.
5. `NTH-TD-019` `[verified]`: Loop Background complete path, first real-provider acceptance.
   - Scope: Clarify -> Task Card -> Goals Card -> durable background Loop task -> Background Tasks list/detail -> linear goal PlanExec/Review sessions -> failed-Review budget handling -> embedded phase AgentTimeline.
   - Related: `NTH-MS-016`, `NTH-MS-017`, `NTH-CD-045`
   - Verification: See `NTH-EV-030`. Local `8082` and public `8148` real Codex Loop+Single paths passed the main chain; Loop+Light, restart recovery and full all-goals-to-`done` hardening continue under `NTH-TD-021`.
6. `NTH-TD-007` `[verified]`: Ship the fixed `v0.0.0-mvp-beta` cross-platform GitHub Release pipeline.
   - Scope: guarded-push `agent/dev/mvp`; build macOS, Windows, Linux, Android and server CLI artifacts from `release/mvp-actions`; preserve one replace-in-place MVP prerelease; keep packages private and avoid npm publication; use the real test Relay and Royalvice repo-local GitHub credentials; leave `main` unchanged.
   - Related: `NTH-MS-006`, `NTH-REQ-010`, `NTH-CD-011`, `NTH-CD-056`
   - Verification: See `NTH-EV-037`. GitHub Actions run `29551530114` passed every native and smoke job, published the public prerelease, and the downloaded AppImage, APK and CLI tgz passed independent checksum and runtime/package verification.
7. `NTH-TD-023` `[verified]`: Replace provider-session storage and split Loop authority with Workspace-sharded Task/Execution authority and the universal HarnessAdapter runtime.
   - Scope: `NTH-CD-060` is the only product path: deduplicated RuntimeBundles, provider-neutral adapters, one Workspace authority shard, unified Quick/Loop Tasks, Human Decision Ledger, Task Blackboard, same-Workspace `@Task`, fenced Card/Stop execution and one-shot installed-home migration.
   - Constraints preserved: no provider-home copying, provider-name business branch, old runtime fallback, dual read/write, hidden internal-Agent phase authority or acceptance-only product route; `main`, npm publication and Relay deployment remained untouched.
   - Related: `NTH-CD-060`, `NTH-REQ-020`, `NTH-TD-021`, `NTH-TD-022`
   - Verification: See `NTH-EV-043`. Adapter conformance, real Codex, public AppImage, public CLI over hosted Relay, native Actions, fixed-key APK and the replacement MVP Release all passed at `a705bbe8`.
8. `NTH-TD-025` `[verified]`: Delete the retired Voice / Speech / Dictation / Audio product path.
   - Scope: Remove disabled wire messages, client APIs, daemon SpeechService/VoiceSession lifecycle, speech configuration/providers, speak-tool specialization, App dictation/realtime voice UI and state, microphone settings, voice shortcuts/i18n, dead PCM tooling, CLI onboarding/config/test environment scaffolding and their obsolete tests.
   - Preserved boundaries: text composer/send/queue/cancel, provider streaming and generic tool calls, task authority, Relay/WebSocket/terminal/notification behavior, generic ACP audio-content placeholder, browser media selection CSS, legacy config sanitation and Android `RECORD_AUDIO` denial remain intact.
   - Related: `NTH-CD-017`, `NTH-CD-059`, `NTH-CD-062`, `NTH-REQ-022`, `NTH-AC-017`
   - Verification: See `NTH-EV-045`. The affected 805 tests, four package type boundaries, repository/residue guards, targeted formatting and diff hygiene passed in a combined `48.602s`.
9. `NTH-TD-026` `[verified]`: Delete the unreachable Core shadow implementation and same-class migration scaffolding.
   - Scope: Remove all 65 files under `packages/core/src`, nine false package-test placeholders, the Expo starter README/reset command, the abandoned Code4Agent Relay mirror command and false package-status statements.
   - Preserved boundaries: the formal `@thoth/core` package manifest and contracts remain; no stub, compatibility export or replacement path was added; active daemon/drivers implementations and all runtime, wire, SDK and UI behavior remain unchanged.
   - Related: `NTH-CD-018`, `NTH-CD-022`, `NTH-CD-059`, `NTH-CD-062`, `NTH-REQ-022`, `NTH-AC-017`
   - Verification: See `NTH-EV-046`. The independent slice removes `20,153` lines with zero additions; repository/package contracts, four foundation type boundaries, structural guards, targeted formatting, diff hygiene and 447 affected tests passed in `36s` plus final documentation hygiene.
10. `NTH-TD-024` `[verified]`: Implement provider-neutral native Plan, Loop approval automation and update recovery.

- Scope: Foreground Create/Send freeze `default | plan` independently of Thoth; Codex, Claude, OpenCode and capable ACP map that contract to native transport while Pi/non-Plan ACP report unsupported. Every Loop PlanExec runs native Plan -> durable Implement approval -> same-thread implementation -> semantic result; Review/audit permissions share the 20-second background approval authority.
- Recovery: Stored Agent unarchive no longer emits before live registration; `fetch_agent_response.errorCode` distinguishes true stale tabs, and App removes only the matching server/workspace tab. Product App source has no Codex `plan_mode` feature path.
- Related: `NTH-CD-060`, `NTH-CD-061`, `NTH-REQ-021`, `NTH-AC-016`
- Verification: See `NTH-EV-047`. The two bounded gates, four package type boundaries, full foundation, static provider-neutral contract, formatting and diff hygiene passed without AppImage, Relay, real-provider, push or Release work.

11. `NTH-TD-027` `[verified]`: Delete the disconnected Paseo file-backed Task subsystem.

- Scope: Remove `packages/daemon/src/tasks`: `FileTaskStore`, Markdown task documents, dependency graph, execution ordering and their self-contained tests.
- Preserved boundaries: Workspace-sharded SQLite Task authority, Task coordinator/orchestrator, Task Blackboard, Human Decisions, public APIs, provider execution and UI behavior remain unchanged; no replacement, compatibility path or empty directory was added.
- Related: `NTH-CD-018`, `NTH-CD-059`, `NTH-CD-060`, `NTH-CD-062`, `NTH-REQ-022`, `NTH-AC-017`
- Verification: See `NTH-EV-048`. Seven files and `2,244` lines were deleted with zero additions; structural guards, repository/Release contracts, foundation and Daemon type boundaries, 16 current Task-authority tests, targeted formatting and diff hygiene passed in a bounded source gate.

12. `NTH-TD-028` `[verified]`: Repair rewind identity, foreground delivery serialization and Workspace image preview regressions, then replace the fixed MVP Release.

- Scope: Provider-neutral canonical/native rewind receipts and Timeline epoch reset; Workspace-sharded durable Queue/Interrupt with one active foreground turn; removal of App-local Queue and optimistic Timeline authority; transient daemon/Relay image preview; Queue-default settings migration.
- Related: `NTH-CD-060`, `NTH-CD-063`, `NTH-REQ-023`, `NTH-AC-018`
- Verification: See `NTH-EV-049`. Local interaction and full Thoth fast gates passed; GitHub Actions run `29926576540` completed every native, Relay and CLI job, replaced the fixed prerelease at `0eff56c0`, and the re-downloaded AppImage, APK and server CLI passed SHA-256 plus AppImage static content verification.

13. `NTH-TD-029` `[verified]`: Restore Agent-scoped native Plan, durable Plan output, reliable tab archive and desktop-only Release publication.

- Scope: live-session capability projection; per-Agent `default | plan` CAS authority; Provider Features Plan control; canonical Plan Timeline persistence; archive-before-layout single/bulk close; no Android updater/install permission; no public APK or server CLI tgz.
- Related: `NTH-CD-060`, `NTH-CD-061`, `NTH-CD-064`, `NTH-REQ-024`, `NTH-AC-019`
- Verification: See `NTH-EV-050`. Local and authenticated Codex gates passed; hosted Relay packaged Plan/Loop passed; GitHub Actions run `29949640876` completed every required desktop, Relay and internal CLI job; the fixed prerelease and downloaded AppImage metadata/checksum all resolve to `05775486`.

14. `NTH-TD-030` `[verified]`: Restore Plan to the Provider Features list without changing Provider Plan authority.

- Scope: delete the standalone Run Mode segmented section; render Plan as the first Provider Feature row; preserve per-Agent CAS updates, native/unsupported/unavailable/retry states and the absence of a Composer Plan control.
- Related: `NTH-CD-064`, `NTH-CD-065`, `NTH-REQ-024`, `NTH-AC-019`
- Verification: See `NTH-EV-051`. The bounded Plan/tab gate passed in `18.441s`, the strengthened source contract proves Plan's exact feature-list placement and Default/Plan mapping, and the real Web export bundled `4415` modules successfully.

15. `NTH-TD-031` `[verified]`: Freeze the clean final-architecture refactor baseline and make one shared `300s` acceptance gate real before production code changes.

- Baseline: commit `743e8d29f8a3e752bd4b53af31bcf0a15a5bed14`, Node `24.14.0`, npm `11.9.0`, `308,531` production LOC, `1,298,564` scanner tokens, `1,346,659` AST nodes, `5,057` non-type static imports and `165` runtime dependency edges.
- Scope: Release `05775486` SQLite fixture/digest, independent daemon/App/response performance, real Web screenshots, keyboard/focus/a11y/responsive transcripts, TUI frame, architecture guards and one shared-deadline runner.
- Related: `NTH-MS-018`, `NTH-CD-066`, `NTH-REQ-025`, `NTH-AC-020`
- Verification: See `NTH-EV-052`. `npm run accept:refactor:fast` passed every source, storage, architecture, foundation, runtime build, public behavior, real Web/visual, App, TUI and performance phase in `270.302s` under one `300s` deadline.

16. `NTH-TD-032` `[verified]`: Atomically cut authority over to pure `@thoth/core` transitions and one Workspace Repository/Unit of Work, migrate Release `05775486` losslessly and delete monolithic persistence, `authority_events`, constructor DDL and obsolete migrations.

- Scope: deterministic Core transition, normalized SQLite schema, Workspace revision/CAS, atomic migration activation, read-through routing projection, direct daemon consumer cutover and removal of duplicate event writes and runtime schema guessing.
- Related: `NTH-MS-018`, `NTH-CD-066`, `NTH-REQ-025`, `NTH-AC-020`
- Verification: See `NTH-EV-053`. The Release semantic digest remained `74f79a53c1cae8d58dbedb7d57a553b8696170371a11650e2d70e91720f74d5f`; the final complete `npm run accept:refactor:fast` included Core `9/9`, passed in `245.631s`, and measured every production complexity metric below the clean baseline.

17. `NTH-TD-033` `[verified]`: Atomically cut every Provider and foreground/background execution path over to direct capability HarnessAdapters, one ExecutionService and one ToolGateway, then delete the AgentClient/Session/Manager/host bridge stack.

- Scope: direct capability contracts and lazy Provider manifests; one ExecutionService for foreground, background, PlanExec and Review; one ToolGateway for generation/phase/tool-scope fencing; complete deletion of the old manager/host/registry/fence bridge and eager compatibility APIs.
- Related: `NTH-MS-018`, `NTH-CD-066`, `NTH-REQ-025`, `NTH-AC-020`
- Verification: See `NTH-EV-054`. Final Provider conformance, public Harness lifecycle, Provider Control and full behavior/visual/performance coverage passed; `npm run accept:refactor:fast` completed in `238.109s`, and every tracked production complexity metric remained below Cut 1 and the clean baseline.

18. `NTH-TD-034` `[verified]`: Replace Protocol/Client/Daemon hand-written RPC synchronization with one Zod Registry and derived semantic Client facade/Daemon dispatch while preserving every public operation and binary codec.

- Scope: one 131-operation/139-outbound schema registry, one common error/version contract, 112 declaration-driven Client methods, one typed 131-handler Daemon table, explicit binary codec isolation and complete deletion of old correlated waiter helpers plus grouped request switches.
- Related: `NTH-MS-018`, `NTH-CD-066`, `NTH-REQ-025`, `NTH-AC-020`
- Verification: See `NTH-EV-055`. Protocol `351/351`, Client `119/119`, Session/Wire `133/133`, WebSocket lifecycle `17/17` and public foreground `12/12` passed. The final no-warning `npm run accept:refactor:fast` passed in `240.108s`; cumulative production metrics are `2,476` LOC, `8,823` scanner tokens, `7,814` AST nodes, `23` static imports and `1` runtime dependency edge below the clean baseline.

19. `NTH-TD-035` `[verified]`: Replace App Session authority state with one normalized authority projection, QueryClient server state, HostRuntime connection state and versioned UI preferences while preserving exact behavior and UX.

- Scope: one `AuthorityProjectionStore` written only by `DaemonProjectionService`; protocol-owned `AgentTimelineEntry`; HostRuntime Client/ServerInfo ownership; QueryClient archive/restore/file/pending-message state; UiPreferences focus ownership; complete deletion of Session Store/Context, duplicate Timeline reducers and the third Timeline model.
- Related: `NTH-MS-018`, `NTH-CD-066`, `NTH-CD-067`, `NTH-REQ-026`, `NTH-AC-021`
- Verification: See `NTH-EV-056`. App `331/331` files and `2,582/2,582` tests, Foundation, real Web, Provider Control, interaction regressions, Stage 4 architecture/source guards and the complete shared gate passed; `npm run accept:refactor:fast` completed in `144.145s`, and every production complexity metric is below Cut 3 and the clean baseline.

20. `NTH-TD-043` `[verified]`: Promote the feature- and UX-preserving refactor intermediate state and replace the fixed desktop-only MVP Beta Release without closing Cut B or the final 50k target.

- Scope: repair the Cut 1 Windows durability regression once in the shared storage/supervisor path; normally fast-forward the two authorized branches; require the complete local `NTH-AC-022` gate, exact-SHA native Actions, a precise desktop-only public asset set and a downloaded public AppImage journey.
- Related: `NTH-CD-068`, `NTH-CD-069`, `NTH-CD-070`, `NTH-AC-022`, `NTH-EV-065`, `NTH-EXP-058`, `NTH-EXP-059`, `NTH-EXP-060`, `NTH-EXP-061`, `NTH-TD-036`, `NTH-REQ-026`
- Verification: See `NTH-EV-065`. Workflow `30160730623` passed every job at source `198562296`, including Windows Server CLI and Desktop, hosted Relay, packaged Linux journey and publish; the fixed prerelease exposes exactly 26 desktop assets, and the checksum-verified downloaded AppImage passed the complete public API journey.

21. `NTH-TD-044` `[verified]`: Reconcile persisted Workspace Agent/Terminal tabs against current authority before presentation or destructive actions.

- Scope: authority-filter every restored entity tab before pane/tab/action derivation; retain valid local tabs; permanently prune stale persistence after hydration; unify single and bulk close policy so missing/archived/subagent Agent and stale Terminal targets are layout-only while known root Agents remain archive-before-layout.
- Related: `NTH-REQ-021`, `NTH-REQ-024`, `NTH-REQ-027`, `NTH-AC-019`, `NTH-AC-023`, `NTH-EV-066`, `NTH-EXP-063`
- Verification: See `NTH-EV-066`. Focused tests passed `86/86`, the complete App passed `2,591/2,591`, real Web bundled `4,423` modules and the final fresh shared Stage 4 gate passed every phase in `138.424s`. No Protocol/daemon semantic change, swallowed real archive failure, push or Release mutation occurred.

22. `NTH-TD-045` `[verified]`: Publish the verified persisted Agent/Terminal tab reconciliation through the fixed desktop-only MVP Beta flow.

- Scope: commit the final repair and tests; normally fast-forward both authorized branches to one source commit; require exact-SHA native Actions and publish to pass; verify the fixed tag/Release, exact 26-asset desktop-only manifest, checksums/build identity and the downloaded public AppImage journey; leave `main`, Relay deployment and Paseo unchanged.
- Related: `NTH-WS-005`, `NTH-CD-071`, `NTH-AC-024`, `NTH-TD-036`, `NTH-TD-044`, `NTH-EV-066`, `NTH-EV-067`, `NTH-EXP-064`
- Verification: See `NTH-EV-067`. Source commit `30528b81`, workflow `30182942323`, Windows CLI/Desktop, hosted Relay, packaged Linux and publish passed; the fixed prerelease exposes exactly 26 desktop-only assets, and the checksum-verified downloaded AppImage passed the complete public API journey.

23. `NTH-TD-046` `[verified]`: Establish one repository-local skill for exact-SHA Paseo-to-Thoth synchronization, evidence, and authorized publication.

- Scope: keep one canonical skill source under `.agent-os/skills/sync-paseo-into-thoth`, expose it to repo-local Codex through a symlink, implement the five-stage workflow, and add deterministic range, boundary and provenance helpers plus formal root command entry points.
- Related: `NTH-WS-001`, `NTH-WS-004`, `NTH-WS-006`, `NTH-CD-041`, `NTH-CD-060`, `NTH-CD-073`, `NTH-EV-069`
- Verification: See `NTH-EV-069`. Skill validation, deterministic positive/negative fixture coverage, real-worktree boundary scanning, repository validation, format/diff hygiene and the complete Foundation gate passed with `565/565` tests. No Paseo range, product source, commit, push, tag, Release or deployment was changed.

24. `NTH-TD-047` `[verified]`: Harden Paseo synchronization for long-term Thoth divergence and architecture-level upstream changes.

- Scope: treat Paseo ranges as capability/intent inventories rather than mechanically mergeable patches; add schema-version-2 architecture signals and per-change impact assessments; require a structured discussion packet and concrete `NTH-CD-*` decision before any architecture-level item can enter integration; prevent required candidates from being ignored or silently downclassified.
- Related: `NTH-WS-001`, `NTH-WS-004`, `NTH-WS-006`, `NTH-CD-060`, `NTH-CD-073`, `NTH-CD-075`, `NTH-EV-070`, `NTH-EXP-066`
- Verification: See `NTH-EV-070`. Deterministic fixtures, independent Stage 2 forward-testing, skill validation, real-worktree boundary audit, project/repository validation, formatting, diff hygiene and the complete Foundation gate passed. No real Paseo range or product source was changed.

25. `NTH-TD-048` `[verified]`: Organically integrate the approved Paseo v0.2.2 capabilities and replace the fixed desktop-only MVP Beta.

- Scope: adapt the approved Forge/Workspace, Browser, Schedule, Timeline/subagent/idle, Provider, Host service-port, Desktop/Terminal, read-only Files/Changes and App/Mobile behavior through current Thoth owners; reject voice/Hub/website/legacy authority/distribution; defer file editing; publish one exact source through the guarded fixed-Beta flow.
- Related: `NTH-REQ-028`, `NTH-AC-025`, `NTH-CD-076`, `NTH-CD-077`, `NTH-CD-078`, `NTH-CD-079`, `NTH-CD-080`, `NTH-CD-081`, `NTH-CD-082`, `NTH-CD-083`, `NTH-CD-084`, `NTH-CD-085`, `NTH-CD-086`, `NTH-CD-087`, `NTH-CD-088`, `NTH-EV-071`, `NTH-EXP-068`, `NTH-EXP-069`, `NTH-EXP-070`
- Verification: See `NTH-EV-071`. Provenance passed `393/393`, `143/143`, `43/43`, zero pending and zero failures; all local gates and product journeys passed; corrective source `cf5067fa` completed exact-SHA workflow `30318942696`; the fixed prerelease exposes exactly 26 desktop-only assets; and the checksum/build-identity-verified public AppImage passed the complete product journey.

26. `NTH-TD-049` `[verified]`: Organically integrate the exact Paseo v0.2.3 target-side capability set, complete the Workspace-owned Schedule App surface, and replace the fixed desktop-only MVP Beta.

- Scope: reconstruct the approved `Tasks | Schedules` information architecture, Workspace-script semantic control, Provider usage/OMP/runtime ownership, atomic socket/E2EE/file streaming, strict forwarded authority and App/Desktop repairs through current Thoth owners while preserving every rejected/deferred boundary.
- Related: `NTH-REQ-029`, `NTH-AC-026`, `NTH-CD-089`, `NTH-CD-090`, `NTH-CD-091`, `NTH-CD-092`, `NTH-CD-093`, `NTH-CD-094`, `NTH-CD-095`, `NTH-CD-096`, `NTH-EV-072`, `NTH-EXP-071`, `NTH-EXP-072`, `NTH-TD-036`
- Verification: See `NTH-EV-072`. Provenance passed `36/36` and `12/12` with all required candidates architectural, zero pending and zero failures; every local gate and product journey passed; source `eaa1aa5f` completed exact-SHA workflow `30383055325`; the fixed prerelease exposes exactly 26 desktop-only assets; and the checksum/build-identity-verified public AppImage passed the complete `Tasks | Schedules`, scripts and five-chunk product journey.

27. `NTH-TD-050` `[verified]`: Decouple turn-scoped Thoth RuntimeBundle activation from Provider-native Plan and Provider questions while preserving one native session per visible Agent.

- Scope: remove session-level Clarify prompt contamination; add Provider-neutral per-turn Skill activation, structured Provider-question response, typed completed-Plan authority, Daemon-owned Implement approval, exact migration and same-session real-product acceptance.
- Related: `NTH-REQ-030`, `NTH-AC-027`, `NTH-CD-053`, `NTH-CD-061`, `NTH-CD-064`, `NTH-CD-065`, `NTH-CD-097`, `NTH-CD-098`, `NTH-EV-073`, `NTH-TD-036`
- Verification: See `NTH-EV-073`. Deterministic owners, real Codex, built-Web UI, local AppImage real-window UI,
  isolation, Foundation and the final `173.751s` refactor gate passed. No commit, push, tag, Release or deployment
  was performed.

28. `NTH-TD-051` `[verified]`: Publish the verified Provider-interaction correction as an in-place replacement of the fixed desktop-only MVP Beta.

- Scope: create one atomic release-source commit, normally fast-forward `agent/dev/mvp` and `release/mvp-actions` to the exact SHA, wait for the existing mandatory workflow, verify the fixed 26-asset prerelease from fresh public downloads, run the downloaded AppImage real-window journey, and close evidence only on the development branch.
- Related: `NTH-REQ-031`, `NTH-AC-028`, `NTH-CD-099`, `NTH-EV-073`, `NTH-EV-074`, `NTH-TD-036`, `NTH-TD-050`
- Verification: See `NTH-EV-074`. Corrective source `d898f25f` completed exact-SHA workflow `30459786832`; all 11
  mandatory jobs passed, including the repaired macOS x64 and hosted Relay paths. Fixed prerelease `361828099`
  exposes exactly 26 desktop-only assets, and the checksum/build-identity-verified downloaded AppImage passed the
  complete Provider Plan/question/Implement same-thread and existing product journey. Terminal state is
  `published`; `NTH-TD-036` is again the sole top action and remains doing at Stage 4.

## Abandoned

1. `NTH-TD-013` `[abandoned]`: Deploy Thoth relay preview through Code4Agent feature workflow and validate a hosted `.seele.chat` relay URL.
   - Reason: Code4Agent active `protected-paths` push ruleset restricted `.github/**/*` and `**/*/wrangler.jsonc`; the user then explicitly moved relay deployment authority to a new independent repository. The working test relay is now `SeeleAI/Thoth-Relay` at `relay.test.thoth.seeles.ai`.
   - Historical evidence: See `NTH-EV-005` and `NTH-EXP-005`.
   - Related: `NTH-MS-010`, `NTH-CD-021`, `NTH-CD-022`
