# Testing

Tests prove behavior, not implementation shape. The default gate for Thoth development is the foundation gate.

## Foundation Gate

Foundation packages:

- `packages/app/highlight`
- `packages/relay`
- `packages/protocol`
- `packages/client`

Run:

```bash
npm run check:foundation
```

This expands to repository validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests.

If this gate fails, fix it before starting or continuing product feature work.

## Final-Architecture Refactor Gate

After `npm install`, prepare the ignored local Expo dependency cache once per lockfile/Node version:

```bash
npm run setup:refactor-web-cache
```

The cache lives under `/tmp`, is never project authority and is rejected automatically when its dependency
signature differs from the current lockfile. Every timed run still synchronizes the current candidate source and
builds a real Web export; the cache only prevents Metro from repeatedly reading the unchanged multi-gigabyte
dependency tree through the remote CFS mount.

The sole acceptance command for the production main-chain refactor is:

```bash
npm run accept:refactor:fast
```

It applies one shared 300-second deadline to source/storage/architecture guards, foundation, affected product
behavior, real Web visual/interaction evidence, App/TUI contracts and performance. Do not reuse a stale Web dist,
skip a phase or run the phases separately as completion evidence.

## Narrow Iteration

Use narrow checks while iterating:

```bash
npm run test:protocol
npm run test:client
npm run test:relay
npm run test:highlight
npm run typecheck:protocol
npm run typecheck:client
```

Owner-level changes outside Foundation use the package's declared script. Examples for the Paseo v0.2.2
integration are:

```bash
npm --workspace=@thoth/daemon run test:unit
npm --workspace=@thoth/app run test
npm --workspace=@thoth/desktop run test
npm --workspace=@thoth/cli run test
```

Do not run output-cleaning root/package scripts concurrently when they share `packages/protocol/dist` or another
built workspace dependency.

## Paseo Organic-Integration Gates

An exact Paseo range is complete only when both provenance and the current Thoth boundary pass:

```bash
npm run test:skill:paseo-sync
npm run paseo:verify-provenance -- --manifest <manifest.json> --classification <classification.json>
npm run paseo:check-boundaries -- --repo . --base <thoth-base-sha> --out <boundary-report.json>
```

For the accepted v0.2.3 target-side set, provenance must cover `36/36` commits selected by
`v0.2.2...v0.2.3 --right-only`, assess `12/12` architecture candidates, represent all four required candidates in
architectural coherent groups, and report zero pending reviews and failures. Generated JSON belongs under ignored
`.agent-os/artifacts/paseo-sync/`; durable conclusions belong in the project ledgers. The published v0.2.2 range
remains historical evidence under `NTH-EV-071` and is not recomputed as part of the v0.2.3 target-side gate.

## Fast Thoth Product API Acceptance

The smallest non-negotiable product acceptance is one public-API journey against the daemon bundled
inside the final AppImage:

```bash
npm run accept:thoth:api -- --appimage packages/desktop/release/Thoth-x86_64.AppImage
```

The journey is intentionally a single behavior chain rather than a list of implementation tests:

```text
raw -> Quick Clarify -> raw -> Loop -> Review fail -> retry -> pass -> done
```

It proves that one visible Agent keeps the same provider session while Thoth is hot-switched, Agent
Cards use the public CAS authority API, Quick completes in the foreground, Loop registration ends the
foreground lifecycle at `background_handoff`, and independent PlanExec/Review sessions consume one
failed-Review retry before the task reaches `done`. The packaged smoke also inspects `app.asar`, mounts
the packaged Clarify/Loop skills, and uses the daemon managed by the AppImage rather than repository
daemon code.

The default external scripted harness controls only provider transport actions. It must call the real
runtime tools and cannot write daemon state directly. This keeps the result deterministic and normally
under one minute. The same `ThothApiJourney` can run against real Codex without changing product steps:

```bash
npm run accept:thoth:api -- \
  --real-codex \
  --quick-prompt-file .dev/acceptance/quick.txt \
  --loop-prompt-file .dev/acceptance/loop.txt
```

`scripts/acceptance/thoth-api-journey.mjs` owns product actions and assertions. Environment launchers
own only process/container/Relay setup, while provider fixtures own only harness transport. Optional
Pause/Resume/Stop, restart, UI and Relay checks compose after `runCore()`; they must not duplicate the
Clarify/Quick/Loop chain. A stale or previously published AppImage can validate itself but does not
validate newer source changes, so rebuild the AppImage before using this command as release evidence.

## Source-Level Product API Checks

Use the public Create/Send/Card/Background Task API suite while changing the foreground coordinator or authority
store:

```bash
npm run test:thoth-foreground
```

The suite covers raw passthrough, same-session hot switching, Agent-scoped Card authority, cancellation,
restart/recovery and Loop registration. It is a fast source check, not packaged acceptance.

Provider transport fixtures live outside the Journey and may prescribe semantic tool calls. They must still use
the real provider adapter and runtime-tool handlers; they may not insert Cards, tasks, phases or verdicts into
authority storage.

## Fast Provider Control Acceptance

Use the provider-control gate while changing native Plan, Implement transitions, background approvals or
installed-Agent recovery:

```bash
npm run accept:provider-control:fast
```

