# TODO

## Backlog

1. `NTH-TD-003` `[backlog]`: Write the first SQLite authority schema and migration policy.
   - Related: `NTH-MS-002`, `NTH-REQ-002`, `NTH-REQ-004`
2. `NTH-TD-004` `[backlog]`: Design the first Claude Code, Codex and ACP driver capability contract.
   - Related: `NTH-MS-004`, `NTH-REQ-005`
3. `NTH-TD-006` `[backlog]`: Design E2EE relay deployment path for Cloudflare prototype and seeles.ai hosted/self-hosted service.
   - Related: `NTH-MS-005`, `NTH-REQ-006`

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

1. `NTH-TD-016` `[doing]`: Repair reopened Loop-2 Quick+Clarify regression.
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

12. `NTH-TD-028` `[doing]`: Repair rewind identity, foreground delivery serialization and Workspace image preview regressions, then replace the fixed MVP Release.

- Scope: Provider-neutral canonical/native rewind receipts and Timeline epoch reset; Workspace-sharded durable Queue/Interrupt with one active foreground turn; removal of App-local Queue and optimistic Timeline authority; transient daemon/Relay image preview; Queue-default settings migration.
- Related: `NTH-CD-060`, `NTH-CD-063`, `NTH-REQ-023`, `NTH-AC-018`
- Verification: Local `accept:interaction-regressions:fast` currently passes; final status requires the complete fast/foundation gates, branch synchronization, all native Actions jobs and public Release metadata/assets.

## Abandoned

1. `NTH-TD-013` `[abandoned]`: Deploy Thoth relay preview through Code4Agent feature workflow and validate a hosted `.seele.chat` relay URL.
   - Reason: Code4Agent active `protected-paths` push ruleset restricted `.github/**/*` and `**/*/wrangler.jsonc`; the user then explicitly moved relay deployment authority to a new independent repository. The working test relay is now `SeeleAI/Thoth-Relay` at `relay.test.thoth.seeles.ai`.
   - Historical evidence: See `NTH-EV-005` and `NTH-EXP-005`.
   - Related: `NTH-MS-010`, `NTH-CD-021`, `NTH-CD-022`
