# Acceptance Report

## Evidence Ledger

### `NTH-EV-001` Repo Reset Verification

Status: `passed`

Scope:

1. Old runtime path deletion.
2. New package skeleton creation.
3. Root metadata and original reset license verification.
4. Recovery document rewrite.
5. Local commit creation.

Required evidence:

1. `git status --short` before and after commit.
2. Structure check confirming old tracked runtime paths are gone.
3. Structure check confirming the exact 10 packages exist.
4. Node JSON parse check for root and package metadata.
5. `npm install --package-lock-only --ignore-scripts`.
6. `git diff --check`.
7. Symlink check for `CLAUDE.md -> AGENTS.md`.

Evidence:

1. Old root runtime paths checked gone: `thoth`, `scripts`, `templates`, `tests`, `commands`, `plugins`, `.claude-plugin`, `.codex-plugin`, `.agents`, `bin`, `pyproject.toml`, `.pytest_cache`, `.tmp_pytest`, `research.db`.
2. `packages/` contains exactly 10 package directories.
3. Root plus package metadata parsed successfully with Node: `package metadata ok 11`.
4. `npm install --package-lock-only --ignore-scripts` completed with `found 0 vulnerabilities`.
5. `CLAUDE.md` symlink check passed: `CLAUDE symlink ok`.
6. Design document presence check passed: `design docs ok`.
7. Official sources cache marker check passed.
8. Asset check confirmed only `thoth-icon.svg` and `thoth.png` remain under `assets/`.
9. `git diff --check` passed.

Current result:

The reset structure and metadata checks passed. Full commit evidence is recorded in `run-log.md`.

Note:

`NTH-AC-003` was later superseded from `GPL-3.0-only` to `AGPL-3.0-or-later` by `NTH-CD-017`. See `NTH-EV-002` for the active license/import evidence.

### `NTH-EV-002` AGPL And Upstream Seed Import Verification

Status: `passed`

Scope:

1. License switch to `AGPL-3.0-or-later`.
2. Upstream source verification and raw cache exclusion.
3. Tracked implementation seed import.
4. Git hygiene and package metadata checks.

Required evidence:

1. Remote HEAD check for the upstream source.
2. Raw cache path ignored by git.
3. Voice/audio/speech/dictation exclusion checks.
4. Node JSON parse and license metadata checks for root and package `package.json` files.
5. `npm install --package-lock-only --ignore-scripts`.
6. Tracked seed directory existence checks.
7. Large file and secret/path hygiene checks.
8. `git diff --check`.

Evidence:

1. Remote upstream `main` checked through `git ls-remote` with proxy: `5fc53c576ef0d4dee55455ccc95660703f71b892`.
2. Raw cache path checked ignored by git: `.gitignore:25:.agent-os/upstreams/`.
3. Seed directory check passed for all nine planned targets under `packages/*/_paseo`.
4. Root package metadata check passed: `packages=10`, `workspaces=packages/*`, active package licenses `AGPL-3.0-or-later`.
5. All package JSON files under `packages/` parsed successfully: `count=19`.
6. Path-level exclusion checks returned no seed or raw cache paths matching voice/audio/speech/dictation/TTS/STT/PCM/WAV patterns.
7. Generated/cache path check returned no seed paths matching `.git`, `node_modules`, `dist`, `build`, `.expo`, `.next`, `.wrangler` or `coverage`.
8. Large file check returned no tracked seed files over `5MB`.
9. Seed content naming scan found no `@getpaseo`, `getpaseo`, `PASEO`, `Paseo` or `paseo` content matches inside tracked seed.
10. Refined secret-like scan found no `ghp_`, real-looking `sk-...` token or private-key block in tracked seed/provenance files.
11. `npm install --package-lock-only --ignore-scripts` completed with `found 0 vulnerabilities`.
12. `git diff --check` passed.

Current result:

The AGPL policy and implementation seed import are verified as a non-runnable migration substrate. No CLI, daemon, TUI, desktop app, mobile app, relay or provider behavior is implemented by this evidence.

### `NTH-EV-003` Promoted Source Verification

Status: `passed`

Scope:

1. Promote tracked `_paseo` implementation seed material into formal package source trees.
2. Delete tracked `_paseo` directories.
3. Preserve the formal 10-package Thoth workspace boundary and package identity.
4. Refresh package-lock metadata without claiming compile or runtime readiness.
5. Check obvious generated/cache, voice/audio/speech/dictation path residue and secret-like residue.

Required evidence:

1. Structural check confirming no `_paseo` paths remain under `packages/`.
2. Package list check confirming exactly the 10 formal packages remain.
3. Check confirming no `packages/highlight` workspace package was created.
4. Check confirming `packages/tui` remains skeleton-only.
5. Node JSON and package identity checks for root, formal packages and nested `packages/app/highlight`.
6. `npm install --package-lock-only --ignore-scripts`.
7. Raw cache ignore check.
8. Generated/cache path scan.
9. Voice/audio/speech/dictation path and package/config/script residue scan.
10. Old internal package-name scan.
11. Large-file and secret-like scan.
12. `git diff --check`.

Evidence:

1. `_paseo` path check reported `0`.
2. Formal package list check reported exactly: `app`, `cli`, `client`, `core`, `daemon`, `desktop`, `drivers`, `protocol`, `relay`, `tui`.
3. `packages/highlight` absence check reported `packages/highlight absent`.
4. `packages/tui` file check reported only `README.md`, `package.json`, `src/.gitkeep` and `tests/README.md`.
5. Node package identity check reported `formal package identity ok`.
6. JSON parse check reported `json ok 12` for root package metadata, 10 formal package metadata files and nested `packages/app/highlight/package.json`.
7. `npm install --package-lock-only --ignore-scripts` completed: `up to date, audited 2189 packages in 10s`; it reported `40 vulnerabilities (4 low, 28 moderate, 8 high)`, which is recorded as follow-up triage input and was not fixed in this round.
8. Raw cache ignore check reported `.gitignore:25:.agent-os/upstreams/` for `.agent-os/upstreams/paseo` and `.agent-os/upstreams/paseo/README.md`.
9. Generated/cache scan under `packages/` returned no paths matching `.git`, `node_modules`, `dist`, `build`, `.expo`, `.next`, `.wrangler` or `coverage`.
10. Path-level voice/audio/speech/dictation/TTS/STT/PCM/WAV scan under `packages/` returned no paths.
11. Package/config/script voice residue scan over root/package metadata, app config, daemon README, daemon CLAUDE and daemon scripts returned no matches.
12. Old internal package-name scan for `@thoth/server` returned no matches.
13. Large-file scan found no package files over `5MB`.
14. Secret-like scan found no `ghp_`, real-looking `sk-...` token or private-key block in staged source candidates.
15. `git diff --check` passed.

Current result:

The promoted source structure is verified as the formal implementation substrate. This evidence does not claim that any package builds, typechecks, launches or implements the Thoth MVP behavior.

### `NTH-EV-004` First-Day Development Infrastructure Verification

Status: `passed`

Scope:

1. Stable install and root-script command surface.
2. Foundation package build/typecheck/test gate.
3. Repository structure, metadata, AGENTS/CLAUDE link, install policy and hygiene validation.
4. Local Android Debug APK packaging.
5. Linux-safe iOS packaging scripts.
6. Development, testing, packaging and release documentation.

Required evidence:

1. `npm install`.
2. `npm run validate:repo`.
3. `npm run format:check`.
4. `npm run lint:foundation`.
5. `npm run build:foundation`.
6. `npm run typecheck:foundation`.
7. `npm run test:foundation`.
8. `npm run check:foundation`.
9. `npm run doctor:android`.
10. `npm run setup:android-toolchain`.
11. `npm run package:android:debug-apk`.
12. `npm run package:ios:prebuild`.
13. `npm run package:ios:build` on Linux, expecting a clear macOS/Xcode-only message and exit code `1`.
14. AGENTS/CLAUDE symlink coverage for root and all 10 packages.
15. Generated/raw path hygiene checks and `git diff --check`.

Evidence:

1. Root `.npmrc` now sets `ignore-scripts=true`, `audit=false` and `fund=false`; after removing the unused local `eas-cli` devDependency, plain `npm install` completed with `up to date in 4s`.
2. Lockfile scan confirmed `node_modules/eas-cli` and `node_modules/dtrace-provider` are absent from `package-lock.json`; `npm ls dtrace-provider --all` reported `(empty)`.
3. `npm run validate:repo` passed and reported `THOTH_REPO_VALIDATION_OK`, including package boundary, package metadata, AGENTS/CLAUDE links, docs, npm install policy, generated/raw path hygiene, package/config voice residue and secret-like scan.
4. `npm run format:check` passed: `All matched files use the correct format`.
5. `npm run lint:foundation` passed: `Found 0 warnings and 0 errors`.
6. `npm run build:foundation` passed for `packages/app/highlight`, `packages/relay`, `packages/protocol` and `packages/client`.
7. `npm run typecheck:foundation` passed with `tsc --noEmit` for the same four foundation packages.
8. `npm run test:foundation` passed:
   - `packages/app/highlight`: 4 files, 66 tests passed.
   - `packages/relay`: 4 files, 25 tests passed.
   - `packages/protocol`: 32 files, 286 tests passed.
   - `packages/client`: 4 files, 110 tests passed.
9. `npm run check:foundation` passed end-to-end through validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests.
10. `npm run doctor:android` passed after setup and reported `THOTH_ANDROID_DOCTOR_OK`, with project JDK at `.dev/jdk-17` and Android SDK at `.dev/android-sdk`.
11. `npm run setup:android-toolchain` completed and reported `THOTH_ANDROID_TOOLCHAIN_READY`.
12. `npm run package:android:debug-apk` completed and reported `THOTH_ANDROID_DEBUG_APK_OK`.
13. Android APK receipt:
    - Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/app/android/app/build/outputs/apk/debug/app-debug.apk`
    - sha256: `1a3cde6a8c2eab458683a5255291ed03ca6db1aaca1ab0d6dbbb39626fd8e540`
    - Bytes: `302693683`
    - Receipt: ignored `.agent-os/artifacts/android-debug-apk.json`
14. `npm run package:ios:prebuild` on Linux reported `THOTH_IOS_PREBUILD_SKIPPED: iOS prebuild requires macOS with Xcode. Current platform is linux.` and exited `0`.
15. `npm run package:ios:build` on Linux reported `THOTH_IOS_BUILD_SKIPPED: iOS build requires macOS with Xcode. Current platform is linux.` and exited `1`, as expected.
16. Root and all 10 package `CLAUDE.md` links point to their local `AGENTS.md`.
17. Generated/raw path checks confirmed no tracked `.dev/`, `.agent-os/upstreams/`, `.agent-os/artifacts/`, `packages/app/android/`, `packages/app/ios/` or `_paseo` paths.
18. The app config microphone/audio permission residue was removed, and package/config voice residue scan now passes.
19. `git diff --check` passed.

Current result:

The first-day development infrastructure is verified. This evidence proves the foundation gate and local packaging infrastructure, not any Thoth MVP product behavior.

### `NTH-EV-005` Relay V3 Security And Local Preview Verification

Status: `partial`

Scope:

1. Replace unauthenticated relay behavior with v3-only room registration and role-scoped token authorization.
2. Update protocol, client, daemon and app pairing paths for v3 connection offers, pairing tokens and device tokens.
3. Replace old relay/app defaults with `seeles.ai` domains.
4. Build and serve the real web app preview locally.
5. Prepare Code4Agent mirror export for hosted relay deployment.
6. Validate relay behavior through tests, local E2E and local load test.
7. Attempt hosted Code4Agent preview deployment or record exact blocker.

Evidence:

1. `npm run build:web` passed and exported `packages/app/dist` through the real Expo app build. Local static preview is served at `http://127.0.0.1:4173`; `curl http://127.0.0.1:4173/` returned HTTP `200` and HTML title `Thoth`.
2. `packages/app/dist` size check reported `12M`.
3. Domain cleanup scan returned no matches for `relay.thoth.sh`, `app.thoth.sh`, `relay.paseo`, `app.paseo` or `paseo.sh` outside ignored upstreams and generated web dist.
4. `npm run test:relay` passed: 4 files, 29 tests.
5. `npm run typecheck:relay` passed.
6. `npm run build:relay` passed.
7. `npm run test:protocol` passed: 32 files, 286 tests.
8. `npm run typecheck:protocol` passed.
9. `npm run build:protocol` passed.
10. `npm run typecheck:client` passed.
11. `npm run build:client` passed.
12. `npm run test:client` passed: 4 files, 110 tests.
13. `npm --workspace=@thoth/relay run test:e2e` passed after updating the e2e tests to v3: 1 file, 3 tests.
14. Local relay load smoke passed with 5 clients / 5 seconds / 1 second interval: 25 attempted pings, 25 pongs, error rate `0`, p95 `4ms`; receipt `/mnt/cfs/5vr0p6/yzy/thoth/.dev/relay-load-test-1782889165157.json`.
15. Local relay load test passed with 200 clients / 10 minutes / 5 second interval: 24000 attempted pings, 24000 pongs, failures `0`, error rate `0`, p50 `18ms`, p95 `24ms`, p99 `31ms`; receipt `/mnt/cfs/5vr0p6/yzy/thoth/.dev/relay-load-test-1782889793822.json`.
16. `npm run sync:code4agent-relay -- .dev/code4agent-thoth-relay-export` generated a Code4Agent-style `apps/thoth-relay` mirror under ignored `.dev/`.
17. Code4Agent dry-run using current remote `packages/config/apps.yml` and `.github/workflows/_deploy-isolated.yml` showed the mirror script can add `thoth-relay` to app registry and emits `CODE4AGENT_WORKFLOW_REQUIRED.md` because `_deploy-isolated.yml` hard-codes per-app jobs.
18. `npm --silent run gh -- api user --jq .login` confirmed the repo-local authenticated identity.
19. `npm --silent run gh -- repo view SeeleAI/Code4Agent --json nameWithOwner,defaultBranchRef,isPrivate,viewerPermission,url` reported private repo access, default branch `master` and `viewerPermission=WRITE`.
20. Code4Agent ruleset query reported active `protected-paths` push ruleset restricting `.github/**/*`, `scripts/**/*`, `docs/**/*`, `AGENTS.md`, `**/AGENTS.md`, `packages/presets/**/*` and `**/*/wrangler.jsonc`.

Current result:

Relay security and local validation are verified. Hosted Code4Agent preview deployment was blocked before push by repository governance: adding `apps/thoth-relay/wrangler.jsonc` and updating `.github/workflows/_deploy-isolated.yml` both hit active protected paths. This Code4Agent path is now historical and superseded by independent repository `SeeleAI/Thoth-Relay`; see `NTH-EV-006` for the hosted test relay and runtime isolation evidence.

### `NTH-EV-006` Thoth/Paseo Runtime Isolation Verification

Status: `passed`

Scope:

1. Keep the existing local Paseo daemon running on `127.0.0.1:6767`.
2. Run Thoth daemon independently on `127.0.0.1:6688`.
3. Serve the real web app review entry on local `8082` and current public mapping `8148`.
4. Deploy and validate the independent test relay service at `relay.test.thoth.seeles.ai`.
5. Produce and smoke the Linux AppImage without using Paseo or the live user daemon.
6. Produce Android Debug APK with Thoth package identity and no microphone permission.
7. Verify Codex provider smoke through the Thoth provider path.
8. Re-run repository foundation and hygiene checks.

Evidence:

1. Port isolation check:
   - `Paseo\x20` PID `1567463` listens on `127.0.0.1:6767`.
   - `Thoth\x20` PID `1529981` listens on `127.0.0.1:6688`.
   - Web static server PID `1211974` listens on `*:8082`.
2. Thoth daemon health:
   - `GET http://127.0.0.1:6688/api/health` returned `{"status":"ok"}`.
   - `GET http://127.0.0.1:6688/api/status` returned listen `127.0.0.1:6688`.
3. CLI status through the Thoth dev profile reported:
   - `localDaemon: "running"`
   - `connectedDaemon: "reachable"`
   - `home: "/mnt/cfs/5vr0p6/yzy/thoth/.dev/thoth-runtime/home"`
   - `listen: "127.0.0.1:6688"`
   - providers include `Claude`, `Codex` and `mock`.
4. Web checks:
   - `npm run build:web` passed.
   - `curl -I http://127.0.0.1:8082/` returned HTTP `200`.
   - `curl -I http://180.76.242.105:8148/` returned HTTP `200`.
   - Playwright smoke rendered the real app UI with no page errors and no `6767` console attempt. Local route showed workspace UI; public route showed Welcome / Direct connection / Paste pairing link / Settings.
5. Relay deployment:
   - Independent repo `SeeleAI/Thoth-Relay` latest pushed commit: `317bcda46571ae0ae508f4d892759eff779d9d73`.
   - GitHub Actions run `28537212728` completed with conclusion `success`.
   - Workflow URL: `https://github.com/SeeleAI/Thoth-Relay/actions/runs/28537212728`.
   - `GET https://relay.test.thoth.seeles.ai/health` returned `{"status":"ok","protocol":"3","service":"thoth-relay"}`.
6. Relay live load test:
   - Receipt: `/mnt/cfs/5vr0p6/yzy/Thoth-Relay/.dev/relay-live-load-test-1782929276055.json`.
   - Clients: `200`.
   - Duration: `600000ms`.
   - Interval: `5000ms`.
   - Connected clients: `200`.
   - Attempted pings: `23972`.
   - Pongs: `23954`.
   - Failures: `18`.
   - Error rate: `0.0007508760220256966`.
   - Latency: p50 `394ms`, p95 `427ms`, p99 `765ms`.
   - Reconnects: `114`.
7. Desktop AppImage:
   - Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/desktop/release/Thoth-x86_64.AppImage`.
   - sha256: `6fc25b0f92cf930b5f7e43d6eb11de8a466cc54f881e8fcbb832f288acd1fd43`.
   - Bytes: `131375945`.
   - Packaged smoke passed with desktop-managed daemon PID `1561097` listening on isolated temp port `127.0.0.1:38579`; CLI shim daemon status and terminal smoke succeeded.
8. Android Debug APK:
   - Path: `/mnt/cfs/5vr0p6/yzy/thoth/packages/app/android/app/build/outputs/apk/debug/app-debug.apk`.
   - sha256: `9579e3cb43637b6380faf2890eb496d43d7a7cc9779c787afdf16f9d98a70fa0`.
   - Bytes: `302700513`.
   - Package id: `sh.thoth.debug`.
   - `aapt dump permissions` did not include `android.permission.RECORD_AUDIO`.
9. Codex provider smoke:
   - `npm --workspace=@thoth/daemon run test:unit -- src/server/agent/providers/codex/app-server-transport.test.ts src/server/agent/providers/codex-app-server-agent.test.ts` passed: 2 files, 79 tests.
   - Debug targeted local e2e `npm --workspace=@thoth/daemon exec -- vitest run src/server/agent/providers/codex-app-server-agent.local.e2e.test.ts` passed: 1 file, 1 test.
   - Broader provider local e2e command hit an unrelated missing `opencode` binary and is not counted as an isolation failure.
10. CLI boundary checks:
    - CLI speech command exposure was removed.
    - Voice onboarding is fixed to disabled and does not prompt for enablement.
    - `npm --workspace=@thoth/cli run typecheck` passed.
    - `npm --workspace=@thoth/cli exec -- tsx tests/17-onboard.test.ts` passed.
11. Repository checks:
    - `npm run check:foundation` passed.
    - `npm --workspace=@thoth/cli exec -- vitest run src/commands/daemon/local-daemon.supervision.test.ts` passed: 1 file, 7 tests.
    - `npm --workspace=@thoth/desktop run test -- src/daemon/daemon-manager.test.ts src/daemon/desktop-packaging.test.ts src/daemon/node-entrypoint-runner.test.ts src/daemon/node-entrypoint-launcher.test.ts` passed: 4 files, 19 tests.
    - `npm run smoke:isolation` passed.
    - `git diff --check` passed.

Current result:

Thoth services can now run in parallel with the user's local Paseo daemon. This evidence proves development/runtime isolation and packaging/smoke readiness, not the Thoth MVP task workflow.

### `NTH-EV-007` Web Workspace White-Screen Regression Verification

Status: `passed`

Scope:

1. Reproduce the web app blank page after workspace navigation.
2. Identify the concrete browser runtime exception.
3. Fix the web bundle without changing product flow or mocking the review UI.
4. Rebuild the real web export and verify local/public review entry behavior.

Evidence:

1. Playwright reproduced the blank page after clicking workspace `Greeting` and captured `TypeError: (...).channel is not a function`.
2. The crashing import path was traced to the xterm ligatures addon pulling a browser-incompatible `diagnostics_channel.channel()` path through `lru-cache`.
3. `packages/app` now aliases `@xterm/addon-ligatures` to a no-op production web stub for Metro web export and terminal webview esbuild output.
4. `npm run build:web` passed and produced `packages/app/dist/_expo/static/js/web/index-82dc0d5713cdea0252baa9435ac46581.js`.
5. Static scans confirmed the new web bundle and generated terminal webview HTML do not contain `diagnostics_channel`, `hasSubscribers&&` or the real ligatures addon markers.
6. Playwright local smoke clicked workspace `Greeting` and reached `/h/srv_Qd3ONVF7rQEHNW2PJTTBxA/workspace/wks_fe7ac40e0f64e5bb` with the composer visible and `PAGE_ERRORS []`.
7. Playwright local smoke submitted `hi`; the page stayed on the workspace route with `PAGE_ERRORS []` and surfaced the current expected `Select model` validation instead of crashing.
8. `curl` confirmed both `http://127.0.0.1:8082/open-project` and `http://180.76.242.105:8148/open-project` serve the new hashed web bundle.
9. Public fresh-browser Playwright loaded `http://180.76.242.105:8148/open-project` with `PAGE_ERRORS []`; it showed `No projects yet` because the fresh origin had no paired host registry.
10. `npm --workspace=@thoth/app run test -- --project unit src/terminal/runtime/terminal-emulator-runtime.test.ts` passed with 17 tests.
11. `npm run format:check` and `git diff --check` passed.

Current result:

The web workspace route no longer white-screens on navigation or `hi` submission. The next visible product-path issue is provider/model selection for actual message execution, not a browser crash.

### `NTH-EV-008` One Thoth Web Shell Icon Surface Verification

Status: `passed-for-slice`

Scope:

