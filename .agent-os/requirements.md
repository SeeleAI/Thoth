# Requirements

## Objective

`NTH-OBJ-001`: Thoth must become a host-neutral task control plane for AI work. It should behave like a reliable private secretary for a high-authority user: remember context, understand vague intent, ask only the important golden questions, register durable tasks when needed, run asynchronous loops, and report results with evidence.

## Goals

1. `NTH-REQ-001`: Reduce user cognitive burden and entry barrier as the first design principle.
2. `NTH-REQ-002`: Compile natural-language intent into clear task contracts with goal, non-goals, constraints, assumptions, risks and acceptance.
3. `NTH-REQ-003`: Treat `Loop` tasks as recoverable, reviewable, long-running loops rather than one-off agent runs.
4. `NTH-REQ-004`: Make success depend on frozen acceptance and evidence, not executor self-report.
5. `NTH-REQ-005`: Keep Thoth host-neutral across Claude Code, Codex, ACP-compatible tools and future harnesses.
6. `NTH-REQ-006`: Keep UI shells thin. TUI, desktop app, mobile app and CLI must see the same authority.
7. `NTH-REQ-007`: Use OpenTUI for the TUI shell.
8. `NTH-REQ-008`: Use a TypeScript / Node monorepo for the new runtime. The new core must not use Python as the main product runtime.
9. `NTH-REQ-009`: Preserve archived plugin history through archive release and archive branch, not through legacy code in the active working tree.
10. `NTH-REQ-010`: Provide an explicit GitHub Actions release and packaging pipeline. Under `NTH-CD-056`, the current MVP trigger is a push to the dedicated `release/mvp-actions` branch and replaces only the fixed `v0.0.0-mvp-beta` prerelease after every build passes. It produces desktop installers, a signed Android APK and a GitHub-hosted server CLI tgz without npm publication or iOS self-install claims; production web/relay deploy and iOS distribution remain separate decisions.
11. `NTH-REQ-011`: Keep Thoth as a control plane, not a harness or direct LLM client. All AI execution must occur through configured provider sessions via ACP, harness runtime, app-server, official harness SDK/control surface or local harness CLI.
12. `NTH-REQ-012`: Keep semantic routing provider-backed or user-selected. The product exposes explicit controls for `Quick` versus `Loop`, clarification strength and loop strength, but Thoth core/daemon must not classify natural-language intent with local heuristic rules.
13. `NTH-REQ-013`: Use the locked chatbox composer controls: `+`, Provider, Mode, Clarify and Loop. Provider owns model/runtime/permission/fast settings; Clarify has five levels: `auto`, `Don't Bother Me`, `light`, `Balanced`, `deep`; Loop has five levels: `auto`, `One Plan, One Do`, `light`, `balanced`, `Run Until Stopped`; `Run Until Stopped` must be visually high-risk, high-cost and manually stopped.
14. `NTH-REQ-014`: Use provider-native sessions for the business flow. `Quick + Don't Bother Me` is a provider passthrough path. `Loop` uses read-only Clarify, frozen contract, one PlanExec provider session with provider-native plan mode when available, and independent Review. Visible provider output must stream to clients in real time. PlanExec clarification questions after contract freeze are auto-answered from the frozen contract or first recommended option, while provider permission requests still obey permission policy.
15. `NTH-REQ-015`: Use `AGPL-3.0-or-later` for Thoth and allow upstream-derived implementation seed material only when provenance, license, commit SHA, exclusion policy and expected broken state are recorded. Multica source code must not be copied into this repository.
16. `NTH-REQ-016`: Maintain first-day development infrastructure before feature work: stable npm install, root-script validation gates, foundation build/typecheck/test coverage, local Android Debug APK packaging, Linux-safe iOS script behavior, package-level agent contracts and executable development/testing/packaging/release docs.
17. `NTH-REQ-017`: Provide a stable human dogfood entry for Thoth I whose UI and experience match the current releasable full UI. Development mode may change runtime wiring, logs, local daemon targets or provider configuration, but it must not change the user-facing flow, layout, copy, states or task experience into a separate debug product.
18. `NTH-REQ-018`: Keep Thoth runtime independent from the local Paseo daemon. Thoth direct daemon defaults to `127.0.0.1:6688`; local Paseo/legacy `127.0.0.1:6767` must remain untouched; web review uses the real app on `8082 -> 8148`; relay test traffic uses `relay.test.thoth.seeles.ai` through v3 tokenized pairing; desktop and Android artifacts must carry Thoth identity and avoid legacy/Paseo runtime state.
19. `NTH-REQ-019`: Make `Simply Is First` the highest code-development priority. Development must implement the locked final architecture as independently verifiable production modules, one real module at a time. Rapid experiments must exercise the final module boundary and product path; they may reveal failing metrics, but may not introduce simplified substitutes, parallel implementations, fallback behavior, semantic downgrades or unapproved architecture changes.
20. `NTH-REQ-020`: Persist and orchestrate Thoth through provider-neutral Workspace and Task authority. One Workspace owns one authority shard and one mutation lease domain; every approved Quick or Loop execution is a Task; every provider run is a fenced ExecutionAttempt; every human authority decision is append-only and exact. RuntimeBundles are deduplicated by digest and attached through the same HarnessAdapter contract for Codex, Claude Code, OpenCode, Pi and ACP. Provider homes, authentication, native transcripts and caches remain provider-owned and must never be copied into `.thoth`.
21. `NTH-REQ-021`: Treat native Plan, Plan-to-Implement transition and provider approvals as one capability-based Harness contract for foreground and background execution. Loop PlanExec requires a native Plan receipt; unsupported providers cannot register Loop through a hidden prompt fallback. Background runtime approvals are durable, task-scoped, CAS-fenced and auto-approved once after a fixed 20-second human window, while Thoth authority Cards remain human-owned. Installed App recovery must reconcile persisted Agent authority before restoring tabs or emitting live state.
22. `NTH-REQ-022`: Run deletion-only refactor slices without changing valid product behavior. Remove retired and unreachable code at its final package boundary, keep every slice net-negative in code and complexity, preserve the sole production authority path, and reject replacement stubs, compatibility shells, hidden fallbacks or temporary parallel implementations. Verify each slice through an affected source-level gate that completes within five minutes.