The runner has one shared 300-second deadline and prints each phase duration. It exercises protocol snapshots,
the real provider adapters with deterministic external transports, approval authority and fake-clock deadlines,
the public foreground/Loop API, typed missing-Agent recovery, scoped App tab cleanup and the static
provider-neutral architecture contract. It does not build an AppImage or contact Relay or a real provider.

Run the broader source-level Thoth gate before handoff:

```bash
npm run accept:thoth:fast
```

This reuses the same runner, executes the complete foreground authority journey and adds storage migration, Task
coordination, Task context and the wider App Task surface under the same hard deadline.

## Fast Interaction Regression Acceptance

Use the dedicated interaction gate while changing foreground delivery, rewind identity or file preview:

```bash
npm run accept:interaction-regressions:fast
```

The runner shares one 300-second deadline. It exercises the public Queue/Interrupt lifecycle through a suspended
Card and daemon restart, Workspace queue/CAS persistence, canonical-to-provider rewind receipts, Timeline epoch
reset, daemon/client binary file reads, Queue-default settings migration and transient PNG/JPEG/GIF/WebP preview
URL cleanup. Its static contract rejects a second App-local Queue, optimistic user Timeline writes and preview
copies in durable attachment storage. `accept:thoth:fast` includes this gate.

## Acceptance Layers

Use the cheapest layer that can disprove the current change, then promote the same Journey:

1. `Source API`: public daemon/client API with an in-process provider adapter.
2. `Packaged API`: AppImage-managed daemon with the external scripted harness. This is the default product gate.
3. `Real provider`: the same packaged Journey with real Codex dynamic tools.
4. `Environment extensions`: UI, Relay, Pause/Resume/Stop and daemon/app restart composed around `runCore()`.
5. `Release`: clean native jobs and a repeat run against assets downloaded from the public Release.

The complete local desktop gate is:

```bash
npm run accept:thoth:appimage
```

It rebuilds the AppImage and runs one real-window packaged journey. The report must include read-only Files,
Changes, Browser automation, Workspace-script start/stop with durable terminal/port receipts, a multi-chunk binary
file read, and complete `Tasks | Schedules` management/navigation. A Browser turn must first be observed leaving
`idle` and then returning to `idle` before the smoke navigates to the Schedule page; an old idle snapshot cannot
prove the newly submitted turn completed. Keep localhost CDP/daemon endpoints outside external proxies. The smoke
must wait for the default Tasks surface to hydrate and close it through the real UI before selecting an obscured
Workspace-scripts control; force-click and Client-only Schedule acceptance are invalid.

Transport changes also require the packaged hosted Relay journey:

```bash
NODE_USE_ENV_PROXY=1 \
HTTP_PROXY=http://10.0.3.5:7899 \
HTTPS_PROXY=http://10.0.3.5:7899 \
NO_PROXY=127.0.0.1,localhost \
npm run accept:thoth:relay
```

The proxy values above describe this repository environment, not product defaults. Node 24 requires
`NODE_USE_ENV_PROXY=1` for `ws`/HTTPS to consume environment proxy variables. The report must prove hosted v3 E2EE,
client and daemon restart recovery, and exact size/revision/SHA-256 for the five-chunk `1,048,649`-byte fixture;
the command never deploys Relay.

Claude Code, OpenCode and ACP must use the same Journey through their adapter capability contracts. Until an
adapter supports session-scoped skills, semantic tools, turn identity and continuation, Thoth-on acceptance must
report honest unsupported rather than use a provider-specific fallback.

## Runtime Isolation

When touching daemon, CLI host resolution, app host bootstrap, desktop daemon lifecycle, Relay pairing or
packaging paths, also run:

```bash
npm run smoke:isolation
```

This smoke proves the reserved legacy service remains on `127.0.0.1:6767` while Thoth uses its own runtime. It
must never probe, stop, reuse or restart the legacy daemon.

## Release Gates

The fast Journey is necessary but does not replace broad promotion evidence. Before replacing the MVP Release,
run the affected package suites, `npm run check:foundation`, daemon/web builds, three golden judges, native
desktop/Android/CLI smokes, real Relay, secret scan and `git diff --check`. The workflow must then repeat the
packaged Journey before publishing and rerun it against the downloaded public AppImage.

## Test Suffixes

- `*.test.ts(x)`: deterministic unit tests.
- `*.posix.test.ts`: POSIX-only unit tests.
- `*.browser.test.ts`: browser-backed app tests.
- `*.e2e.test.ts`: local end-to-end tests against real local services.
- `*.real.e2e.test.ts`: tests that hit real providers or external services.
- `*.local.e2e.test.ts`: tests that require local-only resources.

Real provider tests are opt-in. They must never be part of `check:foundation`.

A narrow native Codex runtime smoke may select one named test through the daemon's real-flow project while keeping
the Workspace temporary and using the Provider's existing auth:

```bash
npm --workspace=@thoth/daemon run test:e2e:real:flow -- --testNamePattern UT-01-quick-direct-passthrough
```

Unavailable Providers must be verified through capability or typed-unavailable behavior; tests must never fake
authentication success.

## Rules

1. Prefer deterministic assertions over weak assertions.
2. No conditional assertions in tests.
3. Do not delete flaky tests; fix the variance source.
4. Do not add fake auth checks for providers.
5. Boundary JSON and protocol messages should be schema-validated.
6. Do not claim a check passed unless the command was actually run in the current work session.