1. Use the locked transparent `05-arcade-inventory` PNG icon set as a real app asset surface.
2. Move the Web/Desktop shared entry shell toward One Thoth / task-control-plane product language.
3. Preserve existing real Add project, Import session, Provider setup and Pair device flows.
4. Keep backend-unimplemented states honest rather than showing fake task/provider/evidence success.
5. Ensure `build:web`, foundation gate and formatting hygiene remain green for this slice.

Evidence:

1. `packages/app/src/components/icons/thoth-inventory-icon.tsx` now provides a single typed registry for the locked package-local PNG assets.
2. `packages/app/src/components/icons/thoth-logo.tsx` now renders the `brand-mark` inventory PNG instead of the old vector mark.
3. `packages/app/src/screens/open-project-screen.tsx` now renders One Thoth / Task control plane copy plus honest status chips:
   - Workspace: `Needs a registered workspace`
   - Provider: `Select a model first`
   - Relay: `Fresh pairing supported`
   - Review: `Preview surface`
4. `packages/app/src/components/left-sidebar.tsx` uses inventory PNGs for Add workspace, Home, Settings and the Workspace section label.
5. `packages/app/src/screens/settings-screen.tsx` uses inventory PNGs for General, Appearance, Diagnostics, About, Connections, Agents/Tasks, Workspaces, Providers, Host and Projects navigation/detail headers where package-local icons exist.
6. `packages/app/scripts/build-terminal-webview-html.mjs` now formats its generated `terminal-emulator-webview-html.ts` output with `oxfmt`, keeping `build:web` and `format:check` compatible.
7. `npm run build:web` passed and exported `packages/app/dist/_expo/static/js/web/index-199f42bfb01d2ed5ca71875d38711970.js`; Expo export listed the arcade-inventory PNG assets in the web bundle.
8. Static bundle scan found `Task control plane`, `One Thoth`, `Needs a registered workspace`, `Fresh pairing supported` and `Preview surface` in the exported web bundle.
9. Playwright desktop-width smoke against `http://127.0.0.1:8092/open-project` at `1440x960` found the One Thoth entry text and had no React page errors.
10. Playwright mobile-width smoke against `http://localhost:8092/open-project` at `390x844` found the One Thoth entry text and exact `Provider` status, with no React page errors.
11. The temporary-origin Playwright runs logged local daemon WebSocket `403` console errors because the smoke used `8092` rather than the formal `8082 -> 8148` dogfood origin/daemon pairing path; no white screen or page exception occurred.
12. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests.
13. `npm run format:check` passed after `build:web`.
14. `git diff --check` passed.

Current result:

The real Web/Desktop shared shell now visibly presents Thoth as One Thoth / task control plane and consumes the locked transparent PNG icon set in first-viewport and navigation surfaces. This evidence does not prove the complete multi-endpoint UI productization goal: OpenTUI, final Workspace composer/task/evidence slots, desktop packaged smoke, full Playwright/PTTY stress matrix and scorecard remain unfinished.

### `NTH-EV-009` Workspace Composer And Task Surface Slice Verification

Status: `passed-for-slice`

Scope:

1. Add the fixed Thoth composer control surface for `+`, Provider, Mode, Clarify and Loop without changing provider execution semantics.
2. Keep Loop/Clarify/backend-unimplemented behavior honest as preview or needs-provider state.
3. Add Workspace task-control-plane slots for active task, frozen contract and evidence/review preview.
4. Align MVP file upload limit with the locked `<10MB` attachment rule.
5. Verify the real web export, foundation gate, formatting and smoke checks for this UI slice.

Evidence:

1. Added `packages/app/src/composer/thoth-composer-controls.tsx` with a shared Thoth composer rail:
   - `+`: `Images/files <10MB`
   - `Provider`: `Select model first` until an existing provider/model selection is present
   - `Mode`: local `Quick` / `Loop` UI selection
   - `Clarify`: local cycle through `Auto`, `Don't Ask`, `Light`, `Balanced`, `Dive Dive Dive`
   - `Loop`: disabled in Quick as `Off in Quick`, enabled in Loop with `Auto`, `Single Pass`, `Light`, `Balanced`, `Try Try Try`
2. `packages/app/src/composer/index.tsx` now renders the Thoth rail above the existing message input and derives provider readiness from the existing real agent/draft provider and model state. It does not create task authority, call a hidden model API or bypass existing provider submission.
3. The existing file upload guard in `packages/app/src/composer/index.tsx` now rejects files over `10MB`, matching the current MVP attachment rule surfaced in the composer.
4. `packages/app/src/composer/draft/workspace-tab.tsx` now renders a Workspace preview surface for draft tabs with:
   - Workspace status: `Registered` or `Needs workspace`
   - Provider status: selected provider or `Select model first`
   - Host status: `Connected` or `Offline`
   - Loop status: `Preview`
   - Active task: `No frozen task yet`
   - Contract: `Needs Clarify session`
   - Evidence: `Review receipts will land here`
5. `npm run build:web` passed and exported `packages/app/dist/_expo/static/js/web/index-9b372b8af504495884b37da2d845671e.js`.
6. Static web bundle scan found the new composer/workspace markers in the latest export, including `Images/files <10MB`, `thoth-composer-controls`, `workspace-thoth-surface-preview` and `Loop task runtime preview`.
7. Playwright desktop-width smoke against temporary `http://127.0.0.1:8093/open-project` at `1440x960` found `ONE THOTH` / `One Thoth`, `Task control plane`, `Provider` and `Fresh pairing supported`, with page errors `[]`.
8. Playwright mobile-width smoke against temporary `http://127.0.0.1:8093/open-project` at `390x844` found `ONE THOTH` / `One Thoth`, `Task control plane`, `Provider` and `Fresh pairing supported`, with page errors `[]`.
9. The temporary `8093` static server was stopped after smoke; `lsof -tiTCP:8093 -sTCP:LISTEN` returned no listener afterward.
10. `npm run format:check` passed after the final `build:web`.
11. `git diff --check` passed.
12. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

The real Web/Desktop app bundle now contains the next Workspace UI slice: fixed Thoth-level composer controls, honest provider/loop readiness states, Workspace task/contract/evidence preview slots and the MVP `10MB` attachment limit. This does not implement provider-backed Router, Clarify runtime, contract freeze, PlanExec, Review or OpenTUI.

### `NTH-EV-010` OpenTUI Shell Surface Foundation Verification

Status: `passed-for-slice`

Scope:

1. Move `packages/tui` from skeleton-only toward the first real OpenTUI shell implementation slice.
2. Keep TUI state derived from shared daemon/client/protocol shapes instead of adding separate task authority.
3. Add a guarded native OpenTUI renderer factory without pretending the locked Node `24.14.0` toolchain can run the native renderer.
4. Verify TUI unit tests, typecheck, build, formatting, diff hygiene and the current foundation gate.

Evidence:

1. `packages/tui/package.json` now declares real package exports, build/typecheck/test scripts, `@thoth/client` and `@opentui/core@0.4.2`.
2. `packages/tui/src/surface.ts` derives the One Thoth TUI surface model from `ConnectionState`, `ThothWorkspace`, `ThothAgent` and provider snapshot types exported through `@thoth/client`.
3. The derived surface covers Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About slots with honest `ready`, `needs-action`, `preview`, `running` and `unavailable` states.
4. `packages/tui/src/runtime.ts` records the current runtime guard: Bun can be accepted for renderer creation, while Node renderer creation requires Node `26.3.0+` and `--experimental-ffi`.
5. `packages/tui/src/opentui-renderer.ts` dynamically imports `@opentui/core` only after the runtime guard passes, so the current Node `24.14.0` path fails before native renderer creation.
6. `packages/tui/README.md` and `packages/tui/tests/README.md` now state the real current status: first non-rendering OpenTUI shell slice exists, native renderer tests remain deferred until the Node FFI vs Bun spike is explicitly resolved.
7. `npm install --package-lock-only` passed; `npm install` passed and added the local OpenTUI dependency under the repository install policy.
8. `npm run test --workspace=@thoth/tui` passed: 2 files, 9 tests.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. Runtime guard smoke with `node -e "import('./packages/tui/dist/runtime.js')..."` returned `available: false`, `runtime: node`, `reason: node_version_too_old`, `currentVersion: 24.14.0`, `minimumNodeVersion: 26.3.0`.
12. `npm run format:check` passed.
13. `git diff --check` passed.
14. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

`packages/tui` now has the first shared-state OpenTUI shell foundation and a truthful native renderer guard. This does not complete the interactive TUI app, renderer/input smoke, Node FFI vs Bun runtime decision, task backend, Clarify runtime, contract freeze, PlanExec or Review.

### `NTH-EV-011` OpenTUI Renderer Smoke Verification

Status: `passed-for-slice`

Scope:

1. Run the first OpenTUI runtime spike for `packages/tui`.
2. Choose a reproducible native renderer smoke path that does not change the repository's locked Node `24.14.0` developer toolchain.
3. Render the actual One Thoth TUI surface model through OpenTUI, not a hello-world-only check.
4. Verify default, narrow and wide terminal character frames.

Evidence:

1. Node `24.14.0` can import `@opentui/core` and `@opentui/core/testing`, but `createTestRenderer()` fails with `OpenTUI native FFI is not available for this runtime yet`.
2. `npm view bun@1.3.14` showed a package with `bun`/`bunx` bins, but `npm exec --package=bun@1.3.14 -- bun --version` failed because the package requires a postinstall script and the repository install policy uses `ignore-scripts=true`.
3. `npm pack @oven/bun-linux-x64@1.3.14 --dry-run --json` showed the package contains `bin/bun`, but `npm exec --package=@oven/bun-linux-x64@1.3.14 -- bun --version` did not expose `bun` on PATH.
4. `npm exec --package=node@26.4.0 -- node --version` still resolved to the current Node `24.14.0`, so the generic `node` package was not a valid spike path.
5. `npm pack node-linux-x64@26.4.0 --dry-run --json` showed a Linux x64 Node package containing `bin/node`.
6. `npm exec --package=node-linux-x64@26.4.0 -- node --version` returned `v26.4.0`.
7. Manual spike with `npm exec --package=node-linux-x64@26.4.0 -- node --experimental-ffi -e ...createTestRenderer...` created an OpenTUI test renderer and captured `One Thoth TUI smoke`.
8. Added `packages/tui/src/render.ts` to mount the existing `TuiSurfaceModel` through OpenTUI and added `packages/tui/src/render.test.ts` for pure surface-line formatting.
9. Added root `npm run smoke:tui:renderer`, which runs `npm run build --workspace=@thoth/tui` then `npm exec --yes --package=node-linux-x64@26.4.0 -- node --experimental-ffi scripts/smoke-opentui-renderer.mjs`.
10. Default `npm run smoke:tui:renderer` passed and captured a `96x34` split surface with `One Thoth - OpenTUI split surface`, `Needs a registered workspace`, `Select model first`, `Fresh pairing supported`, `Evidence / Review`, `+ Images/files <10MB | Provider | Mode Quick/Loop | Clarify | Loop`, and `Authority: daemon/client/protocol state only`.
11. Narrow `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer` passed and captured a compact surface.
12. Wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer` passed and captured a split surface.
13. `npm run test --workspace=@thoth/tui` passed: 3 files, 10 tests.
14. `npm run typecheck --workspace=@thoth/tui` passed.
15. `npm run build --workspace=@thoth/tui` passed.
16. `npm run format:check` passed.
17. `git diff --check` passed.
18. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

The OpenTUI renderer runtime spike now has a reproducible root-script path using pinned `node-linux-x64@26.4.0` plus experimental FFI. Bun is not selected for the current repo-local smoke path. This proves renderer creation and character-frame capture for the One Thoth surface, not the complete interactive CLI workspace TUI, daemon-connected TUI state, focus/input loops or final TUI scorecard.

### `NTH-EV-012` OpenTUI Interaction Navigation Slice Verification

Status: `passed-for-slice`

Scope:

1. Add a testable OpenTUI interaction state layer for focus, route navigation, route history and explicit composer controls.
2. Keep interaction state limited to UI focus/control presentation; do not create fake task authority, fake daemon state or fake backend behavior.
3. Render active route, focus, state notices, composer values and authority guard text through the existing OpenTUI render path.
4. Add a root navigation smoke that simulates deterministic interaction actions and captures an OpenTUI character frame under the pinned Node FFI renderer path.
5. Verify default, compact and wide terminal frames.

Evidence:

1. Added `packages/tui/src/interaction.ts` with `createInitialTuiInteractionState`, `applyTuiInteractionAction`, focus order, route open/back behavior, Mode/Clarify/Loop cycling, Quick-mode Loop disablement and user-facing interaction hints.
2. Added `packages/tui/src/interaction.test.ts`; `npm run test --workspace=@thoth/tui` passed with 4 files and 16 tests.
3. Updated `packages/tui/src/render.ts` so the frame shows route, focus, state notice, authority guard, focused/active navigation markers and composer control values while retaining the original surface model input.
4. Added root `npm run smoke:tui:navigation`, which runs `npm run build --workspace=@thoth/tui` and then `npm exec --yes --package=node-linux-x64@26.4.0 -- node --experimental-ffi scripts/smoke-opentui-navigation.mjs`.
5. Default `npm run smoke:tui:renderer` passed at `96x34` and captured the updated Home frame with `Route: Home`, `Focus: Home`, `State: One Thoth overview`, `Loop: Off in Quick` and `Authority: daemon/client/protocol state only`.
6. Default `npm run smoke:tui:navigation` passed at `96x34` and captured `Route: Evidence / Review (Preview)`, `Focus: Loop`, `State: Evidence and review receipts are preview-only`, `Mode: Loop`, `Loop: One Plan, One Do` and the authority guard.
7. Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` passed and captured the compact frame.
8. Wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` passed and captured the split frame.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. `npm run format:check` passed.
12. `git diff --check` passed.
13. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

`packages/tui` now has a deterministic interaction/navigation model and an OpenTUI navigation smoke that proves the renderer can display simulated focus, route and composer-control state. This still does not complete a live interactive CLI TUI, daemon-connected workspace state, native keypress loop, task backend, Clarify runtime, contract freeze, PlanExec or Review.

### `NTH-EV-013` OpenTUI CLI Dogfood Entry Verification

Status: `passed-for-slice`

Scope:

1. Add a real top-level `thoth tui` command rather than a detached TUI smoke script.
2. Build the TUI surface from the same daemon/client/protocol state used by other CLI commands.
3. From the current `pwd`, choose the matching registered workspace, preferring the most specific workspace root when parent and child workspaces both match.
4. Keep Node `24.14.0` behavior truthful: the live native renderer is unavailable without Node `26.3.0+` and `--experimental-ffi`.
5. Verify a daemon-connected OpenTUI CLI smoke against Thoth `127.0.0.1:6688` without touching Paseo `127.0.0.1:6767`.

Evidence:

1. Added `packages/cli/src/commands/tui.ts` and registered top-level `thoth tui` in `packages/cli/src/cli.ts`.
2. `thoth tui` connects through existing CLI daemon utilities, fetches real `fetchWorkspaces`, `fetchAgents` and `getProvidersSnapshot` data, then mounts the shared `@thoth/tui` OpenTUI surface. If the daemon cannot be reached, it renders a disconnected/needs-host surface rather than fake connected state.
3. `packages/tui/src/surface.ts` now treats `cwd` descendants as workspace matches and chooses the most specific registered workspace root. `packages/tui/src/surface.test.ts` covers descendant and parent/child specificity cases.
4. Added `packages/tui/src/keyboard.ts` and live `mountTuiSurface(...).handleKey(...)` support so Tab/arrows, Enter, Esc, `M`, `C`, `L`, `Q` and Ctrl+C map to deterministic interaction actions or exit.
5. Added root `npm run smoke:tui:cli`, which builds `@thoth/tui`, builds CLI/daemon/client dependencies, then runs the real CLI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi`.
6. Node `24.14.0` direct command check returned the truthful runtime error: OpenTUI native renderer is disabled for Node `24.14.0` and needs Node `26.3.0+` with experimental FFI.
7. `npm run smoke:tui:cli` passed against `127.0.0.1:6688`, capturing `One Thoth - OpenTUI split surface`, `Route: Workspace (Ready)`, `Host: Connected`, `Workspace: yzy`, `Provider: Provider available`, `Relay: Fresh pairing supported`, composer controls, task/evidence preview slots and the authority guard. The smoke asserts that `127.0.0.1:6767` / `localhost:6767` do not appear.
8. Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed.
9. Wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed.
10. `npm run test --workspace=@thoth/tui` passed with 5 files and 21 tests.
11. `npm run typecheck --workspace=@thoth/tui` passed.
12. `npm --workspace=@thoth/cli run typecheck` passed.
13. `npm --workspace=@thoth/cli run build` passed.
14. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and the PIDs differed.
15. `npm run smoke:tui:renderer` and `npm run smoke:tui:navigation` passed after the CLI changes.
16. `npm run format:check` passed.
17. `git diff --check` passed.
18. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a real CLI dogfood entry that uses daemon/client/protocol authority and can render the current workspace from `pwd` under the pinned Node 26 FFI path. This still does not complete the final OpenTUI product: deeper onboarding flows, live daemon refresh, richer error recovery, task backend, Clarify runtime, contract freeze, PlanExec, Review and the full UI review scorecard remain incomplete.

### `NTH-EV-014` OpenTUI Live Refresh And Recovery Verification

Status: `passed-for-slice`

Scope:

1. Add a discoverable refresh action to the live OpenTUI CLI entry without creating TUI-only daemon, workspace, provider or task truth.
2. Re-fetch real daemon workspaces, agents and provider snapshots from the CLI/client layer when the user presses `R` or when a smoke test requests refresh.
3. Show honest `Snapshot` / last-updated state in the TUI frame.
4. Keep disconnected recovery inside the TUI surface instead of exiting, crashing or pretending to be connected.
5. Avoid leaking relay pairing tokens, URL `offer=` values, password query values or legacy `6767` fallback text in CLI TUI frames.

Evidence:

1. `packages/tui/src/surface.ts` now accepts an optional refresh input and derives a `Snapshot` status chip plus `refresh` state from it. The state is still input-derived and does not create durable authority in `packages/tui`.
2. `packages/tui/src/keyboard.ts` maps `R` to a refresh intent. Existing Tab/arrows, Enter, Esc, `M`, `C`, `L`, `Q` and Ctrl+C behavior remains deterministic UI interaction.
3. `packages/tui/src/render.ts` now lets the live mount replace its current `TuiSurfaceModel`, renders `R refresh` in the key hints, and shows recovery text when the host is unavailable or a refresh fails.
4. `packages/cli/src/commands/tui.ts` handles refresh in the CLI layer by calling the same real daemon-loading path used on startup: `fetchWorkspaces`, `fetchAgents` and `getProvidersSnapshot`. Refresh updates the mounted OpenTUI surface rather than writing a mock file or using a fake backend.
5. `packages/cli/src/commands/tui.ts` redacts sensitive host material for TUI recovery text: relay pairing offers are described as relay pairing offers, URL `password=` is redacted, and error messages scrub `offer=` / `password=` fragments.
6. Added root `npm run smoke:tui:cli:recovery`, backed by `scripts/smoke-opentui-cli-recovery.sh`, which runs the real CLI OpenTUI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi` against an unreachable host and verifies the disconnected recovery frame.
7. `npm run test --workspace=@thoth/tui` passed with 5 files and 23 tests, including refresh state, recovery rendering and `R` key mapping coverage.
8. `npm run typecheck --workspace=@thoth/tui` passed.
9. `npm --workspace=@thoth/cli run typecheck` passed.
10. `npm run build --workspace=@thoth/tui` and `npm --workspace=@thoth/cli run build` passed.
11. `npm run smoke:tui:renderer` passed and still captured the One Thoth OpenTUI surface under the pinned Node 26 FFI renderer path.
12. `npm run smoke:tui:navigation` passed and still captured route/focus/composer interaction state.
13. `npm run smoke:tui:cli` passed against Thoth `127.0.0.1:6688`; the final frame included `State: Refreshed daemon snapshot`, `Snapshot: Updated ...`, `Host: Connected`, `Workspace: yzy`, provider readiness, task/evidence preview slots and `R refresh`.
14. Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed and captured the connected refresh frame in compact layout.
15. Wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed and captured the connected refresh frame in split layout.
16. `npm run smoke:tui:cli:recovery` passed; the final frame included `State: Refresh failed; recovery state shown`, `Snapshot: Refresh failed ...`, `Recovery: start Thoth daemon on 127.0.0.1:6688 or pair a fresh relay offer, then press R.`, `Workspace: Needs a registered workspace`, and no fake connected host state.
17. CLI smoke assertions now reject `127.0.0.1:6767`, `localhost:6767`, `offer=`, `pairingToken` and `thoth-relay-v3-client.` in final frames.
18. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and the PIDs differed.
19. `npm run format:check` passed.
20. `git diff --check` passed.
21. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a live CLI refresh/recovery slice: users can discover `R refresh`, the CLI re-fetches real daemon/client state, the TUI shows updated snapshot state, and disconnected hosts remain inside an honest recovery surface. This still does not complete final OpenTUI onboarding, in-TUI workspace registration, richer route detail panels, task backend, Clarify runtime, contract freeze, PlanExec, Review, long interactive PTY stress or the full UI review scorecard.

### `NTH-EV-015` OpenTUI Route Detail Panels Verification

Status: `passed-for-slice`

Scope:

1. Add route-specific detail panels for Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About.
2. Derive detail content only from existing TUI surface inputs: connection chip, daemon workspaces, provider snapshot, agents, refresh state, relay paired state and current `cwd`.
3. Keep the panels honest about unavailable or preview-only capabilities: no fake task authority, no fake Clarify/Loop backend, no fake Review validation and no hidden provider/API call.
4. Render the active route detail above the composer so the selected route has a product-like status explanation without pushing Mode/Loop out of compact 34-row frames.
5. Extend renderer, navigation, connected CLI and recovery CLI smokes to assert the detail panels.

Evidence:

1. Added `TuiDetailLine`, `TuiDetailSection` and `routeDetails: Record<TuiRouteId, TuiDetailSection>` to `packages/tui/src/surface.ts`.
2. `buildTuiSurfaceModel` now builds route details for Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About from input state; `packages/tui` still does not own durable task, provider, workspace or daemon authority.
3. `packages/tui/src/render.ts` now renders `Active Route Detail` for the current route before the composer. The default order is Header, Status, Active Route Detail, Composer, Navigation, Interaction and Task Control Plane.
4. `packages/tui/src/index.ts` exports the new detail-section types for consumers.
5. `packages/tui/src/surface.test.ts` covers provider, connection, review and settings detail values from real surface inputs.
6. `packages/tui/src/render.test.ts` covers Home detail rendering plus provider/settings route detail formatting.
7. `scripts/smoke-opentui-renderer.mjs` now verifies `Active Route Detail`, `One Thoth Home` and `Next step: Register/connect this workspace before task loops`.
8. `scripts/smoke-opentui-navigation.mjs` now verifies the Evidence / Review detail panel and `Independent Review backend unavailable`.
9. `scripts/smoke-opentui-cli.sh` now verifies connected Workspace detail: `Workspace Control: Current workspace selected from daemon state` and `Context/files: Workspace context preview; attachments stay <10MB`.
10. `scripts/smoke-opentui-cli-recovery.sh` now verifies disconnected Home detail: `One Thoth Home: Needs host` and the workspace registration next step.
11. `npm run test --workspace=@thoth/tui` passed with 5 files and 25 tests.
12. `npm run typecheck --workspace=@thoth/tui` passed.
13. `npm run build --workspace=@thoth/tui` passed.
14. `npm run smoke:tui:renderer` passed under pinned `node-linux-x64@26.4.0 --experimental-ffi`; the frame contained Home detail and the workspace registration next step.
15. `npm run smoke:tui:navigation` passed under pinned Node FFI; the frame contained Evidence / Review detail, Review receipt preview and the unavailable independent Review backend state.
16. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` passed; the compact frame still showed composer Mode and Loop after the detail panel.
17. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`; the final frame showed connected Workspace detail for workspace `yzy`.
18. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`; the final frame showed recovery state, Home detail and no fake connected state.
19. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed with connected Workspace detail.
20. `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed with connected Workspace detail.
21. `npm run format:check` passed.
22. `git diff --check` passed.
23. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI route detail panels now give each major route a richer, product-shaped status explanation while remaining derived from existing daemon/client/provider/agent/refresh inputs. This still does not complete final OpenTUI onboarding, in-TUI workspace registration, provider setup flows, task backend, Clarify runtime, Loop runtime, independent Review runtime, long interactive PTY stress or the full Web/Desktop/OpenTUI UI scorecard.

### `NTH-EV-016` OpenTUI Onboarding Next Actions And Workspace Registration Verification

Status: `passed-for-slice`

Scope:

1. Add an OpenTUI `Next Actions` surface derived from existing daemon/client state, not from fake local authority.
2. Make unregistered current `pwd` visible as an onboarding state instead of silently selecting an unrelated workspace.
3. Add a discoverable `W workspace` key path that registers the current `pwd` through the real daemon workspace RPC and then reloads the daemon snapshot.
4. Keep provider setup, relay/device pairing and recovery as honest next actions where backend/UI editing paths are not yet implemented in TUI.
5. Verify compact terminal layout keeps composer Mode/Loop visible after adding next actions.

Evidence:

1. `packages/tui/src/surface.ts` now adds `TuiNextAction` and `nextActions` to the surface model. Actions are derived from connection, workspace readiness, provider readiness, relay paired state, refresh state and current `cwd`.
2. `packages/tui/src/render.ts` now renders `Next Actions` after the composer, keeping Mode/Clarify/Loop visible before onboarding actions in default and compact frames.
3. `packages/tui/src/keyboard.ts` maps `W` to workspace registration, `P` to Providers and `D` to Connections / Devices while preserving existing Tab/arrows/Enter/Esc/R/M/C/L/Q behavior.
4. `packages/cli/src/commands/tui.ts` now handles `W` by calling the existing daemon `createWorkspace({ source: { kind: "directory", path: cwd } })` path, then reloading workspaces, agents and provider snapshots through the same client layer used by refresh.
5. The TUI workspace selector no longer falls back to the first registered workspace when the current `cwd` is not under any registered workspace. It now shows `Needs a registered workspace` and offers `W: Register workspace`.
6. Added `npm run smoke:tui:cli:workspace-register`, backed by `scripts/smoke-opentui-cli-workspace-register.sh`. The smoke starts TUI from a temporary directory, auto-triggers workspace registration, verifies `State: Registered workspace`, `Route: Workspace (Ready)`, the temporary path and the workspace detail panel, then archives the temporary workspace.
7. Temporary workspace cleanup check after the smoke reported `tmpWorkspaceCount: 0`.
8. `npm run test --workspace=@thoth/tui` passed with 5 files and 26 tests, including the unregistered-`cwd` regression.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. `npm --workspace=@thoth/cli run typecheck` passed.
12. `npm run smoke:tui:renderer` passed and showed `Next Actions`, `W: Register workspace`, `P: Provider setup`, composer Mode/Clarify/Loop and the existing authority guard.
13. `npm run smoke:tui:navigation` passed and showed composer Mode/Loop plus next actions in default `96x34`.
14. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`, showing connected Workspace detail and `D: Pair device`.
15. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`, showing recovery state without fake connected host state.
16. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` passed and kept composer Mode/Loop visible in compact layout.
17. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed against `127.0.0.1:6688`.
18. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and PIDs differed.
19. `npm run format:check` passed.
20. `git diff --check` passed.
21. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a real onboarding next-action surface and can register the current `pwd` as a workspace from inside `thoth tui` through daemon authority. This still does not complete provider setup editing inside TUI, relay pairing execution inside TUI, task backend, Clarify runtime, Loop runtime, independent Review runtime, long PTY stress or the full Web/Desktop/OpenTUI UI scorecard.

### `NTH-EV-017` OpenTUI Provider Readiness Action Verification

Status: `passed-for-slice`

Scope:

1. Turn `P providers` from a local-only route shortcut into a real provider readiness action handled by the CLI/client layer.
2. Refresh daemon provider snapshot state through existing provider authority, without adding TUI-owned provider configuration, fake auth checks, hidden LLM/API calls or a fake default model setting.
3. Keep the Providers route honest: show provider readiness/read-only setup state derived from daemon snapshots and tell users to select a model before task loops when no ready model exists.
4. Preserve existing workspace registration, recovery, renderer, navigation, connected CLI and isolation behavior.
5. Verify compact terminal layout still exposes both `W` and `P` next actions after shortening the workspace registration action copy.

Evidence:

1. `packages/tui/src/keyboard.ts` now maps `P` to a `providerSetup` intent instead of a pure `setRoute` action. The TUI package still does not call daemon/provider APIs directly.
2. `packages/tui/src/render.ts` now returns `providerSetup` from the mounted surface so the CLI layer can decide how to handle it.
3. `packages/cli/src/commands/tui.ts` now handles provider setup by opening the Providers route, calling the real daemon client `refreshProvidersSnapshot({ cwd })`, reloading the same surface input path used by refresh, and updating the frame with either `Provider readiness refreshed from daemon` or `Provider snapshot refreshed; select a model before task loops`.
4. Added `--provider-setup-after-render-ms` as a smoke-only automation option for the real `thoth tui` command.
5. Added root `npm run smoke:tui:cli:provider-setup`, backed by `scripts/smoke-opentui-cli-provider-setup.sh`. The smoke runs the real CLI OpenTUI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi`, triggers provider setup, verifies `Route: Providers (...)`, `State: Provider readiness refreshed from daemon` or provider snapshot refresh state, `Host: Connected`, Providers route detail and the authority guard.
6. Provider setup smoke assertions reject `fake configured`, `configured by TUI`, `TUI-only provider`, `127.0.0.1:6767`, `localhost:6767`, `offer=`, `pairingToken` and `thoth-relay-v3-client.` in final frames.
7. `packages/tui/src/surface.ts` now phrases the `P` next action as `Refresh provider readiness from daemon`, and shortens the `W` action to `Create daemon workspace for current pwd` so compact `72x34` frames keep both `W` and `P` visible.
8. `npm run test --workspace=@thoth/tui` passed with 5 files and 26 tests.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. `npm --workspace=@thoth/cli run typecheck` passed.
12. `npm run smoke:tui:cli:provider-setup` passed against real Thoth daemon `127.0.0.1:6688`, showing `Route: Providers (Available)`, `State: Provider readiness refreshed from daemon`, provider entries from daemon snapshot and the authority guard.
13. `npm run smoke:tui:renderer` passed at default `96x34`.
14. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer` passed and showed both `W: Register workspace - Create daemon workspace for current pwd` and `P: Provider setup - Refresh provider readiness from daemon`.
15. `npm run smoke:tui:navigation` passed.
16. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`.
17. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`.
18. `npm run smoke:tui:cli:workspace-register` passed; a post-smoke active workspace check reported `tmpWorkspaceCount: 0`.
19. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and the PIDs differed.
20. `npm run format:check` passed.
21. `git diff --check` passed.
22. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a real provider readiness action: pressing `P` refreshes provider state through daemon/client authority and lands users on the Providers route with honest readiness status. This still does not complete provider/model editing or auth setup inside TUI, relay pairing execution inside TUI, task backend, Clarify runtime, Loop runtime, independent Review runtime, long PTY stress or the full Web/Desktop/OpenTUI UI scorecard.

### `NTH-EV-018` OpenTUI Device Pairing Action Verification

Status: `passed-for-slice`

Scope:

1. Turn `D devices` from a local route shortcut into a real daemon pairing action handled by the CLI/client layer.
2. Request a fresh daemon pairing offer through existing daemon authority, which refreshes relay registration before returning the offer.
3. Parse the sensitive daemon offer only inside the CLI layer and pass only safe summary fields into the TUI surface.
4. Keep raw offer URLs, QR payloads, pairing tokens and relay subprotocol tokens out of the TUI model, final frame, smoke output and final report.
5. Preserve existing workspace registration, provider readiness, recovery, renderer, navigation, connected CLI and isolation behavior.

Evidence:

1. `packages/tui/src/keyboard.ts` now maps `D` to a `devicePairing` intent instead of a pure local route action. The TUI package still does not call daemon or relay APIs directly.
2. `packages/tui/src/render.ts` now returns `devicePairing` from the mounted surface so the CLI layer owns the daemon call.
3. `packages/cli/src/commands/tui.ts` now handles device pairing by opening the Connections route, calling real daemon client `getDaemonPairingOffer({ timeout: 5000 })`, parsing the returned offer with `parseConnectionOfferFromUrl`, and injecting only `endpoint` plus `pairingExpiresAt` into the surface input.
4. The TUI Connections route now shows `Pairing offer ready`, `Pairing endpoint`, `Pairing expiry` and `Credential safety: Offer URL, QR and tokens are kept out of the TUI frame`.
5. CLI TUI redaction now scrubs URL `offer=` / `#offer=` material, `pairingToken`, `thoth-relay-v3-client.*`, `thoth.relay.token.*` and URL passwords from recovery/error text before it can enter a TUI frame.
6. Added `--pair-device-after-render-ms` as a smoke-only automation option for the real `thoth tui` command.
7. Added root `npm run smoke:tui:cli:device-pairing`, backed by `scripts/smoke-opentui-cli-device-pairing.sh`. The smoke runs the real CLI OpenTUI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi`, triggers daemon pairing, verifies the Connections route and rejects raw offer/token/QR/legacy-host leakage.
8. `npm run test --workspace=@thoth/tui` passed with 5 files and 28 tests, including `D` key mapping, safe pairing surface state and rendered Connections detail.
9. `npm run typecheck --workspace=@thoth/tui` passed.
10. `npm run build --workspace=@thoth/tui` passed.
11. `npm --workspace=@thoth/cli run typecheck` passed.
12. `npm run smoke:tui:cli:device-pairing` passed against real Thoth daemon `127.0.0.1:6688`, showing `Route: Connections (Offer ready)`, `State: Pairing offer ready for relay.test.thoth.seeles.ai:443; credential hidden`, `Pairing endpoint: relay.test.thoth.seeles.ai:443`, `Pairing expiry: ...` and the credential safety line. The smoke rejects `offer=`, `#offer=`, `pairingToken`, `thoth-relay-v3-client.`, `thoth.relay.token.`, QR text and legacy `6767` hosts.
13. `npm run smoke:tui:renderer` passed at default `96x34`.
14. `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer` passed and still showed compact `W` / `P` onboarding actions.
15. `npm run smoke:tui:navigation` passed.
16. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`.
17. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`.
18. `npm run smoke:tui:cli:workspace-register` passed; a post-smoke active workspace check reported `tmpWorkspaceCount: 0`.
19. `npm run smoke:tui:cli:provider-setup` passed against real Thoth daemon `127.0.0.1:6688`.
20. `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and the PIDs differed.
21. `npm run format:check` passed.
22. `git diff --check` passed.
23. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.

Current result:

OpenTUI now has a safe real device pairing action: pressing `D` asks the daemon for a fresh pairing offer, lands users on the Connections route and shows only safe relay endpoint/expiry summary. This still does not complete full paired-device persistence UI, provider/model editing or auth setup inside TUI, task backend, Clarify runtime, Loop runtime, independent Review runtime, long PTY stress or the full Web/Desktop/OpenTUI UI scorecard.

### `NTH-EV-019` Desktop Semantic Menu And UI Scorecard Baseline Verification

Status: `passed-for-slice`

Scope:

1. Move the Desktop application menu away from a generic Electron shell toward Thoth product
   navigation.
2. Add Thoth semantic top-level menus for Desktop without changing daemon lifecycle or claiming
   unimplemented backend actions work.
3. Keep unfinished Workspace, Task and Provider menu targets disabled instead of presenting fake
   behavior.
4. Establish a durable UI scorecard document for the final Web/Desktop/OpenTUI review while marking
   the current score as not passing.

Evidence:

1. `packages/desktop/src/features/menu.ts` now exports `buildApplicationMenuTemplate` and uses
   top-level menus `Thoth`, `File`, `Workspace`, `Task`, `Provider`, `View`, `Window` and `Help`.
2. The generic top-level `Edit` menu was removed; standard editing roles remain under `File` so
   basic desktop edit commands are still present.
3. The new `Workspace`, `Task` and `Provider` menu groups expose final product slots such as
   `Open Workspace...`, `Register Current Workspace`, `New Loop Task`, `Clarify Contract`,
   `Review Evidence`, `Provider Settings`, `Refresh Provider Readiness`, `Select Model` and
   `Permission Mode`, all disabled until the real backing actions are wired.
4. Added `packages/desktop/src/features/menu.test.ts` with an Electron mock. The tests verify the
   Thoth top-level menu order, absence of the generic `Edit` top-level menu, disabled unfinished
   product actions and preserved `File`, `View` and `Window` commands.
5. Added `docs/ui-review-scorecard.md` as a working scorecard and evidence ledger. It records the
   final Web/Desktop/OpenTUI threshold, dimensions, current failing working scores and missing
   screenshot/stress artifacts. It explicitly does not claim final UI acceptance.
6. `npm --workspace=@thoth/desktop run test -- src/features/menu.test.ts` passed with 1 file and
   3 tests.
7. `npm --workspace=@thoth/desktop run typecheck` passed.
8. `npm --workspace=@thoth/desktop run build:main` passed.
9. `npm run format:check` passed.
10. `git diff --check` passed.

Current result:

Desktop now has a Thoth-specific application menu surface and the project has a durable working UI
scorecard. This still does not complete Web/Desktop/OpenTUI final UI acceptance: current scorecard
status is failing until fresh screenshots, Playwright UI stress, Desktop smoke, OpenTUI PTY stress,
full endpoint score evidence and final thresholds are satisfied.

### `NTH-EV-020` OpenTUI PTY Stress And Scorecard Capture Verification

Status: `passed-for-slice`

Scope:

1. Add a reproducible OpenTUI stress smoke for the real `thoth tui` CLI path.
2. Run the smoke under a pseudo-terminal wrapper while preserving the pinned `node-linux-x64@26.4.0`
   plus `--experimental-ffi` OpenTUI runtime path.
3. Cover rapid route, focus, composer, refresh, provider readiness and device pairing churn without
   adding fake TUI backend state or fake provider/task authority.
4. Verify narrow, default and wide terminal widths.
5. Keep raw relay offers, pairing tokens, QR payloads and legacy Paseo/daemon endpoints out of the
   terminal frame and smoke output.
6. Update the working UI scorecard without claiming final UI acceptance.

Evidence:

1. `packages/cli/src/commands/tui.ts` now exposes smoke-only `--stress-after-render-ms` for the
   real `thoth tui` command. The stress path reuses the mounted OpenTUI surface, drives key-intent
   handling for Mode/Clarify/Loop, Tab/Enter route churn and Esc/back churn, then calls the existing
   daemon snapshot refresh, provider readiness refresh and safe device pairing handlers.
2. The CLI key handling now funnels interactive keypresses and smoke-driven key results through the
   same result dispatcher, so refresh, workspace registration, provider readiness and device pairing
   remain owned by the CLI/client layer rather than `packages/tui`.
3. Added root `npm run smoke:tui:pty-stress`, backed by
   `scripts/smoke-opentui-pty-stress.mjs`. The script builds `@thoth/tui` and the CLI, then runs
   `thoth tui` through `/usr/bin/script -qfec ... /dev/null` to allocate a pseudo-terminal.
4. The stress script verifies `72x34`, `96x34` and `132x34` final frames. Each final frame shows
   Connections offer-ready route/focus, stress-completed state, `Mode: Loop`, `Clarify: Light`,
   `Loop: Light`, `Host: Connected`, `Provider: Provider available`, safe pairing endpoint
   `relay.test.thoth.seeles.ai:443` and the authority guard.
5. The stress assertions reject `127.0.0.1:6767`, `localhost:6767`, raw `offer=` / `#offer=`,
   `pairingToken`, relay subprotocol token prefixes, QR text, `undefined`, `[object Object]` and
   common crash traces.
6. `npm run typecheck --workspace=@thoth/tui` passed.
7. `npm --workspace=@thoth/cli run typecheck` passed.
8. `npm run test --workspace=@thoth/tui` passed with 5 files and 28 tests.
9. `npm run build --workspace=@thoth/tui` passed.
10. `npm run smoke:tui:pty-stress` passed after formatting. The command produced three passing
    receipts for widths `72`, `96` and `132`, all with height `34` and host `127.0.0.1:6688`.
11. `npm run smoke:tui:cli` passed against real Thoth daemon `127.0.0.1:6688`.
12. `npm run smoke:tui:cli:recovery` passed against unreachable host `127.0.0.1:1`.
13. `npm run smoke:tui:cli:provider-setup` passed against real Thoth daemon `127.0.0.1:6688`.
14. `npm run smoke:tui:cli:device-pairing` passed against real Thoth daemon `127.0.0.1:6688`.
15. `npm run format:check` passed.
16. `git diff --check` passed.
17. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation
    build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`,
    relay `29`, protocol `286` and client `110` tests.
18. `npm run smoke:isolation` passed: Paseo/legacy remained on `127.0.0.1:6767`, Thoth remained on
    `127.0.0.1:6688`, and the PIDs differed.
19. `docs/ui-review-scorecard.md` now records OpenTUI stress evidence and raises the OpenTUI working
    score from `84` to `87`, while keeping the overall score failing at `78` and the final threshold
    unmet.

Current result:

OpenTUI now has a reproducible pseudo-terminal stress smoke for route/focus/composer/provider/device
churn across narrow, default and wide terminal widths. This still does not complete final
Web/Desktop/OpenTUI UI acceptance: OpenTUI is still below the final `88` score threshold, Web and
Desktop still need current screenshot/stress evidence, and the full Thoth MVP task loop,
provider/model editing path, Clarify runtime, Loop runtime and independent Review runtime remain
unimplemented.

### `NTH-EV-021` Web Scorecard Static Export Smoke Verification

Status: `passed-for-slice`

Scope:

1. Add a reproducible Web scorecard smoke for the real static web export rather than Metro-only
   development UI.
2. Build the current web bundle with the root `npm run build:web` entrypoint.
3. Serve `packages/app/dist` through the repository static server and run Playwright against the
   served export through `E2E_BASE_URL`.
4. Capture current review screenshots for Home desktop, Home mobile, Workspace composer, Settings
   About, Settings Providers and Settings Connections.
5. Stress rapid Workspace, Settings, composer control and viewport transitions without relying on a
   mock/debug-only UI surface.
6. Reject visible legacy Paseo/daemon fallback material and sensitive relay credential material from
   the Web surface under test.

Evidence:

1. Added root `npm run smoke:web:ui-scorecard`, backed by
   `scripts/smoke-web-ui-scorecard.mjs`. The script runs `npm run build:web`, serves
   `packages/app/dist` on an ephemeral `127.0.0.1` port with `scripts/serve-static.mjs`, sets
   `E2E_BASE_URL`, and runs `npm --workspace=@thoth/app run test:e2e -- thoth-ui-scorecard.spec.ts`.
2. Added `packages/app/e2e/thoth-ui-scorecard.spec.ts`. The spec verifies Home / One Thoth,
   Workspace composer/task/evidence preview slots, Settings About, host Providers and host
   Connections, then churns Settings/Workspace/composer/viewport paths.
3. The spec captures six screenshot artifacts:
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/web-scorecard/web-home-desktop.png`,
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/web-scorecard/web-home-mobile.png`,
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/web-scorecard/web-workspace-composer.png`,
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/web-scorecard/web-settings-about.png`,
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/web-scorecard/web-settings-providers.png` and
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/web-scorecard/web-settings-connections.png`.
4. Screenshot sizes from the local artifact check were `68775`, `39004`, `92514`, `42747`,
   `118783` and `37881` bytes respectively.
5. `packages/app/e2e/fixtures.ts` now lets `E2E_BASE_URL` override the Metro base URL so the same app
   e2e fixtures can target the static export.
6. `packages/app/e2e/global-setup.ts` now uses ESM-safe path resolution, resolves `wrangler` from
   app/root workspace install locations, starts the current `packages/daemon` package instead of
   the obsolete server path, validates relay v3 pairing offer shape and includes the static export
   origin in `THOTH_CORS_ORIGINS`.
7. `packages/app/e2e/helpers/app.ts` now opens Settings through the real responsive UI: desktop
   sidebar when available and mobile drawer when needed. The helper accepts both Settings root and
   General sub-route URLs because the current responsive route can land on either form.
8. `packages/app/e2e/helpers/daemon-client-loader.ts` now uses ESM-safe path resolution for loading
   the built daemon client and app version metadata.
9. `npm run smoke:web:ui-scorecard` passed with Playwright result `1 passed (18.6s)`.
10. The smoke uses isolated app e2e daemon/workspace setup through daemon/client authority. It does
    not create task authority in the Web UI and does not claim provider-backed Router, Clarify,
    PlanExec, Loop or Review behavior exists.
11. `docs/ui-review-scorecard.md` now records this evidence, raises Web's working score from `72` to
    `80`, raises the overall working score from `78` to `80`, and keeps final scorecard status
    failing.
12. `npm run format:check` passed after applying root `npm run format`.
13. `git diff --check` passed.
14. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation
    build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`,
    relay `29`, protocol `286` and client `110` tests.