## Acceptance Criteria

1. `NTH-AC-001`: The active working tree no longer contains archived Python runtime, plugin projection, dashboard template, Textual TUI or old tests.
2. `NTH-AC-002`: The active working tree contains exactly the 10 approved package skeletons under `packages/`.
3. `NTH-AC-003`: Root and package metadata use `AGPL-3.0-or-later`, the current decision-locked package version `0.0.0-mvp-beta`, and `npm workspaces`.
4. `NTH-AC-004`: The recovery path from `AGENTS.md` to `.agent-os/project-index.md` to `.agent-os/todo.md` can explain the current Thoth state without the chat transcript.
5. `NTH-AC-005`: The canonical design set is present under `.agent-os/designs/`.
6. `NTH-AC-006`: The archived plugin release and branch are documented for traceability.
7. `NTH-AC-007`: Claims about runnable Thoth surfaces are backed by current build, test, packaging or release evidence and clearly distinguish local development, MVP beta and archived plugin paths.
8. `NTH-AC-008`: `npm run check:foundation` passes through repo validation, formatting, foundation lint, foundation build, foundation typecheck and foundation tests.
9. `NTH-AC-009`: `npm run package:android:debug-apk` produces a real local Debug APK and records its absolute path, sha256 and byte size without committing the APK or generated native project.
10. `NTH-AC-010`: Root plus all 10 packages have local `AGENTS.md` files, and every `CLAUDE.md` is a symlink to the matching `AGENTS.md`.
11. `NTH-AC-011`: Once the Thoth I dev entry exists, human review enters the same UI component tree, routes, composer controls, task cards, stream states and report surfaces that a releasable build uses; debug overlays or logs may exist only as non-primary developer aids.
12. `NTH-AC-012`: Runtime isolation smoke proves Paseo/legacy remains on `127.0.0.1:6767`, Thoth runs on `127.0.0.1:6688`, the real web UI responds on `8082 -> 8148`, the test relay health endpoint responds, Linux AppImage packaged smoke passes with an isolated managed daemon, Android Debug APK has package id `sh.thoth.debug` without `RECORD_AUDIO`, and Codex provider smoke passes through Thoth paths.
13. `NTH-AC-013`: The authorized `v0.0.0-mvp-beta` GitHub Actions flow leaves `main` unchanged, publishes exactly one current MVP prerelease with native macOS/Windows/Linux, signed Android and server CLI assets, preserves the historical archive release, does not publish npm packages and passes independent downloaded-asset verification.
14. `NTH-AC-014`: Every nontrivial implementation slice identifies its canonical final module, production interface, state owner and real-path acceptance before coding; its landed code remains part of the final architecture, introduces no unapproved parallel or fallback path, and reports unmet acceptance values as failures rather than lowering the target.
15. `NTH-AC-015`: A fresh packaged AppImage proves raw/Thoth hot switching on one visible provider thread, durable Card continuation after a five-hour wait, Quick and Loop Tasks, `thoth.loop` attachment receipts for every background phase, failed-Review retry, same-Workspace structured `@Task` context, Stop without a stale phase spinner, daemon restart recovery and a provider-session-free `.thoth` layout. Six scripted sessions add at most 25MB of durable Thoth state and store each RuntimeBundle digest only once. The same public adapter conformance journey passes for Codex, Claude Code, OpenCode, Pi and ACP; Codex additionally passes a real-provider run.
16. `NTH-AC-016`: One fast public-API gate proves native Plan selection for every supporting adapter, honest unsupported behavior for Pi/non-Plan ACP, foreground mode snapshots independent of Thoth, Loop PlanExec Plan-to-Implement continuation, 20-second background approval CAS/timeout/Stop fencing, and update-time Agent/tab reconciliation. The gate uses real product adapters and authority with deterministic external transports and a fake clock, completes within five minutes, and contains no AppImage, Relay, browser or real-provider smoke.
17. `NTH-AC-017`: A deletion-only slice is acceptable only when its surviving public behavior tests pass, retired symbols and file references are absent, relevant type boundaries remain green, its conservative non-overlapping diff is net-negative, formatting/diff hygiene passes for the slice, and the complete acceptance bundle finishes within 300 seconds without packaging, Relay, browser or real-provider work.