15. `npm run smoke:isolation` passed: Paseo/legacy remained on `127.0.0.1:6767`, Thoth remained on
    `127.0.0.1:6688`, and the PIDs differed.

Current result:

Web now has current static export screenshot and route/composer/settings stress evidence for the
scorecard. This still does not complete final Web/Desktop/OpenTUI UI acceptance: Desktop still needs
fresh packaged/dev scorecard evidence, Web still needs fresh relay and expired relay scorecard
paths, the full task route/backend path is not implemented, provider/model editing remains
unfinished, OpenTUI remains below the final threshold and the full Thoth MVP task loop,
Clarify runtime, Loop runtime and independent Review runtime remain unimplemented.

### `NTH-EV-022` Compact APP Runtime Contract Verification

Status: `passed-for-contract`

Scope:

1. Preserve the 2026-07-03 user decision that the APP direction must stop polishing the
   Paseo-like shell and instead use exactly three MVP views: Settings, Workspace Secretary and
   Background Tasks.
2. Capture the workspace secretary model: `New Agent` remains, but means opening a new secretary
   topic/session for the current workspace, not exposing internal roles.
3. Capture the Quick/Loop transition rule: Quick remains foreground in the secretary session;
   Loop registers a background task only after two confirmations.
4. Capture the hidden built-in runtime skills: `thoth.clarify` for secretary sessions and
   `thoth.loop` for PlanExec/Review sessions. They are installed with Thoth, hidden from users and
   not optional.
5. Add a compact protocol code contract for state codes, packets, provider input envelopes and
   loop cursor validation.

Evidence:

1. Added `.agent-os/designs/thoth-app-runtime-contract.md` as canonical design authority for the
   compact APP runtime model. It documents Settings, Workspace Secretary and Background Tasks;
   hidden clarify/loop skills; Quick/Loop switching; two confirmation gates; compact state codes;
   compact packets; provider input envelope; daemon mechanical responsibility; and front-end
   rendering responsibility.
2. Updated `AGENTS.md` recovery order so future agents read
   `.agent-os/designs/thoth-app-runtime-contract.md` with the canonical design set.
3. Recorded `NTH-CD-027` in `.agent-os/change-decisions.md`.
4. Added `packages/protocol/src/thoth-runtime-contract.ts` with code authority for:
   `THOTH_BUILTIN_RUNTIME_SKILLS`, 7 Clarify codes, 8 Loop codes, Clarify/Loop UI kinds, compact
   runtime packet schemas, compact loop cursor schema and provider input envelope schema.
5. Added `packages/protocol/src/thoth-runtime-contract.test.ts`. The tests assert the state code
   sets remain under ten entries, the packet top-level fields remain compact, clarify packets reject
   loop UI kinds, loop packets require valid cursor values, and provider input envelopes reject
   mismatched skill/code combinations.
6. Updated `docs/ui-review-scorecard.md` to mark the old scorecard as a rejected legacy-shell
   baseline, not the current product target.
7. Recorded `NTH-EXP-008` in `.agent-os/lessons-learned.md`.
8. `npm run test:protocol -- thoth-runtime-contract.test.ts` passed with `1` file and `12` tests.
9. `npm run typecheck:protocol` passed.
10. `npm run build:protocol` passed.

Current result:

The compact APP runtime contract is now preserved in both design authority and protocol code. This
does not implement the runtime, daemon authority, provider skill injection, APP views or background
task execution; it only locks the shape future implementation must follow.

### `NTH-EV-023` Clarify Agent Harness And Golden Judge Verification

Status: `passed`

Scope:

1. Implement the first `thoth.clarify` hidden skill harness for provider-backed secretary sessions.
2. Preserve the boundary that semantic judgment belongs inside provider sessions, while local code
   builds envelopes, validates packet shape, preserves transcript/provenance and runs fixture evals.
3. Add prompt contract, compact preset prompt, convergence rubric and behavior-tree question rubric.
4. Add protocol-level `C_ASK` question-card, Clarify answer packet and final-card provenance schemas.
5. Add golden data and deterministic eval for Quick, Clarify, Task Card, Goal Card and blocked
   behavior.
6. Run an independent `codex exec` judge over the golden transcripts and packets.

Evidence:

1. Added `packages/drivers/src/clarify/contract.ts` with `thoth.clarify` prompt contract,
   per-round compact preset, convergence rubric, behavior-tree question rubric,
   `composeClarifyProviderPrompt` and `buildClarifyProviderInputEnvelope`.
2. Added `packages/drivers/src/clarify/golden.ts` with 15 golden scenarios covering `hi`, vague
   large task, low-risk small task, unclear acceptance, missing risk/resource boundary, repeated
   ambiguity, enough information, "you decide", high-risk confirmation, unsafe blocked, contradictory
   demands, anti-downgrade, `C_ASK` compact preset, note-only answer packet and final Goal Card
   provenance.
3. Added `packages/drivers/src/clarify/eval.ts` and `packages/drivers/src/clarify/eval.test.ts`.
   Deterministic eval validates packet schemas, compact preset guard phrases, forbidden visible
   question text, repeated-question avoidance, answer packet shape and final-card provenance.
4. Added `scripts/judge-clarify-golden.mjs` and root `npm run judge:clarify:golden`; the script
   runs deterministic eval, launches an independent read-only `codex exec` judge and writes ignored
   evidence artifacts under `.agent-os/artifacts/`.
5. Updated `packages/protocol/src/thoth-runtime-contract.ts` so `C_ASK` packets must carry a valid
   question card in both `content` and `ui`, `C_TASK_CARD` must carry
   `content.provenance.clarify_transcript_verbatim`, and `C_GOAL_CARD` must carry both the full
   transcript and `approved_ceo_task_card_verbatim`.
6. Updated `packages/protocol/src/thoth-runtime-contract.test.ts` for question card validation,
   note-only answer packets, label length rejection, `C_ASK` content/ui card requirements and final
   card provenance rejection.
7. First independent judge run after adding blocked coverage failed on semantic quality: the
   `you-decide` Task Card was too generic, note-only answer handling looked like repeated Clarify,
   Task Card provenance lacked the original user goal and the cleanup branch had slight partial-scope
   downgrade risk. The golden data was corrected before acceptance.
8. Second independent judge run failed because the Goal Card provenance fixture mixed a settings-page
   transcript with an unrelated Clarify-backend CEO Task Card and goal split. The fixture was corrected
   so transcript, approved CEO Task Card and goal split all refer to the same settings-page task before
   acceptance.
9. Final `npm run eval:clarify` passed with 15 scenarios:
   `hi-direct`, `vague-large-task`, `low-risk-small-task`, `unclear-acceptance`,
   `risk-resource-boundary`, `repeated-ambiguity`, `enough-information-task-card`,
   `you-decide-agent-owned`, `high-risk-confirmation`, `unsafe-blocked`, `contradiction`,
   `anti-downgrade`, `compact-preset-cask`, `answer-packet-note-only` and
   `goal-card-provenance`.
10. Final `npm run judge:clarify:golden` passed. Evidence artifacts:
    `.agent-os/artifacts/clarify-golden-eval-2026-07-03T17-41-06-546Z.json` and
    `.agent-os/artifacts/clarify-golden-codex-judge-2026-07-03T17-41-06-546Z.md`. The judge found
    that the golden scenarios satisfy secretary-like behavior, behavior-tree convergence, original
    target preservation, anti-downgrade, no repeated low-value questions, no agent-discoverable fact
    pushback, no unsolicited defaults, `C_ASK` card constraints, `C_TASK_CARD` transcript provenance
    and `C_GOAL_CARD` transcript plus approved CEO Task Card provenance.
11. `npm run test:protocol` passed: 33 files and 303 tests.
12. `npm run test:drivers` passed: 1 file and 3 tests.
13. `npm run typecheck:drivers` passed.
14. `npm run format:check` passed.
15. `git diff --check` passed.
16. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation
    build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`,
    relay `29`, protocol `303` and client `110` tests.

Current result:

`NTH-TD-015` / `NTH-MS-012` is verified for the backend Clarify Agent Harness and Convergence
Contract scope. The implementation provides a provider-session prompt harness, schemas, golden
fixtures, deterministic eval and independent judge workflow. It does not yet render the Workspace
Secretary UI, start live provider-backed secretary sessions from the daemon, or register real
background tasks; those remain for `NTH-TD-016` and later loop goals.

Supersession note:

This was the first Loop-1 acceptance. The 2026-07-04 user revision replaced the TS prompt-constant
source model and per-round compact-preset packet model with standard `SKILL.md` artifacts,
session-scoped mounting and compact runtime packets. The current accepted Loop-1 evidence is
`NTH-EV-024`.

### `NTH-EV-024` Revised Clarify Standard Skill Artifact And User Simulation Verification

Status: `passed`

Scope:

1. Convert `thoth.clarify` from TS-only prompt constants into a standard cross-provider internal
   Skill artifact with `SKILL.md` as canonical source.
2. Create reserved `thoth.loop` as the same standard internal Skill artifact form, without claiming
   Loop execution / Review runtime exists.
3. Keep runtime skills inside Thoth-owned internal bundles and mount them only into Thoth-owned
   provider session scope.
4. Prove mounting does not write to bare/global provider skill homes:
   `~/.codex/skills`, `~/.claude/skills` or `~/.agents/skills`.
5. Replace per-round rule repetition with compact runtime packets: normal same-state turns carry
   runtime data only; session start and transition packets may carry `skill_ref` / digest markers;
   repair packets only repair shape/state/provenance.
6. Separate provider semantic transition rules in `SKILL.md` from daemon/protocol mechanical
   transition validation.
7. Upgrade deterministic eval and independent `codex exec` judge coverage to include standard Skill
   artifact, session-scoped mount, bare-provider invisibility, compact packets, repair boundary and
   user simulation.

Evidence:

1. Created standard Skill artifacts through the standard skill-creator init flow and removed generated
   Codex-only UI metadata:
   - `packages/drivers/src/runtime-skills/thoth-clarify/SKILL.md`
   - `packages/drivers/src/runtime-skills/thoth-loop/SKILL.md`
2. `thoth-clarify/SKILL.md` has YAML frontmatter with `name: thoth.clarify`,
   `description`, `user-invocable: false`, `x-thoth-runtime: hidden`,
   `x-thoth-required: true` and `x-thoth-scope: provider-session`. Its Markdown body contains
   Role, Runtime Arguments, State Codes, Transition Rules, Question Rules, Output Contract, Repair
   Contract, Good Cases and Bad Cases.
3. `thoth-loop/SKILL.md` exists as a reserved standard artifact only. It explicitly says
   `thoth.loop` execution, Review, retry, evidence, permission and task completion behavior remain
   unfinished.
4. `packages/drivers/src/clarify/contract.ts` now loads the canonical `SKILL.md`, parses
   frontmatter, computes a `sha256:` digest, validates required Clarify sections, mounts the Skill
   under `provider-sessions/<sessionId>/skills/thoth-clarify/SKILL.md`, rejects global provider skill
   dirs and exposes fallback prompt rendering only as compatibility path.
5. `packages/protocol/src/thoth-runtime-contract.ts` now defines Clarify session-start, normal turn,
   transition and repair input packets; `THOTH_CLARIFY_MECHANICAL_TRANSITIONS`; and
   `isAllowedClarifyMechanicalTransition`. Normal turn packets reject `skill_ref`; transition packets
   require `skill_ref`, digest and `basis: "according_to_loaded_skill"`; repair packets require
   shape-only / no semantic reinterpretation / no fabricated transcript / no approved-card mutation
   instructions.
6. `packages/drivers/src/clarify/user-simulation.ts` provides the deterministic multi-turn user
   simulation covering `hi`, vague large task, Three.js PathTracing, branch choice answer, note-only
   answer, `you decide`, unclear acceptance, risk/delete boundary, contradictory demand, Task Card
   confirmation, Goal Card confirmation and repair packet boundary.
7. `packages/drivers/src/clarify/eval.ts` now keeps the original 15 behavior golden scenarios and
   adds revised checks:
   `packaged-runtime-skill-authority`, `skill-not-global-installed`,
   `session-scoped-skill-visible`, `bare-provider-skill-invisible`,
   `normal-turn-does-not-repeat-skill-rules`, `transition-turn-carries-skill-reference`,
   `repair-packet-shape-only`, `skill-rules-live-in-skill-md` and
   `codex-exec-user-simulation`.
8. `scripts/judge-clarify-golden.mjs` now sends the independent judge the canonical `SKILL.md`,
   session-scoped mount evidence, normal turn envelope, transition packet, repair packet and golden
   scenarios.
9. Added `scripts/judge-clarify-user-simulation.mjs` and root
   `npm run judge:clarify:user-simulation`. The script constructs a clean temp Thoth runtime home,
   mounts the installed internal Skill artifact into session scope, verifies fake bare provider
   global skill dirs remain unpolluted, validates the multi-turn simulation and launches an
   independent read-only `codex exec` judge.
10. `npm run test:protocol -- thoth-runtime-contract.test.ts` passed with `1` file and `23` tests.
11. `npm run test:drivers` passed with `1` file and `4` tests.
12. `npm run typecheck:drivers` passed.
13. `npm run eval:clarify` passed with 15 behavior scenarios plus all revised skill/session/packet
    checks.
14. `npm run judge:clarify:golden` passed. Evidence artifacts:
    `.agent-os/artifacts/clarify-golden-eval-2026-07-04T02-09-17-693Z.json` and
    `.agent-os/artifacts/clarify-golden-codex-judge-2026-07-04T02-09-17-693Z.md`.
15. `npm run judge:clarify:user-simulation` passed. Evidence artifact:
    `.agent-os/artifacts/clarify-user-simulation-2026-07-04T02-11-39-269Z.md`.
16. `npm run format:check` passed.
17. `git diff --check` passed.
18. `npm run check:foundation` passed: repo validation, format check, foundation lint,
    foundation build, foundation typecheck and foundation tests. Foundation tests passed with
    highlight `66`, relay `29`, protocol `309` and client `110` tests.

Current result:

The revised `NTH-TD-015` / `NTH-MS-012` acceptance is verified for the backend Clarify standard Skill
artifact, Thoth internal session-scoped skill invocation/mount contract, no global provider skill
pollution, compact runtime/transition/repair packets, repair boundary, golden eval, independent
golden judge and independent user-simulation judge.

Not completed by this evidence:

1. Full daemon live provider orchestration.
2. Workspace Secretary frontend rendering.
3. Real background task registration.
4. `thoth.loop` execution / review runtime.

### `NTH-EV-025` Clarify Strength And Decision Frontier Revision Verification

Status: `passed`

Scope:

1. Extend the canonical `thoth.clarify` `SKILL.md` with clarify strength strategy, assumption
   owner classification, decision-tree frontier handling, multi-question `C_ASK` card rules,
   hidden output meta and stop conditions such as "够了/不要再问".
2. Extend protocol and driver contracts so inner Clarify input packets carry controls /
   `clarify_strength` / `effective_clarify_strength`, transcript refs, assumption ledger refs and
   decision-tree frontier refs without repeating Skill rules.
3. Extend transition packets with `controls_changed` for strength changes while keeping
   `skill_ref` / digest markers limited to session start, transition, context loss and repair paths.
4. Update `C_ASK` schema from a single-question card to a standard-compatible card with one title,
   one primary behavior-tree node, 2-4 tightly related question items, short choices, note support
   and hidden `content.meta`.
5. Prove `none` / `light` / `balanced` / `dive` produce different behavior for the same Three.js
   PathTracing prompt, and that agent-discoverable facts are not pushed to the user.

Evidence:

1. Updated `packages/drivers/src/runtime-skills/thoth-clarify/SKILL.md` with Mental Model,
   Clarify Strength Strategy, Assumption Ledger, Decision Tree Frontier, multi-question Output
   Contract, hidden internal meta and updated Good/Bad cases.
2. Updated `packages/protocol/src/thoth-runtime-contract.ts` with `dive` strength support, legacy
   `deep` compatibility, `ClarifyInputControlsSchema`, `ClarifyControlsChangedSchema`,
   multi-question card schemas, multi-answer packet schemas, assumption owner schemas and
   `ClarifyOutputMetaSchema`.
3. Updated `packages/drivers/src/clarify/contract.ts` so normal turn builders emit controls,
   effective strength, assumption ledger refs and decision-tree frontier refs, transition builders
   can emit `controls_changed`, and legacy `deep` normalizes to effective `dive`.
4. Updated `packages/drivers/src/clarify/golden.ts` and `eval.ts` to 21 deterministic scenarios,
   including `strength-none-pathtracing`, `strength-light-pathtracing`,
   `strength-balanced-pathtracing`, `strength-dive-pathtracing`, `agent-can-discover` and
   `stop-clarify-task-card`.
5. Updated `packages/drivers/src/clarify/user-simulation.ts` to use multi-question cards, `dive`
   controls, hidden meta, controls validation and a `stop-clarify-enough` user turn.
6. Updated both independent judge scripts so `codex exec` reviews strength behavior, assumption
   ownership, decision frontier behavior, multi-question cards, hidden meta and stop conditions.
7. `npm run test:protocol -- thoth-runtime-contract.test.ts` passed with `1` file and `23` tests.
8. `npm run test:drivers` passed with `1` file and `4` tests.
9. `npm run typecheck:drivers` passed.
10. `npm run eval:clarify` passed with `21` behavior scenarios plus skill/session/packet/repair /
    strength checks.
11. `npm run judge:clarify:golden` passed. Evidence artifacts:
    `.agent-os/artifacts/clarify-golden-eval-2026-07-04T03-10-56-860Z.json` and
    `.agent-os/artifacts/clarify-golden-codex-judge-2026-07-04T03-10-56-860Z.md`.
12. `npm run judge:clarify:user-simulation` passed. Evidence artifact:
    `.agent-os/artifacts/clarify-user-simulation-2026-07-04T03-13-04-820Z.md`.
13. `npm run format:check` passed.
14. `git diff --check` passed.
15. `npm run check:foundation` passed: repo validation, format check, foundation lint,
    foundation build, foundation typecheck and foundation tests. Foundation tests passed with
    highlight `66`, relay `29`, protocol `309` and client `110` tests.

Current result:

The current `NTH-TD-015` / `NTH-MS-012` acceptance is verified for the revised Clarify strength
strategy, assumption-owner contract, decision-tree frontier refs, compact runtime controls,
multi-question `C_ASK` cards, hidden internal meta, deterministic golden eval, independent golden
judge and independent user-simulation judge.

Not completed by this evidence:

1. Full daemon live provider orchestration.
2. Workspace Secretary frontend rendering.
3. Real background task registration.
4. `thoth.loop` execution / review runtime.

### `NTH-EV-026` Loop-2 Workspace Secretary Frontend Refactor Slice

Status: `historical_only`

Scope:

1. Replace the root web/app entry with the compact three-view Thoth APP shell:
   Workspace Secretary, Background Tasks and Settings.
2. Add a protocol/client/daemon/app typed clean UI model boundary for Workspace Secretary, Clarify
   cards, Settings relay state and Background Tasks.
3. Render Clarify output as secretary decision cards with multi-question choices,
   per-option notes, note-only, "you recommend" and "you decide" actions.
4. Replace the development fixture APP slice with daemon-backed `workspace_secretary.*` RPC
   authority and remove app-local Clarify/relay model construction from the production path.
5. Exercise the real `relay.test.thoth.seeles.ai` health endpoint through daemon clean UI model
   authority without displaying
   tokens, raw pairing offers or credentials.
6. Prove the web static export path, Loop-2 user journey, desktop/mobile screenshots, Playwright
   trace/video and independent UI mental-model review.

Evidence:

1. Added `packages/protocol/src/workspace-secretary/rpc-schemas.ts` with
   `ThothCleanUiModel`, `WorkspaceSecretaryModel`, `ThothClarifyCardModel`,
   `RelayServiceModel`, `BackgroundTasksModel`, structured answer payload schemas and
   `workspace_secretary.snapshot/send/answer/topic.create` RPC schemas. The clean model authority
   source is `daemon_clean_ui_model`.
2. Wired the new RPC schemas into `packages/protocol/src/messages.ts` and added client methods in
   `packages/client/src/daemon-client.ts`: `fetchWorkspaceSecretarySnapshot`,
   `sendWorkspaceSecretaryMessage`, `answerWorkspaceSecretaryClarify` and
   `createWorkspaceSecretaryTopic`.
3. Added `packages/daemon/src/server/session/workspace-secretary/workspace-secretary-session.ts`
   and mounted it from `packages/daemon/src/server/session.ts`. The daemon owns the current
   Workspace Secretary clean UI model, Quick replies, Loop Clarify card append, submitted readonly
   state, multi-round history, `stop` intent and Settings relay status.
4. Daemon relay authority calls `https://relay.test.thoth.seeles.ai/health` and only marks healthy
   when the response is exactly `{"status":"ok","protocol":"3","service":"thoth-relay"}`. Every
   `workspace_secretary.*` response refreshes `model.settings.relay` before schema verification and
   emit.
5. Reworked `packages/app/src/thoth-app/clean-ui-model.ts` into app presentation helpers plus
   protocol type re-exports only. The app no longer exports or calls a relay model factory; Settings
   consumes `model.settings.relay` from daemon clean UI authority.
6. Deleted the old app-local Clarify fixture/adapter path from the active product surface:
   `packages/app/src/thoth-app/protocol-authority-adapter.ts` and
   `packages/app/src/thoth-app/development-fixture-adapter.ts` are absent from the final path.
7. Added `packages/app/src/thoth-app/thoth-app-shell.tsx` and changed
   `packages/app/src/app/index.tsx` so `/` renders Thoth Workspace Secretary by default. The shell
   exposes exactly Workspace Secretary, Background Tasks and Settings; `New Agent` is replaced by
   `新秘书话题` and submitted through daemon authority.
8. Clarify card behavior covers title, why-now, 2 tightly related questions, 3 choices per question,
   short labels/explanations, per-option notes, per-question notes, note-only submission, recommend,
   decide, stop, readonly submitted summaries, multi-round append without replacing history and
   authority-driven return to Quick after the user stops Clarify.
9. Composer behavior covers `hi` without Clarify, Quick foreground chat without Clarify, Loop
   Clarify creation and `Quick -> Loop -> Clarify -> Quick`.
10. Added and updated unit/component tests:

- `packages/protocol/src/workspace-secretary/rpc-schemas.test.ts`
- `packages/daemon/src/server/session/workspace-secretary/workspace-secretary-session.test.ts`
- `packages/app/src/thoth-app/clean-ui-model.test.ts`
- `packages/app/src/thoth-app/thoth-app-shell.test.tsx`
- `packages/app/src/test/jsdom-shim.d.ts`

11. Reworked `packages/app/e2e/thoth-ui-scorecard.spec.ts` into the Loop-2 static-export scorecard
    covering three views, Workspace Secretary default, `hi`, Quick/no-card, Loop Clarify,
    choice+note, note-only, recommend, decide, stop Clarify, Background Tasks, Settings real relay
    state and mobile composer visibility.
12. `curl -sS --max-time 10 https://relay.test.thoth.seeles.ai/health` returned
    `{"status":"ok","protocol":"3","service":"thoth-relay"}` on 2026-07-04.
13. `npm --workspace=@thoth/daemon run test:unit -- workspace-secretary-session.test.ts` passed
    with `1` file and `4` tests, including the regression that `stop` returns the composer to
    Quick through daemon clean UI model authority.
14. `npm --workspace=@thoth/app run test -- thoth-app` passed with `2` files and `11` tests.
15. `npm --workspace=@thoth/app run test` passed with `315` files and `2617` tests. The only
    reported warnings were existing `@vitest/browser/context` deprecation warnings.
16. `npm run build:web` passed and exported `packages/app/dist`; the latest web bundle is
    `index-29d0748e2e9e1994ebe1c4f2534a7d0a.js`, and `packages/app/dist/index.html` marks Expo web
    bundle scripts as modules.
17. Loop-2 narrow e2e passed with `1` Playwright test using the static export:
    `E2E_BASE_URL=http://127.0.0.1:4173 E2E_RECORD_VIDEO=1 npm --workspace=@thoth/app run test:e2e -- thoth-ui-scorecard.spec.ts --trace on`.
    The daemon metrics recorded `workspace_secretary.send.request: 7`,
    `workspace_secretary.answer.request: 5`, `workspace_secretary.snapshot.request: 2` and
    `workspace_secretary.topic.create.request: 1`. The final e2e also asserts that stopping
    Clarify returns the visible composer action to `Send` rather than leaving the Loop action active.
18. Latest screenshot evidence was refreshed under
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/` on 2026-07-04 after the stop-to-Quick
    refinement:
    `desktop-workspace-secretary.png`, `desktop-hi-no-card.png`, `desktop-clarify-card.png`,
    `desktop-clarify-readonly-next-round.png`, `desktop-background-tasks.png`,
    `desktop-settings-real-relay.png` and `mobile-workspace-secretary-composer.png`.
19. Electron desktop app screenshot evidence was refreshed through
    `npm run smoke:desktop:ui-scorecard` after updating the desktop smoke to load the current
    Loop-2 static export in the Electron shell. The command passed `packages/desktop`
    `src/features/menu.test.ts` with `3` tests, built the web export and desktop main process,
    launched an isolated daemon on `127.0.0.1:46409`, verified the desktop bridge, and captured
    `desktop-app-workspace-secretary.png`, `desktop-app-hi-no-card.png`,
    `desktop-app-clarify-card.png`, `desktop-app-background-tasks.png` and
    `desktop-app-settings-real-relay.png` under
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/`.
20. Manual `view_image` review passed for the Electron desktop app Workspace Secretary root, `hi`
    with no Clarify card, Clarify decision card, Background Tasks and Settings real relay state.
    The older `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/desktop-scorecard/` screenshots still show the pre-Loop-2
    One Thoth / New Agent scorecard and are historical, not the current Loop-2 desktop evidence.
21. Latest Playwright evidence is
    `packages/app/test-results/thoth-ui-scorecard-Loop-2--d4592--card-and-real-relay-status-Desktop-Chrome/trace.zip`
    and
    `packages/app/test-results/thoth-ui-scorecard-Loop-2--d4592--card-and-real-relay-status-Desktop-Chrome/video.webm`,
    refreshed on 2026-07-04 after the final Loop-2 e2e rerun.
22. Manual `view_image` review passed for default Workspace Secretary, `hi` with no Clarify card,
    Clarify card, readonly/next-round Clarify, Settings real relay, Background Tasks and mobile
    composer visibility. The refreshed mobile screenshot shows Quick selected and `Send` visible
    after stopping Clarify.
23. Focused anti-residual scan over the active Loop-2 app/protocol/client/daemon paths found only
    negative assertion hits for forbidden terms such as `Paseo`, `request_user_input`,
    `permission question`, `agent manager`, `raw JSON`, `state code`, `repair`, `provider role`,
    `6767`, `offer`, `pairingToken` and `credential`.
24. Icon/accessibility inventory found the active shell uses the locked `ThothInventoryIcon` system
    for main navigation, composer, Clarify actions and state icons, with `accessibilityLabel` on
    main navigation, new topic, composer inputs/actions, mode/strength controls, choices, notes and
    Clarify action buttons.
25. Independent read-only `codex exec` mental-model review wrote
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/independent-mental-model-review.md` with
    verdict `PASS`. It found no blocking evidence that the UI still reads as Paseo agent manager,
    questionnaire or permission prompt.
26. `git diff --check` passed after the final Loop-2 edits.
27. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation
    build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`,
    relay `29`, protocol `312` and client `110` tests.
28. Composer controls were refined after the Loop-2 acceptance pass so Mode, Clarify strength and
    Loop strength are collapsed into bottom composer pills instead of always-visible segmented
    controls. The app still consumes only the typed `ThothComposerModel`; selecting Loop strength
    updates `mode: "loop"` and `loop` through `onComposerChange` without creating task authority,
    Task Cards, Goal Cards or local convergence state.
29. `packages/app/src/thoth-app/thoth-app-shell.test.tsx` now proves the composer controls are
    collapsed by default, the old option test IDs are absent until the corresponding menu is open,
    and selecting Loop / Clarify / Loop-strength options updates the visible composer state.
30. The Loop-2 scorecard now captures dropdown-open states in addition to the existing journey:
    `desktop-composer-clarify-menu.png` and `mobile-composer-loop-menu.png` under
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/`. Manual `view_image` review passed for
    both. The mobile screenshot verifies the menu overlays upward and keeps the bottom Mode /
    Clarify / Loop controls visible rather than pushing them off-screen.
31. The latest composer-refinement `npm run build:web` passed and exported
    `packages/app/dist/_expo/static/js/web/index-504256249c2eed522f2d536b7c118e28.js`.
32. The latest composer-refinement Loop-2 narrow e2e passed with `1` Playwright test:
    `E2E_BASE_URL=http://127.0.0.1:4173 E2E_RECORD_VIDEO=1 npm --workspace=@thoth/app run test:e2e -- thoth-ui-scorecard.spec.ts --trace on`.
    The refreshed trace/video artifacts are
    `packages/app/test-results/thoth-ui-scorecard-Loop-2--d4592--card-and-real-relay-status-Desktop-Chrome/trace.zip`
    and `video.webm`.
33. `npm run smoke:desktop:ui-scorecard` passed after the collapsed-menu selector update. The smoke
    ran desktop `src/features/menu.test.ts` with `3` tests, rebuilt the web export and desktop main
    process, launched an isolated daemon on `127.0.0.1:34773`, verified the Electron bridge and
    refreshed `desktop-app-workspace-secretary.png`, `desktop-app-hi-no-card.png`,
    `desktop-app-clarify-card.png`, `desktop-app-background-tasks.png` and
    `desktop-app-settings-real-relay.png`. Manual `view_image` review passed for the refreshed
    Electron Workspace Secretary and Clarify composer states.
34. `npm --workspace=@thoth/app run test -- thoth-app`, `npm run format:check` and
    `git diff --check` passed after the final composer overlay adjustment.
35. `npm run check:foundation` passed after the composer refinement and evidence ledger updates:
    repo validation, format check, foundation lint, foundation build, foundation typecheck and
    foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `312` and
    client `110` tests.
36. Public web review entry recovery was repaired after a real browser report still showed
    `本机 Thoth host 未连接` at `http://180.76.242.105:8148/`. The app runtime now always probes and
    upserts the explicit injected initial daemon connection hint instead of short-circuiting when
    the same connection already exists in the persisted host registry. This refreshes stale daemon
    `serverId` values after daemon restarts while still using the real same-origin `/ws` daemon
    proxy, not a fake relay, localhost relay or offline fixture.
37. Public review recovery evidence passed: `npm --workspace=@thoth/app run test --
host-runtime.test.ts` passed with `1` file and `46` tests; `npm run build:web` passed and
    exported `index-af71fdae85603a93d009de4a5d707155.js`; the 8082 public static server was
    restarted with `THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6689`; `curl
http://180.76.242.105:8148/` showed the injected `__THOTH_INITIAL_DAEMON_CONNECTION__` and the
    new bundle; Playwright verified fresh desktop, stale-registry desktop and stale-registry mobile
    public URL journeys all had `本机 Thoth host 未连接 = false`, `Clarify card count after hi = 0`,
    and local storage rewritten from stale `srv_stale_public_review` to current real daemon
    `srv_0Ryud1K1J1zRYj7eylwnsg`.
38. Public review screenshots were captured and manually reviewed with `view_image`:
    `public-web-fresh-desktop.png`, `public-web-stale-desktop.png` and
    `public-web-stale-mobile.png` under `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/`.
    Electron desktop smoke was also rerun and passed, refreshing
    `desktop-app-workspace-secretary.png`, `desktop-app-hi-no-card.png`,
    `desktop-app-clarify-card.png`, `desktop-app-background-tasks.png` and
    `desktop-app-settings-real-relay.png`; manual `view_image` review passed for desktop Workspace
    Secretary and Clarify card states.
39. Public review recovery gates passed: `git diff --check`, `npm run format:check`,
    `npm run smoke:desktop:ui-scorecard` and `npm run check:foundation`. Foundation tests passed
    with highlight `66`, relay `29`, protocol `312` and client `110` tests. Runtime isolation was
    preserved: 8082 served the web entry, 6689 served the current Thoth daemon, and Paseo/legacy
    remained only as the separate existing listener on `127.0.0.1:6767`.
40. A follow-up real-browser report showed the same dark-theme host-unavailable screen after
    hard-refresh. The second root cause was broader persisted host state: the app shell selected
    `hosts[0]` for Workspace Secretary authority. If the user's browser had an older failed host
    first and the public same-origin daemon later in the registry, the public daemon could be online
    while the visible Workspace Secretary still rendered from the first stale host.
41. The active app shell now selects Workspace Secretary authority by product-relevant runtime
    status: online host matching the injected same-origin daemon hint first, then any online host,
    then a matching hinted host while it is still connecting, and only then the first persisted host.
    Regression coverage in `packages/app/src/thoth-app/thoth-app-shell.test.tsx` proves the public
    same-origin host is selected ahead of stale persisted hosts.
42. Follow-up public review evidence passed: `npm --workspace=@thoth/app run test -- thoth-app
host-runtime.test.ts` passed with `3` files and `58` tests; `npm run build:web` passed and
    exported `index-2435eae53f002855c8ae5143a30e36b4.js`; 8082 was restarted with the new bundle;
    Playwright reproduced a dark-theme public browser with three persisted hosts where the stale
    hosts remain and fail WebSocket probes, while the visible Workspace Secretary selects the real
    public same-origin daemon, shows `前台 Quick 可用`, answers `hi` in Quick and keeps Clarify card
    count at `0`. Screenshot: `public-web-multihost-dark-ready.png`.

Current result:

This evidence is preserved as the historical frontend refactor pass that established the three-view
Workspace Secretary product shell, typed clean UI model boundary, relay-safe Settings surface and
independent UI mental-model review. After `NTH-CD-039`, it no longer verifies final Loop-2
acceptance because the old Quick/`hi`/Clarify path still relied on deterministic daemon production
behavior instead of the configured real provider session.

Not completed by this evidence:

1. Full provider-backed `thoth.clarify` runtime output; the daemon card generator is deterministic
   Loop-2 UI authority, not the final provider-session Clarify harness.
2. Real background task registration, loop execution, PlanExec and Review runtime.
3. Task Card / Goal Card approval experience.
4. Broader promoted-substrate cleanup for old voice/speech/dictation code and bootstrap logs outside
   the active Loop-2 user-visible APP surface.

### `NTH-EV-027` Loop-2 Provider-Backed Workspace Secretary Reopen

Status: `partial_superseded_by_NTH-EV-028`

Scope:

1. Replace the deterministic Workspace Secretary production path with the real configured provider
   session as the only authority for `hi`, Quick, Clarify cards, repair and the reopened Loop-2
   narrow e2e.
2. Keep the three-view APP shell and typed clean UI model, but make `authority.source`,
   provider-missing blocking behavior, provider-native question handling and live clean events
   truthful about provider authority.
3. Reopen `NTH-TD-016` / `NTH-MS-013` / `NTH-EV-026` until a real provider + real relay + final
   screenshot/trace/e2e run proves the full user journey.

Evidence so far:

1. `packages/daemon/src/server/session/workspace-secretary/workspace-secretary-session.ts` now uses
   real internal provider sessions for Workspace Secretary turns, enforces provider-required
   blocking on send/new-topic, emits clean provider progress events, treats provider-native question
   requests as structured Clarify-card candidates and removes deterministic production greetings and
   fixed Clarify-card generation from the active authority path.
2. `packages/protocol/src/workspace-secretary/rpc-schemas.ts` already carried the provider runtime,
   clean event and `provider_backed_clean_ui_model` boundaries required by `NTH-CD-039`; the new
   daemon path now consumes them instead of only projecting ready-state cosmetics.
3. `packages/app/src/thoth-app/thoth-app-shell.tsx` now renders clean provider progress events so
   the user sees Thoth semantics such as waiting for provider, structured candidate receipt and
   provider question convergence rather than raw packet/provider-role terms.
4. Targeted tests passed on 2026-07-05:
   `npm --workspace=@thoth/protocol run test -- workspace-secretary/rpc-schemas.test.ts thoth-runtime-contract.test.ts`,
   `npm --workspace=@thoth/app run test -- src/thoth-app/thoth-app-shell.test.tsx src/thoth-app/clean-ui-model.test.ts`,
   `npm --workspace=@thoth/daemon exec vitest run src/server/session/workspace-secretary/workspace-secretary-session.test.ts`.
   The daemon test now proves snapshot authority stays daemon-owned until a provider-backed turn is
   written, `hi` becomes provider-backed `C_DIRECT`, provider-native questions are converted into
   Clarify-card candidates through Thoth ask-gate rules and repair still stops after 12 attempts
   without local fallback.
5. `npm run build:web` passed on 2026-07-05 and exported a new web bundle
   `packages/app/dist/_expo/static/js/web/index-40a6555efdaf92ad7260f8dea7924577.js`, with
   `packages/app/dist/index.html` still marking Expo bundle scripts as modules.
6. Replayed Loop-2 Playwright against the static export by running
   `E2E_BASE_URL=http://127.0.0.1:8093 npm --workspace=@thoth/app run test:e2e -- e2e/thoth-ui-scorecard.spec.ts`.
   This reached the Workspace Secretary shell and connected to daemon authority, proving the
   provider-backed refactor does not require the old deterministic APP fixture path. The original
   Metro dev-server E2E path still failed earlier with browser error
   `Cannot use 'import.meta' outside a module`, so the dev-path scorecard remains blocked for this
   round.
7. `git diff --check`, `npm run format:check` and `npm run check:foundation` all passed on
   2026-07-05 after the provider-backed refactor and client config expectation update. Foundation
   tests passed with highlight `66`, relay `29`, protocol `315` and client `110` tests.
8. Public test app debug evidence on 2026-07-05 found and fixed a real-provider `hi` failure at
   `http://180.76.242.105:8148/`. The provider's complete Codex native structured `C_DIRECT` packet
   was schema-valid, but the daemon had been validating only the last assistant-message delta
   fragment. `WorkspaceSecretarySession` now reassembles assistant message fragments by `messageId`
   before native packet validation, and a regression test covers valid packet output split across
   multiple Codex assistant deltas.
9. Follow-up public Playwright verification against `http://180.76.242.105:8148/` passed after
   restarting the Thoth daemon on `127.0.0.1:6688`: `hi` produced a real provider-backed secretary
   reply, no Clarify card, no repair loop, no provider failure, no stale "waiting" flood, no
   raw/schema leakage, and visible clean events `真实 provider 回合已开始` /
   `真实 provider 回合完成`. Screenshot:
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/public-test-hi-final-fixed.png`.
10. Additional gates for the public test bugfix passed on 2026-07-05:
    `npm --workspace=@thoth/daemon exec vitest run src/server/session/workspace-secretary/workspace-secretary-session.test.ts`
    with `1` file and `9` tests, `git diff --check`, and `npm run check:foundation` through repo
    validation, format, foundation lint, foundation build, foundation typecheck and foundation tests
    with highlight `66`, relay `29`, protocol `315` and client `111` tests.

Current result:

The provider-backed refactor implementation and public `hi` bugfix evidence are retained as the
reopened partial record. The missing final screenshot/trace/e2e, real relay and independent review
gates were completed later under `NTH-EV-028`, so this evidence no longer represents the current
Loop-2 status by itself.

### `NTH-EV-028` Loop-2 Provider-Backed Streaming And Atomic Card Verification

Status: `historical_only_after_NTH-CD-041`

Scope:

1. Verify `NTH-TD-016` / `NTH-MS-013` after `NTH-CD-039` and `NTH-CD-040`: Quick, `hi`, Clarify,
   repair and Loop-2 e2e must be owned by the daemon Settings configured real provider session.
2. Prove ordinary provider progress / safe direct reply deltas enter Workspace Secretary through
   typed clean stream updates, while `C_ASK` Clarify cards render atomically only after daemon
   packet/schema/provenance/authority validation.
3. Prove the deployed public test web app, real `relay.test.thoth.seeles.ai`, screenshots,
   Playwright trace/video, source reviews and independent UI mental-model review all pass without
   local fallback, text parsing, fake provider, fake relay or Paseo agent-manager semantics.

Evidence:

1. Protocol/client stream contract is implemented: `packages/protocol/src/workspace-secretary/rpc-schemas.ts`
   defines `workspace_secretary.model.update`, clean `liveEvents`, `secretary_reply_delta`,
   provider runtime status, bridge capability and `provider_backed_clean_ui_model`; `packages/client/src/daemon-client.ts`
   exposes typed subscription to `workspace_secretary.model.update` instead of app-local WebSocket
   parsing.
2. Daemon runtime is provider-backed: `packages/daemon/src/server/session/workspace-secretary/workspace-secretary-session.ts`
   creates/reuses internal provider sessions from `workspaceSecretary.providerSession`, requires a
   supported structured bridge, blocks provider-missing send/new-topic, reassembles Codex
   `assistant_message` deltas by `messageId`, validates `RuntimePacketCandidate` /
   `ClarificationCardCandidate`, emits clean live progress/delta events and applies final provider
   outcomes only through `applyProviderOutcome`.
3. Atomic card source review passed: `C_ASK` provider question/card candidates do not enter
   `turns` until daemon validation succeeds; Task/Goal Card rendering remains outside Loop-2 and is
   still reserved for later milestones. APP code renders only typed clean model/events and does not
   parse assistant text, markdown JSON, code fences or raw packets.
4. Anti-Paseo residual scan passed for active Loop-2 app/protocol/client/daemon paths. Matches for
   `Paseo`, `request_user_input`, `AskUserQuestion`, `permission question`, `agent manager`,
   `raw JSON`, `state code`, `repair`, `provider role`, `6767`, `pairingToken`, `raw offer` and
   `credential` are limited to negative assertions, tests, safe bridge normalization or hidden
   prompt constraints, not user-visible product UI.
5. Narrow protocol test passed:
   `npm --workspace=@thoth/protocol run test -- workspace-secretary/rpc-schemas.test.ts` with
   `1` file and `5` tests.
6. Narrow client test passed:
   `npm --workspace=@thoth/client run test -- daemon-client.test.ts` with `1` file and `95` tests.
7. Narrow daemon test passed:
   `npm --workspace=@thoth/daemon exec vitest run src/server/session/workspace-secretary/workspace-secretary-session.test.ts`
   with `1` file and `10` tests, covering provider-backed `hi`, provider-native question candidate
   conversion, safe `secretary_reply_delta`, assistant delta reassembly and repair failure without
   local fallback.
8. Narrow app component test passed:
   `npm --workspace=@thoth/app run test -- src/thoth-app/thoth-app-shell.test.tsx` with `1` file
   and `12` tests.
9. Full app test passed:
   `npm --workspace=@thoth/app run test` with `315` files and `2623` tests. The only noted warnings
   were existing deprecated `@vitest/browser/context` imports in terminal browser tests.
10. Real relay verification passed:
    `curl -fsS --max-time 10 https://relay.test.thoth.seeles.ai/health` returned
    `{"status":"ok","protocol":"3","service":"thoth-relay"}`.
11. Web build passed: `npm run build:web` exported the current public-test bundle
    `packages/app/dist/_expo/static/js/web/index-dc3970d4d5f1b889316602a4e34382e9.js`.
12. Public test app is serving the current web export at `http://180.76.242.105:8148/`; live curl
    evidence showed `__THOTH_INITIAL_DAEMON_CONNECTION__` and
    `index-dc3970d4d5f1b889316602a4e34382e9.js`.
13. Public real-provider Playwright journey passed against `http://180.76.242.105:8148/`. Summary:
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/streaming-atomic-20260705/workspace-secretary-streaming-atomic-summary.json`
    records all steps as `ok`: ready Workspace Secretary shell, `hi` completed with no card,
    Clarify card appeared atomically, submitted card became readonly, Settings relay captured and
    mobile composer captured.
14. Screenshot evidence was saved and manually reviewed with `view_image`:
    `desktop-workspace-secretary-ready.png`, `workspace-secretary-streaming-quick-live.png`,
    `workspace-secretary-hi-no-card-final.png`, `workspace-secretary-loop-live-before-card.png`,
    `workspace-secretary-clarify-card-atomic.png`, `workspace-secretary-clarify-card-readonly.png`,
    `settings-real-relay-status.png` and `mobile-workspace-secretary-composer.png` under
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/streaming-atomic-20260705/`.
15. Playwright trace/video evidence was saved:
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/streaming-atomic-20260705/workspace-secretary-streaming-atomic-trace.zip`,
    `videos/page@0e81e70a7ef3f02ebfc7a717d13ae278.webm` and
    `videos/page@8b34a58568759844da9b3c8ab63b7f39.webm`.
16. Independent read-only `codex exec` UI mental-model review passed with verdict `PASS` in
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/streaming-atomic-20260705/independent-ui-mental-model-review.md`.
    It found no blocking evidence of Paseo agent manager, questionnaire, permission prompt, fake
    provider, fake relay, local fallback, non-streaming Quick or non-atomic QA card behavior.
17. `git diff --check` and `npm run format:check` passed after the implementation/formatting pass.
18. `npm run check:foundation` passed after the provider-backed streaming implementation and
    visual evidence run: repo validation, format, foundation lint, foundation build, foundation
    typecheck and foundation tests all passed. Foundation test totals were highlight `66`,
    relay `29`, protocol `316` and client `112`.

Current result:

This evidence is retained as historical evidence for the rejected three-view Workspace Secretary /
toy-shell direction. After `NTH-CD-041`, it no longer verifies `NTH-TD-016` / `NTH-MS-013`.
It may be reused only as implementation evidence for provider-backed streaming and atomic-card
mechanics, not as evidence that the current Paseo-surface frontend target is satisfied. `NTH-TD-016`
is reopened and must produce new Paseo-surface retention, anti-toy, real-provider, real-relay,
screenshot/trace/video and independent-review evidence.

Residual non-blocking risks:

1. Codex native `outputSchema` does not expose safe token-level prose streaming in all cases. Current
   evidence proves clean progress streaming plus final provider reply, and source supports
   `secretary_reply_delta` only when provider text is safe and non-structured.
2. The mobile screenshot proves composer non-overlap and reachability but does not show every
   possible scroll position of the full Clarify card; keep mobile full-card layout as a regression
   watch item for future frontend changes.

### `NTH-EV-029` Loop-2 Runtime Tool Bridge And AgentTimeline Evidence

Status: `regression_reopened`

Regression note on `2026-07-07`:

1. Real user testing after the original Loop-2 pass found that Quick+Clarify could show provider
   timeline activity, then visually complete/idle, and only afterward reveal the Clarify card. This
   fails the Paseo-style pending user decision lifecycle expected from provider question/tool flows.
2. Quick+Clarify strength behavior was too shallow: `dive` and `balanced` could converge after only a
   few fixed-looking rounds, instead of pursuing a valuable frontier until material user-owned
   assumptions were exhausted.
3. Timeline badge copy did not reliably come from an intelligent decomposition of the user's request.
   Badge text must now be provided by the model as `public_badge_summary`, while detailed stopping
   behavior is represented by a model-submitted `frontier_ledger`.
4. The earlier evidence below remains useful historical proof that Codex `dynamicTools`,
   AgentTimeline cards, same-session quick_exec and Loop `registered_pending` existed. It no longer
   verifies the strengthened Loop-2 acceptance contract until the new pending lifecycle and
   strength/frontier behavior are revalidated on the local `8082` and public `8148` web test apps.

Repair implementation status:

1. Protocol and Codex dynamic tool schemas now require `public_badge_summary` and `frontier_ledger` on
   `thoth_submit_clarify_card`; `decision_it_changes` is legacy optional input and no longer drives
   UI copy.
2. `thoth_submit_task_card` now requires `convergence_review` with a `ready_for_task`
   `frontier_ledger`. Below the soft target, `balanced < 5` or `dive < 10`, the model must provide
   `below_soft_target_rationale`.
3. Daemon authority tooling now persists `publicBadgeSummary`, `frontierLedger` and
   `convergenceReview`, labels Clarify tool badges as `需求拆解`, derives card labels as
   `Clarify 1`, `Clarify 2`, and rejects Task reviews that downgrade the latest Clarify strength.
4. App stream reducers and AgentStream layout now treat unresolved Clarify / Task / Pyramid authority
   cards or running Thoth authority tool calls as pending decisions, suppressing premature
   completed/idle footer rendering until the decision resolves.
5. Verification after the frontier-ledger repair is no longer narrow-only: protocol, daemon and app
   targeted tests passed; `npm --workspace=@thoth/app run test`, `npm run build:web`,
   `npm run check:foundation` and `git diff --check` also passed. Real Codex evidence now covers the
   main strengthened behavior, but this evidence remains `regression_reopened` because the latest
   mobile recovery and one complex Dive quick_exec run exposed residual issues.

Scope:

1. Verify `NTH-TD-016` / `NTH-MS-013` after `NTH-CD-041`, `NTH-CD-042` and `NTH-CD-043`: the restored
   production-grade Paseo app surface is the primary frontend path and the toy Workspace Secretary shell
   is no longer the acceptance path.
2. Prove Paseo capability retention: agent-stream, timeline, bottom anchor, turn boundary,
   virtualization, original composer, attachments, markdown/code/diff rendering, adaptive cards,
   settings, host/provider, relay pairing, diagnostics, workspace/session layout, terminal/browser/file
   panes, responsive layout and e2e/test substrate remain used by the main path.
3. Prove authority boundary: app renders typed models and AgentTimeline items only; it does not parse
   assistant markdown JSON, raw packets or state codes, does not choose defaults, does not synthesize
   Task/Pyramid cards locally and does not fake provider/relay success.
4. Prove the runtime phase split: `Quick + none` is bare Codex/Paseo foreground stream; `Quick + clarify`
   uses Codex app-server `dynamicTools` / `item/tool/call` semantic Thoth runtime tools for Clarify /
   Task / Pyramid cards and same-session `quick_exec`; `Loop` registers `registered_pending` after two
   approvals without starting fake PlanExec / Review.

Evidence:

1. Restored Paseo surface/source review passed for route chrome, sidebar/mobile sidebar,
   selected-agent state, PushNotificationRouter, OfferLinkListener, OpenProjectListener and
   no-`6767` fallback.
2. Composer controls render in the restored composer area: Provider updates
   `workspaceSecretary.providerSession`, Clarify updates `workspaceSecretary.clarifyStrength`, and Mode
   updates `workspaceSecretary.mode`.
3. Protocol/app models include Clarify Card, compact Task Card, Pyramid Plan Card and registered-task
   shapes; wire compatibility fields remain internal and do not drive user copy.
4. Codex app-server runtime tool bridge is implemented: structured sessions register
   `thoth_submit_clarify_card`, `thoth_submit_task_card`, `thoth_submit_pyramid_plan` and
   `thoth_report_blocked` as `dynamicTools`; the provider adapter handles `item/tool/call` and returns
   `DynamicToolCallResponse` after the pending authority decision is answered.
5. Runtime tool decisions create persisted pending authority records with provider/session/topic/call/
   phase/card metadata. User answers resolve the pending decision and return tool-result content to
   Codex; silent defaults and first-option fallback are not used.
6. AgentTimeline is the realtime stream surface. Codex command/file/web/tool thread items map to
   lifecycle `tool_call` items by call id, and app stream rendering includes assistant text, thought,
   tool_call, Clarify Card, Task Card, Pyramid Plan Card and registered-task items in the same topic.
7. Clarify cards are Paseo-style paginated cards with submitted readonly summaries; Task Card is a
   compact CEO overview; Pyramid Plan Card is hierarchical; registered task cards and Background Tasks
   detail show honest `registered_pending` state only.
8. Quick+none real-provider evidence passed on `2026-07-07` in throwaway workspace
   `/tmp/thoth-loop2-quick-none-K8g4vp`: report
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783414416734-quick-none-report.json` records
   prompt `hi`, `hasClarifyCard: 0` and screenshots
   `1783414371390-quick-none-start.png` / `1783414416665-quick-none-result.png`. `view_image` review
   confirmed ordinary provider reply with no Clarify card or raw packet/schema text.
9. Quick+Dive runtime-tool evidence passed on public `http://180.76.242.105:8148/` in
   `/tmp/thoth-loop2-runtime-tools-6eO72B`: report
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783416763028-report.json` records prompt
   `实现一个高性能快速排序`, Provider=Codex, Mode=Quick, Clarify=Dive, three Clarify rounds, Task
   approval `accept_quick`, Pyramid approval `accept_quick`, same-session quick_exec and generated
   files `bench/bench_fast_quicksort.cpp`, `include/fast_quicksort.hpp` and
   `tests/test_fast_quicksort.cpp`.
10. Quick+Dive screenshots include `1783416553652-clarify-round-1.png`, submitted readonly card
    screenshots, `1783416614492-task-card.png`, `1783416643620-pyramid-plan-card.png` and
    `1783416762955-quick-exec.png`. `view_image` review confirmed tabbed Clarify cards, compact Task
    Card, hierarchical Pyramid Plan and real Shell/Edit timeline rows during quick_exec rather than
    spinner-only output.
11. Loop+Dive registration evidence passed on public `http://180.76.242.105:8148/` in
    `/tmp/thoth-loop2-runtime-tools-wDRNa4`: report
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783415185110-report.json` records three Clarify
    rounds, Task approval `accept_loop`, Pyramid approval `accept_loop` and
    `registeredTaskVisible: true`. Screenshot `1783415185038-registered-pending.png` shows honest
    registration without fake running, fake review or fake evidence.
12. Background Tasks list/detail recovery passed:
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783415406577-background-tasks-success-report.json`
    records `passed_visual_and_text_recovery`, observed `Background tasks`, `registered_pending`, task
    title and source topic. Screenshot `1783415406577-background-tasks-panel-success.png` shows list and
    detail in the independent panel.
13. Mobile deep-link recovery passed:
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783416247271-mobile-loop-recovery-success-report.json`
    records `passed_mobile_deep_link_recovery` for
    `http://180.76.242.105:8148/h/srv_Qd3ONVF7rQEHNW2PJTTBxA/workspace/wks_9429345588e40559`.
    Screenshot `1783416247271-mobile-loop-registered-recovery.png` shows the registered task card and
    does not fall back to Open Project.
14. Earlier `2026-07-06` Quick+Dive repair/recovery evidence remains historical support: it proved
    multi-card Clarify, same-session quick_exec, Pyramid Plan label correction and durable topic/history
    recovery. The `2026-07-07` runtime-tool evidence closes its remaining Quick+none and Loop gaps.
15. Focused tests passed after runtime-tool-bridge implementation:
    `npm --workspace=@thoth/protocol run test -- src/thoth-runtime-contract.test.ts
src/workspace-secretary/rpc-schemas.test.ts` passed 33 tests;
    `npm --workspace=@thoth/client run test -- src/daemon-client.test.ts` passed 95 tests;
    `npm --workspace=@thoth/daemon run test:unit --
src/server/agent/tools/thoth-tools.test.ts
src/server/session/workspace-secretary/workspace-secretary-session.test.ts
src/server/agent/agent-manager.test.ts
src/server/agent/providers/codex-app-server-agent.test.ts
src/server/agent/runtime-tool-decisions.test.ts` passed 5 files / 200 tests.
16. App/build gates passed: `npm --workspace=@thoth/app run test -- src/runtime/host-runtime.test.ts
src/navigation/host-runtime-bootstrap.test.ts` passed 77 tests;
    `npm --workspace=@thoth/app run test` passed 316 files / 2621 tests; `npm run build:web` passed.
17. Final closeout gates passed on `2026-07-07`: `npm --workspace=@thoth/daemon run typecheck`,
    `npm run check:foundation` and `git diff --check`. Foundation totals were highlight 66, relay 29,
    protocol 320 and client 112.
18. Independent read-only `codex exec` UI/runtime mental-model review passed with verdict `PASS` and no
    blocking findings in
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/independent-ui-mental-model-review.md`.
19. Frontier-ledger repair revalidation on `2026-07-07` passed the required code gates:
    `npm --workspace=@thoth/protocol run test --
src/thoth-runtime-contract.test.ts src/workspace-secretary/rpc-schemas.test.ts` passed 36 tests;
    `npm run build:protocol` passed; `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts
src/server/agent/providers/codex-app-server-agent.test.ts src/server/agent/tools/thoth-tools.test.ts`
    passed 3 files / 85 tests; `npm --workspace=@thoth/app run test --
src/utils/tool-call-display.test.ts src/timeline/session-stream-reducers.test.ts
src/agent-stream/layout.test.ts src/composer/actions.test.ts
src/composer/draft/workspace-tab-core.test.ts` passed 5 files / 131 tests;
    `npm --workspace=@thoth/app run test` passed 317 files / 2628 tests; `npm run build:web` passed;
    `npm run check:foundation` passed with highlight 66, relay 29, protocol 323 and client 112 tests;
    `git diff --check` passed.
20. Local `8082` Quick + Balanced prompt `实现一个高性能快速排序` passed the strengthened soft-range
    behavior: report
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783447093160-report.json` records 5 Clarify
    rounds, Task approval, Pyramid approval, same-session quick_exec and generated files
    `quicksort.py` / `test_quicksort.py`. Screenshot
    `1783446788953-clarify-round-5.png` shows `Clarify 5` with intelligent `需求拆解` badge text and
    no raw packet/schema text; screenshot `1783447093090-quick-exec.png` shows Shell/Edit timeline
    rows during foreground execution.
21. Public `8148` Quick + Balanced prompt `实现一个高性能快速排序` passed the same path: report
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783447426182-report.json` records 5 Clarify
    rounds and generated C++ files `CMakeLists.txt`,
    `include/sorting/high_performance_quicksort.hpp`, `src/high_performance_quicksort.cpp` and
    `tests/high_performance_quicksort_tests.cpp`.
22. Local `8082` Quick + Dive prompt `实现一个高性能快速排序` passed the Dive soft range: report
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783447971613-report.json` records 12 Clarify
    rounds, Task/Pyramid approvals, quick_exec and generated files `Makefile`,
    `benchmarks/benchmark_fast_quicksort.cpp`, `include/fast_quicksort.hpp` and
    `tests/test_fast_quicksort.cpp`. Screenshot `1783447727999-clarify-round-12.png` shows
    `Clarify 12`; screenshot `1783447971544-quick-exec.png` shows Shell/Edit execution timeline.
23. Local `8082` Quick + Balanced prompt `帮我实现一个实时 PathTracing 系统` passed after extending the
    guarded e2e wait for slower file generation: report
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783449102697-report.json` records 5 Clarify
    rounds and generated files `index.html`, `src/main.js` and `src/styles.css`.
24. Local `8082` Quick + Dive prompt `帮我实现一个实时 PathTracing 系统` passed the Dive soft-range
    clarification behavior but not full quick_exec quality: report
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783449724169-report.json` records 10 Clarify
    rounds and quick_exec, but generated only `index.html` and `src/styles.css` while `index.html`
    references missing `src/main.js`. This is recorded as a residual execution-quality regression, not
    as acceptance pass evidence.
25. Local `8082` Loop + Balanced prompt `实现一个高性能快速排序` passed honest Loop registration: report
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783449979213-report.json` records 5 Clarify
    rounds, Task approval `accept_loop`, Pyramid approval `accept_loop` and
    `registeredTaskVisible: true`; screenshot `1783449979146-registered-pending.png` captures the
    `registered_pending` terminal state without fake running/review.
26. Mobile viewport was rechecked after the repair. Screenshot
    `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783450162819-mobile-registered-pending.png`
    opens the registered-pending workspace in a 390x844 viewport but shows an empty `New Agent` tab
    rather than the registered task/timeline. Treat this as a remaining mobile history/recovery
    regression; do not count mobile as revalidated for the strengthened contract.

Current result:

`NTH-EV-029` remains reopened, but the frontier-ledger repair is partially revalidated. The real
Codex evidence now verifies intelligent demand-breakdown badges, pending authority lifecycle behavior
visible in AgentTimeline, `balanced` / `dive` soft ranges, Task convergence review plumbing, local and
public web paths, same-session quick_exec for multiple prompts and Loop `registered_pending`. It does
not yet fully verify the strengthened contract because mobile registered-pending history recovery
regressed to an empty `New Agent` tab and one complex Dive quick_exec produced incomplete source
output. It also does not verify Loop-5 PlanExec / Review execution, real background running/review
evidence, non-Codex provider runtime-tool adapters or a release build.

Residual risks:

1. The real-provider journey is opt-in and outside `check:foundation`; keep the `.dev` Playwright
   runbook/script as a guarded acceptance tool until promoted to a stable `*.real.e2e.test.ts`.
2. Older failed screenshots/reports remain in the evidence directory as debug history; the success
   reports above are the acceptance authority.
3. User-visible internal-symbol hygiene is proven by source review, screenshots, reports and independent
   review, not by a full OCR scan over every generated screenshot.
4. The Background Tasks panel is a Loop-2 registered-task browser, not the final Loop-6 dogfood task
   system.

### `NTH-EV-030` Loop Background Real-Provider Verification

Status: `passed`

Scope:

1. Verify the implementation of `NTH-CD-045`: Task Card + Goals Card approval registers a
   durable background Loop task, starts scheduling immediately, runs linear goals through PlanExec and
   independent Review sessions, tracks failed-Review budgets, exposes task/goal/phase state in
   Background Tasks, and embeds phase AgentTimeline output.
2. Verify the main Codex dynamicTools path on both local `8082` and public `8148` using throwaway
   `/tmp` workspaces and external captures outside the git repository.

Implementation evidence:

1. Protocol now includes `ThothGoalsCardModel`, `LoopTaskModel`, `LoopGoalRecord`,
   `LoopPhaseRecord`, `LoopReviewVerdict`, background task RPC schemas and Loop semantic tool schemas
   for `thoth_loop_submit_planexec_result`, `thoth_loop_submit_review_verdict` and
   `thoth_loop_report_blocked`.
2. Daemon now has `ThothLoopTaskService`, persisted under daemon-owned `thoth-loop/tasks.json`.
   Startup marks previously running tasks as `interrupted`; `register`, `list`, `inspect` and
   `action(pause/resume/stop)` are exposed through session RPC and websocket updates.
3. Scheduler semantics are code-covered: same-worktree lock, queued task handling, current-goal-only
   PlanExec, independent Review, Review pass advancing to the next goal, Review fail consuming budget
   and retrying the same goal, Single budget blocking after one failed Review, and all-goals pass
   producing `done`.
4. Provider session semantics are code-covered for the Codex path: PlanExec inherits provider config
   and forces `plan_mode: true`; Review creates a fresh Auto-mode session per round; both mount
   `thoth.loop` through session-scoped `CODEX_HOME` and enable only Loop runtime tools.
5. Background Tasks UI now lists real Loop tasks, opens task detail, shows linear goals, marks the
   current goal/phase with spinner, keeps inactive goals grey, lets users switch PlanExec/Review
   phase tabs, fetches the selected phase AgentTimeline, subscribes `agent_stream` and permission
   events, and routes Pause/Resume/Stop through daemon RPC.
6. Background Tasks phase timelines now auto-scroll to the latest embedded AgentTimeline output when
   the selected phase loads or receives new stream items, preventing the embedded view from looking
   like only the initial PlanExec prompt is present.

Code verification passed on `2026-07-09`:

1. `npm --workspace=@thoth/protocol run test -- thoth-runtime-contract workspace-secretary` passed 2
   files / 37 tests.
2. `npm --workspace=@thoth/daemon run test:unit --
src/server/agent/tools/thoth-tools.test.ts
src/server/agent/providers/codex-app-server-agent.test.ts
src/server/session/workspace-secretary/workspace-secretary-session.test.ts
src/server/thoth-loop/task-service.test.ts` passed 4 files / 98 tests after the dynamicTools
   launch-config gating repair.
3. `npm --workspace=@thoth/daemon run test:unit -- src/server/thoth-loop/task-service.test.ts`
   passed 1 file / 7 tests, covering register/start, linear pass advancement, failed Review retry,
   PlanExec reuse, Review fresh-session creation, Single budget blocking, same-worktree queueing,
   pause/resume/stop and interrupted reload.
4. `npm --workspace=@thoth/app run test -- background-tasks-panel secretary-approval-card
types/stream` passed 4 files / 52 tests. The Background Tasks panel test now verifies the embedded
   phase `AgentStreamView` receives `scrollToBottom("jump-to-bottom")`.
5. `npm --workspace=@thoth/app run test` passed 319 files / 2645 tests.
6. `npm run build:daemon` passed.
7. `npm run build:web` passed and exported the web app to `packages/app/dist`.
8. `npm run check:foundation` passed: repo validation, format check, foundation lint, foundation
   build, foundation typecheck and foundation tests all passed.
9. `git diff --check` passed.

Loop hardening verification passed later on `2026-07-09` under `NTH-TD-021`:

1. Protocol/runtime schemas now persist full PlanExec result evidence, Goals Card count rationale,
   phase audit fields and stricter Review verdict semantics. Failed Review verdicts must include
   failed acceptance, root cause, next-round guidance and anti-repeat strategy; pass verdicts must
   mark all acceptance entries as met; blocked verdicts cannot mark every acceptance as met.
2. Daemon Loop task service now persists full `latestPlanExecResult`, records phase run metadata,
   validates `goal_id` / `round` / `phase` against the pending phase before resolving dynamic tool
   results, uses durable worktree locks, reloads stale running locks as `interrupted`, and feeds the
   complete PlanExec evidence into Review prompts.
3. Workspace Secretary Goals accept no longer falls back to legacy `registered_pending` production
   tasks when the real Loop service/capability is missing. It emits an honest
   `provider_unsupported` status and visible timeline message instead.
4. Background Tasks detail now exposes richer task budget/current phase summaries, pending
   Pause/Resume/Stop states and the latest PlanExec evidence block for selected goals.
5. `thoth.loop` golden coverage was promoted from shape-only examples to positive and negative
   behavior fixtures for current-goal boundaries, frozen-contract no-question behavior, concrete
   Review evidence, no Review source mutation, non-mechanical retry, provider/permission failure
   budget semantics, failed-review budget exhaustion and all-goals completion.
6. `npm run judge:loop:golden` passed. Evidence:
   `.agent-os/artifacts/loop-golden-eval-2026-07-09T16-47-13-651Z.json` and
   `.agent-os/artifacts/loop-golden-codex-judge-2026-07-09T16-47-13-651Z.md`.
7. Narrow and build gates passed after the hardening changes:
   `npm --workspace=@thoth/protocol run test -- thoth-runtime-contract workspace-secretary`
   passed 2 files / 40 tests; `npm --workspace=@thoth/daemon run test:unit --
src/server/thoth-loop/task-service.test.ts src/server/agent/tools/thoth-tools.test.ts
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 3 files / 32
   tests; `npm --workspace=@thoth/app run test -- background-tasks-panel` passed 1 file / 6 tests;
   `npm run test:drivers -- loop/eval` passed 1 file / 1 test; `npm --workspace=@thoth/app run test`
   passed 320 files / 2663 tests; `npm run build:daemon`, `npm run build:web`,
   `npm run check:foundation` and `git diff --check` passed.