## Hard Constraints

1. Do not push unless explicitly requested.
2. Do not touch `main`, archive branches, marketplace installs or any release/tag outside the narrowly authorized `v0.0.0-mvp-beta` replacement flow in `NTH-CD-056`.
3. Do not reintroduce archived plugin runtime compatibility.
4. Do not add fake build/test/typecheck scripts before implementation exists.
5. Do not add a new package outside the approved 10 packages without a tracked decision.
6. Do not expose internal multi-agent/team/squad concepts to the user-facing product model.
7. Do not call general OpenAI, Anthropic or other model inference APIs directly from Thoth core/daemon as a substitute for a harness/provider session.
8. Do not let provider-native session handles, permissions or model settings become task authority; Thoth records them as execution evidence and resume metadata only.
9. Do not implement a local zero-shot semantic classifier for route, workspace intent, clarification strategy or loop strategy.
10. Local code may only honor explicit user controls, validate schemas, enforce permissions, gather mechanical evidence and maintain authority state.
11. Do not let Clarify mutate workspace files, install dependencies, commit, push, delete or rewrite workspace content.
12. Do not split Plan and Execute into separate Thoth role sessions in MVP; they are one PlanExec provider session.
13. Do not auto-approve provider permission requests merely because PlanExec provider questions are auto-answered after contract freeze.
14. Do not copy Multica source code into the Thoth repository.
15. Do not stage or commit `.agent-os/upstreams/` raw upstream cache.
16. Do not delete tracked `_paseo/` implementation seed material merely because imports, types or tests are temporarily broken.
17. Do not include voice, audio, speech or dictation upstream material in the current MVP implementation seed.
18. Do not rely on npm install lifecycle scripts for required toolchain setup; use explicit root scripts for native packaging/toolchain work.
19. Do not stage or commit `.dev/`, `.agent-os/artifacts/`, generated Android/iOS native folders or APK artifacts.
20. Do not create a separate mock, reduced, debug-only or agent-facing UI as the primary Thoth I review surface.
21. Do not use manual UI exploration as the ordinary agent validation gate; agents should use repository tests, typechecks, builds and explicit smoke commands.
22. Do not auto-probe, reuse, stop or restart `localhost:6767` / `127.0.0.1:6767` from Thoth runtime. That port is reserved for the user's local Paseo/legacy daemon.
23. Do not place relay pairing tokens in URL query strings, logs, screenshots, docs examples or final reports.
24. Do not stage or commit `packages/desktop/release/`.
25. Do not begin production implementation while the target module boundary, authority owner or canonical interface is unresolved.
26. Do not replace a final module with a compressed substitute that combines or bypasses responsibilities belonging to later modules.
27. Do not add fallback, compatibility, degraded, provider-specific or test-only production paths unless a tracked user decision explicitly requires that path.
28. Do not let fixtures or mocks bypass the same public API, state machine and lifecycle used by the real product.
29. Do not lower acceptance thresholds, alter success semantics or hide failing measurements to make a real implementation appear complete.
30. Do not change locked architecture implicitly through code; record and approve the architectural change first, then implement it as the new single path.
31. Do not create `.thoth/provider-sessions`, set a provider home per Agent/Task/phase, copy provider credentials/config/transcripts/cache, or inspect provider-native persistence from core/daemon business logic.
32. Do not represent a Task phase by a hidden foreground Agent status. Task, PhaseRun, ExecutionAttempt and ProviderThread must retain separate identities and lifecycles.
33. Do not place Runtime Truth fields such as attempt ids, generations, budgets, leases, receipts, hashes or cursors into Agent Harness cognitive context. They may exist only in daemon authority, adapter calls, audit evidence and UI projections.

## Non-Goals

1. Implementing daemon, SQLite authority, drivers, TUI, desktop app, mobile app, relay or CLI.
2. Producing runnable MVP behavior.
3. Porting archived plugin commands.
4. Preserving old 0.4.x changelog as the active product history.
5. Maintaining the archived Python package for compatibility.
6. Publishing npm packages, running EAS cloud builds, app-store submission, production web/Relay deployment or producing a real iOS build on Linux. The narrowly authorized GitHub Actions and Release exception is defined by `NTH-CD-056`.
7. Building a second development-only product surface that behaves differently from the releasable Thoth UI.
8. Deploying production relay `relay.thoth.seeles.ai` or production app `app.thoth.seeles.ai`.
9. Using Code4Agent as the current relay deployment authority after the independent `SeeleAI/Thoth-Relay` decision.