Real Codex evidence captured on `2026-07-09`:

1. Local `http://127.0.0.1:8082/` Loop+Single / Clarify Balanced run used throwaway workspace
   `/tmp/thoth-loop-background-dIy278`. Report:
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-background-2026-07-09T02-22-03-920Z/1783563943719-report.json`.
   It produced 5 Clarify cards, Task Card approval, Goals Card approval, durable task
   `loop-task-13fa5321-1d5d-4a52-b655-ae2634f74d9a`, 8 linear goals and a visible Background Tasks
   detail with Goal 1 PlanExec running.
2. Public `http://180.76.242.105:8148/` Loop+Single / Clarify Balanced run used throwaway workspace
   `/tmp/thoth-loop-background-l16BGt`. Report:
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-background-2026-07-09T02-32-23-648Z/1783564545908-report.json`.
   It produced 5 Clarify cards, Task Card approval, Goals Card approval, durable task
   `loop-task-2f4cd8fb-a6a8-457d-8eea-a85df8b9932b`, 10 linear goals and a visible Background Tasks
   detail with Goal 1 PlanExec running.
3. Post-run summary:
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-background-2026-07-09T02-32-23-648Z/1783565728941-post-run-summary.json`.
   Local evidence shows Goal 1 PlanExec and Review completed with reasoning / assistant / tool_call
   AgentTimeline entries, Review pass advanced to Goal 2, Goal 2 Review failed, Single budget
   consumed `1/1`, and the task was stopped after the blocked/stop path was observed. Public
   evidence shows Goal 1, Goal 2 and Goal 3 all passed Review without consuming failed-review budget
   and the task linearly advanced to Goal 4 PlanExec before being stopped.
4. Key external screenshots include:
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-background-2026-07-09T02-32-23-648Z/1783564538646-background-task-list-detail.png`
   for task/goal detail and current-goal spinner, and
   `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-background-2026-07-09T02-32-23-648Z/1783564545842-background-task-planexec-timeline.png`
   for embedded phase timeline. Additional direct AgentTimeline evidence is in the post-run summary
   because the visual timeline starts at the long PlanExec input prompt before auto-scroll repair.
5. Daemon log evidence shows the secretary Codex session registered
   `thoth_submit_clarify_card`, `thoth_submit_task_card`, `thoth_submit_goals_card`,
   `thoth_report_blocked` and legacy `thoth_submit_pyramid_plan`; Loop phase sessions registered
   `thoth_loop_submit_planexec_result`, `thoth_loop_submit_review_verdict` and
   `thoth_loop_report_blocked`.

Known follow-ups, not claimed by this evidence:

1. Loop+Light, restart recovery and complete all-goals-to-`done` real-provider runs remain
   hardening work under `NTH-TD-021`.
2. No Claude/OpenCode native question or custom runtime-tool Loop adapter is claimed.
3. `npm --workspace=@thoth/app run typecheck` was previously attempted and still fails on broad
   pre-existing app type issues unrelated to the new Background Tasks panel; app tests and web export
   passed.

## Failed Or Not-Yet-Passed Checks

1. The full MVP loop remains open because Loop background still needs Loop+Light real-provider
   hardening, complete all-goals-to-`done` dogfood and restart recovery evidence beyond the current
   verified Single-path evidence and promoted `thoth.loop` golden judge.
2. Full daemon/app/desktop/CLI/driver build and test suites are still outside the foundation gate and may remain expected-broken until their dedicated migration milestones.
3. Some old `.tmp_pytest` fixture entries could not be unlinked promptly on NFS and were moved under ignored `.agent-os/.trash/tmp_pytest-nfs-stale-20260628`; this is not part of the committed source tree.
4. Android build currently emits upstream Expo/React Native/Gradle deprecation warnings; the Debug APK is still produced successfully.
5. Real iOS build was not run because the current environment is Linux and lacks macOS/Xcode.
6. The Code4Agent hosted relay preview path was abandoned after protected-path blockers; independent `SeeleAI/Thoth-Relay` is now the verified test relay authority.

### `NTH-EV-031` Loop Engineering Authority And Scripted Native-Codex Flow Verification

Status: `partial_verification`

Evidence recorded on `2026-07-11`:

1. The daemon Loop authority now uses `node:sqlite` WAL storage with append-only events, projection revision CAS, task memory nodes, durable worktree leases and one-time legacy JSON migration. `tasks.json` is no longer a scheduler truth source.
2. Task registration seals a workspace baseline. PlanExec and Review persist phase/timeline/command/diff/usage evidence manifests. Review source mutation, evidence mismatch and concurrent workspace change enter recoverable evidence holds instead of silently advancing a goal.
3. `thoth_submit_task_card` now launches an independent Codex Clarify convergence audit. The real trace found and fixed a catalog lifecycle defect: AgentManager builds a dynamic-tool catalog before registering the caller agent, so audit handlers now resolve the live caller at execution time. The regression unit test covers the pre-registration catalog path.
4. The opt-in native provider suite passed `5/5` in `345.73s` with no OpenRouter or generic model API: `npm run test:e2e:real:flow --workspace=@thoth/daemon -- --reporter=verbose`. It covers Quick direct, Quick Clarify foreground handoff, Clarify cancel/recover/resume, Loop+Single two linear goals to `done`, and Loop+Light Review fail -> same-goal retry -> pass -> next goal. The test uses real Codex app-server sessions and dynamic tools, but injects literal fixture arguments into every independent Secretary/PlanExec/Review session so it tests transport/state authority rather than provider planning intelligence.
5. Current-tree verification passed: daemon typecheck; `thoth-tools`, `task-service` and deterministic flow tests `43/43`; final daemon combination `146/146`; app Vitest `322/322`, `2703/2703`; `npm run check:foundation`; `npm run build:web`; `git diff --check`; `judge:clarify:golden`; `judge:clarify:user-simulation`; and `judge:loop:golden`. The user-simulation judge initially caught missing companion questions and regressed transcript refs in Task/Goals provenance; the fixture now preserves every asked question and validator rejects omissions or ref regression. Final judge evidence is `.agent-os/artifacts/clarify-golden-codex-judge-2026-07-11T21-10-00-748Z.md`, `.agent-os/artifacts/clarify-user-simulation-2026-07-11T21-07-21-858Z.md` and `.agent-os/artifacts/loop-golden-codex-judge-2026-07-11T21-08-13-725Z.md`. Trace files stay outside git at `/tmp/thoth-ut04-continuation-trace.ndjson`, `/tmp/thoth-ut04-scripted-phase-trace.ndjson` and `/tmp/thoth-ut05-scripted-phase-trace.ndjson`.

Not yet promoted by this evidence:

1. Real browser/device acceptance for `budget_wait`, pause/resume/stop and daemon restart/reconnect with the Background Tasks control surface and restored phase AgentTimeline.
2. Claude/OpenCode Loop execution adapters. They remain honest unsupported/contract-only paths.
3. This record remains partial only because the browser/device recovery evidence above is still absent, not because a current repository gate or independent judge is pending.

Follow-up repair evidence recorded on `2026-07-14`:

1. Archived Workspace Secretary agents are now excluded from automatic foreground restore regardless of
   pin/layout retention. Old persisted layouts cannot recreate an archived agent tab; History remains the
   explicit access path. This fixes the observed archived "今天天气怎么样？" topic reappearing after reload.
2. A successful Loop Goals Card registration now persists `foregroundTurnState: "background_handoff"`.
   The Secretary immediately reports `ready` with "该工作已交由后台流程继续处理。" Late terminal
   events remain timeline evidence and cannot restore a foreground spinner or error. A live snapshot for
   `topic-5883ef61-a526-492f-9a5f-16de3e84c345` confirmed that exact state.
3. Non-git evidence baselines now use bounded iterative metadata capture, exclude runtime/build caches and
   calculate changed files/lines against the sealed baseline. A real legacy task
   `loop-task-494e2c0d-f065-4713-9f70-e55c1023c439` was recovered from an erroneous `1665` changed-file
   `budget_wait` to `0/75`; its durable event is `legacy_workspace_size_budget_wait_recovered`. The later
   `evidence_invalid` state is a separate Review workspace-mutation safeguard and remains intentionally visible.
4. Background Tasks now opens without the prior `isCompactLayout` runtime exception. The surface maintains
   a readable side-by-side minimum width on desktop and switches to a stacked list/detail layout on compact
   widths. A fresh `390x844` Chromium capture confirms a one-line task title, readable controls and no
   console or page errors: `.dev/ui-review-captures/loop-repair-20260714/mobile-background-header-readable-after-final-fix.png`.
5. Current-tree verification: `npm --workspace=@thoth/app run test` passed `323` files / `2716` tests;
   targeted daemon Loop/Secretary tests passed `3` files / `73` tests; `npm run build:daemon`,
   `npm run build:web`, `npm run check:foundation` and `git diff --check` passed.

This follow-up does not promote `NTH-EV-031` to fully verified. Browser/device proof for actual
pause/resume/stop, daemon restart/reconnect and restored live phase timelines remains required.

### `NTH-EV-031` 2026-07-14 Loop Semantic-Contract And Scheduler Follow-up

Status: `partial_verification`

1. Live PlanExec, Review and blocked runtime tools now expose semantic task-language only. The daemon
   binds goal, round, phase run, runtime-tool call id and attempt generation internally; stale native
   provider turns cannot inject a late PlanExec result or independent Review assessment into the active
   phase.
2. Review now has a strict two-step contract: independent assessment first, then daemon releases the
   fallible PlanExec account for comparison. Retry Review receives the prior substantive Direction Memo
   for the same goal, but never a round, budget, receipt, manifest or task-revision obligation.
3. Real Codex app-server runs exercised the current semantic dynamic-tool contract. The all-pass path
   completed two linear goals through PlanExec, independent Review and pass. The retry path completed
   `continue -> same-goal Direction-Memo retry -> pass -> next goal -> pass`. The real tool payloads
   contained no daemon goal/phase/round ids, acceptance matrix, failed-acceptance rows or budget fields.
4. Final deterministic daemon coverage passed `5` files / `136` tests: five user journeys, Loop
   scheduler/state service, runtime-tool bridge, Codex app-server adapter and literal real-provider flow
   script contracts. The five journeys retain their intended boundary: they verify authority flow rather
   than asking the fixture provider to solve an implementation task intelligently.
5. `npm run test:drivers -- loop/eval` passed. `npm run judge:loop:golden` first found missing negative
   coverage and was repaired; its final independent Codex judge passed with 19 deterministic scenarios,
   including negative cases for Review-before-assessment, shallow/incremental Direction Memo, daemon-budget
   reasoning and a pass that consumes failed-Review budget.
6. `npm --workspace=@thoth/app run test`, `npm run build:daemon`, `npm run build:web`,
   `npm run check:foundation` and `git diff --check` completed successfully in this follow-up.

Current boundary:

1. Review uses Provider Trust for workspace access. Daemon evidence remains audit/recovery/UI material and
   does not automatically turn a workspace manifest difference into `evidence_invalid` or block lifecycle.
2. This does not close browser/device proof for task controls, restart/reconnect and complete phase-timeline
   restoration. Those remain the open acceptance evidence for `NTH-TD-021`; no screenshot or real-provider
   trace is recorded in this tracked report.

### `NTH-EV-032` Explicit Raw Provider / Thoth Entry Separation

Status: `partial_verification`

Evidence recorded on `2026-07-15`:

1. `workspaceSecretary.enabled` is an optional config field accepted by both daemon persisted config and the
   protocol patch contract. Empty new config resolves to raw Provider conversation; older saved structured
   Clarify or Loop settings preserve their opt-in behavior until the user explicitly turns Thoth off.
2. The Provider-adjacent Thoth switch hides structured controls while off. The effective Workspace Secretary
   composer is forced to `Quick + Direct`; stale stored `Loop + Dive + Infinite` preferences cannot produce a
   Clarify Card, Task Card, Goals Card or Loop registration for that send.
3. When Thoth is re-enabled, Clarify is normalized to `Light`, `Balanced` or `Dive`; it has no visible or
   effective `Direct`/`Auto` option. Loop selection remains `Quick` or background `Loop` strength.
4. Focused verification passed: app control/model tests `10/10`, protocol config tests `4/4`, daemon
   persisted-config tests `42/42`, Workspace Secretary session tests `43/43`, and `npm run build:web`.
5. Real Chromium on the local `8082` Web surface opened an existing workspace and confirmed the Provider-
   adjacent switch. It completed `on -> off -> on`: while off, both `Loop` and `Clarify` controls were absent;
   after re-enable, the stored `Loop Quick` and `Clarify Light` values returned. No page error occurred. The
   ignored captures are `.dev/ui-review-captures/thoth-entry-20260715-provider-adjacent.png` and
   `.dev/ui-review-captures/thoth-entry-20260715-switch-off.png`.

Not yet promoted by this evidence:

1. This entry does not change the remaining `NTH-TD-021` Browser/device Loop control and recovery evidence.

### `NTH-EV-033` One Workspace Secretary Topic, One Provider Session

Status: `partial_verification`

Evidence recorded on `2026-07-15`:

1. Workspace Secretary agent identity is now only `topic + provider/model/mode/settings`; the deleted
   `structured` / `bare` discriminator can no longer create two foreground provider sessions for one topic.
2. A native-tool-capable topic provisions its stable Clarify tool catalog once, including when its first turn is
   raw Provider. Raw and structured prompts remain distinct per turn, but both run through the same provider
   agent/session and preserve its conversation context.
3. The daemon now owns a provider-neutral per-turn authority fence. A raw Provider turn rejects remembered
   Thoth authority tool calls before schema parsing, so it creates no timeline card, pending decision or task.
   The fence binds provider-native turn ids when the adapter supplies them and ignores stale turn generations.
4. Persisted legacy `topic:structured:*` and `topic:bare:*` records reconcile to one canonical mapping. When
   both exist, the historical structured agent is retained for its Clarify authority context; the losing legacy
   route is removed from active routing, not used as a fallback.
5. Deterministic verification passed: Workspace Secretary and runtime-tool tests `60/60`; app Thoth control
   tests `10/10`; `npm run build:daemon`, `npm run build:web`, `npm run format:check`, `npm run check:foundation`
   and `git diff --check` passed. The daemon suite covers Thoth-on -> raw-off -> Thoth-on, raw-first ->
   Thoth-on, raw tool-call rejection and legacy mapping reconciliation.
6. The rebuilt Thoth daemon was restarted on `127.0.0.1:6688` and returned `/api/health` `status=ok`; the web
   surface on `127.0.0.1:8082` rendered in Chromium without console or page errors. Captures remain ignored under
   `.dev/ui-review-captures/`.

Not yet promoted by this evidence:

1. Real browser/provider evidence must still show one live native provider thread across an on -> off -> on
   conversation after the rebuilt daemon is restarted. This is a product smoke gap, not a deterministic-state
   or compile failure.

### `NTH-EV-034` Per-Send Quick/Loop Hot-Switch Authority

Status: `code_verified`

Evidence recorded on `2026-07-16`:

1. Protocol models now persist optional provider-neutral `turnControls` on user turns and Task/Goal/Goals Cards.
   Legacy records without the field still parse; current sends freeze effective `mode`, Clarify strength and Loop
   strength before provider execution begins.
2. Daemon binds authority cards to the latest durable user-send snapshot, ignores provider-supplied control
   mechanics, validates approval intent against the target Card and uses the same snapshot for Loop budget and
   restart handoff. A later composer switch remains available for the next send and cannot rewrite the pending
   Card.
3. App approval cards prefer their own frozen controls over the live composer. Tests cover a Loop Card while the
   composer is Quick and a Quick Card while the composer is Loop, so only `确认注册` or `前台执行` respectively is
   exposed.
4. Daemon integration covers an existing Quick topic hot-switching to `Loop + Balanced + Light`, both authority
   cards retaining the Loop snapshot, another switch back to Quick while Goals approval is pending, successful
   background registration with the Light budget, foreground `background_handoff`, and restart restoration while
   global controls remain Quick.
5. Verification passed: Workspace Secretary/persistence `91/91`, protocol schema `13/13`, focused App `33/33`,
   App unit `2706/2706`, App browser `20/20`, `npm run build:daemon`, `npm run build:web`,
   `npm run check:foundation`, format check and `git diff --check`.
6. A read-only Chromium smoke loaded the rebuilt Web export through `127.0.0.1:8082` with HTTP `200`, title
   `Thoth`, and no console or page errors. The ignored capture is
   `.dev/ui-review-captures/workspace-secretary-hot-switch-20260716/current-web-readonly.png`.

Boundary:

1. This evidence verifies durable routing, persistence, browser-component behavior and Web surface loading. It
   does not claim a new real-provider hot-switch conversation run, and it does not close the broader
   `NTH-TD-021` control/restart/device acceptance gap.

### `NTH-EV-035` Background Handoff And Provider-Failure Recovery

Status: `code_verified_with_live_recovery`

Evidence recorded on `2026-07-16`:

1. The affected Workspace Secretary topic was read from the live daemon after restart and retained
   `foregroundTurnState=background_handoff`, `status=ready` and the submitted Goals Card. App runtime identity no
   longer includes mutable composer mode, so a hot switch cannot discard that handoff and reconstruct running
   from historical timeline tools.
2. Codex runtime sessions now link shared `auth.json` but copy `config.toml` as a private regular-file snapshot.
   New G2 PlanExec and Review session homes were inspected live and both configs were regular files. Historical
   phase recovery also re-runs the provider runtime-session adapter so old config symlinks migrate on Resume.
3. Provider stream startup exceptions now produce `interrupted(provider_stream_error)` and leave failed-Review
   usage unchanged. Explicit blocked phases are resumable from their phase cursor, and Background Tasks enables
   Resume for blocked state.
4. The live affected task `loop-task-ee84025c-7293-4ed4-98ce-f7f09e77c435` was resumed at authority revision 12.
   G1 Review completed with pass, daemon advanced to G2, G2 PlanExec completed, and G2 Review started with failed
   reviews still `0/1`. The task was not re-registered and its 11-goal lineage was preserved.
5. Verification passed: focused daemon `86/86`, focused App `51/51`, `npm run build:daemon`, `npm run build:web`,
   `npm run check:foundation`, format check and `git diff --check`. Daemon restart used the official RPC, changed
   the `6688` worker PID from `2742116` to `3647175`, restored health, and did not touch `6767`.

Boundary:

1. The task remains a live background execution and this evidence does not claim all 11 goals are done. The final
   historical-session migration patch is built for the next restart but was not used to interrupt the newly
   recovered live G2 phase.

### `NTH-EV-036` Background Loop Review Apply Live Stream Recovery

Status: `verified_for_scoped_behavior`

Evidence recorded on `2026-07-16`:

1. Root cause was the live-event routing boundary, not Provider permission continuation. Loop PlanExec/Review
   agents are internal and therefore correctly filtered from global `AgentManager` subscribers, but Background
   Tasks previously fetched only a timeline snapshot. A pending card could render from that snapshot while its
   later `permission_resolved`, completed tool and reasoning events were still discarded by the global internal
   filter, leaving `respondToPermissionAndWait()` to reach its 15-second timeout.
2. A daemon WebSocket session now installs one idempotent, agent-targeted subscription only after
   `recoverPhaseAgent(agentId)` confirms a registered Loop phase and the loaded snapshot is internal. Switching
   phases releases the old subscription; session cleanup always releases the current one. Global subscriptions
   still hide every internal state/stream, and targeted internal `agent_state` never enters foreground
   `agentUpdates`.
3. The shared forwarding path now emits the existing `agent_stream`, `agent_permission_request` and
   `agent_permission_resolved` messages for the viewed phase with `internal: true`. No protocol schema, client API,
   App permission-card contract or Review write boundary changed.
4. Focused regression passed: daemon `session.test.ts` plus `agent-manager.test.ts` passed `2` files / `249`
   tests; Background Tasks App regression passed `1` file / `13` tests. `npm run build:daemon`,
   `npm run build:web`, `npm run check:foundation`, `npm run format:check` and `git diff --check` passed. The
   one direct `./node_modules/.bin/oxfmt packages/daemon/src/server/session.test.ts` invocation was only the
   documented single-file debug correction after the root format gate identified that file; the subsequent
   root format gate is the acceptance result.
5. Real Chromium on `127.0.0.1:8082` observed native Codex Review agent
   `5aed1a5d-90d9-4753-8ed6-c3f81249d507` for task
   `loop-task-284b34e3-8cef-4235-a167-732e2ce26737`. The exact WebSocket order was sequence `692`
   `permission_requested` (`Apply file changes`) -> `694` browser `agent_permission_response` -> `695` scoped
   internal `permission_resolved` -> `697` `apply_patch completed` -> `705` later Review reasoning. The permission
   card disappeared in `242ms`, with no refresh and no page error. A second Review repeated the Apply path in
   `253ms` and then continued into a separately approved artifact compile command.
6. Review wrote only
   `.dev/thoth-runtime/home/thoth-loop/review-artifacts/loop-task-284b34e3-8cef-4235-a167-732e2ce26737/loop-phase-2b580dfc-5056-42ab-8e2e-73f4213cc9cb/state_contract_probe.cpp`.
   The sealed `review_start` and `review_result` receipts have identical tree, Git status/diff hashes, HEAD,
   changed-file count and changed-line count, proving Review did not change the throwaway workspace. A live
   foreground-agent probe found zero leaked phase agent IDs.
7. Ignored evidence is under
   `.dev/ui-review-captures/loop-background-approval-20260716T094404Z/`. The machine-readable acceptance report is
   `final-acceptance-report.json`; `prng-websocket-summary.json`, `daemon-final-prng.json`, the before/resolved
   screenshots and `prng-review-g4-completed-history.png` preserve the ordered stream, visibility boundary and
   inspected UI state. Both new throwaway acceptance tasks were explicitly stopped; no `running`, `queued` or
   `awaiting_provider` task remained, and legacy port `6767` was not inspected or touched.

Boundary:

1. This verifies the reviewed internal Loop phase permission/stream defect and Background Tasks UI recovery. It
   does not close real browser/device `budget_wait`, pause/resume/stop or daemon restart/reconnect acceptance;
   `NTH-TD-021` remains the single top next action.

### `NTH-EV-037` MVP Beta Cross-Platform GitHub Release

Status: `verified`

Evidence recorded on `2026-07-17`:

1. The development line `agent/dev/mvp` was guarded-pushed to
   `dd3a768a17832cb4926cdb3a6f8d9c1e77139909`; the dedicated release line reached
   `aada0ca3c970f62c9ade2b7b289e5cb1b579901a`. Remote `main` remained exactly
   `e74c6e0de8a110d5e07249880d0e4e4f0ceab691` throughout the release operation.
2. GitHub Actions run `29551530114` completed successfully. Its preflight passed clean `npm ci`, explicit
   Electron setup, release contract, foundation, full release-runtime build, App, daemon, desktop and CLI tests,
   web export, diff hygiene and secret/protected-path checks. Native jobs passed macOS arm64/x64, Windows
   arm64/x64, Linux x64, universal Android, real Relay v3 and server CLI install/daemon smokes on Linux, macOS
   and Windows.
3. The workflow published public prerelease `v0.0.0-mvp-beta` as Release `355463767`, with tag target
   `aada0ca3c970f62c9ade2b7b289e5cb1b579901a`. The exact 27-asset manifest contains updater metadata,
   `BUILD-SOURCE.txt`, `SHA256SUMS`, macOS DMG/ZIP, Windows NSIS/ZIP, Linux AppImage/DEB/RPM/tar.gz, the signed
   Android APK and the server CLI tgz. The only other Release remains `thoth-plugin-final-archive`.
4. Selected assets were downloaded again from the public Release rather than reused from local or Actions
   output. `Thoth-x86_64.AppImage` is `139663376` bytes with SHA-256
   `b3c2032d8aaed314def22602b2bb770d9d4aec1e18062a62a94fd2a84c4c7262`; after extraction it passed the
   packaged desktop smoke for cold CLI daemon start, desktop-managed daemon, bundled CLI status and PTY terminal
   create/send/capture/kill.
5. The downloaded `Thoth-0.0.0-mvp-beta-android.apk` is `151915238` bytes with SHA-256
   `9852f1c5d3ab6132609c451df1ca390f08dd45f399ed277b84ccd38027e45d30`. It is package `sh.thoth`, version
   `0.0.0-mvp-beta`, contains arm64-v8a/armeabi-v7a/x86/x86_64, verifies with APK Signature v2 and the dedicated
   Thoth MVP Beta certificate, and requests neither `RECORD_AUDIO` nor `SYSTEM_ALERT_WINDOW`.
6. The downloaded `thoth-server-cli-0.0.0-mvp-beta.tgz` is `1415642` bytes with SHA-256
   `8ac62bc6c61f716fc5e7303193244c2ec4959a46eec5b7f5355abf9fb1922836`. Both the downloaded file and the exact
   GitHub URL installed globally into isolated prefixes, reported version `0.0.0-mvp-beta`, contained both
   runtime `SKILL.md` files, and started/statused/stopped an isolated daemon through lifecycle RPC. npm registry
   lookup returned `E404` for `@thoth/cli@0.0.0-mvp-beta`, confirming this flow did not publish the package.
7. Failed precursor runs were retained as evidence rather than hidden: `29547536716` exposed cold protocol/Relay
   order, `29547906169` exposed skipped Electron postinstall, `29548363865` exposed daemon/highlight cold builds
   and Windows shell differences, and `29549799359` exposed npm/PowerShell short-option rewriting. The successful
   workflow now locks each correction in `scripts/mvp-release-contract.mjs`.

Release:

<https://github.com/SeeleAI/Thoth/releases/tag/v0.0.0-mvp-beta>

### `NTH-EV-038` Installed Flow, Branding And Build-ID Update Release

Status: `verified` for packaging, native build and public Release replacement; installed real-provider Relay
Clarify/Loop behavior remains open under `NTH-TD-016`.

Evidence recorded on `2026-07-17`:

1. Commit `3ff79cad96b7717c37ac8257e05788e20ec1feb3` implements per-send Thoth binding to the visible
   provider agent, daemon-owned remote workspace cwd, transparent rounded platform assets, Android/Web module
   isolation and fixed-tag commit-based update clients. Local full App tests passed `2728`, daemon tests passed
   `3166`, final protocol tests passed `343`, desktop tests passed `171`, and focused update settings tests passed
   `49`; foundation, daemon/web builds, release/brand contracts and diff checks passed.
2. Local native review built a dedicated-key signed `sh.thoth` APK and Linux AppImage. It caught and repaired two
   release-only Linux defects before push: non-AppImage installations selecting the AppImage asset, and
   AppImage replacement attempting a cross-filesystem rename from the system temporary directory. An exported
   Chromium startup screenshot shows the transparent Thoth mark rather than the Paseo mark.
3. GitHub Actions run `29571377829` completed successfully at the same commit. Clean preflight, real Relay,
   server CLI plus Linux/macOS/Windows install smokes, macOS arm64/x64, Windows arm64/x64, Linux x64 and signed
   universal Android all passed before publish.
4. Public prerelease `355615612` has tag target `3ff79cad96b7717c37ac8257e05788e20ec1feb3`, is not a draft,
   and contains `28` assets. The repository still contains exactly the current MVP prerelease and
   `thoth-plugin-final-archive`; remote `main` remains `e74c6e0de8a110d5e07249880d0e4e4f0ceab691`.
5. Public `MVP-UPDATE.json` identifies workflow `29571377829`, the exact release commit and seven preferred update
   assets. `BUILD-SOURCE.txt` agrees. The manifest and source receipt are included in public `SHA256SUMS`.
6. Re-downloaded public assets matched `SHA256SUMS`: Android APK
   `8a563923c77db896a767396aa6f8a91502b12a40d40577580dd718d7f8435d74`, AppImage
   `cbbca01c88d082c0f9786bf55842ce5ed222f4721930afa527fe6ad3871a91e8`, and server CLI tgz
   `698b4e3961b9106a9784464f81fa1e3cb39f103431c01fef470aeb0f58ef6dc0`.
7. The downloaded APK is `sh.thoth` `0.0.0-mvp-beta`, verifies with APK Signature v2, requests
   `REQUEST_INSTALL_PACKAGES`, and requests neither `RECORD_AUDIO` nor `SYSTEM_ALERT_WINDOW`. The downloaded
   AppImage embeds the exact commit in `build-identity.json`; its `app.asar` contains Clarify/Loop `SKILL.md`, the
   build-ID updater and no legacy Paseo brand-mark path.
8. Migration boundary: already-installed old clients still contain the legacy updater and need one manual install
   of this replacement. No claim is made that remote metadata can retrofit that old binary. After this install,
   later fixed-semver replacements are selected by commit and verified by size/SHA-256.

Release:

<https://github.com/SeeleAI/Thoth/releases/tag/v0.0.0-mvp-beta>

### `NTH-EV-039` Packaged Product API Journey

Status: `verified` for the local and publicly downloaded Linux AppImage product journey, native packaging and
fixed MVP Release replacement. A combined installed-AppImage-through-Relay UI journey remains outside this
evidence item.

Evidence recorded on `2026-07-18`:

1. `scripts/acceptance/thoth-api-journey.mjs` defines one public product journey independent of Electron,
   provider implementation and fixture internals: `raw -> Quick Clarify -> raw -> Loop -> Review fail -> retry
-> pass -> done`. The AppImage launcher owns only isolated process setup and evidence collection.
2. The Journey uses one visible Agent for all foreground turns. It asserts one provider session across raw,
   Quick and Loop hot switching, Card submission through the Agent-scoped revision/CAS API, foreground
   `background_handoff`, one failed-Review budget charge and final background `done`.
3. A freshly rebuilt `packages/desktop/release/Thoth-x86_64.AppImage` passed the deterministic external-harness
   Journey in `14.792s`: five foreground turns, three PlanExec phases, three Review phases, one failed Review and
   eight dynamic-tool threads. The runtime build plus AppImage packaging took `75.270s` while reusing the Web
   export.
4. The same AppImage and identical Journey passed against real Codex in `196.341s`. It preserved provider session
   `019f7434-9dee-7311-b321-47fed8974910`, registered task
   `loop-task-cd97794c-0af5-4c79-a372-6dee40f425d2`, consumed one failed Review and reached `done`.
5. Both runs mounted packaged `thoth-clarify/SKILL.md` and `thoth-loop/SKILL.md`, inspected `app.asar` for removed
   Workspace Secretary execution symbols and used the daemon managed by the AppImage. The real-run daemon and
   desktop logs contain no read-only SQLite, catalog probe, feature probe or command probe failure.
6. Focused daemon typecheck passed; six provider/Loop test files passed `283/283`; the public foreground API suite
   passed `5/5` in `6.61s`; `git diff --check` passed. Ignored receipts are under
   `.dev/real-appimage/fast-api-result/` and `.dev/packaged-appimage-thoth-flow-fast-rebuilt/`.
7. A fresh Electron/Xvfb UI canary then caught two projection defects that API-driving could not expose. The
   Clarify renderer submitted its inner question-form ID instead of the outer authority Card ID, and Task/Goals
   timeline Cards omitted the frozen turn controls, hiding Quick/Loop approval actions. Both were corrected and
   locked by component/runtime-tool tests.
8. The ninth empty-state AppImage UI run selected Codex/GPT-5.4 from an unconfigured draft, enabled Thoth, rendered
   and submitted two real Clarify Cards, displayed `确认继续` on Task and `前台执行` on Quick Goals, and completed
   the same visible session with `FOREGROUND_EXEC_DONE`. It then consumed frozen Loop/Single controls, displayed
   `确认注册`, reached foreground `background_handoff` with an editable Composer and no Interrupt spinner, and
   completed background task `loop-task-25ccf47f-368b-4cdd-8339-f80f5530fff3` with both goals passed. Ignored UI
   evidence is under `.dev/real-appimage/ui-canary-ninth/`.
9. Final local promotion gates passed full App (`324` files / `2673` tests), daemon (`230` passed files / `3123`
   passed tests), foreground public API (`5/5`), desktop (`26` passed files / `171` tests), CLI (`40/40`), release
   and brand contracts, foundation, Web/runtime/AppImage builds and diff hygiene. Clarify golden, Clarify user
   simulation and Loop golden independent Codex judges all passed. The Loop dataset now explicitly rejects
   Review permission denial, provider crash and timeout being modeled as semantic Review failures or consuming
   failed-Review budget.
10. GitHub Actions run `29639444687` passed clean preflight, real Relay v3, server CLI packaging and Linux/macOS/
    Windows installation smokes, unsigned macOS arm64/x64, unsigned Windows, Linux x64, signed universal Android
    and publish. The Linux native job built the final AppImage and ran the packaged Clarify/Loop product journey
    before upload.
11. Public prerelease `356074788` contains exactly `28` assets and targets
    `5f196637316d945651645cebf22eee52724ece53`. Remote `agent/dev/mvp`, `release/mvp-actions` and tag
    `v0.0.0-mvp-beta` all pointed to that commit at publication; `main` remained
    `e74c6e0de8a110d5e07249880d0e4e4f0ceab691`, and `thoth-plugin-final-archive` remained the only other Release.
12. Publicly re-downloaded assets matched `SHA256SUMS`: AppImage
    `603076f874c8c0c0f653f703b97a6ed60a4d7b2e470030b99eb9a8deafe4ca81`, Android APK
    `484f4835afbe771e71b093c3de82273f5c555fb94b3a4ab4a16ea86c1c07149a` and server CLI tgz
    `6e72b9525a82bbea78151cdb9bf5b96f4cffdf5e1014b021a43466565d4f913a`. `MVP-UPDATE.json` and
    `BUILD-SOURCE.txt` identify the same commit and workflow run.
13. The publicly downloaded AppImage repeated the deterministic public API journey successfully: five hot-switch
    foreground turns on one visible session, session-scoped Clarify/Loop skills, three PlanExec calls, three
    Review calls, one failed-Review retry and final background `done`. The public APK is `sh.thoth`
    `0.0.0-mvp-beta`, verifies with APK Signature v2, requests update installation, and requests neither recording
    nor overlay permission. The exact one-line GitHub URL installed the CLI into an isolated prefix; version,
    packaged skills and isolated daemon start/status/stop passed.

Boundary:

This evidence validates the local and public Linux package, public CLI/APK contracts and native release matrix.
It does not claim a combined installed-AppImage-through-Relay UI journey or manual device interaction for
Pause/Resume/Stop and restart/reconnect.

### `NTH-EV-040` Durable Card Suspension And Automatic Continuation

Status: `verified` for deterministic daemon authority, provider-stream fencing and App Card interaction. A newly
packaged AppImage/manual five-hour wall-clock run remains a promotion check, not evidence claimed here.

Evidence recorded on `2026-07-19`:

1. Runtime authority Card tools no longer keep a process-local Promise pending until the user answers. Card
   creation commits SQLite authority, marks the provider turn parked, completes the semantic tool call and
   interrupts that exact run. Card authority remains pending without an elapsed-time expiry.
2. AgentManager suppresses reasoning and assistant timeline events from every parked provider turn until its
   terminal event is processed. The fence remains valid even if a newer continuation turn becomes active.
3. Card answers append the submitted Card and start a new same-session continuation from durable Task Truth.
   If the old run is still in generator cleanup, ForegroundTurnCoordinator keeps polling its provider-neutral
   in-flight contract and starts the continuation after release; it cannot silently return and require a manual
   `continue` prompt.
4. The deterministic public foreground API journey passed `5/5` and completed raw -> Clarify -> Task -> Goals ->
   Quick -> raw on one visible provider session. Its provider fixture deliberately emitted late reasoning and
   assistant text during Card interrupts; neither marker appeared in the durable timeline.
5. Authority/tool/fence focused suites passed `22/22`; App Card/state suites passed `12/12`. They cover a Card
   remaining pending across a simulated year, process-memory loss, CAS answer persistence, old-turn fencing,
   immediate `recommend` submission and idle/no-spinner projection while awaiting a Card.
6. Full daemon unit passed `3124/3124`; full App passed `2692/2692`; daemon/Web builds and
   `check:foundation` passed. Full lint completed with zero errors and the repository's existing warning-only
   baseline.
7. A newly rebuilt `packages/desktop/release/Thoth-x86_64.AppImage` passed the isolated packaged Product API
   Journey. One visible Agent kept provider session `scripted-thread-2463126` across nine raw/Card/Quick/Loop
   turns; Loop task `loop-task-86fa278d-357c-44de-9861-9e4c318eee8d` ran three PlanExec and three Review calls,
   consumed exactly one failed Review and reached `done`. The packaged foreground and internal phase sessions
   mounted the expected Clarify/Loop skills.
8. GitHub Actions run `29683323966` completed successfully at `00b470a7`. All native, Android, CLI, Relay and
   publish jobs passed. Public prerelease `356321706` contains 28 assets; its `BUILD-SOURCE.txt` and
   `MVP-UPDATE.json` identify commit `00b470a7a552997ec0f5cbcc921b00cabf25fa06` and workflow
   `29683323966`, while `SHA256SUMS` contains all 27 downloadable payload/update assets. The repository retains
   only this MVP prerelease and `thoth-plugin-final-archive`; `main` remains `e74c6e0d`.

### `NTH-EV-041` Startup Brand Asset Unification

Status: `verified` for source, Web export and local Linux AppImage resources. A macOS cold-start screenshot from
the next native package remains the visual platform confirmation.

Evidence recorded on `2026-07-19`:

1. The desktop/Web branch of `StartupSplashScreen` contained a standalone embedded SVG silhouette instead of the
   shared `ThothLogo`. It now renders the same transparent `thoth-brand-mark.png` used by welcome and project
   screens; animation changes only opacity and brightness and no longer owns brand geometry.
2. Four archived feather brand images under `assets/icons/arcade-inventory/brand/` were deleted. The brand gate
   rejects their former paths and SHA-256 hashes, so renaming or relocating those exact assets cannot restore
   them.
3. `npm run check:brand-assets`, `npm run format:check`, `npm run build:web` and `git diff --check` passed. The Web
   export asset list contains `thoth-brand-mark` and no archived brand asset or old embedded-path fingerprint.
4. A fresh `Thoth-x86_64.AppImage` was built and extracted. Its `resources/app.asar` and
   `resources/app-dist` contain none of the four archived paths or the old SVG fingerprint. A clean HOME/XDG/
   THOTH_HOME launch reached the welcome screen with the Thoth moon-and-pen mark.
5. The dev Metro startup E2E was attempted but did not mount the application because its existing renderer path
   raised `Cannot use 'import.meta' outside a module`; it is not counted as branding evidence. CDP attached after
   the short startup splash had already completed, so no transient-frame screenshot is claimed.
6. GitHub Actions run `29688512132` completed successfully at
   `b19191ba39cd9c65f497abdf92e4b629a348337b`. Preflight, real Relay, server CLI plus three native CLI smokes,
   Linux, Windows, macOS x64/arm64, signed Android and publish all passed. The sole MVP prerelease was replaced as
   Release `356353956` with exactly 28 assets; `main` remained `e74c6e0d`.
7. Public `BUILD-SOURCE.txt` and `MVP-UPDATE.json` identify commit `b19191ba` and workflow `29688512132`, while
   `SHA256SUMS` covers 27 downloadable payload/update assets. The re-downloaded public AppImage matched its
   checksum, embedded the same build identity, contained `thoth-brand-mark`, and contained none of the four
   archived paths or old SVG fingerprint in either `app.asar` or `resources/app-dist`.

### `NTH-EV-042` Windows Runtime Skill CRLF Compatibility

Status: `verified` for merged source, Windows-native release build and publicly downloaded packaged skills.

Evidence recorded on `2026-07-20`:

1. PR `#12` was merged with merge commit `1b6c016479846952dd44543743373392295a78ab`. Its parents are the exact
   previous release `b19191ba` and reviewed contributor commit `f2d442e5`; the PR is recorded as merged rather
   than squashed or rebased.
2. The merged parser accepts LF and CRLF YAML frontmatter. Runtime Skill containment and Clarify/Loop mount-path
   checks use platform-native `relative`, `sep`, `isAbsolute` and `join` behavior instead of POSIX-only string
   separators.
3. The isolated merge result passed drivers `7/7`, foundation `549/549`, a clean dependency-graph
   `build:release-runtime`, MVP release contract, brand contract and diff hygiene. The first shared-node_modules
   release build was rejected as cross-worktree dependency contamination and was not counted as code evidence.
4. GitHub Actions run `29724438993` passed preflight, real Relay, Linux, Windows, macOS x64/arm64, signed Android,
   server CLI and all three native CLI smokes. Publish replaced only `v0.0.0-mvp-beta` as Release `356572010`
   with 28 assets; `main` remained `e74c6e0d` and the archive Release remained intact.
5. Public `BUILD-SOURCE.txt` and `MVP-UPDATE.json` identify commit `1b6c0164` and workflow `29724438993`;
   `SHA256SUMS` verified the re-downloaded Windows x64 ZIP, Linux AppImage and server CLI tgz.
6. Both Runtime Skills extracted from the public Windows x64 `app.asar` have real CRLF line endings. The parser
   extracted from that same package parsed `thoth.clarify` and `thoth.loop` successfully, with non-empty bodies
   of `13876` and `6977` characters respectively.

### `NTH-EV-043` Workspace / Task Authority And Universal HarnessAdapter

Status: `local_verified_release_pending`. The final product architecture and local packaged journeys are
verified. Native GitHub Actions and verification of the replacement public Release are not yet claimed.

Evidence recorded on `2026-07-21`:

1. `.thoth` now uses one global catalog, one normalized SQLite authority shard per Workspace, content-addressed
   RuntimeBundles and provider-owned thread handles. The repository guard rejects `.thoth/provider-sessions`,
   copied provider homes, old foreground/Loop execution RPCs, full-projection event duplication and provider-name
   business routing.
2. The common HarnessAdapter and ToolGateway path passed all provider transport fixtures: drivers completed `46`
   files / `583` tests with `3` files / `21` tests explicitly skipped, and daemon lifecycle conformance completed
   `5/5` for Codex, Claude Code, OpenCode, Pi and ACP. Codex additionally completed a real-provider AppImage run.
3. Workspace authority acceptance completed `30/30`; App Task surface acceptance completed `19/19`. These cover
   one-shot storage migration, command idempotency/CAS, Human Decision persistence, Task context, Card suspension,
   Quick/Loop unification, failed-Review retry and immediate Stop projection without a running spinner.
4. The real Codex AppImage journey kept one visible provider thread through `10` raw/Thoth hot-switch turns,
   consumed exactly one failed Review, attached `thoth.loop` to all `6` background phase attempts and used
   `9,412,373` bytes of durable Thoth state. No provider-session directory or hidden foreground Secretary Agent
   was created.
5. A newly rebuilt final AppImage then passed the deterministic public journey with `13` hot-switch turns, one
   failed Review, three PlanExec calls, three Review calls, six Loop attachment receipts, one-shot legacy layout
   migration, structured Task context and a stopped Task with no active execution. Durable state was `6,428,194`
   bytes and exactly two RuntimeBundle digests existed.
6. The final server CLI tgz was installed as a non-root user in `node:24-bookworm-slim`, which has no `ps`. Over
   hosted Relay v3 + E2EE it completed Clarify, Quick, Loop, Card submission across daemon restart, client
   reconnect, one failed-Review retry, Pause/Resume, Stop, five PlanExec calls, five Review calls and six Loop
   receipts. Pairing credentials were absent from URLs, logs and the report.
7. Recovery defects found during the journey were fixed at their owning boundaries: visible Agents are restored
   before Card/continuation timeline writes; resumed provider threads reattach the exact RuntimeBundle tool
   catalog; Pause is consumed at the PlanExec transaction boundary; Stop owns `stopping -> stopped`; canceled
   provider terminals cannot rewrite it as interrupted.
8. CLI stop no longer depends on `tree-kill` or `ps`. The PID lock identifies the supervisor owner, POSIX provider
   processes use native process-group signals, stale-lock reachable shutdown uses lifecycle RPC and forced stop
   does not scan unrelated descendants. The full CLI suite passed `40/40`, including supervisor restart,
   ownership, stale lock and worker-disconnect regressions.
9. Final local gates passed: full App `327` files / `2688` tests, daemon `188` files / `2519` tests, drivers
   `46` files / `583` tests, desktop `26` files / `171` tests, foundation `552` tests, AppImage and hosted Relay
   journeys, daemon/client/protocol builds and typechecks, release/brand contracts, secret and removed-path scans,
   formatting and diff hygiene. Clarify golden, Clarify user simulation and Loop golden independent Codex judges
   all passed.

Boundary:

The fixed public `v0.0.0-mvp-beta` Release still contains the prior commit. `NTH-EV-043` becomes fully verified
only after both target branches are pushed, every native workflow job succeeds, the sole MVP Release is replaced
and the public AppImage/APK/CLI plus source/update/checksum receipts are downloaded and revalidated.
