# Run Log

## 2026-07-13 [Quick/Loop authority split and non-blocking Loop registration]

- Worked on: `NTH-TD-018`, `NTH-TD-019`, `NTH-TD-020`, `NTH-TD-021`
- User-visible request: Loop approval cards must not offer foreground execution; Quick approval cards must not offer background registration. Selecting Loop Goals Card registration must return promptly rather than failing with `Connection timed out`.
- Root cause: approval cards always rendered both `accept_quick` and `accept_loop`, and Workspace Secretary accepted either intent without checking the frozen composer mode. Separately, Loop `register()` synchronously captured the complete workspace evidence baseline and started scheduling inside the WebSocket answer handler. A live daemon receipt recorded `eventLoopDelay.maxMs: 631897.1` while an `workspace_secretary.answer.request` was handled; synchronous Git status/diff capture on a large worktree starved the event loop long enough for the client request to time out.
- State changes: approval cards now expose exactly one execution action from the daemon-backed composer mode: Quick offers foreground continuation/execution only; Loop offers background continuation/registration only. The daemon rejects inverse `accept_quick`/`accept_loop` intents while preserving the unresolved card. Loop registration now persists the task and replies before worktree evidence capture. Baseline and phase evidence use asynchronous filesystem/Git operations, and the scheduler enters through `setImmediate`, so it cannot block the reply path; PlanExec begins only after the baseline is captured.
- Regression coverage: app approval-card tests verify the mutually exclusive Quick and Loop actions and emitted intents. Workspace Secretary tests verify direct cross-mode RPC is rejected without folding the card. Loop task-service tests gate baseline capture and verify registration has already returned while capture is pending, then PlanExec begins only after it resolves.
- Evidence produced: app narrow tests passed (`2 files`, `29 tests`); daemon narrow tests passed (`2 files`, `65 tests`); `npm run build:web`, full `npm --workspace=@thoth/app run test`, `npm run check:foundation` and `git diff --check` completed successfully. The daemon acknowledged `restart_server_request` in `1ms`; its supervisor replaced worker `4081400` with `920916` and recovered `127.0.0.1:6688`. A real Chromium smoke of `http://127.0.0.1:8082/` after restart reached `/open-project` with no page or console error; the capture is ignored local evidence at `.dev/thoth-runtime/loop-registration-smoke.png`. No existing approval card was submitted during smoke, so a real provider registration is not claimed here.

## 2026-07-13 [Durable authority-card recovery]

- Worked on: `NTH-TD-016`, `NTH-TD-021`
- User-visible request: An unanswered authority card must have no maximum lifetime. After daemon restart or provider KV-cache/session loss, reopening the topic must show the current card and let the user submit it; only explicit user cancel may end it.
- Root cause: pending runtime authority decisions were treated as in-memory provider tool-call leases. The old elapsed timeout could mark them `expired`, and the persisted reload path converted a previously `pending` decision into `blocked`. In addition, authority persistence was initialized only when the dynamic tool catalog happened to load, so a post-restart snapshot could miss the pending decision before a new provider session was created.
- State changes: removed elapsed-time expiry and timer cleanup from runtime authority decisions. Startup now restores every non-answered, non-blocked-card authority record as pending, including historical expired/rejected records, with the original card id and metadata. Workspace Secretary configures the decision persistence store during construction, so snapshot recovery has the pending index before any dynamic tool call is mounted.
- State changes: persisted topic loading keeps a topic with an unsubmitted authority card in `loading` with an explicit waiting-for-user state. If the old provider session cannot be resumed, the daemon retains its durable timeline as history-only and creates a replacement structured session in the same topic after the user's answer. The replacement uses the durable topic/card/transcript/answer context rather than treating provider cache loss as an invalid card.
- State changes: duplicate submits no longer produce an expired/stale-card error or mutate the card. They leave the topic ready with an idempotent "already submitted or cancelled" result. Explicit Cancel remains the only path that folds unresolved authority cards and resolves their pending tool calls.
- Regression coverage: runtime-decision tests prove a pending card survives simulated process loss and remains pending after a full year of fake elapsed time. Workspace Secretary coverage simulates daemon restart plus an unrunnable OpenCode provider session, verifies the original card remains unsubmitted and visible, then verifies that submission creates a same-topic replacement structured session and continues with the durable runtime context.
- Evidence produced: `npm run format`, `npm run format:check`, the affected daemon unit suite (`170/170`), app Workspace Secretary core tests (`27/27`), `npm run build:daemon`, `npm run build:web`, `npm run check:foundation` and `git diff --check` passed. A production-source scan found no remaining elapsed-time authority timeout constant or obsolete "card expired" product message.
- Remaining unrelated baseline: the full daemon unit command still has five failures in four untouched legacy areas: a `packages/server` path reference in the Claude hook guard, old `packages/server/dist` assertions in web-UI config tests, a home-relative directory mock and a config-file same-mtime stale-write race. They do not exercise authority decisions, topic recovery or provider-session replacement, and are not claimed as fixed by this change.

## 2026-07-12 [Quick foreground Plan+Exec handoff recovery]

- Worked on: `NTH-TD-016`, `NTH-TD-021`
- User-visible request: Debug the Quick + Clarify foreground flow that remained on a spinner for minutes after the Task Card and Goals Card had both been approved.
- Root cause: An older development daemon accepted the Goals Card and persisted `quick_exec`, but did not launch the required ordinary foreground Plan+Exec provider turn. Its UI therefore showed a running state with no in-flight provider run or timeline events. A stale local `quick_foreground:*` launch claim could also suppress a later legitimate launch after a failed start.
- State changes: Quick foreground execution now clears a stale launch claim when the provider has no in-flight run. On snapshot hydration, an approved Quick task that is still `loading`, or was interrupted by daemon restart before terminal evidence, restores the original topic provider agent/session and submits an explicit continuation Plan+Exec prompt. The continuation instructs the provider to inspect the workspace, preserve prior work, continue at the earliest unfinished approved goal, avoid Clarify/card repetition, and execute all approved goals.
- State changes: Explicit user cancellation remains terminal for automatic recovery. A topic whose persisted state is `ready` with the user-cancel summary is not silently restarted; this preserves the stop contract rather than converting it into a hidden retry.
- State changes: Moved `emitExternalSessionMessage` before `ThothLoopTaskService` construction so a task-load callback cannot access it in the temporal dead zone during daemon bootstrap.
- Evidence produced: `npm run test:unit --workspace=@thoth/daemon -- src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed, 26 tests. The new regression test covers daemon restart after approved Quick Goals Card but before provider turn start, and asserts same-session recovery uses the Plan+Exec prompt.
- Evidence produced: `npm run test:unit --workspace=@thoth/daemon -- src/server/thoth-loop/task-service.test.ts` passed, 25 tests. `npm run build:daemon` and `git diff --check` passed.
- Evidence produced: real Codex dynamicTools `UT-02-quick-clarify-foreground-success` passed in 65.787 seconds on 2026-07-12. It validates the real Task Card -> Goals Card -> same-session Quick foreground Plan+Exec handoff without OpenRouter.
- Operational note: The originally inspected topic was later explicitly cancelled by the browser, so it is correctly persisted as ready/cancelled and is not automatically resumed by this recovery path.

## 2026-07-02 [Workspace composer task surface wired]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`, `NTH-TD-002`
- User-visible request: Continue the long-running Web/Desktop/OpenTUI UI productization goal from the One Thoth shell slice, focusing next on the real Workspace surface without mocking backend task capability.
- State changes: Added `packages/app/src/composer/thoth-composer-controls.tsx`, a reusable Thoth composer rail for `+`, Provider, Mode, Clarify and Loop. It shows provider readiness from the existing real agent/draft provider/model state, keeps Loop disabled in Quick, cycles local Mode/Clarify/Loop UI choices, and marks unimplemented execution behavior as preview/needs-provider rather than task authority.
- State changes: Wired the new rail into `packages/app/src/composer/index.tsx` above the existing message input while preserving current provider submission flow. The existing file upload limit is now `10MB`, matching the locked MVP attachment rule surfaced in the rail.
- State changes: Added a Workspace draft preview surface in `packages/app/src/composer/draft/workspace-tab.tsx` with workspace/provider/host/loop readiness chips plus Active task, Contract and Evidence slots. The slots intentionally say `No frozen task yet`, `Needs Clarify session` and `Review receipts will land here` until the real backend exists.
- Evidence produced: `npm run build:web` passed and exported `packages/app/dist/_expo/static/js/web/index-9b372b8af504495884b37da2d845671e.js`.
- Evidence produced: Static scan of the exported bundle found `Images/files <10MB`, `thoth-composer-controls`, `workspace-thoth-surface-preview` and `Loop task runtime preview`.
- Evidence produced: Playwright smoke against temporary `http://127.0.0.1:8093/open-project` passed at `1440x960` and `390x844`: both found One Thoth / Task control plane / Provider / Fresh pairing supported and reported page errors `[]`. The temporary `8093` static server was stopped afterward.
- Evidence produced: `npm run format:check`, `git diff --check` and `npm run check:foundation` passed. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- Current limitation: This slice proves the real web bundle now contains the Workspace composer/task/evidence UI slots and honest unavailable states. It does not implement provider-backed Router, Clarify runtime, contract freeze, PlanExec, Review, OpenTUI or desktop packaged smoke for the full productization goal.
- Next likely action: Continue `NTH-TD-002` by connecting these UI slots to a minimal authority/task state design, or begin the OpenTUI implementation slice over shared daemon/client/protocol if the UI shell remains the priority.

## 2026-07-02 [One Thoth web shell icon surface wired]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`, `NTH-TD-002`
- User-visible request: Continue the long-running Web/Desktop/OpenTUI UI productization goal and move the real dogfood UI away from a generic/Paseo-shaped shell without mocking backend capability.
- State changes: Added a single `ThothInventoryIcon` registry for the locked 52 transparent `05-arcade-inventory` PNG assets. Replaced the in-app Thoth logo renderer with the package-local `brand-mark` PNG asset. Wired inventory PNGs into the real Web/Desktop shared `OpenProjectScreen`, sidebar footer/workspace header and Settings sidebar/detail header.
- State changes: Changed the open-project entry into a more explicit One Thoth control-plane surface with honest status chips for workspace/provider/relay/review: `Needs a registered workspace`, `Select a model first`, `Fresh pairing supported` and `Preview surface`. Existing Add project, Import session, Setup providers and Pair device actions remain connected to current real app flows.
- State changes: Made `packages/app/scripts/build-terminal-webview-html.mjs` format-stable by running `oxfmt` on its generated output, so `npm run build:web` no longer leaves the generated terminal webview file failing `format:check`.
- Evidence produced: `npm run build:web` passed and exported `packages/app/dist/_expo/static/js/web/index-199f42bfb01d2ed5ca71875d38711970.js`. Expo export listed arcade-inventory icon assets in the web bundle.
- Evidence produced: `npm run check:foundation`, `npm run format:check` and `git diff --check` passed.
- Evidence produced: Playwright smoke against `http://127.0.0.1:8092/open-project` at `1440x960` found `One Thoth`, `Task control plane`, `Needs a registered workspace` and `Fresh pairing supported`; no React page errors occurred. Playwright smoke against `http://localhost:8092/open-project` at `390x844` found `One Thoth`, `Task control plane` and exact `Provider`; no React page errors occurred. Both temporary-origin runs logged the expected local daemon WebSocket `403` console error because the smoke used a temporary `8092` origin rather than the formal dogfood origin/daemon pairing path.
- Evidence produced: A broad debug `npm --workspace=@thoth/app run typecheck` still failed on pre-existing promoted-source blockers such as missing `react-dom`/`jsdom` declarations, voice residue typing, i18n `pairAgain` key drift and unrelated app TS errors; this was not treated as a passing gate or as introduced by the UI icon shell slice.
- Current limitation: This slice improves the real Web/Desktop shared shell and keeps states honest, but it does not complete OpenTUI, task/Clarify/Loop backend behavior, full UI scorecard, desktop packaged smoke or the final multi-viewport/PTY stress matrix.
- Next likely action: Continue `NTH-TD-002` by expanding the real Workspace surface: final composer controls (`+`, Provider, Mode, Clarify, Loop), active task/contract/evidence preview slots and honest unavailable/needs-provider states, then begin the OpenTUI implementation slice over shared daemon/client/protocol.

## 2026-07-02 [Compressed UI goal prompt added]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Compress the long Thoth Web/Desktop/OpenTUI UI implementation prompt to under 3000 characters and store it in project docs for reuse.
- State changes: Added `.agent-os/designs/thoth-ui-goal-prompt.md` with a ready-to-use goal-mode prompt.
- Evidence produced: Prompt body length verified as 2714 characters.
- Next likely action: Use the prompt to launch a long-running goal-mode UI implementation session.

## 2026-07-02 [Final UI icons converted to transparent PNG]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Remove backgrounds from the final full icon set and consider `rembg` or a more mature cutout method for transparent PNG assets.
- State changes: Recorded `NTH-CD-026`. Converted the 52 final `05-arcade-inventory` PNG icons under `packages/app/assets/icons/arcade-inventory/` to transparent-background PNGs in place.
- Implementation note: `rembg` is not installed in the current environment, and generic AI matting is not ideal for these pixel-art assets. Used deterministic edge-connected flood-fill alpha extraction from the near-solid ivory background, preserving enclosed slot/card interiors and crisp pixel outlines.
- Evidence produced: Alpha verification reported 52 files, 0 issues; every final icon has alpha extrema `(0, 255)` and non-empty visible/opaque pixels. A temporary light/dark background preview was inspected and then removed so no extra candidate/preview asset remains.
- Next likely action: Use these transparent package-local icons directly in the Thoth UI shell.

## 2026-07-02 [UI branch rename requested]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Rename the current branch to `agent/dev/ui`, commit the full current working tree, and push using the repo-local GitHub token.
- State changes: Recorded `NTH-CD-025` and updated current-branch recovery facts in `AGENTS.md` and `.agent-os/project-index.md`.
- Evidence intent: Commit and push evidence will be reported in the final response after branch rename, commit and upstream push complete.

## 2026-07-02 [Final arcade-inventory icon set locked]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Make the final icon selection directly, delete all non-final candidates, and keep only one final icon version instead of candidate sets.
- State changes: Recorded `NTH-CD-024`. Promoted the final 52-icon `05-arcade-inventory` set into the app package at `packages/app/assets/icons/arcade-inventory/`, grouped by `brand`, `composer`, `mode-clarify-loop`, `task`, `workspace-connection` and `navigation-settings`.
- State changes: The final selection uses the prior `selected-v1` choices as the locked final version. The provider loadout icon intentionally keeps the "capability equipment chest" metaphor; `model-brain`, `no-provider`, `connection-health` and other previously-noted weak spots are now accepted as final for this UI shell pass rather than treated as open candidates.
- Cleanup intent: All generated exploration/candidate material under `.dev/thoth-icon-generation/` is removed after promotion. Existing provider icons such as `packages/app/assets/icons/claude.svg` and `packages/app/assets/icons/codex.svg` are not part of the generated candidate set and are not removed.
- Evidence produced: Final package asset scan found 52 PNG icons under `packages/app/assets/icons/arcade-inventory/`.
- Next likely action: Wire these final package-local icons into the real Thoth UI shell without reopening icon selection.

## 2026-07-02 [Full arcade-inventory icon candidates generated]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Use the preferred `05-arcade-inventory` direction and generate all UI icons, two candidates per role, so the final icon set can be selected.
- State changes: Generated 104 preview-only full-role candidates under `.dev/thoth-icon-generation/arcade-inventory-full-01/images/`: 52 UI roles times `a-sprite` and `b-slot`. Roles cover brand, composer controls, mode/clarify/loop, task lifecycle, workspace/connection and navigation/settings.
- State changes: Created category contact sheets plus a 64px overview. Also created `selected-v1`, a first-pass one-icon-per-role selection set under `.dev/thoth-icon-generation/arcade-inventory-full-01/selected-v1/`.
- Evidence produced: All 104 generation jobs succeeded. Main overview is `.dev/thoth-icon-generation/arcade-inventory-full-01/arcade-inventory-full-01-overview-64.png`; category sheets are `arcade-inventory-full-01-brand.png`, `arcade-inventory-full-01-composer.png`, `arcade-inventory-full-01-mode-clarify-loop.png`, `arcade-inventory-full-01-task.png`, `arcade-inventory-full-01-workspace-connection.png` and `arcade-inventory-full-01-navigation-settings.png`.
- Evidence produced: First-pass selection sheets are `.dev/thoth-icon-generation/arcade-inventory-full-01/selected-v1/selected-v1-overview.png` and `.dev/thoth-icon-generation/arcade-inventory-full-01/selected-v1/selected-v1-48-preview.png`; selection manifest is `.dev/thoth-icon-generation/arcade-inventory-full-01/selected-v1/manifest.json`.
- Design note: The full arcade-inventory set is visually coherent and readable at 48px. Potential weak spots before package promotion are `provider-loadout` as treasure chest metaphor, `model-brain` being too literal/anatomical, `add-image` being small at 48px, and `no-provider` needing a clearer missing-capability symbol.
- Next likely action: Human reviews `selected-v1`; after approval, promote selected PNGs into a package-local app UI asset directory and wire them into the Thoth shell.

## 2026-07-02 [Arcade inventory icon direction deepened]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Take the preferred `05-arcade-inventory` icon style as the starting point and deepen it into 10 distinct substyles, 5 representative UI roles each.
- State changes: Generated 50 preview-only i2i icon concepts under `.dev/thoth-icon-generation/arcade-inventory-deep-01/images/`, using the previous `05-arcade-inventory` row as the reference style parent. The five fixed roles remained `thoth-presence`, `provider-settings`, `clarify`, `loop-try` and `evidence`.
- Evidence produced: All 50 generation jobs succeeded. Contact sheets are `.dev/thoth-icon-generation/arcade-inventory-deep-01/arcade-inventory-deep-01-contact.png` and `.dev/thoth-icon-generation/arcade-inventory-deep-01/arcade-inventory-deep-01-48-preview.png`; shortlist contact sheet is `.dev/thoth-icon-generation/arcade-inventory-deep-01/arcade-inventory-deep-01-shortlist-4.png`; raw job metadata is `.dev/thoth-icon-generation/arcade-inventory-deep-01/results.json`.
- Design note: `05d-framed-item-tile` is the strongest candidate for a complete Thoth UI icon system because it is readable, contained, product-like and still game-inventory flavored. `05i-black-gold-sprite` is a strong dark/high-power variant; `05j-polished-indie` is a safe mainstream variant; `05c-isometric-relic` is attractive for larger empty states but less ideal for dense controls.
- Known issue: Several generated evidence/clarify candidates still include pseudo-text despite no-text prompting. The next generation pass should enforce icon-only composition more aggressively and avoid document/card designs that invite fake labels.
- Next likely action: If this direction is approved, regenerate the full 52-icon UI role list using `05d-framed-item-tile` as the primary style and `05i-black-gold-sprite` as the optional dark/high-power variant.

## 2026-07-02 [Thoth UI icon candidate set converged]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Work backwards from the full current Thoth UI design, identify the icon/button assets still needed to fully leave the Paseo-shaped shell, generate them with the local text-to-image service, and converge to a compact candidate set.
- State changes: Generated and inspected icon candidates for brand/presence, composer controls, mode/clarify/loop controls, task lifecycle states, workspace/connection states, and navigation/settings. Earlier colorful/cartoon candidates were rejected in favor of a minimal pixel-line style with black outline, warm gold accent and tiny red Thoth marker.
- State changes: Converged a local preview-only set of 52 PNG candidates under `.dev/thoth-icon-generation/final-candidates-v1/assets/`. These assets are not yet promoted into `packages/app`; promotion should happen after human visual approval of the contact sheets.
- Evidence produced: Final contact sheets are `.dev/thoth-icon-generation/final-candidates-v1/final-candidates-v1-overview.png` and `.dev/thoth-icon-generation/final-candidates-v1/final-candidates-v1-48-preview.png`; manifest is `.dev/thoth-icon-generation/final-candidates-v1/manifest.json`.
- Design note: The strongest candidates are the composer, task lifecycle, workspace/connection and mode icons. Weak-but-usable candidates are `provider-loadout`, `model-brain`, `connection-health`, `about-thoth` and `avatar-light`; regenerate only those if the next visual pass needs more polish.
- Next likely action: Human reviews the final contact sheets, then selected assets can be promoted into a package-local UI icon directory and wired into the real app shell.

## 2026-07-02 [Thoth icon style matrix generated]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Explore more possible Thoth icon styles while still staying within Thoth's product constraints; generate at least 10 distinct icon design styles with 5 representative UI roles each.
- State changes: Generated 50 preview-only icon concepts under `.dev/thoth-icon-generation/style-exploration-01/images/`. The five fixed roles are `thoth-presence`, `provider-settings`, `clarify`, `loop-try` and `evidence`; the ten styles are `pixel-ink`, `flat-vector`, `enamel-pin`, `woodcut-seal`, `arcade-inventory`, `technical-glyph`, `neon-console`, `paper-cut`, `clay-token` and `ink-wash-minimal`.
- Evidence produced: All 50 generation jobs succeeded. Contact sheets are `.dev/thoth-icon-generation/style-exploration-01/style-exploration-01-contact.png` and `.dev/thoth-icon-generation/style-exploration-01/style-exploration-01-48-preview.png`; raw job metadata is `.dev/thoth-icon-generation/style-exploration-01/results.json`.
- Design note: Early visual read suggests `paper-cut`, `technical-glyph`, `neon-console` and `clay-token` are the most useful style directions. `flat-vector`, `woodcut-seal` and `ink-wash-minimal` have attractive individual images but are weaker as compact functional UI systems.
- Next likely action: Choose one primary style family or hybrid rule, then regenerate only the chosen family against the full 52-icon UI role list before promoting assets into package-local app UI assets.

## 2026-07-02 [Web workspace white-screen regression fixed]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-005`
- User-visible issue: The real web review UI at `http://180.76.242.105:8148/open-project` could add a project/workspace, but clicking the workspace or sending `hi` turned the main app into a blank white page.
- Diagnosis: Playwright reproduced the blank page on workspace click and captured `TypeError: (...).channel is not a function` from the web bundle. The workspace route imported the xterm ligatures addon; that addon brought an `lru-cache` path that calls Node `diagnostics_channel.channel()`, which is not available in the browser bundle.
- State changes: Added a production web no-op `LigaturesAddon` stub at `packages/app/src/terminal/runtime/xterm-addon-ligatures-stub.ts`. Metro web export now aliases `@xterm/addon-ligatures` to the stub, the terminal webview esbuild script uses the same alias, and the app web build now regenerates terminal webview HTML before Expo export.
- Evidence produced: `npm run build:web` passed and produced `packages/app/dist/_expo/static/js/web/index-82dc0d5713cdea0252baa9435ac46581.js`. Static scans confirmed the new web bundle and generated terminal webview HTML no longer contain `diagnostics_channel`, `hasSubscribers&&` or the real ligatures addon markers.
- Evidence produced: Playwright local smoke clicked workspace `Greeting` and reached `/h/srv_Qd3ONVF7rQEHNW2PJTTBxA/workspace/wks_fe7ac40e0f64e5bb` with the real composer visible and `PAGE_ERRORS []`. A second Playwright smoke submitted `hi`; the page stayed on the workspace route with `PAGE_ERRORS []`, surfacing only the expected current `Select model` validation.
- Evidence produced: Public `curl` confirmed `http://180.76.242.105:8148/open-project` now serves the new hashed web bundle. Public fresh-browser Playwright loaded the app with `PAGE_ERRORS []`; it showed `No projects yet` because that fresh origin has no paired host registry.
- Evidence produced: `npm --workspace=@thoth/app run test -- --project unit src/terminal/runtime/terminal-emulator-runtime.test.ts` passed with 17 tests. `npm run format:check` and `git diff --check` passed.
- Next likely action: Continue `NTH-TD-002`; provider/model selection is now the next visible product-path blocker for sending `hi`, separate from the fixed web white-screen crash.

## 2026-07-01 [Thoth/Paseo runtime isolation verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-WS-005`, `NTH-MS-010`, `NTH-MS-011`, `NTH-TD-014`
- State changes: Isolated Thoth direct runtime from the local Paseo daemon. Thoth defaults now target `127.0.0.1:6688`; `127.0.0.1:6767` is reserved for the existing Paseo/legacy daemon and is not an automatic Thoth fallback.
- State changes: Added stable development entrypoints for `dev:daemon`, `dev:web:demo`, `dev:desktop`, `smoke:isolation` and Linux AppImage packaging. `scripts/dev-home.sh` gives Thoth a repo-local ignored runtime home under `.dev/thoth-runtime/`.
- State changes: Fixed web export module-script handling, desktop packaging/smoke isolation, packaged daemon path identity, CLI status isolation, Android microphone permission removal, CLI voice/speech command exposure and Thoth-specific app/package defaults.
- State changes: Moved current hosted relay test authority from the blocked Code4Agent mirror path to independent repository `SeeleAI/Thoth-Relay`. Test relay allows broad browser Origin only in test while still enforcing relay v3 subprotocol tokens.
- Evidence produced: Port checks showed Paseo PID `1567463` listening on `127.0.0.1:6767`, Thoth PID `1529981` listening on `127.0.0.1:6688` and web static server PID `1211974` listening on `*:8082`.
- Evidence produced: `curl http://127.0.0.1:6688/api/health` returned `{"status":"ok"}` and daemon status reported listen `127.0.0.1:6688`. CLI status through the Thoth dev profile reported local daemon running, connected daemon reachable, home `.dev/thoth-runtime/home`, and providers `Claude`, `Codex` and `mock`.
- Evidence produced: `npm run build:web` passed; `curl -I http://127.0.0.1:8082/` and `curl -I http://180.76.242.105:8148/` both returned HTTP `200`; Playwright smoke rendered the real app UI with no page errors and no `6767` console attempt.
- Evidence produced: `SeeleAI/Thoth-Relay` pushed commit `317bcda46571ae0ae508f4d892759eff779d9d73`; GitHub Actions run `28537212728` completed successfully; `curl https://relay.test.thoth.seeles.ai/health` returned `{"status":"ok","protocol":"3","service":"thoth-relay"}`.
- Evidence produced: Live relay load test passed with 200 clients for 10 minutes: 23972 attempted pings, 23954 pongs, 18 failures, error rate `0.0007508760220256966`, p50 `394ms`, p95 `427ms`, p99 `765ms`; receipt `/mnt/cfs/5vr0p6/yzy/Thoth-Relay/.dev/relay-live-load-test-1782929276055.json`.
- Evidence produced: Linux AppImage produced `/mnt/cfs/5vr0p6/yzy/thoth/packages/desktop/release/Thoth-x86_64.AppImage`, sha256 `6fc25b0f92cf930b5f7e43d6eb11de8a466cc54f881e8fcbb832f288acd1fd43`, size `131375945`; packaged smoke passed with isolated desktop-managed daemon on `127.0.0.1:38579`.
- Evidence produced: Android Debug APK produced `/mnt/cfs/5vr0p6/yzy/thoth/packages/app/android/app/build/outputs/apk/debug/app-debug.apk`, sha256 `9579e3cb43637b6380faf2890eb496d43d7a7cc9779c787afdf16f9d98a70fa0`, size `302700513`, package id `sh.thoth.debug`; `aapt dump permissions` did not include `android.permission.RECORD_AUDIO`.
- Evidence produced: Codex provider targeted tests passed: app-server transport plus Codex app-server agent unit tests passed 79 tests; Codex app-server local e2e passed 1 test. The broader provider local e2e command hit an unrelated missing `opencode` binary and was not treated as an isolation blocker.
- Evidence produced: CLI checks passed after disabling the speech command and voice onboarding path: `npm --workspace=@thoth/cli run typecheck`, targeted CLI supervision test and `npm --workspace=@thoth/cli exec -- tsx tests/17-onboard.test.ts`.
- Evidence produced: `npm run check:foundation`, targeted desktop daemon/packaging tests, `npm run smoke:isolation` and `git diff --check` passed.
- State documentation: Recorded `NTH-CD-022`, `NTH-REQ-018`, `NTH-AC-012`, `NTH-MS-011`, `NTH-TD-014`, `NTH-EV-006`, `NTH-EXP-005` and `NTH-EXP-006`. `NTH-TD-013` is abandoned because the independent relay repository supersedes the blocked Code4Agent path.
- Next likely action: `NTH-TD-002` - design and implement the first Thoth slice around explicit task mode, provider-backed Router, Clarify, authority store, task lifecycle and product-identical dogfood UI entry.

## 2026-07-01 [Relay v3 security and local preview verification]

- Worked on: `NTH-OBJ-001`, `NTH-WS-004`, `NTH-WS-005`, `NTH-MS-010`, `NTH-TD-012`, `NTH-TD-013`
- State changes: Implemented v3-only relay protocol with daemon-first room registration, role-scoped capability tokens in `Sec-WebSocket-Protocol`, hashed room registration, pairing/device token metadata, strict URL/origin validation, frame/pending/socket limits and seeles relay/app defaults.
- State changes: Updated protocol/client/daemon/app pairing paths for `ConnectionOfferV3`, relay token subprotocols, device token issuance and app token storage. Removed or disabled remaining web-build-blocking voice/dictation imports without reintroducing voice runtime or permissions.
- State changes: Added `scripts/sync-code4agent-relay.mjs` and root `sync:code4agent-relay` to export Thoth relay source into a Code4Agent `apps/thoth-relay` mirror; added `scripts/loadtest-relay-local.mjs` and root `loadtest:relay:local`.
- Evidence produced: `npm run build:web` passed and `npm run serve:web` is serving the real app export at `http://127.0.0.1:4173`; `curl` returned HTTP `200` for that URL.
- Evidence produced: `npm run test:relay`, `npm run typecheck:relay`, `npm run build:relay`, `npm run test:protocol`, `npm run typecheck:protocol`, `npm run build:protocol`, `npm run typecheck:client`, `npm run build:client`, `npm run test:client` all passed. Relay local E2E passed: 1 file, 3 tests.
- Evidence produced: Local 200-client / 10-minute relay load test passed with 24000 attempted E2EE pings, 24000 pongs, failures `0`, error rate `0`, p50 `18ms`, p95 `24ms`, p99 `31ms`; receipt `.dev/relay-load-test-1782889793822.json`.
- Blocker recorded: Code4Agent hosted preview deploy is blocked by active `protected-paths` push ruleset restricting `.github/**/*` and `**/*/wrangler.jsonc`, while the required mirror needs `apps/thoth-relay/wrangler.jsonc` and a `_deploy-isolated.yml` job. No hosted `.seele.chat` preview or `relay.test.thoth.seeles.ai` deployment was created.
- Next likely action: either Bot/admin applies the Code4Agent protected-path patch for `NTH-TD-013`, or development returns to `NTH-TD-002` for the first Thoth product slice.

## 2026-06-30 [Repo-local GitHub CLI wrapper added]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`
- State changes: Added `scripts/gh-local.mjs` and root `npm run gh -- ...` as the standard repository-local GitHub CLI entry. The wrapper forces `GH_CONFIG_DIR` to ignored `.dev/gh`, preserving the current machine's global `gh` login state.
- State changes: Updated `AGENTS.md` and `docs/development.md` so agents use `npm run gh -- ...` for private GitHub repository and workflow access, and do not run global `gh auth login` for Thoth work.
- Evidence produced: `npm run gh -- api user` confirmed the repo-local authenticated identity; `npm run gh -- repo view SeeleAI/Code4Agent` reported private repo access with `viewerPermission=WRITE`; `git check-ignore -v .dev/gh .dev/gh/hosts.yml` confirmed `.dev/gh` is ignored; `npm run validate:repo`, `npm run format:check` and `git diff --check` passed.
- Next likely action: `NTH-TD-002` - design and implement the first Thoth slice around explicit task mode, provider-backed Router, Clarify, authority store, task lifecycle and product-identical dogfood UI entry.

## 2026-06-28 [Thoth repo reset]

- Worked on: `NTH-OBJ-001`, `NTH-MS-001`, `NTH-TD-001`
- State changes: Reset the active branch toward Thoth by removing the archived Python / Claude-Codex plugin runtime from the active working tree and replacing the public entrypoints with Thoth documentation and monorepo skeleton metadata.
- State changes: Rewrote project recovery documents around Thoth IDs and current truth. Archived plugin history is now referenced through release `thoth-plugin-final-archive` and branch `archive/main-20260627`.
- State changes: Added the prompt seed extraction document so archived prompt lessons survive as contracts rather than legacy Python code.
- Evidence produced: Old runtime path check confirmed `thoth`, `scripts`, `templates`, `tests`, `commands`, `plugins`, `.claude-plugin`, `.codex-plugin`, `.agents`, `bin`, `pyproject.toml`, `.pytest_cache`, `.tmp_pytest` and `research.db` are gone from the repo root. Package metadata check reported `package metadata ok 11`; package directory count reported `10`; design document check reported `design docs ok`; `CLAUDE.md` symlink check reported `CLAUDE symlink ok`; asset check confirmed only `thoth-icon.svg` and `thoth.png` remain; `npm install --package-lock-only --ignore-scripts` completed with `found 0 vulnerabilities`; `git diff --check` passed. Old `.tmp_pytest` cleanup hit NFS unlink stalls; remaining untracked residue was moved under ignored `.agent-os/.trash/tmp_pytest-nfs-stale-20260628` so the repo root no longer exposes the old test-cache path.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [AGENTS engineering behavior integration]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`
- State changes: Integrated the engineering behavior rules from `multica-ai/andrej-karpathy-skills` `CLAUDE.md` into root `AGENTS.md` as Thoth scoped guidance: Think Before Coding, Simplicity First, Surgical Changes and Goal-Driven Execution.
- Evidence produced: `git diff --check` passed. Targeted scan confirmed `AGENTS.md` now contains `General Engineering Behavior Guidelines`, `Think Before Coding`, `Simplicity First`, `Surgical Changes`, `Goal-Driven Execution` and the `multica-ai/andrej-karpathy-skills` source note.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [Release packaging decision recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-005`
- State changes: Recorded `NTH-CD-011`, `NTH-REQ-010`, `NTH-MS-006` and `NTH-TD-007` for a future Paseo-like release and packaging pipeline.
- Decision detail: The future pipeline should use explicit release tags or manual GitHub Actions dispatch, not ordinary branch pushes. Desktop packages should target macOS, Linux and Windows installer artifacts. Android APK release builds should use Expo/EAS or an equivalent path and upload installable artifacts to GitHub Releases. Web/app and relay deployments should be separately explicit. iOS distribution should be handled through TestFlight/App Store/EAS submit or another Apple-approved path rather than assuming GitHub Release IPA self-install.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [Provider execution boundary recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-004`
- State changes: Recorded `NTH-CD-012` and `NTH-REQ-011`: Thoth is a control plane, not a harness tool or hidden LLM API wrapper.
- Decision detail: All AI and agent execution must come from configured providers through ACP adapters, harness runtimes, app-server sessions, official harness SDK/control surfaces or local harness CLIs. Thoth owns process flow, routing judgment, prompt contracts, task authority, frozen acceptance, evidence and session records. Thoth core/daemon must not privately call general model inference APIs as a substitute for provider sessions.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [Provider-backed routing boundary recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`, `NTH-WS-004`
- State changes: Recorded `NTH-CD-013` and `NTH-REQ-012`: zero-shot semantic routing, workspace intent resolution, clarification strategy and loop strategy must not be local deterministic heuristics.
- Decision detail: Desktop composer should expose explicit Thoth-level controls for `quick` and `loop`, plus clarification strength and loop strength. Local code may honor explicit controls, validate schemas, enforce permissions, gather mechanical evidence and maintain authority state. Any intelligent recommendation, ambiguity resolution, route upgrade/downgrade or context judgment must run inside a provider-backed session.

## 2026-06-29 [Chatbox control levels recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`
- State changes: Recorded `NTH-CD-014` and `NTH-REQ-013`: chatbox controls are `+`, Provider, Mode, Clarify and Loop.
- Decision detail: `+` supports only images and files under `10MB` in MVP. Scope is handled through `@`, not a separate button. Provider contains provider/model/runtime settings including model id, thinking strength, permission mode and fast mode. Mode is `Quick` or `Loop`. Clarify is `auto`, `no-ask`, `light`, `balance`, `deep` and applies to both modes. Loop is `auto`, `no-loop`, `light`, `balanced`, `endless`; it applies only to `Loop`, with `endless` shown red/high-cost/manual-stop.
- Next likely action: `NTH-TD-002` - design the first implementation slice for explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-29 [Business flow canonical docs updated]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-WS-004`
- State changes: Recorded `NTH-CD-015` and `NTH-REQ-014`, then updated the three canonical design documents: `.agent-os/designs/thoth-high-level-design.md`, `.agent-os/designs/thoth-mvp-user-journey.md` and `.agent-os/designs/thoth-engineering-architecture.md`.
- Decision detail: All provider-visible output should stream through Thoth in real time. `Quick + Don't Bother Me` is a provider passthrough path. `Loop` uses read-only Clarify, frozen contract, one PlanExec provider session with provider-native plan mode when available, and independent Review. PlanExec provider clarification questions after freeze are auto-answered from the contract or first recommended option; provider permission requests still obey permission policy.
- Evidence produced: Targeted term scan found no remaining `no-ask`, `no_ask`, `no-loop`, `no_loop`, `endless`, `Plan -> Execute`, `Plan/Execute`, `write Execute`, `Execute role` or `Plan role` in the three canonical design documents. `git diff --check` passed for the updated canonical design documents.
- Next likely action: `NTH-TD-002` - design the first implementation slice around provider streaming, quick passthrough, read-only Clarify, PlanExec, Review and authority persistence.

## 2026-06-30 [Clarify card validation runtime recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-WS-004`
- State changes: Recorded `NTH-CD-016` and updated `.agent-os/designs/thoth-engineering-architecture.md` with Clarify decision-tree runtime, two-channel provider streaming, card candidate validation, hidden format repair and frontend/daemon validation boundaries.
- Decision detail: Clarify must behave as a decision-tree walk rather than a questionnaire. Provider text streams to users in real time, but structured clarification cards render only after validation. Invalid card candidates, schema diagnostics and repair prompts stay hidden from users; the daemon sends concise repair feedback back into the same provider session and asks it to regenerate the same card for the same tree node.
- Evidence produced: Targeted scan confirmed the engineering architecture document now contains `Clarify Decision-Tree Runtime`, `Clarify Streaming And Card Validation`, `Invalid card repair` and `Timeline event split`. `git diff --check` passed after the documentation update.
- Next likely action: `NTH-TD-002` - design the first implementation slice around provider streaming, Clarify card validation, read-only provider sessions, authority persistence and task lifecycle.

## 2026-06-30 [AGPL policy and upstream seed import completed]

- Worked on: `NTH-OBJ-001`, `NTH-WS-006`, `NTH-MS-007`, `NTH-TD-008`
- State changes: Recorded `NTH-CD-017`, `NTH-REQ-015`, `NTH-MS-007`, `NTH-TD-008`, `NTH-TD-009` and `NTH-EV-002` for the AGPL license switch, upstream implementation seed import and next seed digestion step.
- State changes: Added `.agent-os/upstreams/` to `.gitignore`, created local raw cache under `.agent-os/upstreams/paseo/`, replaced root `LICENSE` with AGPL v3 text, changed package metadata license fields to `AGPL-3.0-or-later`, added `NOTICE`, and added `.agent-os/upstream-transplant.md`.
- State changes: Copied non-runnable tracked seed material into `packages/protocol/_paseo`, `packages/client/_paseo`, `packages/relay/_paseo`, `packages/cli/_paseo`, `packages/app/_paseo`, `packages/desktop/_paseo`, `packages/drivers/_paseo`, `packages/daemon/_paseo` and `packages/core/_paseo`.
- Evidence produced: Remote upstream `main` was verified through `git ls-remote` with proxy as `5fc53c576ef0d4dee55455ccc95660703f71b892`. Raw cache was created from the exact GitHub archive tarball after direct clone/index-pack was unreliable. Voice/audio/speech/dictation/TTS/STT/PCM/WAV path exclusion checks returned no matches in raw cache or tracked seed after cleanup. Seed content naming scan found no upstream product naming matches. Root metadata check reported `packages=10` and `workspaces=packages/*`; all package JSON parse check reported `count=19`; large file check found no seed files over `5MB`; refined secret-like scan returned no real-looking tokens or private-key blocks; `npm install --package-lock-only --ignore-scripts` completed with `found 0 vulnerabilities`; `git diff --check` passed.
- Next likely action: `NTH-TD-009` - digest imported `_paseo/` seeds into the first real Thoth implementation migration map before moving any code into formal `src`.

## 2026-06-30 [Implementation seeds promoted to formal source]

- Worked on: `NTH-OBJ-001`, `NTH-WS-006`, `NTH-MS-008`, `NTH-TD-009`
- State changes: Promoted tracked `_paseo` implementation seed material into formal package source trees and deleted tracked `_paseo` directories.
- State changes: Preserved the formal Thoth package boundary and identity: root workspace boundary remains `packages/*`; the 10 formal packages remain `@thoth/app`, `@thoth/cli`, `@thoth/client`, `@thoth/core`, `@thoth/daemon`, `@thoth/desktop`, `@thoth/drivers`, `@thoth/protocol`, `@thoth/relay` and `@thoth/tui`; `packages/app/highlight` remains nested and no `packages/highlight` workspace was created.
- State changes: Kept `packages/tui` skeleton-only. Removed obvious package/config/script-level voice/audio/speech/dictation residue while recording broad promoted-source references as expected-broken material for dependency and compile triage.
- State changes: Recorded `NTH-CD-018`, marked `NTH-MS-008` and `NTH-TD-009` done, added `NTH-TD-010` as the next dependency and compile triage item, and recorded `NTH-EV-003`.
- Evidence produced: `_paseo` path count reported `0`; formal package list reported exactly 10 package directories; `packages/highlight` absence check passed; `packages/tui` skeleton file check passed; package identity check reported `formal package identity ok`; JSON parse check reported `json ok 12`; `npm install --package-lock-only --ignore-scripts` completed with `up to date, audited 2189 packages in 10s` and reported 40 vulnerabilities for later triage; raw cache ignore check reported `.gitignore:25:.agent-os/upstreams/`; generated/cache path scan returned no package paths; path-level voice/audio/speech/dictation scan returned no package paths; package/config/script voice-residue scan returned no matches; `@thoth/server` scan returned no matches; large-file scan found no package files over `5MB`; secret-like scan found no real-looking tokens or private-key blocks; `git diff --check` passed.
- Next likely action: `NTH-TD-010` - run dependency and compile triage on the promoted source substrate without changing Thoth product goals.

## 2026-06-30 [First-day development infrastructure completed]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-005`, `NTH-MS-009`, `NTH-TD-011`
- State changes: Added first-day root npm scripts for formatting, linting, repository validation, foundation build/typecheck/test, Android doctor/setup/APK packaging and Linux-safe iOS script behavior.
- State changes: Added `.nvmrc`, `.tool-versions`, `.npmrc`, root/package AGENTS contracts, package `CLAUDE.md -> AGENTS.md` links, and developer docs under `docs/development.md`, `docs/testing.md`, `docs/packaging.md` and `docs/release.md`.
- State changes: Removed current local `eas-cli` devDependency from `packages/app` because it pulled `dtrace-provider` and made ordinary install unstable, while EAS cloud builds are not part of this round.
- State changes: Removed Android microphone/audio permissions from `packages/app/app.config.js` and added repository validation for package/config voice residue.
- State changes: Recorded `NTH-CD-019`, `NTH-REQ-016`, `NTH-MS-009`, `NTH-TD-011`, `NTH-EV-004`, `NTH-EXP-003` and `NTH-EXP-004`; top next action is now `NTH-TD-002`.
- Evidence produced: `npm install` completed with `up to date in 4s`; lockfile scan confirmed `eas-cli` and `dtrace-provider` absent; `npm ls dtrace-provider --all` reported `(empty)`; `npm run validate:repo` reported `THOTH_REPO_VALIDATION_OK`; `npm run format:check`, `npm run lint:foundation`, `npm run build:foundation`, `npm run typecheck:foundation`, `npm run test:foundation` and `npm run check:foundation` passed.
- Evidence produced: `npm run doctor:android` reported `THOTH_ANDROID_DOCTOR_OK`; `npm run setup:android-toolchain` reported `THOTH_ANDROID_TOOLCHAIN_READY`; `npm run package:android:debug-apk` reported `THOTH_ANDROID_DEBUG_APK_OK` and produced `/mnt/cfs/5vr0p6/yzy/thoth/packages/app/android/app/build/outputs/apk/debug/app-debug.apk`, sha256 `1a3cde6a8c2eab458683a5255291ed03ca6db1aaca1ab0d6dbbb39626fd8e540`, size `302693683` bytes.
- Evidence produced: `npm run package:ios:prebuild` on Linux reported `THOTH_IOS_PREBUILD_SKIPPED` and exited `0`; `npm run package:ios:build` on Linux reported `THOTH_IOS_BUILD_SKIPPED` and exited `1`, as expected.
- Next likely action: `NTH-TD-002` - design and implement the first Thoth slice around explicit task mode, provider-backed Router, Clarify, authority store and task lifecycle.

## 2026-06-30 [Thoth I dev UI boundary recorded]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`, `NTH-TD-002`
- State changes: Recorded `NTH-CD-020`, `NTH-REQ-017` and `NTH-AC-011`: Thoth I dev UI must be the same user experience as the current releasable full UI, not a separate debug/mock/agent-facing interface.
- Decision detail: Humans use the dev UI as the real dogfood and review surface. Agents validate repository code through standard unit tests, typechecks, builds, root gates and explicit smoke commands.
- State changes: Updated `AGENTS.md`, `docs/development.md`, `.agent-os/project-index.md` and `.agent-os/todo.md` so the first implementation slice includes a stable human dogfood entry without compromising the releasable UI experience.
- Next likely action: `NTH-TD-002` - design and implement the first Thoth slice around explicit task mode, provider-backed Router, Clarify, authority store, task lifecycle and product-identical dogfood UI entry.

## 2026-07-02 [Relay pairing 1006/401 fixed in local Thoth]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-005`
- User-visible issue: Pasting a valid `https://app.thoth.seeles.ai/#offer=...` pairing link in the web UI failed with `Transport closed (code 1006)`. CLI relay connection reproduced the same failure as relay HTTP `401`, so the issue was not only browser UI.
- Diagnosis: The relay service accepted a manually registered current pairing ticket, proving the deployed relay, server id, token contents and expiry were valid. The remaining failures came from two Thoth-side issues: daemon pairing offer generation did not explicitly force relay room registration after minting a new ticket, and CLI `--host <offer-url>` did not pass the pairing token through `Sec-WebSocket-Protocol`.
- State changes: Added `RelayTransportController.refreshRegistration()`, wired it through bootstrap, websocket server, session and daemon session, and call it after `daemon.get_pairing_offer.request`. Added safe `relay_registration_sent` logs without raw tokens. Updated CLI relay-offer connection to pass `buildRelayWebSocketProtocols(offer.pairingToken)`. Updated relay-host e2e to use real `thoth daemon pair --json`, pass token subprotocols in its probe, and resolve the current wrangler CLI entrypoint.
- Evidence produced: `npm --workspace=@thoth/daemon run test:unit -- src/server/relay-transport.test.ts src/server/session/daemon/daemon-session.test.ts` passed with `2 passed, 14 passed`. `npm --workspace=@thoth/cli run build` passed. Live Thoth daemon on `127.0.0.1:6688` generated a fresh offer; `npm --workspace=@thoth/cli exec -- thoth ls --json --host <redacted-offer>` returned `[]` through `relay.test.thoth.seeles.ai` instead of 401. `npm --workspace=@thoth/cli exec -- vitest run tests/e2e/relay-host.test.ts` passed with `1 passed`. `lsof` confirmed Paseo remained on `127.0.0.1:6767` while Thoth listened on `127.0.0.1:6688`. `git diff --check` passed.
- Next likely action: Continue `NTH-TD-002` with the now-working human dogfood pairing path and keep using fresh pairing links; do not reuse expired or pre-fix links.

## 2026-07-02 [Relay timeout clarified in web Settings]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-005`
- User-visible issue: Web Settings showed `Relay (relay.test.thoth.seeles.ai:443) Timeout` for the saved Thoth host even though `https://relay.test.thoth.seeles.ai/health` returned ok and a fresh CLI offer could connect through relay.
- Diagnosis: The relay service and daemon room registration were healthy. Fresh browser relay smoke with a newly minted offer rendered a real latency value. The confusing timeout state came from saved relay credentials that may be missing/expired, especially older browser state that only stored a short-lived pairing token instead of a valid device token.
- State changes: Added relay credential status helpers for missing/expired tokens. Frontend probe/config now rejects missing or expired relay credentials before opening a WebSocket, runtime probe marks those connections unavailable without waiting for a network timeout, and Settings renders `Pair again` instead of generic `Timeout` for that state.
- Evidence produced: `npm --workspace=@thoth/app run test -- --project unit src/types/host-connection.test.ts src/utils/test-daemon-connection.test.ts src/runtime/host-runtime.test.ts` passed with `3 passed`, `62 passed`. `npm run build:web` passed and exported `packages/app/dist` with bundle `index-bd2eea9c3f96689bf10ee3208f830240.js`; both `http://127.0.0.1:8082/open-project` and `http://180.76.242.105:8148/open-project` returned that bundle. Playwright expired-token Settings smoke showed `Pair again`, no `Timeout`, and no page errors. Playwright fresh-offer Settings smoke through `relay.test.thoth.seeles.ai` showed a real latency value (`588ms` in the run), no timeout, no pair-again state, and no page errors. `npm run format:check` and `git diff --check` passed.
- Next likely action: Continue `NTH-TD-002`; if an existing browser still shows the old host as timed out, remove/re-pair that host with a fresh offer so the browser stores a valid device token.

## 2026-07-02 [Unsigned macOS desktop test zips produced]

- Worked on: `NTH-OBJ-001`, `NTH-WS-005`
- User-visible request: Produce a macOS desktop package for human testing.
- State changes: Built local unsigned macOS Electron zip artifacts for both x64 and arm64 from the current desktop package configuration. Created temporary download symlinks under `packages/app/dist/downloads/` so the already-running `8082 -> 8148` static server can serve them.
- Limitation: A real `.dmg` installer could not be produced on this Linux host. `electron-builder --mac dmg` first required `dmg-license`, and `npm install --no-save --package-lock=false dmg-license@^1.0.11` failed with `EBADPLATFORM` because `dmg-license` is darwin-only. The macOS artifacts are unsigned and not notarized because code signing is supported only on macOS.
- Evidence produced: `HTTPS_PROXY=http://10.0.3.5:7899 HTTP_PROXY=http://10.0.3.5:7899 npm --workspace=@thoth/desktop exec -- electron-builder --config electron-builder.yml --mac zip --publish never` produced `packages/desktop/release/Thoth-0.0.0-x64.zip`, sha256 `238e2cccce5dcddf2e221ef05a0994f951a06442348d4e048ee590223d4238a0`, size `121M`. `HTTPS_PROXY=http://10.0.3.5:7899 HTTP_PROXY=http://10.0.3.5:7899 npm --workspace=@thoth/desktop exec -- electron-builder --config electron-builder.yml --mac zip --arm64 --publish never` produced `packages/desktop/release/Thoth-0.0.0-arm64.zip`, sha256 `1f3de97f5af8caee25480bafaac93873b4e7cae701d855d3f44b935848d9c2f9`, size `116M`. `unzip -l` confirmed both archives contain `Thoth.app`. `curl -I` against `http://180.76.242.105:8148/downloads/Thoth-0.0.0-arm64.zip` and `http://180.76.242.105:8148/downloads/Thoth-0.0.0-x64.zip` returned `200 OK`.

## 2026-07-02 [UI shell rebrand plan drafted]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Draft a plan Markdown that locks the goal, constraints and acceptance criteria for rebuilding the Thoth UI shell toward the final product surface before implementing deeper task/Clarify/Loop business logic.
- State changes: Added `.agent-os/designs/thoth-ui-shell-rebrand-plan.md`.
- Decision detail: The planned UI direction is not a Paseo recolor. It targets a final-form Thoth product surface with game-like, light, cute and cheerful visual personality; Thoth-specific navigation; final composer controls; app icon/desktop icon/menu/settings rework; honest unavailable states for unimplemented business capabilities; and preservation of current daemon/relay/web/desktop capabilities.
- Next likely action: User reviews and edits the UI shell plan. If approved, promote it into a formal TODO/top next action and implement UI shell changes without entering formal task backend work.

## 2026-07-02 [Thoth icon asset unified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Use the newly generated icon artwork as the Thoth icon everywhere, without making a transparent variant or separate favicon/tray design.
- State changes: Recorded `NTH-CD-023`. Replaced the Expo/App icon, favicon status PNGs, splash icon, notification icon, Android foreground image, PWA icons, Desktop PNG sizes, Windows `.ico` and macOS `.icns` with opaque derivatives of the approved artwork. Removed the old favicon status SVG variants so the runtime favicon hook cannot fall back to a second visual language.
- Evidence produced: Image inspection confirmed the approved source artwork is `1586x1586 RGB`; generated App/Desktop/Web icon PNG entrypoints are RGB and sized for their configured platform paths. `file` confirmed `packages/desktop/assets/icon.ico` is a Windows icon resource and `packages/desktop/assets/icon.icns` is a Mac OS X icon. `npm run build:web` passed and exported `packages/app/dist`; Expo output showed all six status favicon PNGs share the same hash. `git diff --check` passed.
- Next likely action: Continue the UI shell rebrand implementation from the approved icon direction, replacing remaining Paseo-shaped UI language and navigation without changing Thoth task backend behavior.

## 2026-07-02 [Old Paseo icon residue removed]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`
- User-visible request: Delete the previous Paseo icons completely after locking the new package-local Thoth icon artwork.
- State changes: Deleted the old Paseo butterfly brand assets `packages/app/assets/images/butterfly-green.svg` and `packages/app/assets/images/butterfly-white.svg`. Moved the approved source icon into `packages/app/assets/images/thoth-icon-source.png` and removed the duplicate root `assets/icon.png`. Kept `assets/thoth.png` because it is a Thoth wordmark asset, not a Paseo icon.
- Evidence produced: Filesystem scan found no remaining `butterfly`, `paseo-logo`, old favicon SVG or `thoth-icon.svg` icon files outside ignored upstream cache. Text scan found no active source references to `PaseoLogo`, `paseo-logo`, `butterfly` or old favicon SVG assets outside historical `.agent-os` evidence entries. `git diff --check` passed.

## 2026-07-02 [OpenTUI shell surface foundation wired]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Moved `packages/tui` beyond skeleton-only by adding a first non-rendering OpenTUI shell surface model, package exports, build/typecheck/test scripts, `@thoth/client` and `@opentui/core@0.4.2`.
- State changes: Added `packages/tui/src/surface.ts` so Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About slots are derived from shared daemon/client shapes instead of TUI-only authority.
- State changes: Added `packages/tui/src/runtime.ts` and `packages/tui/src/opentui-renderer.ts` so native OpenTUI renderer creation is guarded by the current runtime. The locked Node `24.14.0` path reports unavailable before renderer creation because OpenTUI needs Bun or Node `26.3.0+` with experimental FFI.
- Evidence produced: `npm run test --workspace=@thoth/tui` passed with 2 files and 9 tests. `npm run typecheck --workspace=@thoth/tui` passed. `npm run build --workspace=@thoth/tui` passed. Runtime guard smoke returned `reason: node_version_too_old`, `currentVersion: 24.14.0`, `minimumNodeVersion: 26.3.0`. `npm run format:check`, `git diff --check` and `npm run check:foundation` passed.
- Next likely action: Continue `NTH-TD-002` by connecting the shared UI slots to minimal authority/task state design, or run the explicit `NTH-TD-005` OpenTUI runtime spike before claiming native TUI renderer smoke.

## 2026-07-02 [OpenTUI renderer smoke path verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-004`, `NTH-TD-005`
- State changes: Added the first OpenTUI render layer in `packages/tui/src/render.ts`, exported it from `@thoth/tui`, and added `scripts/smoke-opentui-renderer.mjs`.
- State changes: Added root `npm run smoke:tui:renderer`, which builds `@thoth/tui` and runs the OpenTUI test renderer under pinned `node-linux-x64@26.4.0 --experimental-ffi`. Updated `packages/tui/AGENTS.md` to remove the stale skeleton-only command wording.
- Spike result: Current reproducible renderer smoke path is Node FFI through `node-linux-x64@26.4.0`; Bun was not selected because `bun@1.3.14` needs postinstall under the current install policy and `@oven/bun-linux-x64@1.3.14` did not expose `bun` through `npm exec`.
- Evidence produced: Manual Node 24 `@opentui/core/testing` renderer creation failed with `OpenTUI native FFI is not available for this runtime yet`; manual Node 26.4 FFI smoke captured `One Thoth TUI smoke`; root `npm run smoke:tui:renderer` passed at default `96x34`; narrow `72x34` and wide `132x34` renderer smoke also passed. `npm run test --workspace=@thoth/tui` passed with 3 files and 10 tests. `npm run typecheck --workspace=@thoth/tui`, `npm run build --workspace=@thoth/tui`, `npm run format:check`, `git diff --check` and `npm run check:foundation` passed.
- Next likely action: Continue toward the real OpenTUI CLI workspace dogfood entry by connecting the renderer to daemon/client state and adding focus/input/navigation smoke; this renderer smoke does not yet prove interactive TUI readiness.

## 2026-07-02 [OpenTUI interaction navigation slice verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Added `packages/tui/src/interaction.ts` as a pure interaction state layer for focus order, route opening/back history and explicit composer controls. The state covers `+`, Provider, Mode, Clarify and Loop without creating task authority or fake daemon/backend state.
- State changes: Updated `packages/tui/src/render.ts` so the OpenTUI frame shows active route, focus, state notice, authority guard, active/focused navigation markers and composer control values. Quick mode keeps Loop disabled as `Off in Quick`; after explicit Loop mode the Loop control can cycle to `One Plan, One Do`.
- State changes: Added `scripts/smoke-opentui-navigation.mjs` and root `npm run smoke:tui:navigation`, using the same pinned `node-linux-x64@26.4.0 --experimental-ffi` renderer path as the renderer smoke. Updated `packages/tui/AGENTS.md` to mention both renderer and navigation root smokes.
- Evidence produced: `npm run test --workspace=@thoth/tui` passed with 4 files and 16 tests. `npm run typecheck --workspace=@thoth/tui` passed. `npm run build --workspace=@thoth/tui` passed. `npm run smoke:tui:renderer` passed at default `96x34`. `npm run smoke:tui:navigation` passed at default `96x34`, compact `72x34` and wide `132x34`, capturing `Route: Evidence / Review`, `Focus: Loop`, `Mode: Loop`, `Loop: One Plan, One Do` and the authority guard.
- Evidence produced: `npm run format:check`, `git diff --check` and `npm run check:foundation` passed. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- State documentation: Recorded `NTH-EV-012` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` toward a real OpenTUI CLI workspace dogfood entry: wire the pure interaction reducer to native keypress handling and/or CLI command launch while keeping daemon/client authority as the only source of durable task truth.

## 2026-07-02 [OpenTUI CLI dogfood entry verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Added a real top-level `thoth tui` CLI command in `packages/cli/src/commands/tui.ts` and registered it in `packages/cli/src/cli.ts`. The command uses existing CLI daemon connection utilities, fetches real workspaces, agents and provider snapshot data, then mounts the shared `@thoth/tui` OpenTUI surface.
- State changes: Updated `packages/tui/src/surface.ts` so launching from a descendant `pwd` selects the matching registered workspace, preferring the most specific workspace root when parent and child workspaces both match.
- State changes: Added `packages/tui/src/keyboard.ts` and live `mountTuiSurface` update handling for Tab/arrows, Enter, Esc, `M`, `C`, `L`, `Q` and Ctrl+C. Added root `npm run smoke:tui:cli`, which runs the real CLI entry under pinned `node-linux-x64@26.4.0 --experimental-ffi`.
- Evidence produced: Node `24.14.0` direct `thoth tui --exit-after-render-ms 10` returned the expected runtime guard message that native OpenTUI rendering needs Node `26.3.0+` with experimental FFI. `npm run smoke:tui:cli` passed against `127.0.0.1:6688`, capturing `Host: Connected`, `Route: Workspace (Ready)`, `Workspace: yzy`, provider/relay status, composer controls, task/evidence preview slots and the authority guard. The smoke asserts that `127.0.0.1:6767` / `localhost:6767` do not appear.
- Evidence produced: Compact `72x34` and wide `132x34` CLI smokes passed. `npm run test --workspace=@thoth/tui` passed with 5 files and 21 tests. `npm run typecheck --workspace=@thoth/tui`, `npm --workspace=@thoth/cli run typecheck`, `npm --workspace=@thoth/cli run build`, `npm run smoke:tui:renderer`, `npm run smoke:tui:navigation`, `npm run smoke:isolation`, `npm run format:check`, `git diff --check` and `npm run check:foundation` passed.
- State documentation: Recorded `NTH-EV-013` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` by expanding OpenTUI from the live CLI entry into richer onboarding/recovery states and live daemon refresh, or return to Web/Desktop surfaces for the full UI scorecard. The full Thoth MVP task loop is still not implemented.

## 2026-07-02 [OpenTUI live refresh and recovery verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Added `Snapshot` / refresh state to the shared TUI surface model, mapped `R` to a refresh intent and updated the OpenTUI mount so the live surface can replace its current model after a daemon snapshot reload.
- State changes: Updated `thoth tui` so refresh is handled in the CLI/client layer by re-fetching real workspaces, agents and provider snapshots from the daemon. The TUI package still does not own durable task, workspace, provider or daemon authority.
- State changes: Added disconnected recovery rendering for failed refresh or unavailable host states. The recovery frame keeps users inside the One Thoth TUI, shows `Needs a registered workspace` / `Needs provider` states honestly and tells them to start Thoth on `127.0.0.1:6688` or pair a fresh relay offer before pressing `R`.
- State changes: Hardened TUI recovery text against sensitive host leakage: relay offers are described without raw `offer=` material, URL `password=` is redacted and smoke assertions reject `offer=`, `pairingToken`, `thoth-relay-v3-client.`, `127.0.0.1:6767` and `localhost:6767`.
- State changes: Added root `npm run smoke:tui:cli:recovery` and `scripts/smoke-opentui-cli-recovery.sh` to verify unreachable-host recovery under the same pinned Node `26.4.0 --experimental-ffi` OpenTUI path as the connected CLI smoke.
- Evidence produced: `npm run test --workspace=@thoth/tui` passed with 5 files and 23 tests. `npm run typecheck --workspace=@thoth/tui`, `npm --workspace=@thoth/cli run typecheck`, `npm run build --workspace=@thoth/tui` and `npm --workspace=@thoth/cli run build` passed.
- Evidence produced: `npm run smoke:tui:renderer`, `npm run smoke:tui:navigation`, `npm run smoke:tui:cli` and `npm run smoke:tui:cli:recovery` passed. Connected CLI final frames included `State: Refreshed daemon snapshot`, `Snapshot: Updated ...`, `Host: Connected`, `Workspace: yzy` and `R refresh`. Recovery final frame against `127.0.0.1:1` included `State: Refresh failed; recovery state shown`, `Snapshot: Refresh failed ...`, `Recovery: start Thoth daemon on 127.0.0.1:6688 or pair a fresh relay offer, then press R.` and no fake connected state.
- Evidence produced: Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` and wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed with refreshed connected frames.
- Evidence produced: `npm run smoke:isolation` passed: Paseo remained on `127.0.0.1:6767`, Thoth remained on `127.0.0.1:6688`, and PIDs differed. `npm run format:check`, `git diff --check` and `npm run check:foundation` passed; foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- State documentation: Recorded `NTH-EV-014` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` by expanding OpenTUI route detail panels and onboarding/registration recovery, or return to Web/Desktop scorecard and full UI smoke matrix. The full Thoth MVP task loop and full multi-endpoint UI productization remain incomplete.

## 2026-07-02 [OpenTUI route detail panels verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Added route-specific `Active Route Detail` panels to the shared OpenTUI surface for Home, Workspace, Task / Loop, Providers, Connections, Evidence / Review and Settings / About.
- State changes: The detail panels are derived from the existing surface inputs: host connection chip, daemon workspaces, provider snapshot, agents, relay paired state, refresh state and current `cwd`. They do not introduce TUI-owned durable task authority or hidden provider calls.
- State changes: Updated OpenTUI renderer output order so route detail appears before the composer, keeping Mode and Loop visible in compact 34-row frames. Updated renderer, navigation, connected CLI and recovery CLI smokes to assert the detail panels.
- Evidence produced: `npm run test --workspace=@thoth/tui` passed with 5 files and 25 tests. `npm run typecheck --workspace=@thoth/tui` and `npm run build --workspace=@thoth/tui` passed.
- Evidence produced: `npm run smoke:tui:renderer`, `npm run smoke:tui:navigation`, `npm run smoke:tui:cli` and `npm run smoke:tui:cli:recovery` passed. Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation`, compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` and wide `THOTH_TUI_SMOKE_WIDTH=132 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` also passed.
- Evidence produced: `npm run format:check`, `git diff --check` and `npm run check:foundation` passed. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- State documentation: Recorded `NTH-EV-015` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` with OpenTUI onboarding/registration recovery, or return to Web/Desktop final surface and strict UI scorecard. The full Thoth MVP task loop and full multi-endpoint UI productization remain incomplete.

## 2026-07-02 [OpenTUI onboarding workspace registration verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Added OpenTUI `Next Actions` derived from connection, workspace, provider, relay and refresh state. The actions show workspace registration, provider setup, device pairing and refresh/recovery without inventing task authority.
- State changes: Added `W workspace`, `P providers` and `D devices` key paths. `W` is handled in the CLI/client layer and calls the real daemon `workspace.create.request` for the current `pwd`, then reloads the same daemon snapshot used by refresh.
- State changes: Fixed an important workspace selection bug: when `thoth tui` is launched from an unregistered `cwd`, the surface no longer falls back to the first unrelated registered workspace. It now stays on Home / needs-workspace and offers registration.
- Evidence produced: `npm run test --workspace=@thoth/tui` passed with 5 files and 26 tests. `npm run typecheck --workspace=@thoth/tui`, `npm run build --workspace=@thoth/tui` and `npm --workspace=@thoth/cli run typecheck` passed.
- Evidence produced: `npm run smoke:tui:renderer`, `npm run smoke:tui:navigation`, `npm run smoke:tui:cli`, `npm run smoke:tui:cli:recovery` and `npm run smoke:tui:cli:workspace-register` passed. The workspace-register smoke created a temporary workspace from inside TUI, showed `State: Registered workspace`, then archived the temporary workspace.
- Evidence produced: A post-smoke active workspace check found `tmpWorkspaceCount: 0`. Compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:navigation` and compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 bash scripts/smoke-opentui-cli.sh` passed. `npm run smoke:isolation` passed with Paseo on `6767` and Thoth on `6688` with different PIDs.
- Evidence produced: `npm run format:check`, `git diff --check` and `npm run check:foundation` passed. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- State documentation: Recorded `NTH-EV-016` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` by adding provider setup and relay pairing actions to OpenTUI, or return to Web/Desktop final surface and strict UI scorecard. The full Thoth MVP task loop and full multi-endpoint UI productization remain incomplete.

## 2026-07-02 [OpenTUI provider readiness action verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Changed `P providers` from a local-only route shortcut into a provider readiness action. `packages/tui` now emits a `providerSetup` intent, and `packages/cli/src/commands/tui.ts` handles it in the CLI/client layer by calling real daemon `refreshProvidersSnapshot({ cwd })`, reloading daemon surface inputs and opening the Providers route.
- State changes: Kept the provider path read-only and honest. The TUI does not add provider config schema, does not select a default provider/model, does not fake auth/readiness and does not call hidden LLM/API paths. The Providers route reports daemon snapshot readiness and still tells users to select a model before task loops when readiness is missing.
- State changes: Added `--provider-setup-after-render-ms` smoke automation for `thoth tui`, root `npm run smoke:tui:cli:provider-setup` and `scripts/smoke-opentui-cli-provider-setup.sh`. Shortened the `W` next-action copy so compact `72x34` frames keep both `W` and `P` visible.
- Evidence produced: `npm run test --workspace=@thoth/tui` passed with 5 files and 26 tests. `npm run typecheck --workspace=@thoth/tui`, `npm run build --workspace=@thoth/tui` and `npm --workspace=@thoth/cli run typecheck` passed.
- Evidence produced: `npm run smoke:tui:cli:provider-setup` passed against real Thoth daemon `127.0.0.1:6688`, showing `Route: Providers (Available)`, `State: Provider readiness refreshed from daemon`, daemon-derived provider entries and the authority guard. The smoke rejects fake provider configuration text, legacy `6767` endpoints and relay token material.
- Evidence produced: `npm run smoke:tui:renderer`, compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer`, `npm run smoke:tui:navigation`, `npm run smoke:tui:cli`, `npm run smoke:tui:cli:recovery` and `npm run smoke:tui:cli:workspace-register` passed. The workspace-register cleanup check reported `tmpWorkspaceCount: 0`.
- Evidence produced: `npm run smoke:isolation` passed with Paseo on `127.0.0.1:6767`, Thoth on `127.0.0.1:6688` and different PIDs. `npm run format:check`, `git diff --check` and `npm run check:foundation` passed; foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- State documentation: Recorded `NTH-EV-017` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` by adding a safe OpenTUI relay pairing action through existing daemon pair/relay APIs, or return to Web/Desktop final surface and the strict UI scorecard. The full Thoth MVP task loop, provider/model editing inside TUI and relay pairing execution inside TUI are still incomplete.

## 2026-07-02 [OpenTUI device pairing action verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Changed `D devices` from a local-only route shortcut into a real device pairing action. `packages/tui` now emits a `devicePairing` intent, and `packages/cli/src/commands/tui.ts` handles it in the CLI/client layer by calling real daemon `getDaemonPairingOffer({ timeout: 5000 })`.
- State changes: Kept sensitive relay credentials out of the TUI surface. CLI parses the daemon offer with `parseConnectionOfferFromUrl`, passes only safe `endpoint` and `pairingExpiresAt` into `packages/tui`, and hardens TUI-facing redaction for `offer=`, `#offer=`, `pairingToken`, `thoth-relay-v3-client.*`, `thoth.relay.token.*` and URL passwords.
- State changes: Connections / Devices now shows `Pairing offer ready`, pairing endpoint, pairing expiry and explicit credential-safety copy. Added `--pair-device-after-render-ms`, root `npm run smoke:tui:cli:device-pairing` and `scripts/smoke-opentui-cli-device-pairing.sh`.
- Evidence produced: `npm run test --workspace=@thoth/tui` passed with 5 files and 28 tests. `npm run typecheck --workspace=@thoth/tui`, `npm run build --workspace=@thoth/tui` and `npm --workspace=@thoth/cli run typecheck` passed.
- Evidence produced: `npm run smoke:tui:cli:device-pairing` passed against real Thoth daemon `127.0.0.1:6688`, showing `Route: Connections (Offer ready)`, `Pairing endpoint: relay.test.thoth.seeles.ai:443`, `Pairing expiry: ...` and credential-safety copy while rejecting raw offer URLs, QR text, pairing tokens, relay subprotocol tokens and legacy `6767` hosts.
- Evidence produced: `npm run smoke:tui:renderer`, compact `THOTH_TUI_SMOKE_WIDTH=72 THOTH_TUI_SMOKE_HEIGHT=34 npm run smoke:tui:renderer`, `npm run smoke:tui:navigation`, `npm run smoke:tui:cli`, `npm run smoke:tui:cli:recovery`, `npm run smoke:tui:cli:workspace-register` and `npm run smoke:tui:cli:provider-setup` passed. The workspace-register cleanup check reported `tmpWorkspaceCount: 0`.
- Evidence produced: `npm run smoke:isolation` passed with Paseo on `127.0.0.1:6767`, Thoth on `127.0.0.1:6688` and different PIDs. `npm run format:check`, `git diff --check` and `npm run check:foundation` passed; foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- State documentation: Recorded `NTH-EV-018` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` toward the next UI productization slice or return to Web/Desktop scorecard. The full Thoth MVP task loop, full paired-device persistence UI, provider/model editing inside TUI and Clarify/Loop/Review runtime are still incomplete.

## 2026-07-02 [Desktop semantic menu and UI scorecard baseline verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-005`, `NTH-TD-002`
- State changes: Reworked the Desktop application menu from a generic Electron `File/Edit/View/Window` shell into Thoth semantic top-level groups: `Thoth`, `File`, `Workspace`, `Task`, `Provider`, `View`, `Window` and `Help`.
- State changes: Kept unfinished Desktop menu product actions honest. Workspace, Task and Provider slots are present for the final UI surface but disabled until real backing behavior is wired; the menu does not fake provider/model editing, task creation, Clarify contract or Review actions.
- State changes: Added `packages/desktop/src/features/menu.test.ts` to verify the menu model with an Electron mock. Added `docs/ui-review-scorecard.md` as the durable working scorecard for Web/Desktop/OpenTUI UI review, with current failing scores and missing screenshot/stress evidence clearly marked.
- Evidence produced: `npm --workspace=@thoth/desktop run test -- src/features/menu.test.ts` passed with 1 file and 3 tests. `npm --workspace=@thoth/desktop run typecheck` passed. `npm --workspace=@thoth/desktop run build:main` passed.
- Evidence produced: `npm run format:check` and `git diff --check` passed.
- State documentation: Recorded `NTH-EV-019` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` by filling the scorecard with current Web/Desktop/OpenTUI screenshots and stress evidence, then repair whichever endpoint scores lowest. The final UI threshold is still not met.

## 2026-07-02 [OpenTUI PTY stress and scorecard evidence verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-WS-004`, `NTH-TD-002`
- State changes: Added smoke-only `--stress-after-render-ms` to the real `thoth tui` CLI command. The stress path drives the existing OpenTUI mount through key-intent route/focus/composer churn, then uses the existing CLI/client handlers for daemon refresh, provider readiness refresh and safe device pairing.
- State changes: Added root `npm run smoke:tui:pty-stress`, backed by `scripts/smoke-opentui-pty-stress.mjs`. The script builds the TUI and CLI, runs `thoth tui` under `/usr/bin/script -qfec ... /dev/null` with pinned `node-linux-x64@26.4.0 --experimental-ffi`, and verifies `72x34`, `96x34` and `132x34` final frames.
- State changes: Updated `docs/ui-review-scorecard.md`: OpenTUI working score is now `87`, overall working score is `78`, and the scorecard still explicitly fails final UI acceptance because Web/Desktop evidence and final OpenTUI threshold evidence are incomplete.
- Evidence produced: `npm run typecheck --workspace=@thoth/tui` passed.
- Evidence produced: `npm --workspace=@thoth/cli run typecheck` passed.
- Evidence produced: `npm run test --workspace=@thoth/tui` passed with 5 files and 28 tests.
- Evidence produced: `npm run build --workspace=@thoth/tui` passed.
- Evidence produced: `npm run smoke:tui:pty-stress` passed after formatting. The final frames showed `Route: Connections (Offer ready)`, `Focus: Connections`, `State: Stress completed: route/focus/composer/provider/device churn`, `Mode: Loop`, `Clarify: Light`, `Loop: Light`, safe relay endpoint `relay.test.thoth.seeles.ai:443` and the daemon/client/protocol authority guard at all three widths.
- Evidence produced: `npm run smoke:tui:cli`, `npm run smoke:tui:cli:recovery`, `npm run smoke:tui:cli:provider-setup` and `npm run smoke:tui:cli:device-pairing` passed.
- Evidence produced: `npm run format:check` and `git diff --check` passed.
- Evidence produced: `npm run check:foundation` passed. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- Evidence produced: `npm run smoke:isolation` passed with Paseo/legacy on `127.0.0.1:6767`, Thoth on `127.0.0.1:6688` and different PIDs.
- Evidence produced: The PTY stress assertions rejected legacy `6767`, raw relay offer material, pairing tokens, relay subprotocol token prefixes, QR text, `undefined`, `[object Object]` and common crash traces.
- State documentation: Recorded `NTH-EV-020` and updated `project-index.md`.
- Next likely action: Continue `NTH-TD-002` by collecting current Web/Desktop scorecard screenshots and stress evidence, or close the remaining OpenTUI score gap with provider/model editing or an explicit final unavailable-state design. The full Thoth MVP task loop remains unimplemented.

## 2026-07-03 [Web static export scorecard evidence verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-002`, `NTH-TD-002`
- State changes: Added root `npm run smoke:web:ui-scorecard`, backed by `scripts/smoke-web-ui-scorecard.mjs`. The script builds the real Web export, serves `packages/app/dist` through the repository static server, sets `E2E_BASE_URL` and runs the app Playwright scorecard spec against the static export.
- State changes: Added `packages/app/e2e/thoth-ui-scorecard.spec.ts` to verify Home / One Thoth, mobile Home, Workspace composer/task/evidence preview slots, Settings About, host Providers and host Connections, then stress rapid Settings/Workspace/composer/viewport transitions while rejecting legacy endpoint and sensitive relay credential material in the visible surface.
- State changes: Updated app e2e helpers so static export tests can reuse the existing daemon/workspace fixtures: `fixtures.ts` honors `E2E_BASE_URL`; `global-setup.ts` uses ESM-safe paths, resolves `wrangler` from app/root install locations, starts `packages/daemon`, validates relay v3 offer shape and includes the static export origin in CORS; `helpers/app.ts` opens Settings through the real responsive sidebar/drawer path; `daemon-client-loader.ts` uses ESM-safe paths.
- Failed exploration recorded: early scorecard attempts treated mobile Settings navigation like desktop Settings navigation. Narrow viewports use a drawer and can remain on the Settings host root route, so the test timed out waiting for desktop-only visible controls. This is now captured as `NTH-EXP-007`.
- Evidence produced: `npm run smoke:web:ui-scorecard` passed. It ran `npm run build:web`, exported the module-marked web bundle from `packages/app/dist`, served it on an ephemeral localhost port and completed Playwright with `1 passed (18.6s)`.
- Evidence produced: Current Web scorecard screenshots exist at `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/web-scorecard/web-home-desktop.png` (`68775` bytes), `web-home-mobile.png` (`39004` bytes), `web-workspace-composer.png` (`92514` bytes), `web-settings-about.png` (`42747` bytes), `web-settings-providers.png` (`118783` bytes) and `web-settings-connections.png` (`37881` bytes).
- Evidence produced: `npm run format:check` passed after root `npm run format`; `git diff --check` passed.
- Evidence produced: `npm run check:foundation` passed. Foundation tests passed with highlight `66`, relay `29`, protocol `286` and client `110` tests.
- Evidence produced: `npm run smoke:isolation` passed with Paseo/legacy on `127.0.0.1:6767`, Thoth on `127.0.0.1:6688` and different PIDs.
- State documentation: Recorded `NTH-EV-021`, updated `docs/ui-review-scorecard.md`, `.agent-os/acceptance-report.md`, `.agent-os/project-index.md`, `.agent-os/lessons-learned.md` and this run log.
- Next likely action: Continue `NTH-TD-002` by collecting Desktop scorecard screenshots/smoke evidence and then filling Web fresh relay / expired relay scorecard paths. The full Thoth MVP task loop and final Web/Desktop/OpenTUI UI acceptance remain incomplete.

## 2026-07-03 [Compact APP runtime contract locked]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`, `NTH-WS-003`, `NTH-TD-002`
- User-visible request: Preserve the latest APP design discussion as code contract and durable docs so later development follows it and does not lose information.
- Product decision: The APP no longer has a General Chat / Today dashboard target. The MVP APP has exactly three user views: Settings, Workspace Secretary and Background Tasks.
- Product decision: Workspace `New Agent` remains, but it means opening a new secretary topic/session for the current workspace. The user still faces the secretary; internal Clarify, PlanExec, Review and provider-role sessions stay hidden.
- Product decision: `Quick` remains in the foreground secretary session. `Loop` creates a background task only after two confirmations: first a compact task overview card, then a compact linear goal contract card. Goal contracts contain only title, goal, constraints and acceptance; implementation planning belongs to later PlanExec sessions.
- Product decision: Thoth must install hidden, non-optional, provider-compatible runtime skills `thoth.clarify` and `thoth.loop`. They are not user-selectable Paseo-style skills. Clarify controls secretary sessions; Loop controls PlanExec/Review sessions. Thoth daemon remains non-intelligent and only validates/repairs packets, enforces gates, lands authority and renders client state from packets.
- State changes: Added `.agent-os/designs/thoth-app-runtime-contract.md` as canonical design authority for the compact APP model, built-in runtime skills, state-code tables, packet shape, provider input envelope, daemon responsibilities and front-end responsibilities.
- State changes: Added `packages/protocol/src/thoth-runtime-contract.ts` as protocol code authority. It defines `THOTH_BUILTIN_RUNTIME_SKILLS`, 7 Clarify codes, 8 Loop codes, Clarify/Loop UI kinds, compact runtime packet schemas, compact loop cursor validation and provider input envelope validation.
- State changes: Added `packages/protocol/src/thoth-runtime-contract.test.ts` to preserve the compactness and compatibility contract.
- State changes: Updated `AGENTS.md` recovery order, `.agent-os/change-decisions.md` (`NTH-CD-027`), `.agent-os/acceptance-report.md` (`NTH-EV-022`), `.agent-os/project-index.md`, `.agent-os/lessons-learned.md` (`NTH-EXP-008`) and `docs/ui-review-scorecard.md`.
- Evidence produced: `npm run test:protocol -- thoth-runtime-contract.test.ts` passed with `1` file and `12` tests.
- Evidence produced: `npm run typecheck:protocol` passed.
- Evidence produced: `npm run build:protocol` passed.
- Current limitation: This locks the design and protocol contract only. It does not implement daemon runtime, provider skill injection, APP route/view refactor, background task execution, packet repair, permission gate wiring or evidence/review authority.
- Next likely action: Continue `NTH-TD-002` by designing/implementing the first daemon and driver slice for `thoth.clarify` packet validation and Workspace Secretary `C_DIRECT` / `C_TASK_CARD` / `C_GOAL_CARD` flow before returning to UI polishing.

## 2026-07-03 [Branch upgraded from UI to MVP]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`, `NTH-WS-003`, `NTH-TD-002`
- User-visible request: Rename the active branch from `agent/dev/ui` to `agent/dev/mvp`, update docs from UI-only implementation to MVP implementation, commit the current work and push.
- State changes: Renamed the local branch to `agent/dev/mvp`. Updated current-branch facts in `AGENTS.md` and `.agent-os/project-index.md`.
- State changes: Recorded `NTH-CD-028`, superseding the branch portion of `NTH-CD-025`. The active goal is now Thoth MVP implementation rather than UI-only scorecard/productization.
- State changes: Renamed `.agent-os/designs/thoth-ui-goal-prompt.md` to `.agent-os/designs/thoth-mvp-goal-prompt.md` and rewrote the prompt around Workspace Secretary, Background Tasks, Settings, hidden `thoth.clarify` / `thoth.loop` skills, compact packets, daemon authority and provider session integration.
- State changes: Added `packages/app/test-results/` to `.gitignore` so Playwright transient attachments are not committed; durable review captures remain under `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/`.
- Evidence produced: `npm run format` completed.
- Evidence produced: `npm run format:check` passed.
- Evidence produced: `git diff --check` passed.
- Evidence produced: `npm run test:protocol -- thoth-runtime-contract.test.ts` passed with `1` file and `12` tests.
- Evidence produced: `npm --workspace=@thoth/desktop run test -- src/features/menu.test.ts src/open-project-routing.test.ts src/daemon/cli/passthrough.test.ts` passed with `3` files and `18` tests.
- Evidence produced: `npm --workspace=@thoth/desktop run typecheck` passed.
- Evidence produced: `npm --workspace=@thoth/desktop run build:main` passed.
- Evidence produced: `npm run check:foundation` passed: repo validation, formatting, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `298` and client `110` tests.
- Push issue: the first `git push -u origin agent/dev/mvp` failed with GitHub `403` because Git used
  a stale/global credential identity instead of the project-local `.dev/gh` authority.
- Push resolution: confirmed `npm run gh -- api user --jq .login` returned the project-local
  authenticated identity, confirmed
  repository permissions included `push: true`, inspected Git credential helpers, then retried the
  push with the URL-specific GitHub helper cleared and the project-local credential path selected
  without printing or tracking any token material.
- Evidence produced: `git push -u origin agent/dev/mvp` then succeeded with commit `933ac2b`, and
  `git push origin --delete agent/dev/ui` deleted the old remote branch. Final branch state was
  `agent/dev/mvp...origin/agent/dev/mvp`.
- State documentation: Recorded `NTH-EXP-009` so future agents do not retry plain GitHub pushes
  against stale global credentials.
- Next likely action: After push, continue `NTH-TD-002` on `agent/dev/mvp` by implementing the first MVP runtime slice rather than returning to legacy UI scorecard polish.

## 2026-07-03 [MVP decomposed into six Codex loop goals]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-002`, `NTH-WS-003`, `NTH-TD-002`
- User-visible request: Preserve the six-loop MVP milestone split in `.agent-os` so future development does not lose the backend/frontend alternating execution plan.
- Product execution decision: MVP implementation must run as six independently executable Codex goal-mode loops, alternating backend and frontend: backend Authority Store + Packet Gate, frontend three-view APP IA, backend Clarify Runtime + two confirmation gates, frontend Workspace Secretary full flow, backend Background Loop Engine + Evidence Stream, frontend Background Tasks + MVP dogfood closure.
- State changes: Added `.agent-os/designs/thoth-mvp-loop-goals.md` as canonical execution plan with full goal, constraints and acceptance for all six loop goals.
- State changes: Added milestones `NTH-MS-012` through `NTH-MS-017` in `.agent-os/architecture-milestones.md`.
- State changes: Added TODOs `NTH-TD-015` through `NTH-TD-020` in `.agent-os/todo.md`; `NTH-TD-015` is now ready and `NTH-TD-016` through `NTH-TD-020` remain backlog in dependency order.
- State changes: Recorded `NTH-CD-029`, updated `.agent-os/project-index.md` top next action to `NTH-TD-015`, and updated `.agent-os/designs/thoth-mvp-goal-prompt.md` to require reading the loop-goals contract.
- Current limitation: This is execution planning and project authority only. It does not implement the authority store, APP IA, Clarify runtime, secretary UI, background loop engine or Background Tasks UI.
- Next likely action: Start `NTH-TD-015` by implementing backend Authority Store + Packet Gate and verifying daemon/client packet authority before returning to frontend work.

## 2026-07-03 [MVP loop goals reframed around agent harness]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-002`, `NTH-TD-015`
- User-visible correction: The previous six-loop split was still too daemon/mechanical. The MVP goal must be framed from agent harness and agent engineering: prompt contracts, runtime skills, convergence/review rubrics and eval harnesses that make provider agents clarify, compile contracts, execute and review better.
- Product interpretation: daemon, packet, authority store, repair, permission gate and UI rendering are required mechanical guarantees, but not the MVP goal itself. The MVP target is improved provider agent behavior under hidden `thoth.clarify` and `thoth.loop` runtime skills.
- State changes: Rewrote `.agent-os/designs/thoth-mvp-loop-goals.md` around the new six-loop sequence: Clarify Agent Harness + Convergence Contract, Secretary Clarify Experience, Task Contract Compiler + Approval Harness, Task / Goal Approval Experience, Loop Execution + Review Agent Harness and Background Task Dogfood Experience.
- State changes: Updated `NTH-MS-012` through `NTH-MS-017` in `.agent-os/architecture-milestones.md` and `NTH-TD-015` through `NTH-TD-020` in `.agent-os/todo.md` to use the agent-harness framing while preserving the backend/frontend alternating order.
- State changes: Recorded `NTH-CD-030`, updated `.agent-os/project-index.md` top next action description and updated `.agent-os/designs/thoth-mvp-goal-prompt.md` to require `NTH-CD-030`.
- Current limitation: This is still planning authority only. No new runtime skill, prompt harness, eval harness, daemon mechanics or frontend experience was implemented in code during this update.
- Next likely action: Start `NTH-TD-015` by designing and implementing `thoth.clarify` harness, convergence rubric and fixture evals before returning to daemon persistence or UI work.

## 2026-07-03 [Golden-driven independent judge discipline added]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-015`, `NTH-TD-019`
- User-visible decision: Clarify and Loop skill development must use fixed golden data and an independent `codex exec` judge. The judge must inspect whether current outputs satisfy behavioral psychology, behavior-tree convergence, goals/constraints/acceptance and low user cognitive load, rather than accepting packet validity or self-review from the main development session.
- Product interpretation: Golden data must encode expected agent behavior, not just schema shape. For `thoth.clarify`, judge failures include irrelevant or repeated questions, field-form questioning, asking facts the agent could discover, unsolicited defaults, target-downgrade fallback and failure to converge. For `thoth.loop`, judge failures include jumping goals, ignoring frozen contracts, treating Review as only running tests, weak evidence, repeating failed retry strategy or producing unclear blockers.
- State changes: Recorded `NTH-CD-031` in `.agent-os/change-decisions.md`.
- State changes: Updated `.agent-os/designs/thoth-mvp-loop-goals.md` global constraints plus Loop Goal 1 and Loop Goal 5 acceptance so golden data and independent judge review are required.
- State changes: Updated `.agent-os/todo.md`, `.agent-os/architecture-milestones.md`, `.agent-os/project-index.md` and `.agent-os/designs/thoth-mvp-goal-prompt.md` so future recovery and goal-mode prompts include `NTH-CD-031`.
- Evidence produced: `rg -n "NTH-CD-031|golden|codex exec|independent|independent|golden-driven|golden data|golden data" ...` confirmed the new decision and requirements are present across change decisions, loop goals, TODOs, milestones, project index and the MVP goal prompt.
- Evidence produced: `git diff --check` passed.
- Current limitation: This is documentation and project-authority work only. No golden fixtures, `codex exec` judge script, runtime skill prompt, eval harness or provider orchestration code was implemented yet.
- Next likely action: Start `NTH-TD-015` by designing the Clarify golden dataset, `thoth.clarify` prompt/rubric contract, deterministic/transcript harness and independent `codex exec` judge workflow before implementing daemon or UI mechanics.

## 2026-07-03 [Clarify final-card provenance locked]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-015`
- User-visible decision: The final two Clarify confirmation packets must preserve provenance mechanically. `C_TASK_CARD` must carry all prior Clarify Q&A transcript text verbatim. `C_GOAL_CARD` must carry that same transcript plus the exact first-round CEO Task Card the user approved, including modifications.
- Product interpretation: The goal split is not allowed to rely only on provider memory or a loose summary. It must be grounded in the transcript and the approved CEO overview card so the chain is traceable: Clarify transcript -> CEO Task Card -> Goal Card split -> future frozen task contract.
- State changes: Recorded `NTH-CD-032` in `.agent-os/change-decisions.md`.
- State changes: Updated `.agent-os/designs/thoth-app-runtime-contract.md` to make `C_TASK_CARD` and `C_GOAL_CARD` packet provenance mandatory.
- State changes: Updated `.agent-os/designs/thoth-mvp-loop-goals.md`, `.agent-os/architecture-milestones.md`, `.agent-os/todo.md`, `.agent-os/project-index.md` and `.agent-os/designs/thoth-mvp-goal-prompt.md` so Loop Goal 1 acceptance requires transcript and CEO-card provenance.
- Current limitation: This is documentation and project-authority work only. No protocol schema fields, packet validator, fixture, runtime prompt or harness code was implemented yet.
- Next likely action: When starting `NTH-TD-015`, design the concrete `content` shape for `clarify_transcript_verbatim` and the user-approved CEO Task Card snapshot before implementing the Clarify golden fixtures and judge workflow.

## 2026-07-03 [Loop 1 and Loop 2 Clarify card contract refined]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-015`, `NTH-TD-016`
- User-visible correction: Behavior tree means the decomposition tree of a user's prompt, where each Clarify question cuts at a high-leverage branch that preserves the user's original target while excluding wrong routes. It does not mean falling back from a larger target to an easier MVP/demo/mock/partial substitute.
- User-visible correction: Clarify should not provide default choices by default. If the agent is better suited to decide a technical detail, it should decide and record the assumption; recommendation is only provided when the user asks for it.
- User-visible correction: A greeting such as `hi` should receive a short friendly secretary response, for example "Hi Boss, what do you need?", without product explanation or Clarify UI.
- User-visible correction: Reference to Paseo means reusing or mirroring the existing Codex request-user-input card rendering capability, not adopting `request_user_input` or `AskUserQuestion` as the Clarify mental model.
- User-visible decision: Clarify answer cards/packets use a title plus 2-4 behavior-tree branch choices. Each choice label is at most 10 Chinese characters and each explanation is at most 20 Chinese characters. Users can attach note text to selected choices, or select no choice and answer with note only.
- State changes: Recorded `NTH-CD-033` in `.agent-os/change-decisions.md`.
- State changes: Updated `.agent-os/designs/thoth-mvp-loop-goals.md` Loop Goal 1 and Loop Goal 2 to remove default-recommendation wording, add downgrade-fallback prohibition, add compact preset prompt requirements and add the 2-4 branch choice plus note answer-card contract.
- State changes: Updated `.agent-os/designs/thoth-app-runtime-contract.md` with `C_ASK` question/answer card constraints and per-round compact preset prompt requirements.
- State changes: Updated `.agent-os/todo.md`, `.agent-os/architecture-milestones.md`, `.agent-os/project-index.md`, `.agent-os/designs/thoth-mvp-goal-prompt.md`, `.agent-os/designs/thoth-mvp-user-journey.md` and `.agent-os/designs/thoth-high-level-design.md` so future recovery uses the new Loop 1/2 Clarify terminology.
- Evidence produced: `rg -n "NTH-CD-033|behavior tree|fallback downgrade|no defaults by default|2-4 branches|note-only|note only|request-user-input|request_user_input" ...` confirmed the new behavior-tree, anti-downgrade, no-unsolicited-default and card-answer constraints are present across the relevant `.agent-os` recovery docs.
- Evidence produced: `rg -n "recommended default|recommended default|accept defaults|default acceptance|accept defaults|recommended default|default value" .agent-os` found no remaining Loop 1/2 default-acceptance wording; remaining default mentions are either explicit anti-default constraints, historical daemon/default endpoint references or Loop 5 frozen-contract execution wording.
- Evidence produced: `git diff --check` passed.
- Current limitation: This is documentation and project-authority work only. No protocol schema fields, UI component changes, fixture data, runtime prompt code or provider harness was implemented yet.
- Next likely action: Start `NTH-TD-015` by designing the concrete `C_ASK` content/ui schema, answer packet schema, compact preset prompt text, golden behavior-tree cases and independent `codex exec` judge rubric.

## 2026-07-03 [NTH-TD-015 Clarify agent harness verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`, `NTH-MS-012`, `NTH-TD-015`
- User-visible request: Execute Loop-1 `NTH-TD-015` in `/mnt/cfs/5vr0p6/yzy/thoth`: make the hidden `thoth.clarify` agent harness real, with prompt contract, convergence rubric, behavior-tree question rubric, golden dataset, eval harness and independent `codex exec` judge evidence.
- Implementation: Added `packages/drivers/src/clarify/contract.ts` with the hidden `thoth.clarify` prompt contract, per-round compact preset prompt, convergence rubric, behavior-tree question rubric and provider input envelope builder. The harness keeps semantic judgment in the provider-backed secretary session and keeps local deterministic code to envelope/schema/eval mechanics.
- Implementation: Added `packages/drivers/src/clarify/golden.ts` and `packages/drivers/src/clarify/eval.ts` with 15 golden scenarios covering `hi`, vague large task, low-risk small task, unclear acceptance, missing risk/resource boundary, repeated ambiguity, enough information, `you decide`, high-risk confirmation, unsafe blocked, contradictory demands, anti-downgrade, `C_ASK` compact preset, note-only answer packet and final Goal Card provenance.
- Implementation: Added `scripts/judge-clarify-golden.mjs` plus root scripts `build:drivers`, `typecheck:drivers`, `test:drivers`, `eval:clarify` and `judge:clarify:golden`. The judge script runs deterministic eval, then launches a read-only independent `codex exec` judge and stores ignored evidence artifacts under `.agent-os/artifacts/`.
- Implementation: Extended `packages/protocol/src/thoth-runtime-contract.ts` and tests so `C_ASK` packets must include valid `content.question_card` and `ui.question_card`, Clarify answer packets support note-only answers, `C_TASK_CARD` requires `clarify_transcript_verbatim`, and `C_GOAL_CARD` requires both transcript and approved CEO Task Card provenance.
- Judge iteration: An independent judge failure caught semantic problems that local eval did not: an overly generic `you decide` Task Card, repeated note-only Clarify behavior, incomplete Task Card transcript provenance and partial-scope cleanup wording. Golden fixtures were corrected and rejudged.
- Judge iteration: A second independent judge failure caught Goal Card provenance drift where a settings-page transcript was paired with an unrelated Clarify-backend CEO Task Card and goal split. The fixture was corrected so transcript, approved CEO Task Card and Goal Card goals all refer to the same settings-page task.
- Evidence produced: `npm run eval:clarify` passed with 15 scenarios.
- Evidence produced: final `npm run judge:clarify:golden` passed with artifacts `.agent-os/artifacts/clarify-golden-eval-2026-07-03T17-41-06-546Z.json` and `.agent-os/artifacts/clarify-golden-codex-judge-2026-07-03T17-41-06-546Z.md`.
- Evidence produced: `npm run test:protocol` passed with 33 files and 303 tests.
- Evidence produced: `npm run test:drivers` passed with 1 file and 3 tests.
- Evidence produced: `npm run typecheck:drivers` passed.
- Evidence produced: `npm run format:check` passed.
- Evidence produced: `git diff --check` passed.
- Evidence produced: `npm run check:foundation` passed: repo validation, formatting, foundation lint, foundation build, foundation typecheck and foundation tests. Foundation tests passed with highlight `66`, relay `29`, protocol `303` and client `110` tests.
- State changes: Added `NTH-EV-023` to `.agent-os/acceptance-report.md`, marked `NTH-MS-012` verified, moved `NTH-TD-015` to verified, moved `NTH-TD-016` to ready, changed the project top next action to `NTH-TD-016`, and recorded `NTH-EXP-010` about semantic provenance failures in Clarify golden fixtures.
- Current limitation: This verifies the backend Clarify agent harness and golden judge workflow. It does not render Workspace Secretary UI cards, start live provider-backed secretary sessions from the daemon, or register real background tasks.
- Next likely action: Start `NTH-TD-016` by implementing the frontend Workspace Secretary Clarify Experience over the verified `C_ASK` question-card and answer-packet contracts.

## 2026-07-04 [NTH-TD-015 revised standard Skill artifact verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`, `NTH-MS-012`, `NTH-TD-015`
- User-visible request: Revise the previous Loop-1 acceptance so `thoth.clarify` becomes a standard,
  cross-provider internal Skill artifact created through the standard skill-create / skill creator
  workflow, not a TS-only prompt-constant harness; keep the skill out of user global provider skill
  dirs; stop repeating Skill rules in ordinary packets; add independent `codex exec` user simulation.
- Decision recorded: Added `NTH-CD-034`. It supersedes the older per-round compact-preset wording in
  `NTH-CD-033`: `SKILL.md` is canonical, ordinary same-state packets carry runtime data only, and
  `skill_ref` / digest markers appear only for session start, state transitions, digest/context
  changes or repeated repair failure.
- Implementation: Created `packages/drivers/src/runtime-skills/thoth-clarify/SKILL.md` and
  `packages/drivers/src/runtime-skills/thoth-loop/SKILL.md` with standard Skill frontmatter/body
  structure. Removed generated Codex-only `agents/openai.yaml` metadata from the created skill dirs.
- Implementation: Reworked `packages/drivers/src/clarify/contract.ts` so TypeScript loads, parses,
  validates, hashes, session-mounts and fallback-renders canonical `SKILL.md` instead of owning the
  behavior as prompt constants. The mount target is
  `provider-sessions/<sessionId>/skills/thoth-clarify/SKILL.md`; global provider skill dirs are
  rejected.
- Implementation: Extended `packages/protocol/src/thoth-runtime-contract.ts` with Clarify
  session-start, normal-turn, transition and repair input packet schemas, `skill_ref` digest
  validation and `THOTH_CLARIFY_MECHANICAL_TRANSITIONS`.
- Implementation: Normal turn packets now omit `skill_ref` and full rules. Transition packets carry
  `skill_ref`, digest and `basis: according_to_loaded_skill` without copying rules. Repair packets
  restrict work to packet shape/state/provenance and forbid semantic reinterpretation, fabricated
  transcript and approved Task Card mutation.
- Implementation: Added `packages/drivers/src/clarify/user-simulation.ts` and
  `scripts/judge-clarify-user-simulation.mjs`. The simulation covers `hi`, vague large task, Three.js
  PathTracing, branch selection, note-only answer, `you decide`, unclear acceptance, delete/risk
  boundary, contradiction, Task Card confirmation, Goal Card confirmation and repair boundary.
- Implementation: Upgraded `scripts/judge-clarify-golden.mjs` so the independent judge reviews
  canonical `SKILL.md`, session-scoped mount evidence, normal-turn envelope, transition packet,
  repair packet and golden outputs.
- Evidence produced: `npm run test:protocol -- thoth-runtime-contract.test.ts` passed with `1` file
  and `23` tests.
- Evidence produced: `npm run test:drivers` passed with `1` file and `4` tests.
- Evidence produced: `npm run typecheck:drivers` passed.
- Evidence produced: `npm run eval:clarify` passed with the original 15 behavior scenarios plus
  revised Skill artifact / session mount / no-global-install / compact packet / repair /
  user-simulation checks.
- Evidence produced: `npm run judge:clarify:golden` passed with artifacts
  `.agent-os/artifacts/clarify-golden-eval-2026-07-04T02-09-17-693Z.json` and
  `.agent-os/artifacts/clarify-golden-codex-judge-2026-07-04T02-09-17-693Z.md`.
- Evidence produced: `npm run judge:clarify:user-simulation` passed with artifact
  `.agent-os/artifacts/clarify-user-simulation-2026-07-04T02-11-39-269Z.md`.
- Evidence produced: `npm run format:check` passed.
- Evidence produced: `git diff --check` passed.
- Evidence produced: `npm run check:foundation` passed. Foundation tests passed with highlight `66`,
  relay `29`, protocol `309` and client `110` tests.
- State changes: Added `NTH-EV-024`, updated `NTH-MS-012`, `NTH-TD-015`, `.agent-os/designs`, the
  MVP goal prompt, project index, lessons learned and this run log so recovery now points to the
  revised Loop-1 acceptance instead of the older TS prompt-constant model.
- Current limitation: This verifies the revised backend Clarify standard Skill artifact, internal
  session-scoped mount contract, no global provider pollution, compact packets, repair boundary,
  golden eval and independent judges. It still does not implement live daemon provider-session
  orchestration, Workspace Secretary frontend rendering, real background task registration or
  `thoth.loop` execution / review runtime.
- Next likely action: Start `NTH-TD-016` by implementing the frontend Workspace Secretary Clarify
  Experience on top of the verified `C_ASK` card, answer packet and hidden runtime skill contract.

## 2026-07-04 [NTH-TD-015 Clarify strength and decision frontier revised]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`, `NTH-MS-012`, `NTH-TD-015`
- User-visible request: Revise Loop-1 again so `thoth.clarify` is not merely a standard internal
  Skill artifact, but also has real clarify-strength behavior, assumption-owner classification,
  decision-tree frontier handling, compact runtime controls and multi-question secretary cards.
- Decision recorded: Added `NTH-CD-035`. Clarify strength now has explicit behavior semantics:
  `none` direct/no proactive Clarify, `light` core fork only, `balanced` core plus 1-2 material
  leaves, `dive` material-assumption walk without trivia or implementation minutiae. Legacy `deep`
  remains a protocol compatibility alias, but `dive` is the canonical wording.
- Implementation: Updated `packages/drivers/src/runtime-skills/thoth-clarify/SKILL.md` with Mental
  Model, Clarify Strength Strategy, Assumption Ledger, Decision Tree Frontier, multi-question
  Output Contract, hidden internal `content.meta` and Good/Bad cases for strength, stop conditions
  and anti-questionnaire behavior.
- Implementation: Updated `packages/protocol/src/thoth-runtime-contract.ts` with `dive`, input
  controls, `controls_changed`, multi-question `C_ASK` card schemas, multi-answer packet schemas,
  assumption owner schemas and `ClarifyOutputMetaSchema`. `C_ASK` packets now require valid hidden
  `content.meta`.
- Implementation: Updated `packages/drivers/src/clarify/contract.ts` so normal turn packets carry
  controls/effective strength plus assumption ledger and decision-tree frontier refs while still
  omitting `skill_ref` and Skill rules. Transition packets can carry `controls_changed`; legacy
  `deep` normalizes to effective `dive`.
- Implementation: Expanded deterministic golden data from 15 to 21 behavior scenarios. New coverage
  proves the same Three.js PathTracing prompt behaves differently under `none`, `light`, `balanced`
  and `dive`; covers agent-discoverable facts; and covers user stop signal
  `enough/do not ask again` converging to a Task Card.
- Implementation: Updated `packages/drivers/src/clarify/user-simulation.ts` and both judge scripts
  so independent `codex exec` reviews strength behavior, assumption ownership, decision frontier,
  multi-question cards, hidden meta and stop conditions.
- State changes: Added `NTH-EV-025`, updated `NTH-MS-012`, `NTH-TD-015`,
  `.agent-os/designs/thoth-app-runtime-contract.md`,
  `.agent-os/designs/thoth-mvp-loop-goals.md`,
  `.agent-os/designs/thoth-mvp-goal-prompt.md`, `.agent-os/project-index.md`,
  `.agent-os/todo.md`, `.agent-os/architecture-milestones.md`,
  `.agent-os/acceptance-report.md` and `.agent-os/lessons-learned.md`.
- Evidence produced: `npm run test:protocol -- thoth-runtime-contract.test.ts` passed with `1` file
  and `23` tests.
- Evidence produced: `npm run test:drivers` passed with `1` file and `4` tests.
- Evidence produced: `npm run typecheck:drivers` passed.
- Evidence produced: `npm run eval:clarify` passed with `21` behavior scenarios plus revised
  skill/session/packet/repair/strength checks.
- Evidence produced: `npm run judge:clarify:golden` passed with artifacts
  `.agent-os/artifacts/clarify-golden-eval-2026-07-04T03-10-56-860Z.json` and
  `.agent-os/artifacts/clarify-golden-codex-judge-2026-07-04T03-10-56-860Z.md`.
- Evidence produced: `npm run judge:clarify:user-simulation` passed with artifact
  `.agent-os/artifacts/clarify-user-simulation-2026-07-04T03-13-04-820Z.md`.
- Evidence produced: `npm run format:check` passed.
- Evidence produced: `git diff --check` passed.
- Evidence produced: `npm run check:foundation` passed. Foundation tests passed with highlight
  `66`, relay `29`, protocol `309` and client `110` tests.
- Current limitation: This still does not implement live daemon provider-session orchestration,
  Workspace Secretary frontend rendering, real background task registration or `thoth.loop`
  execution / review runtime.
- Next likely action: Start `NTH-TD-016` by rendering the verified multi-question `C_ASK` card and
  answer flow in the Workspace Secretary UI without exposing skill ids, packets, state codes,
  provider roles or repair internals.

## 2026-07-04 [NTH-TD-016 Loop-2 frontend refactor contract hardened]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Converge the final Loop-2 goals/constraints/acceptance, keep each column compact, and make the frontend acceptance hard enough to prove the UI has truly left Paseo's product model and become Thoth Workspace Secretary.
- Decision recorded: Added `NTH-CD-036`. Loop-2 is no longer a light Secretary question-card task; it is the first hard APP frontend refactor gate. Refactor priority is higher than compatibility, local minimal-change preservation or keeping old Paseo UI paths alive.
- State changes: Updated `.agent-os/designs/thoth-mvp-loop-goals.md` so Loop-2 is now `Frontend App Refactor Foundation + Workspace Secretary Clarify Experience`, with targets, constraints and acceptance each compressed under 15 items.
- State changes: Updated `.agent-os/architecture-milestones.md`, `.agent-os/todo.md`, `.agent-os/project-index.md` and `.agent-os/designs/thoth-mvp-goal-prompt.md` so recovery and goal-mode prompts point to the hardened Loop-2 contract.
- Current Loop-2 contract: The APP must have only Settings, Workspace Secretary and Background Tasks; Workspace Secretary is default; `New Agent` means secretary topic/session; Paseo is only substrate; Clarify card is a Thoth decision-card experience with choices, per-option notes, note-only, "you recommend" and "you decide"; UI consumes typed clean models and never raw packets or text parsing.
- Acceptance emphasis: Loop-2 now requires anti-Paseo residual scan, authority-boundary source review, icon/accessibility review, desktop/mobile screenshots, Playwright trace/e2e, app/build/foundation gates and independent UI mental-model review proving it feels like Thoth Workspace Secretary rather than Paseo agent manager, questionnaire or permission prompt.
- Current limitation: This is documentation and project-authority work only. No `packages/app` source, UI tests, screenshots or e2e evidence were produced in this session.
- Next likely action: Execute `NTH-TD-016` against the hardened contract, starting from route/product skeleton refactor before implementing Clarify card details.

## 2026-07-04 [Project naming converged to Thoth]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-006`
- User-visible request: Sweep repository documents, code strings and preset prompts so the project uses one product identity: Thoth.
- Decision recorded: Added `NTH-CD-037`. Historical material may be named as the archived plugin runtime or historical migration note, but not as a second Thoth identity.
- State changes: Renamed canonical design documents to the unified `thoth-*` filename family, including `thoth-app-runtime-contract.md`, `thoth-mvp-loop-goals.md`, `thoth-mvp-goal-prompt.md`, `thoth-mvp-user-journey.md`, `thoth-engineering-architecture.md`, `thoth-high-level-design.md`, `thoth-prompt-contract-seeds.md`, `thoth-ui-shell-rebrand-plan.md` and `thoth-migration-architecture-20260625.md`.
- State changes: Updated AGENTS recovery paths, README/NOTICE/docs/package descriptions, `.agent-os` authority files, prompt docs, TUI text/tests and relevant code/test strings to `Thoth` plus `archived plugin` terminology.
- Evidence produced: Strict, case-insensitive and Chinese-variant scans over tracked plus non-ignored untracked source files found no remaining split-name or archived-plugin phrasing matches. Canonical design path scan found no stale former-prefix references. Ignored `.agent-os/artifacts/` judge evidence was intentionally preserved as historical evidence.
- Verification: `git diff --check`, no-index whitespace check for `.agent-os/designs/thoth-mvp-loop-goals.md`, `npm run validate:repo` and `npm run format:check` passed.
- Current limitation: This is terminology, file-path and authority-doc convergence only. No runtime behavior, frontend implementation or provider orchestration was implemented.
- Next likely action: Continue `NTH-TD-016` using the renamed Thoth design paths and unified terminology.

## 2026-07-04 [NTH-TD-016 real Seele relay acceptance added]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-004`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Revise the Loop-2 goal-mode prompt and corresponding `.agent-os` docs so final frontend acceptance must use the real Seele relay service, not fake links or mock connected states.
- Decision recorded: Added `NTH-CD-038`. Loop-2 must validate against `relay.test.thoth.seeles.ai` from `SeeleAI/Thoth-Relay`; fake links, localhost relay stand-ins, mock success, fake device links and offline-only relay fixtures cannot satisfy acceptance.
- State changes: Updated `.agent-os/designs/thoth-mvp-loop-goals.md`, `.agent-os/designs/thoth-mvp-goal-prompt.md`, `.agent-os/architecture-milestones.md`, `.agent-os/todo.md` and `.agent-os/project-index.md`.
- Current Loop-2 relay contract: Settings must show safe real relay status for `relay.test.thoth.seeles.ai`; screenshots/trace must include that state; source review and e2e must prove no fake relay fallback; token/raw offer/credential leakage remains forbidden.
- Current limitation: This is documentation and project-authority work only. No `packages/app` source, relay user journey, screenshots, trace/video, e2e or real relay verification were executed in this session.
- Next likely action: Execute `NTH-TD-016` against the relay-hardened contract and fail/block acceptance if the real Seele relay service is not exercised.

## 2026-07-04 [NTH-TD-016 Workspace Secretary frontend slice]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-WS-004`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Continue Loop-2 frontend implementation from the prior handoff and move the
  APP away from the Paseo-derived shell toward the compact Workspace Secretary / Background Tasks /
  Settings model.
- Implementation: Added `packages/app/src/thoth-app/clean-ui-model.ts` with typed clean UI model
  contracts for Workspace Secretary, Clarify cards, Settings relay state and Background Tasks, plus
  structured Clarify answer payload builders and the locked `relay.test.thoth.seeles.ai` endpoint.
- Implementation: Added `packages/app/src/thoth-app/development-fixture-adapter.ts` as an explicit
  development-only fixture adapter for multi-question Clarify cards while daemon-backed typed UI
  authority is still future work.
- Implementation: Added `packages/app/src/thoth-app/thoth-app-shell.tsx` and changed
  `packages/app/src/app/index.tsx` so `/` renders the first three-view Thoth APP shell by default.
  The shell covers workspace identity, secretary topics, conversation, Quick/Loop and
  clarify-strength controls, decision cards, Background Tasks and Settings.
- Implementation: Reworked `packages/app/e2e/thoth-ui-scorecard.spec.ts` into the Loop-2 static
  export scorecard covering Workspace Secretary default, `hi`, Quick/no-card, Loop Clarify,
  choice+note, note-only, recommend, stop Clarify, Background Tasks, Settings real relay state and
  mobile composer visibility.
- Debug finding: The first direct Metro e2e failed with a blank page and `Cannot use 'import.meta'
outside a module`. Static export passed because `scripts/post-export-web.mjs` marks the Expo web
  bundle as `type="module"`. Recorded this as `NTH-EXP-012`.
- Evidence produced: `curl -sS https://relay.test.thoth.seeles.ai/health` returned
  `{"status":"ok","protocol":"3","service":"thoth-relay"}`.
- Evidence produced: `npm --workspace=@thoth/app run test -- --project unit src/thoth-app/clean-ui-model.test.ts src/thoth-app/thoth-app-shell.test.tsx`
  passed with `2` files and `9` tests.
- Evidence produced: `npm run build:web` passed and exported `packages/app/dist`.
- Evidence produced: `E2E_BASE_URL=http://127.0.0.1:4173 E2E_RECORD_VIDEO=1 npm --workspace=@thoth/app run test:e2e -- thoth-ui-scorecard.spec.ts --trace on`
  passed with `1` Playwright test against the static export.
- Evidence produced: `npm run smoke:web:ui-scorecard` passed end-to-end through build, static serve
  and the Loop-2 scorecard e2e.
- Evidence produced: screenshots captured under `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/`
  for desktop Workspace Secretary, `hi`, Clarify card, readonly/next-round Clarify, Background
  Tasks, Settings real relay state and mobile composer.
- Evidence produced: `npm --workspace=@thoth/app run typecheck` still fails on existing promoted
  substrate issues, but a filtered scan found no errors from `src/thoth-app`, `src/app/index`,
  `src/test/jsdom-shim` or the Loop-2 e2e spec.
- Evidence produced: `git diff --check` passed.
- Evidence produced: `npm run check:foundation` passed. Foundation tests passed with highlight
  `66`, relay `29`, protocol `309` and client `110` tests.
- State changes: Added `NTH-EV-026`, changed `NTH-MS-013` / `NTH-TD-016` to in-progress / doing,
  updated `.agent-os/project-index.md`, `.agent-os/todo.md`, `.agent-os/architecture-milestones.md`,
  `.agent-os/acceptance-report.md`, `.agent-os/lessons-learned.md` and this run log.
- Current limitation: `NTH-TD-016` is not complete. The APP slice still uses a development fixture
  adapter, independent UI mental-model review has not passed, full source-boundary review is not
  complete, submitted/loading/error/retry/daemon-unavailable states are incomplete, real background
  task registration is not implemented and `thoth.loop` execution / review runtime remains future
  work.
- Next likely action: Finish Loop-2 acceptance by replacing or quarantining fixtures behind the
  daemon-backed typed UI model path, running the independent UI mental-model review, and completing
  anti-residual/source-boundary/icon/accessibility review before moving to `NTH-TD-017`.

## 2026-07-04 [NTH-TD-016 Loop-2 frontend acceptance verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-WS-004`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Finish Loop-2 as the frontend owner: do not downgrade to a small UI patch;
  prove the active APP is Settings / Workspace Secretary / Background Tasks, prove Clarify is a
  Thoth decision-branch card, prove Settings uses the real `relay.test.thoth.seeles.ai` service, run
  tests/e2e/screenshots/independent review and update `.agent-os`.
- Implementation: Added and verified the daemon-backed `workspace_secretary.*` clean UI model path
  across protocol, client, daemon and app. The active app shell now fetches snapshots, sends Quick /
  Loop messages, answers Clarify cards and creates new secretary topics through authority client
  methods instead of local fixtures.
- Implementation: Moved relay health into daemon clean UI authority. The daemon probes
  `https://relay.test.thoth.seeles.ai/health`, accepts only
  `{"status":"ok","protocol":"3","service":"thoth-relay"}`, and emits safe Settings relay state
  without token/raw-offer/credential fields.
- Implementation: Removed app-local relay model construction from
  `packages/app/src/thoth-app/clean-ui-model.ts`; app tests now prove the module does not export a
  `createRelayModel` factory. Settings renders `model.settings.relay` from daemon authority.
- Evidence produced: `npm --workspace=@thoth/daemon run test:unit -- workspace-secretary-session.test.ts`
  passed with `1` file and `4` tests. The added regression proves the daemon clean UI model returns
  the composer to Quick after a structured `stop` Clarify answer.
- Evidence produced: `npm --workspace=@thoth/app run test -- thoth-app` passed with `2` files and
  `11` tests.
- Evidence produced: `npm --workspace=@thoth/app run test` passed with `315` files and `2617` tests;
  only existing `@vitest/browser/context` deprecation warnings were reported.
- Evidence produced: `curl -sS --max-time 10 https://relay.test.thoth.seeles.ai/health` returned
  `{"status":"ok","protocol":"3","service":"thoth-relay"}`.
- Evidence produced: `npm run build:web` passed and produced the latest web bundle
  `index-29d0748e2e9e1994ebe1c4f2534a7d0a.js`.
- Evidence produced: Loop-2 narrow e2e passed with `1` Playwright test:
  `E2E_BASE_URL=http://127.0.0.1:4173 E2E_RECORD_VIDEO=1 npm --workspace=@thoth/app run test:e2e -- thoth-ui-scorecard.spec.ts --trace on`.
  The daemon metrics recorded `workspace_secretary.send.request: 7`,
  `workspace_secretary.answer.request: 5`, `workspace_secretary.snapshot.request: 2` and
  `workspace_secretary.topic.create.request: 1`; the final rerun also asserts `stop` returns the
  composer action to `Send` / Quick.
- Evidence produced: Latest screenshots were refreshed under
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/`: `desktop-workspace-secretary.png`,
  `desktop-hi-no-card.png`, `desktop-clarify-card.png`,
  `desktop-clarify-readonly-next-round.png`, `desktop-background-tasks.png`,
  `desktop-settings-real-relay.png` and `mobile-workspace-secretary-composer.png`.
- Evidence produced: After re-checking the requested web app, Electron desktop app and mobile
  screenshots, the previous `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/desktop-scorecard/` images were identified as
  historical pre-Loop-2 One Thoth / New Agent evidence rather than current desktop app evidence. The
  desktop smoke was updated to load the Loop-2 static export in the Electron shell through
  `THOTH_DESKTOP_LOAD_STATIC_EXPORT=1`.
- Evidence produced: `npm run smoke:desktop:ui-scorecard` passed after the desktop smoke update. It
  ran `packages/desktop` `src/features/menu.test.ts` with `3` tests, rebuilt the web export and
  desktop main process, launched an isolated daemon on `127.0.0.1:46409`, verified the Electron
  bridge, and captured `desktop-app-workspace-secretary.png`, `desktop-app-hi-no-card.png`,
  `desktop-app-clarify-card.png`, `desktop-app-background-tasks.png` and
  `desktop-app-settings-real-relay.png` under `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/`.
- Evidence produced: Manual `view_image` review passed for the refreshed Electron desktop app root
  Workspace Secretary view, `hi` no-card state, Clarify decision card, Background Tasks empty state
  and Settings real relay state. Manual `view_image` review also reconfirmed the existing Loop-2 web
  desktop viewport and mobile composer screenshots.
- Evidence produced: Latest Playwright artifacts are
  `packages/app/test-results/thoth-ui-scorecard-Loop-2--d4592--card-and-real-relay-status-Desktop-Chrome/trace.zip`
  and
  `packages/app/test-results/thoth-ui-scorecard-Loop-2--d4592--card-and-real-relay-status-Desktop-Chrome/video.webm`.
- Evidence produced: Manual `view_image` review passed for the default Workspace Secretary,
  `hi` no-card state, Clarify card, readonly/next-round Clarify, Settings real relay status,
  Background Tasks empty state and mobile composer visibility. The refreshed mobile screenshot shows
  Quick selected and `Send` visible after stopping Clarify.
- Evidence produced: Focused anti-residual scan found only negative assertion hits for forbidden
  terms; icon/accessibility inventory found the active shell uses `ThothInventoryIcon` and
  `accessibilityLabel` on the main action surfaces.
- Evidence produced: Independent read-only `codex exec` mental-model review wrote
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/independent-mental-model-review.md` with
  verdict `PASS` and no blocking evidence.
- Evidence produced: `git diff --check` passed.
- Evidence produced: `npm run format:check` passed.
- Evidence produced: `npm run check:foundation` passed. Foundation tests passed with highlight `66`,
  relay `29`, protocol `312` and client `110` tests.
- State changes: Updated `NTH-EV-026` to `passed`, changed `NTH-MS-013` and `NTH-TD-016` to
  `verified`, moved `NTH-TD-017` to `ready`, changed `project-index.md` top next action to
  `NTH-TD-017`, and recorded `NTH-EXP-013` plus the later desktop static-export smoke lesson
  `NTH-EXP-014`.
- Current limitation: This verifies Loop-2 frontend acceptance only. It does not implement
  provider-backed `thoth.clarify` runtime output, Task Card / Goal Card approval, real background
  task registration or `thoth.loop` PlanExec / Review runtime. The broader promoted substrate still
  has legacy voice/speech/dictation code and bootstrap logs outside the active Loop-2 user-visible
  APP surface.
- Next likely action: Start `NTH-TD-017`, backend Task Contract Compiler and Approval Harness, from
  the now-verified Workspace Secretary Clarify experience.

## 2026-07-04 [NTH-TD-016 Workspace composer controls collapsed]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Make Mode, Clarify strength and Loop strength feel like the provided
  bottom composer pills: collapsed at the bottom of the dialog, not permanently stacked above the
  input, with a restrained dropdown menu style.
- Implementation: Replaced the previous always-visible segmented Mode / Clarify controls in
  `packages/app/src/thoth-app/thoth-app-shell.tsx` with three bottom composer pills:
  `secretary-mode-menu-trigger`, `secretary-clarify-menu-trigger` and
  `secretary-loop-menu-trigger`. Each trigger opens one lightweight menu with current-option check
  state. The option test IDs remain stable, including `secretary-mode-control-loop`,
  `secretary-clarify-strength-control-*` and `secretary-loop-strength-control-*`.
- Implementation: Added Loop strength choices to the UI surface without creating any app-local task
  authority. Selecting a Loop strength only updates the typed `ThothComposerModel` through
  `onComposerChange({ mode: "loop", loop })`; Quick still clears `loop: null`.
- Implementation: Moved dropdown menus to an upward overlay so mobile opening does not push the
  bottom composer control strip off-screen. The bottom controls stay visible while the menu is open.
- Evidence produced: `npm --workspace=@thoth/app run test -- thoth-app` passed with `2` files and
  `11` tests. The updated component test asserts the controls are collapsed by default and options
  appear only after opening the relevant menu.
- Evidence produced: `npm run build:web` passed and exported `packages/app/dist`; the final bundle
  for this refinement is `index-504256249c2eed522f2d536b7c118e28.js`.
- Evidence produced: Loop-2 narrow e2e passed with `1` Playwright test:
  `E2E_BASE_URL=http://127.0.0.1:4173 E2E_RECORD_VIDEO=1 npm --workspace=@thoth/app run test:e2e -- thoth-ui-scorecard.spec.ts --trace on`.
  The latest Playwright artifacts remain under
  `packages/app/test-results/thoth-ui-scorecard-Loop-2--d4592--card-and-real-relay-status-Desktop-Chrome/trace.zip`
  and `video.webm`, refreshed during this run.
- Evidence produced: New web screenshots were captured and manually reviewed with `view_image`:
  `desktop-composer-clarify-menu.png` proves the desktop dropdown menu, and
  `mobile-composer-loop-menu.png` proves the mobile dropdown keeps Mode / Clarify / Loop controls
  visible at the bottom. Existing refreshed screenshots also show the collapsed default composer and
  Clarify composer states.
- Evidence produced: `npm run smoke:desktop:ui-scorecard` passed after the selector update. It ran
  desktop `src/features/menu.test.ts` with `3` tests, rebuilt the web export and desktop main
  process, launched the smoke daemon on `127.0.0.1:34773`, verified the Electron bridge and refreshed
  `desktop-app-workspace-secretary.png`, `desktop-app-hi-no-card.png`,
  `desktop-app-clarify-card.png`, `desktop-app-background-tasks.png` and
  `desktop-app-settings-real-relay.png`.
- Evidence produced: Manual `view_image` review passed for the refreshed Electron
  `desktop-app-workspace-secretary.png` and `desktop-app-clarify-card.png`; both show the bottom
  collapsed composer controls rather than a stacked option panel.
- Evidence produced: `npm run format:check` and `git diff --check` passed after the final composer
  overlay adjustment.
- Evidence produced: `npm run check:foundation` passed after the composer refinement and evidence
  ledger updates. Foundation tests passed with highlight `66`, relay `29`, protocol `312` and
  client `110` tests.
- State changes: Updated `packages/app/e2e/thoth-ui-scorecard.spec.ts` to open the collapsed Mode
  menu before selecting Quick/Loop and to capture desktop/mobile dropdown screenshots. Updated
  `scripts/smoke-desktop-ui-scorecard.mjs` to open the Mode menu before selecting Loop in the
  Electron app journey.
- Current limitation: This is a UI ergonomics refinement over the already verified Loop-2 frontend
  slice. It does not change backend task registration, provider-backed Clarify generation, Task Card
  / Goal Card approval or `thoth.loop` PlanExec / Review runtime.
- Next likely action: Continue `NTH-TD-017`, using the now less cluttered Workspace Secretary
  composer as the entry point for backend Task Contract Compiler and Approval Harness work.

## 2026-07-04 [NTH-TD-016 public web host recovery hotfix]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: The public web app at `http://180.76.242.105:8148/` still showed
  `Workspace Secretary` / `Local Thoth host not connected` in the user's real browser after the 8082 static
  server was proxied to a real Thoth daemon.
- Diagnosis: The public static entry injects `window.__THOTH_INITIAL_DAEMON_CONNECTION__` with the
  current same-origin host and proxies `/ws` to the real daemon, but `HostRuntimeStore` skipped the
  explicit hint probe when the same connection already existed in persisted host registry. If the
  daemon had restarted and the real `serverId` changed, the stale persisted profile stayed selected
  and the controller rejected the real daemon as the wrong server.
- Implementation: Updated `packages/app/src/runtime/host-runtime.ts` so the explicit injected
  initial daemon connection hint always runs `probeAndUpsertConnection`. This refreshes stale
  profiles to the current real daemon server id and activates the existing probed client without
  clearing unrelated browser state, without touching Paseo `6767`, and without introducing a fake
  relay/mock success/offline fixture.
- Implementation: Added a regression in `packages/app/src/runtime/host-runtime.test.ts` proving a
  persisted matching public hint connection with stale `srv_stale_review` is refreshed to
  `srv_current_review`.
- Runtime state: Rebuilt web and restarted the public review static server on `0.0.0.0:8082` with
  `THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6689`. The real daemon remained on `127.0.0.1:6689` with
  server id `srv_0Ryud1K1J1zRYj7eylwnsg`; the existing Paseo/legacy listener remained isolated on
  `127.0.0.1:6767`.
- Evidence produced: `npm --workspace=@thoth/app run test -- host-runtime.test.ts` passed with `1`
  file and `46` tests.
- Evidence produced: `npm run build:web` passed and exported
  `packages/app/dist/_expo/static/js/web/index-af71fdae85603a93d009de4a5d707155.js`.
- Evidence produced: `curl http://180.76.242.105:8148/` showed the injected
  `__THOTH_INITIAL_DAEMON_CONNECTION__` script and the `index-af71...js` bundle.
- Evidence produced: Playwright verified `http://180.76.242.105:8148/` in fresh desktop,
  stale-registry desktop and stale-registry mobile states. All three had no visible
  `Local Thoth host not connected`, `hi` produced ordinary Quick chat, Clarify card count after `hi` was `0`,
  and stale local storage was rewritten from `srv_stale_public_review` to the current real daemon
  `srv_0Ryud1K1J1zRYj7eylwnsg`.
- Evidence produced: Public screenshots were saved under
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/` as `public-web-fresh-desktop.png`,
  `public-web-stale-desktop.png` and `public-web-stale-mobile.png`; manual `view_image` review
  passed for all three.
- Evidence produced: `npm run smoke:desktop:ui-scorecard` passed. It reran desktop
  `src/features/menu.test.ts` with `3` tests, rebuilt web and desktop main, launched an isolated
  daemon on `127.0.0.1:35899`, verified the Electron bridge and refreshed desktop app Workspace
  Secretary / `hi` / Clarify / Background Tasks / Settings screenshots. Manual `view_image` review
  passed for desktop Workspace Secretary and Clarify card states.
- Evidence produced: `git diff --check`, `npm run format:check` and `npm run check:foundation`
  passed. Foundation tests passed with highlight `66`, relay `29`, protocol `312` and client `110`
  tests.
- State changes: Updated `.agent-os/acceptance-report.md` with the public web recovery evidence and
  this run log.
- Current limitation: This is a public review host-recovery hotfix over the already verified Loop-2
  frontend slice. It does not implement provider-backed `thoth.clarify`, Task Card / Goal Card
  approval, real background task registration or `thoth.loop` PlanExec / Review runtime.
- Next likely action: Ask the user to hard-refresh or reopen `http://180.76.242.105:8148/` and then
  continue `NTH-TD-017` after the public entry is confirmed in their browser.

## 2026-07-04 [NTH-TD-016 public web multi-host recovery follow-up]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: The user's real browser still showed the dark-theme public web app with
  `Local Thoth host not connected` even after `Ctrl+Shift+R`.
- Diagnosis: The previous fix handled a stale same-address host, but the active app shell still chose
  `hosts[0]` for Workspace Secretary authority. A real browser can have multiple persisted hosts;
  if an old failed local/stale host remains first and the public same-origin daemon appears later,
  the page can have a healthy public daemon while the visible Workspace Secretary still renders from
  the first stale host.
- Implementation: Updated `packages/app/src/thoth-app/thoth-app-shell.tsx` to select Workspace
  Secretary authority by runtime relevance: online host matching the injected same-origin daemon hint
  first, then any online host, then a matching hinted host while it is still connecting, and only then
  the first persisted host fallback.
- Implementation: Added `selectWorkspaceSecretaryAuthorityServerId` regression coverage in
  `packages/app/src/thoth-app/thoth-app-shell.test.tsx`; the test proves the public same-origin host
  is selected ahead of stale persisted hosts.
- Evidence produced: `npm --workspace=@thoth/app run test -- thoth-app host-runtime.test.ts` passed
  with `3` files and `58` tests.
- Evidence produced: `npm run build:web` passed and exported
  `packages/app/dist/_expo/static/js/web/index-2435eae53f002855c8ae5143a30e36b4.js`.
- Runtime state: Restarted the public review static server on `0.0.0.0:8082` with
  `THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6689`; `curl http://180.76.242.105:8148/` shows the injected
  daemon connection hint and the `index-2435...js` bundle.
- Evidence produced: Playwright reproduced a dark-theme public browser with three persisted hosts:
  a stale invalid host first, an old `127.0.0.1:6688` host second and the public same-origin host
  third. Stale hosts still emitted expected WebSocket failures, but the visible Workspace Secretary
  selected the public same-origin daemon, showed `Foreground Quick available`, answered `hi` in Quick and kept
  Clarify card count at `0`.
- Evidence produced: Screenshot saved as
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/public-web-multihost-dark-ready.png` and
  manually reviewed with `view_image`.
- Evidence produced: `git diff --check`, `npm run format:check` and `npm run check:foundation`
  passed. Foundation tests passed with highlight `66`, relay `29`, protocol `312` and client `110`
  tests.
- State changes: Updated `.agent-os/acceptance-report.md` and this run log with the second root
  cause and evidence.
- Current limitation: This remains a public review host-selection recovery fix over Loop-2. It does
  not implement provider-backed `thoth.clarify`, Task Card / Goal Card approval, real background task
  registration or `thoth.loop` PlanExec / Review runtime.
- Next likely action: Ask the user to reload `http://180.76.242.105:8148/`; the dark-theme page
  should now show `Foreground Quick available` rather than `Local Thoth host not connected`.

## 2026-07-04 [Harness question / clarify prompt research doc update]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`, `NTH-WS-004`
- User-visible request: Update the research document under `docs/` with the latest OpenCode
  `question` and Claude Code `AskUserQuestion` preset prompt / tool-description constraints and
  keep the result under 1000 lines.
- Implementation: Updated `docs/harness-question-clarify-research.md` with Claude Code extracted
  prompt evidence from `Piebald-AI/claude-code-system-prompts`, local Claude Code `2.1.159` string
  evidence, OpenCode `question.txt` / schema constraints, a prompt-philosophy comparison, Thoth ask
  gate rules, driver notes, risk mitigations and prompt-level acceptance checklist.
- Evidence produced: `wc -l docs/harness-question-clarify-research.md` returned `535`, under the
  requested 1000-line limit.
- Evidence produced: `git diff --check -- docs/harness-question-clarify-research.md` passed.
- Current limitation: This is documentation and design-analysis material only. It does not implement
  provider question adapters, ClarificationCard validation or runtime ask-gate enforcement.
- Next likely action: Continue `NTH-TD-017`, using the updated prompt/tool-description constraints
  when designing Task Contract Compiler / Approval Harness question and approval boundaries.

## 2026-07-05 [NTH-TD-016 provider-backed Workspace Secretary reopen]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Implement the approved provider-backed Workspace Secretary refactor now, do
  not restate the plan, and verify the result with real code/test evidence plus `.agent-os`
  bookkeeping.
- Diagnosis: The old Loop-2 pass treated the typed clean UI model as if it were enough authority.
  In practice `WorkspaceSecretarySession` still owned deterministic production behavior: daemon
  readiness could project `provider_backed_clean_ui_model` before any provider turn existed, and
  Quick / `hi` / Clarify success still depended on local clean-model construction rather than the
  configured real provider session.
- Implementation: Reworked
  `packages/daemon/src/server/session/workspace-secretary/workspace-secretary-session.ts` so active
  Workspace Secretary turns now run through persistent internal provider sessions only. The daemon
  now:
  uses the configured `workspaceSecretary.providerSession` as the sole production authority for
  Quick / `hi` / Clarify / repair; keeps `authority.source = daemon_clean_ui_model` until a real
  provider-backed turn is actually written; converts provider-native question requests into
  structured Clarify-card candidates through Thoth ask-gate rules; denies provider permission /
  approval requests during Clarify rather than faking success; emits clean provider progress events;
  and keeps failure copy safe instead of leaking packet/schema/raw-JSON wording to the UI.
- Implementation: Updated
  `packages/app/src/thoth-app/thoth-app-shell.tsx` to render the new clean provider progress panel,
  and updated app/protocol/daemon tests to match the reopened provider-backed semantics.
- Implementation: Split the Loop-2 app E2E story in code. The default `Desktop Chrome`
  scorecard now asserts honest provider-missing guardrails and relay-safe status instead of
  deterministic fake replies. Added
  `packages/app/e2e/workspace-secretary.codex.real.spec.ts` as the new real-provider narrow
  journey scaffold for Settings -> provider configure -> `hi` -> Loop Clarify -> relay-safe review.
- Evidence produced: `npm --workspace=@thoth/protocol run test -- workspace-secretary/rpc-schemas.test.ts thoth-runtime-contract.test.ts`
  passed with `2` files and `29` tests.
- Evidence produced: `npm --workspace=@thoth/app run test -- src/thoth-app/thoth-app-shell.test.tsx src/thoth-app/clean-ui-model.test.ts`
  passed with `2` files and `14` tests.
- Evidence produced: `npm --workspace=@thoth/daemon exec vitest run src/server/session/workspace-secretary/workspace-secretary-session.test.ts`
  passed with `1` file and `7` tests. The reopened daemon test now proves snapshot authority stays
  daemon-owned until a provider-backed turn exists and that provider-native questions become
  Clarify-card candidates instead of permission-prompt authority.
- Evidence produced: `npm run build:web` passed and exported
  `packages/app/dist/_expo/static/js/web/index-40a6555efdaf92ad7260f8dea7924577.js`.
- Evidence produced: The original Playwright dev-server scorecard still failed before shell mount
  with browser error `Cannot use 'import.meta' outside a module`. Repointing the same scorecard to
  the static export via `E2E_BASE_URL=http://127.0.0.1:8093 ... thoth-ui-scorecard.spec.ts`
  reached the Workspace Secretary shell and connected to daemon authority, confirming the reopened
  provider-backed shell path works on the exported web bundle, but the full scorecard run still
  needs a completed final pass after the relay-safe assertion rewrite.
- Evidence produced: `npm run format:check`, `git diff --check` and the final
  `npm run check:foundation` all passed on 2026-07-05. Foundation gates passed through repo
  validation, formatting, foundation lint, foundation build, foundation typecheck and foundation
  tests, with highlight `66`, relay `29`, protocol `315` and client `110` tests green.
- State changes: Updated `.agent-os/project-index.md`, `.agent-os/architecture-milestones.md` and
  `.agent-os/acceptance-report.md` so `NTH-TD-016` is again the top next action, `NTH-MS-013` is no
  longer treated as verified, `NTH-EV-026` is historical-only, and new partial evidence is tracked
  under `NTH-EV-027`.
- Current limitation: Final Loop-2 provider-backed verification is not complete yet. Missing proof:
  a fully completed real-provider screenshot/trace/e2e run and a resolved dev-server web E2E path.
- Next likely action: Complete the static-export and real-provider Loop-2 screenshot/trace/e2e
  evidence or document the exact remaining external blocker if the real provider / relay journey
  still cannot be completed.

## 2026-07-05 [Public test Workspace Secretary provider-turn debug]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Keep `http://180.76.242.105:8148/` deployed as the public test web app
  rather than production, and debug the visible Workspace Secretary bug so the user can quickly test
  the current provider-backed slice.
- Diagnosis: The public test page was already serving the new web export and connecting to the real
  configured Codex provider, but `hi` still failed after 12 repair attempts. Direct read-only Codex
  thread inspection showed the provider's complete `C_DIRECT` packet was schema-valid. The daemon
  failure was caused by `WorkspaceSecretarySession` treating each streaming `assistant_message`
  timeline event as complete final text; the Codex adapter emits assistant deltas, so the daemon
  parsed only a fragment instead of the full native structured output.
- Implementation: Updated
  `packages/daemon/src/server/session/workspace-secretary/workspace-secretary-session.ts` to
  reassemble assistant message fragments by `messageId` before native packet validation, while still
  accepting single complete assistant messages. Also changed the provider-start live event copy from
  an ongoing "waiting" phrase to a neutral "provider turn started" phrase so completed turns do not
  look stuck.
- Regression coverage: Added a daemon regression in
  `packages/daemon/src/server/session/workspace-secretary/workspace-secretary-session.test.ts` that
  streams a valid native packet across multiple Codex assistant-message deltas and proves the daemon
  writes one provider-backed `C_DIRECT` response without entering repair.
- Evidence produced: `npm --workspace=@thoth/daemon exec vitest run src/server/session/workspace-secretary/workspace-secretary-session.test.ts`
  passed with `1` file and `9` tests after the fix.
- Evidence produced: Public Playwright check against `http://180.76.242.105:8148/` passed after the
  daemon restart. It showed `Real provider connected`, `Real provider turn started`,
  `Real provider turn completed`, no provider failure, no repair, no Clarify card for `hi`, no raw/schema
  leakage, and a provider-generated secretary reply. Screenshot:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/public-test-hi-final-fixed.png`.
- Evidence produced: `git diff --check` passed. `npm run check:foundation` passed through repo
  validation, format, foundation lint, foundation build, foundation typecheck and foundation tests
  with highlight `66`, relay `29`, protocol `315` and client `111` tests green.
- Runtime state: The public test entry remains `http://180.76.242.105:8148/`, backed by the local
  web static service on `0.0.0.0:8082` and the restarted Thoth daemon on `127.0.0.1:6688`. The
  local Paseo/legacy daemon remains untouched on `127.0.0.1:6767`.
- Current limitation: This closes the public test `hi` provider-turn bug and the repeated waiting /
  repair flood symptom. It does not complete full `NTH-TD-016` verification: Quick -> Loop ->
  Clarify -> Quick, relay-safe Settings and the full screenshot/trace/e2e acceptance run remain open.

## 2026-07-05 [NTH-TD-016 streaming-first authority update]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Continue Loop-2 from the approved provider-backed plan, first fix the
  `.agent-os` authority language, then implement the real provider stream / atomic card behavior
  without creating a parallel replacement UI.
- Decision recorded: Added `NTH-CD-040`, locking Loop-2 as provider-backed streaming-first with
  atomic decision cards. Ordinary Quick / `C_DIRECT`, provider progress and tool/progress/evidence
  events should stream through typed clean UI events; `C_ASK` Clarify cards, Task Cards and Goal
  Cards render only after complete provider output plus daemon packet/schema/provenance/authority
  validation.
- Documentation updated: Synchronized `.agent-os/designs/thoth-mvp-loop-goals.md`,
  `.agent-os/designs/thoth-mvp-goal-prompt.md`, `.agent-os/architecture-milestones.md`,
  `.agent-os/todo.md` and `.agent-os/project-index.md` so `NTH-MS-013` / `NTH-TD-016` no longer
  imply that a static clean UI model or already-present message/card is sufficient for verification.
- Acceptance language updated: Loop-2 now explicitly requires real provider stream rendering,
  atomic QA/card rendering, real `relay.test.thoth.seeles.ai`, desktop/mobile screenshots,
  Playwright trace/video, stream/render source review and independent UI mental-model review.
- Current limitation: This entry records the authority update only. Implementation and verification
  must continue in `packages/protocol`, `packages/client`, `packages/daemon` and `packages/app`.
  `NTH-TD-016` remains `[doing]` until real-provider streaming, atomic card behavior, relay
  validation, screenshot/trace/video and independent review evidence are complete.

## 2026-07-05 [NTH-TD-016 provider-backed streaming verified]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Continue the approved Loop-2 provider-backed frontend/runtime refactor,
  keep the public test web app available at `http://180.76.242.105:8148/`, debug the visible
  provider-turn bug and finish `.agent-os` evidence bookkeeping.
- Implementation completed: Protocol/client now expose typed
  `workspace_secretary.model.update` clean stream updates; daemon Workspace Secretary turns run
  through the Settings configured real provider session; Codex assistant-message deltas are
  reassembled by `messageId` before native packet validation; safe provider progress / reply deltas
  project as clean live events; `C_ASK` Clarify candidates enter history only after daemon
  validation; APP renders only typed clean UI model/events and keeps Clarify cards atomic.
- Source review: Active Loop-2 app/protocol/client/daemon paths use `liveEvents`,
  `secretary_reply_delta`, provider runtime bridge status, `RuntimePacketCandidate` /
  `ClarificationCardCandidate` validation and daemon `applyProviderOutcome`. Forbidden residual
  scan hits for `Paseo`, `request_user_input`, `AskUserQuestion`, `permission question`,
  `raw JSON`, `state code`, `repair`, `provider role`, `6767`, `pairingToken`, `raw offer` and
  `credential` are limited to tests, negative assertions, hidden prompt constraints or bridge
  normalization rather than user-visible production UI.
- Evidence produced: `npm --workspace=@thoth/protocol run test -- workspace-secretary/rpc-schemas.test.ts`
  passed with `1` file and `5` tests.
- Evidence produced: `npm --workspace=@thoth/client run test -- daemon-client.test.ts` passed with
  `1` file and `95` tests.
- Evidence produced:
  `npm --workspace=@thoth/daemon exec vitest run src/server/session/workspace-secretary/workspace-secretary-session.test.ts`
  passed with `1` file and `10` tests.
- Evidence produced: `npm --workspace=@thoth/app run test -- src/thoth-app/thoth-app-shell.test.tsx`
  passed with `1` file and `12` tests.
- Evidence produced: `npm --workspace=@thoth/app run test` passed with `315` files and `2623`
  tests; only existing deprecated `@vitest/browser/context` warnings were noted.
- Evidence produced: `curl -fsS --max-time 10 https://relay.test.thoth.seeles.ai/health` returned
  `{"status":"ok","protocol":"3","service":"thoth-relay"}`.
- Evidence produced: `npm run build:web` passed and exported
  `packages/app/dist/_expo/static/js/web/index-dc3970d4d5f1b889316602a4e34382e9.js`. Live curl
  against `http://180.76.242.105:8148/` showed `__THOTH_INITIAL_DAEMON_CONNECTION__` and the same
  current bundle.
- Evidence produced: Public Playwright real-provider journey against `http://180.76.242.105:8148/`
  passed. Summary file
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/streaming-atomic-20260705/workspace-secretary-streaming-atomic-summary.json`
  records all steps as `ok`: ready shell, `hi` no card, Clarify card atomic, submitted readonly,
  Settings relay and mobile composer.
- Evidence produced: Screenshots saved under
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/streaming-atomic-20260705/`: desktop ready,
  streaming Quick live, `hi` no card final, Loop live before card, Clarify card atomic, Clarify
  readonly, Settings real relay status and mobile composer. Manual `view_image` review passed for
  the key states.
- Evidence produced: Playwright trace/video saved as
  `workspace-secretary-streaming-atomic-trace.zip`,
  `videos/page@0e81e70a7ef3f02ebfc7a717d13ae278.webm` and
  `videos/page@8b34a58568759844da9b3c8ab63b7f39.webm`.
- Evidence produced: Independent read-only `codex exec` UI mental-model review passed with verdict
  `PASS` in
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/streaming-atomic-20260705/independent-ui-mental-model-review.md`.
- Evidence produced: `git diff --check`, `npm run format:check` and `npm run check:foundation`
  passed after the implementation/verification pass. Foundation test totals were highlight `66`,
  relay `29`, protocol `316` and client `112`.
- State changes: Added `NTH-EV-028`, marked `NTH-TD-016` / `NTH-MS-013` verified, moved
  `NTH-TD-017` from blocked to ready and updated `project-index.md` top next action to `NTH-TD-017`.
- Residual caveats: Codex native `outputSchema` does not always expose safe token-level prose
  deltas, so current evidence proves clean progress streaming plus final provider reply and keeps
  `secretary_reply_delta` only for safe non-structured text. Mobile composer non-overlap is proven,
  while full mobile Clarify-card layout should remain a regression watch item.
- Next likely action: Start `NTH-TD-017`, the backend Task Contract Compiler and Approval Harness,
  using the verified provider-backed Workspace Secretary / Clarify card substrate from Loop-2.

## 2026-07-05 [NTH-TD-016 Paseo surface reset authority update]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Reopen Loop-2 frontend work so the main path returns to the original
  production-grade Paseo app surface instead of continuing the current Thoth toy Workspace
  Secretary shell; first update `.agent-os` authority, then implement.
- Decision recorded: Added `NTH-CD-041`. It supersedes the prior three-view toy shell main-path
  direction from `NTH-CD-036` while preserving the provider-backed/no-fallback/streaming/atomic-card
  constraints from `NTH-CD-039` and `NTH-CD-040`.
- State changes: Updated `project-index.md`, `todo.md`, `architecture-milestones.md`,
  `designs/thoth-app-runtime-contract.md`, `designs/thoth-mvp-loop-goals.md`,
  `designs/thoth-mvp-goal-prompt.md` and `acceptance-report.md`.
- Current authority state: `NTH-TD-016` is back to `doing`, `NTH-MS-013` is `in_progress`,
  `NTH-TD-017` / `NTH-MS-014` are blocked until the Paseo-surface Loop-2 reset passes, and
  `NTH-EV-028` is historical-only after `NTH-CD-041`.
- Current limitation: No new implementation or verification evidence has been produced yet for
  the restored Paseo surface. `NTH-EV-029` is pending and `NTH-TD-016` must not be marked verified
  without the full anti-toy, Paseo capability retention, real provider, real relay, screenshot,
  trace/video, `view_image`, independent review and `check:foundation` evidence.
- Next likely action: Audit current `packages/app` main routes against
  `.agent-os/upstreams/paseo/packages/app/src`, then remove/isolate the toy shell from the primary
  entry and reconnect Thoth Clarify controls through the restored Paseo surface.

## 2026-07-05 [NTH-TD-016 Paseo surface partial implementation]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-WS-004`, `NTH-MS-013`, `NTH-TD-016`
- User-visible request: Fix Loop-2 so the original Paseo production app surface is the main path
  and only Thoth Clarify runtime / input-output packet / composer controls / authority adapter are
  connected. Do not enter Loop-3.
- Implementation summary: Restored `packages/app/src/app/_layout.tsx` chrome/listener behavior for
  LeftSidebar, mobile sidebar, selected agent state, route-based chrome, settings/workspace route
  guard, PushNotificationRouter, OfferLinkListener and OpenProjectListener. Kept Thoth on `6688`,
  retained the no-`6767` guard, and removed raw offer/token leakage from pairing failure surfaces.
- Implementation summary: Connected Clarify cards inside `agent-stream` through typed
  `SecretaryClarifyAnswerPayload` and `answerWorkspaceSecretaryClarify`, with submitted readonly
  state, historical-card preservation, stop-to-Quick behavior and no assistant-text / markdown JSON /
  code-fence / raw-packet parsing in the app.
- Implementation summary: Mapped original composer controls to Provider / Clarify / Mode.
  Provider writes `workspaceSecretary.providerSession`, Clarify writes
  `workspaceSecretary.clarifyStrength`, and Mode writes `workspaceSecretary.mode` as Quick / Loop.
  The compact duplicate footer controls were removed so the controls are not duplicated.
- Implementation summary: Hardened safety boundaries by sanitizing pair-scan failure UI/logging and
  Workspace Secretary catastrophic runtime errors; downstream raw offer/token/schema/packet/provider
  text is not exposed on those reviewed paths.
- Verification passed: `git diff --check`; `npm --workspace=@thoth/app run test` passed 316 files /
  2618 tests; `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 11 tests;
  `npm run build:web` passed and produced
  `packages/app/dist/_expo/static/js/web/index-952df71a4533a61d6661e0859b6eae58.js`.
- Verification passed: `curl -fsS --max-time 10 https://relay.test.thoth.seeles.ai/health`
  returned `{"status":"ok","protocol":"3","service":"thoth-relay"}`; `E2E_BASE_URL=http://127.0.0.1:8082
npm --workspace=@thoth/app run test:e2e -- thoth-ui-scorecard.spec.ts` passed 2 tests; `npm run
check:foundation` passed validation / format / lint / build / typecheck / tests with foundation
  test totals highlight 66, relay 29, protocol 317 and client 112.
- Visual evidence: Captures are under `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-paseo-surface/`: desktop and
  mobile open-project screenshots, desktop workspace/composer screenshot, Provider / Clarify / Mode
  composer screenshot, settings screenshot, mobile workspace/composer screenshot, open-project and
  workspace/settings trace/video, and two independent UI mental-model reviews. The screenshots were
  opened with `view_image` and reviewed for restored Paseo layout, sidebar/workspace chrome,
  composer controls, settings surface and mobile composer non-overlap.
- Independent review: `independent-ui-mental-model-review.md` and
  `independent-ui-mental-model-review-followup.md` passed the restored chrome/listeners, no-`6767`
  fallback, Provider / Clarify / Mode control wiring, typed Clarify submit path, clean UI boundary,
  pair-scan sanitization and catastrophic error sanitization.
- Current limitation: This is partial `NTH-EV-029` evidence, not final Loop-2 acceptance. The current
  scorecard and screenshots do not prove a real-provider-backed `hi` no-card turn or Quick -> Loop
  -> Clarify -> submit -> submitted-readonly -> Quick journey on the restored Paseo surface.
- State changes: Updated `project-index.md`, `todo.md`, `acceptance-report.md` and this run log so
  `NTH-TD-016` remains `doing`, `NTH-MS-013` remains `in_progress`, `NTH-TD-017` remains blocked and
  `NTH-EV-029` is `partial_in_progress` rather than passed.
- Next likely action: Run or repair the real-provider-backed Loop-2 narrow journey on the restored
  Paseo surface and capture the missing Clarify submission / readonly / Quick-return evidence
  without fake provider, fake relay, deterministic local reply/card or first-option fallback.

## 2026-07-05 [Public web test app redeployed]

- Worked on: `NTH-OBJ-001`, `NTH-WS-004`, `NTH-TD-016`
- User-visible request: Deploy the web test app and return the URL.
- Runtime state: Built the real web export with `npm run build:web` and started the static review
  service with `HOST=0.0.0.0 PORT=8082 npm run serve:web`.
- Verification passed: `curl -fsS -I --max-time 5 http://127.0.0.1:8082/` returned `HTTP/1.1 200
OK`; `curl -fsS -I --max-time 8 http://180.76.242.105:8148/` returned `HTTP/1.1 200 OK`.
  `netstat -ltnp` confirmed the web service listening on `0.0.0.0:8082` and the Paseo daemon still
  listening separately on `127.0.0.1:6767`.
- Current limitation: This operational redeploy does not add new Loop-2 acceptance evidence beyond
  the already recorded partial `NTH-EV-029` state.

## 2026-07-05 [Public web relay timeout repaired]

- Worked on: `NTH-OBJ-001`, `NTH-WS-004`, `NTH-TD-016`
- User-visible request: The public web test app relay path timed out.
- Diagnosis: The hosted relay health endpoint itself was reachable, but the local Thoth daemon was
  not listening on `127.0.0.1:6688`, so the public web app could not get the local host / relay
  pairing runtime through the review entry.
- Runtime state: Started the Thoth daemon with `npm run dev:daemon`, then restarted the public web
  static service as `THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688 HOST=0.0.0.0 PORT=8082 npm run
serve:web` so `/ws` proxies to the daemon.
- Verification passed: `curl http://127.0.0.1:6688/api/health` returned `{"status":"ok",...}`;
  `curl http://180.76.242.105:8148/__thoth/relay-health` returned
  `{"status":"ok","protocol":"3","service":"thoth-relay","endpoint":"relay.test.thoth.seeles.ai"}`;
  the public HTML contains `window.__THOTH_INITIAL_DAEMON_CONNECTION__`; a `ws` client opened
  `ws://180.76.242.105:8148/ws`; `netstat -ltnp` confirmed Thoth on `127.0.0.1:6688`, public web on
  `0.0.0.0:8082`, and Paseo still separate on `127.0.0.1:6767`.
- Current limitation: This fixes the deployed runtime path only; it does not complete the missing
  real-provider Loop-2 journey evidence for `NTH-EV-029`.

## 2026-07-05 [Main docs legacy-name cleanup]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`
- User-visible request: Remove remaining legacy product-name references from `docs/development.md`,
  `docs/packaging.md` and `docs/testing.md`.
- State changes: Reworded the three docs so runtime isolation uses `reserved local legacy daemon`
  language instead of old product-specific wording, while preserving the required `6767` / `6688`
  isolation contract.
- Verification passed: `rg -n "Paseo|paseo|getpaseo|PASEO|@getpaseo" docs/development.md
docs/packaging.md docs/testing.md` returned no matches; `git diff --check -- docs/development.md
docs/packaging.md docs/testing.md` passed.

## 2026-07-05 [Provider controls and Quick Clarify hardening]

- Worked on: `NTH-OBJ-001`, `NTH-WS-006`, `NTH-TD-016`
- User-visible request: Move provider/session options into Provider config, keep the composer row as
  `+ / Provider / Mode / Clarify / Context / Send`, and make Quick Clarify real rather than a shell.
- State changes: Reworked the restored composer controls so Provider config owns provider/model,
  provider mode/permission, thinking/reasoning and provider feature values while Thoth Mode and
  Clarify remain top-level controls. Context window now renders in the composer control sequence
  after Clarify instead of the old right/footer placement.
- State changes: Hardened Workspace Secretary Quick Clarify: Loop sends now return an honest
  not-implemented blocked state; `clarify=none` repairs provider `C_ASK` or native questions into
  direct/blocked output and falls back to clean `C_BLOCKED` after repeated violations; `auto`
  `C_ASK` packets must resolve their effective strength away from `auto` / `deep`.
- Verification passed: `npm --workspace=@thoth/app run test --
src/composer/agent-controls/runtime-controls.test.tsx
src/composer/agent-controls/provider-session-config.test.ts
src/components/clarify-decision-card.test.tsx` passed 3 files / 10 tests.
- Verification passed: `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 15 tests,
  including Quick direct, C_ASK card, submitted readonly, `clarify=none` repair/blocked and Loop
  honest blocked coverage.
- Verification passed: `npm run build:web` passed and produced
  `packages/app/dist/_expo/static/js/web/index-8749f0513db6215355e648899dc0b84b.js`.
- Verification passed: `npm run check:foundation` passed validation, format, foundation lint,
  foundation build, foundation typecheck and foundation tests before the final run-log append; it is
  rerun after this state update before handoff.
- Current limitation: This does not complete full real-provider Loop-2 journey evidence on the
  restored surface. Loop remains intentionally blocked until the later backend Loop goals land.

## 2026-07-06 [Quick none and Clarify phase contract documented]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-TD-016`
- User-visible request: Record the refined Quick / Clarify / Loop runtime design into the relevant
  `.agent-os` documents.
- Decision recorded: Added `NTH-CD-042`. `Quick + none` is now a bare provider / Paseo-like foreground
  path with no `thoth.clarify` mount, no Clarify input envelope, no `submit_clarify_packet`, no
  structured Clarify output and no Clarify repair. `Quick + clarify` uses `turn_phase` to move through
  `clarify`, `approval_task`, `approval_breakdown`, `quick_exec` and `repair`; structured phases call
  `submit_clarify_packet` exactly once, while `quick_exec` streams normal provider execution. `Loop`
  uses the secretary session only for Clarify plus the two approval cards, then launches separate
  PlanExec / Review sessions after background registration.
- State changes: Updated `thoth-app-runtime-contract.md`, `thoth-mvp-loop-goals.md`,
  `thoth-prompt-contract-seeds.md`, `thoth-mvp-goal-prompt.md`, `architecture-milestones.md`,
  `project-index.md`, `todo.md` and `acceptance-report.md` so Loop-1 / Loop-2 authority no longer keeps
  the older "Quick/no-clarify still forced through Clarify packet" terminology.
- Current limitation: This is design / documentation authority only. No code was changed in this
  turn, and no new implementation evidence was produced. `NTH-EV-029` remains `partial_in_progress`;
  `NTH-TD-016` remains `doing`; `NTH-TD-017` remains blocked until the Paseo-surface and phase/tool
  acceptance both pass.
- Verification passed: `git diff --check` over the edited `.agent-os` documents passed.

## 2026-07-06 [Loop-4 frontend-to-approval wave partial implementation]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-WS-004`, `NTH-TD-016`
- User-visible request: Implement the approved Loop-4 wave now without restating the plan, then deploy
  it on the web test app.
- Implementation summary: Extended `packages/protocol` so Workspace Secretary clean UI now has
  Task Card, Goal Card, registered-task turns, `registered_pending` background-task models and
  approval action payloads. Added `turn_phase` plus Task/Goal/Register packet validation to
  `thoth-runtime-contract`, while keeping new fields backward-parseable.
- Implementation summary: Reworked daemon Workspace Secretary so `Quick + none` uses a bare provider
  foreground turn with no Clarify repair loop, structured turns use `turn_phase`, the MCP/runtime
  bridge is named `submit_clarify_packet`, `C_TASK_CARD` / `C_GOAL_CARD` become clean turns, and
  `C_REGISTER` becomes a persisted `registered_pending` task under
  `workspaceSecretary.registeredTasks`.
- Implementation summary: Extended the restored app surface with typed Task / Goal approval cards,
  registered-task transcript items, a `background_tasks` workspace tab target, a sidebar Background
  Tasks entry and an independent Background Tasks panel backed by Workspace Secretary snapshot/model
  updates.
- Verification passed: Focused checks passed in this work session:
  `npm --workspace=@thoth/protocol run test -- src/thoth-runtime-contract.test.ts src/workspace-secretary/rpc-schemas.test.ts`,
  `npm --workspace=@thoth/client run test -- src/daemon-client.test.ts`,
  `npm --workspace=@thoth/app run test -- src/components/clarify-decision-card.test.tsx src/types/stream.test.ts src/screens/workspace/workspace-pane-content.test.tsx`,
  `npm --workspace=@thoth/daemon run test:unit -- src/server/session/workspace-secretary/workspace-secretary-session.test.ts`,
  `npm run build:protocol`,
  `npm run build:web`,
  and `npm run check:foundation`.
- Deployment/runtime evidence: Restarted the daemon with `npm run dev:daemon`, served the real web
  export at `HOST=0.0.0.0 PORT=8082 THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688 npm run serve:web`,
  confirmed `http://127.0.0.1:6688/api/health`, `http://127.0.0.1:8082/`,
  `http://180.76.242.105:8148/` and `http://180.76.242.105:8148/__thoth/relay-health` all responded.
- Current limitation: This still does not complete `NTH-EV-029`. We do not yet have end-to-end
  real-provider evidence for the full approved journeys: Quick+none bare `hi`, Quick+clarify
  -> Task Card -> Goal Card -> same-session `quick_exec`, and Quick -> Loop -> Clarify -> register
  -> Quick on the restored Paseo surface, nor the required screenshots/trace/video for those journeys.
- Next likely action: Add or repair real-provider web e2e coverage and capture desktop/mobile
  evidence for the three approved journeys, then update `NTH-EV-029` from partial toward verified.

## 2026-07-06 [Quick Clarify main send path connected]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-016`, `NTH-TD-017`,
  `NTH-TD-018`
- User-visible request: `Quick+clarify` currently has no effect because the main composer still sends
  through the generic agent transport; implement the approved plan without revising it.
- Implementation summary: Extended `workspace_secretary.send.request` and the client facade with
  optional `messageId`, `images` and `attachments`, reusing the existing composer attachment wire
  shape rather than inventing a second attachment protocol.
- Implementation summary: Changed the main app composer default send path to dispatch through
  Workspace Secretary instead of direct `sendAgentMessage`, while preserving the existing Paseo
  composer surface, optimistic user messages, image encoding and structured attachment splitting.
- Implementation summary: Added a clean Workspace Secretary -> current AgentStream adapter so
  provider-backed secretary replies, Clarify cards, Task cards, Goal cards and registered-task cards
  are merged into the same visible transcript. Clarify/approval card submissions now call
  `answerWorkspaceSecretaryClarify` and apply the returned clean model back to the same stream.
- Implementation summary: Updated daemon Workspace Secretary to reuse one topic provider agent across
  `Quick + none`, `Quick + clarify` and `Loop` instead of splitting `:bare` and `:structured`
  sessions. `Quick + none` remains bare provider behavior, while structured turns inject the
  `thoth.clarify` skill contract only on state/phase/bridge transitions and pass user images and
  structured attachments into the provider prompt.
- Verification passed: `npm --workspace=@thoth/protocol run test` passed 34 files / 318 tests.
- Verification passed: `npm --workspace=@thoth/client run test -- src/daemon-client.test.ts` passed
  95 tests.
- Verification passed: `npm --workspace=@thoth/app run test` passed 316 files / 2619 tests.
- Verification passed: `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 16 tests,
  including Quick none -> Quick clarify same-topic provider-session reuse.
- Verification passed: `npm run build:web` passed and rebuilt the Expo web export.
- Verification passed: `npm run build:daemon` passed after daemon Workspace Secretary type tightening.
- Verification passed: `npm run check:foundation` passed validation, format, foundation lint,
  foundation build, foundation typecheck and foundation tests. Foundation test totals were highlight
  66, relay 29, protocol 318 and client 112.
- Verification passed: `git diff --check` passed.
- Runtime health checked: existing local services were healthy after the build. `127.0.0.1:6688`
  returned daemon health OK, `127.0.0.1:8082` returned `HTTP/1.1 200 OK`,
  `180.76.242.105:8148` returned `HTTP/1.1 200 OK`, and `127.0.0.1:6767` remained a separate
  legacy daemon listener.
- Current limitation: No new live browser / real-provider screenshots, Playwright trace/video or
  independent UI mental-model review were produced in this turn. `NTH-EV-029` therefore remains
  partial rather than verified.

## 2026-07-06 [Quick+Dive real-provider Clarify debug]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-016`, `NTH-TD-017`,
  `NTH-TD-018`, `NTH-EV-029`
- User-visible request: Debug why `Quick + Dive Clarify` on `http://180.76.242.105:8148/` did not
  show the expected Clarify Q&A flow, then run the real public web app plus real Codex provider
  journey from `Help me implement an extremely efficient sorting algorithm` through Clarify, Task Card, Goal Card and same-session
  Quick execution in a throwaway workspace.
- Implementation summary: The daemon Workspace Secretary contract was tightened so provider output
  schema accepts `C_TASK_CARD`, `C_GOAL_CARD` and `C_REGISTER` in addition to `C_DIRECT`, `C_ASK` and
  `C_BLOCKED`. Runtime prompt and outcome guards now prevent a structured Clarify session with prior
  submitted answers from converging to plain `C_DIRECT`; it must produce Task Card when converged.
- Implementation summary: Added same-session Quick execution after Goal `accept_quick`. The daemon
  switches to `quick_exec`, renders the approved Task/Goal context for the provider, and calls the
  bare provider turn with no runtime packet/output schema. Daemon logs confirmed the real run reached
  `codex-turn-6` with `hasOutputSchema=false`.
- Unit coverage added/updated: daemon tests now cover repairing illegal `C_DIRECT` after submitted
  Clarify answers into a Task Card and starting same-topic bare Quick execution after Goal Card
  `accept_quick`, without registering a background task for Quick.
- Real-provider evidence: Ran the public app at `http://180.76.242.105:8148/` against local Thoth
  daemon `127.0.0.1:6688` and real Codex provider `gpt-5.5`. The test workspace was
  `/tmp/thoth-quick-dive-workspace-eTURiY`, workspace id `wks_a6f4e7d8153fe35d`; execution did not
  touch the Thoth repository and did not touch the reserved Paseo daemon at `127.0.0.1:6767`.
- Real-provider evidence: WebSocket report
  `/tmp/thoth-quick-dive-clean-bADKFd/report.json` shows the main send was
  `workspace_secretary.send.request` with `composer.mode="quick"` and
  `composer.clarifyStrength="dive"`. The run rendered three Clarify cards:
  `Confirm sorting objective`, `Confirm deliverables and acceptance`, `Confirm performance boundaries`; each was answered by selecting the first option for each
  question. The Task Card and Goal Card were accepted with the first Quick action.
- Real-provider evidence: Key screenshots were captured and opened with `view_image`:
  `/tmp/thoth-quick-dive-clean-bADKFd/screenshots/03-before-send-quick-dive.png`,
  `05-clarify-card.png`, `08-task-card.png`, `09-goal-card.png` and
  `/tmp/thoth-quick-dive-clean-bADKFd/post-screenshots/desktop-after-quick-exec.png`. The reviewed
  Clarify/approval screenshots did not expose raw `provider_input`, `C_DIRECT`, `C_ASK`,
  `C_TASK_CARD`, `C_GOAL_CARD`, schema, packet, skill or MCP bridge text.
- Real-provider evidence: Real Codex quick execution created
  `src/fastSort.js`, `src/fastSort.d.ts`, `test/fastSort.test.js`, `bench/fastSort.bench.js`,
  `package.json` and an updated `README.md` in the throwaway workspace. `npm test` in that workspace
  passed 5/5 tests. `npm run bench` reported speedups of about `7.68x`, `13.15x` and `15.09x` against
  native numeric sort on 10k, 100k and 500k random signed int32 arrays.
- Evidence artifacts: Main artifact directory `/tmp/thoth-quick-dive-clean-bADKFd`; corrected report
  `/tmp/thoth-quick-dive-clean-bADKFd/corrected-report.json`; traces
  `/tmp/thoth-quick-dive-clean-bADKFd/trace.zip` and
  `/tmp/thoth-quick-dive-clean-bADKFd/post-trace.zip`; video artifacts are the `.webm` files in the
  same directory.
- Verification passed: Focused checks passed:
  `npm --workspace=@thoth/protocol run test -- src/thoth-runtime-contract.test.ts
src/workspace-secretary/rpc-schemas.test.ts` passed 31 tests;
  `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 18 tests;
  `npm --workspace=@thoth/app run test -- src/composer/actions.test.ts
src/components/clarify-decision-card.test.tsx` passed 38 tests; `npm run build:web` passed; and
  `npm run check:foundation` passed.
- Runbook updated: Added `Quick+Dive Clarify Real-Provider Runbook` to `docs/testing.md`, including
  the required public app entry, throwaway workspace, first-option card answering policy,
  `hasOutputSchema=false` quick_exec assertion, screenshot/trace/report evidence and recovery check.
- Current limitation: This run found a real product gap. After browser/client disconnect and reopening
  the workspace, `workspace_secretary.snapshot.request` returned only `topic-main` with empty
  `turns`, and the public UI showed an empty `New Agent` composer instead of the completed secretary
  transcript. Therefore Quick+Dive live-path evidence is materially improved, but `NTH-EV-029`
  remains `partial_in_progress` until secretary topic/history recovery and the remaining Quick+none
  and Loop registration real-provider journeys are verified.

## 2026-07-06 [Quick+Dive recovery and Pyramid Plan label follow-up]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-016`, `NTH-EV-029`
- User-visible request: Continue the approved Quick+Dive Clarify repair and validation work.
- Diagnosis update: The earlier Quick+Dive run was not permanently stuck. The same-session
  `quick_exec` provider turn completed after about 362 seconds, generated real files in the throwaway
  workspace and eventually persisted into the Workspace Secretary topic snapshot. The confusing
  intermediate state came from checking recovery before the long Codex foreground execution had
  finished.
- Implementation summary: Removed the old user-visible `Goals` round label for the second approval
  card by changing new daemon-generated Pyramid Plan cards to `roundLabel: "Pyramid Plan"` and making
  the app approval component render `Pyramid Plan` for existing persisted goal-card snapshots as well.
  This keeps the wire-compatible `C_GOAL_CARD` code but fixes the product mental model.
- Real-provider recovery evidence: Reopened the public web app at `http://180.76.242.105:8148/`,
  entered workspace `Quick Dive Sort Acceptance` under throwaway path
  `/tmp/thoth-quick-dive-workspace-8ZNlFR`, and confirmed the restored Paseo surface recovered five
  submitted Clarify cards, the Task Card, the Pyramid Plan Card and the final same-session Quick
  execution result. Persisted config now records the transcript through a final secretary message and
  ends at `currentClarifyState="C_DIRECT"` / `activeTurnPhase="quick_exec"`.
- Real-provider UI evidence: Rebuilt and redeployed the web export on `8082 -> 8148`, then captured
  and opened with `view_image`:
  `/tmp/thoth-quick-dive-evidence-20260706T151122Z/desktop-after-label-fix.png` and
  `/tmp/thoth-quick-dive-evidence-20260706T151122Z/mobile-after-label-fix.png`. Both screenshots show
  `Pyramid Plan`, no bare `Goals` label, and the recovered Quick execution result. Mobile recovery
  required opening the mobile menu before selecting the workspace row, matching the restored Paseo
  responsive layout.
- Real-provider execution evidence: The throwaway workspace contains a C++17 header-only hybrid
  quicksort implementation plus CMake test and benchmark files:
  `include/hqsort/quicksort.hpp`, `tests/quicksort_tests.cpp`,
  `benchmarks/quicksort_benchmark.cpp`, `CMakeLists.txt` and `README.md`.
  `ctest --test-dir build --output-on-failure` passed 1/1 test. `./build/quicksort_benchmark` passed
  random, sorted, reversed and repeated cases with ratios `1.080`, `0.038`, `0.066` and `0.747`.
- Verification passed: `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 18 tests.
  `npm --workspace=@thoth/app run test -- src/components/clarify-decision-card.test.tsx
src/composer/actions.test.ts` passed 39 tests. `npm run build:web` passed and the rebuilt export was
  served with `THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688 HOST=0.0.0.0 PORT=8082 npm run serve:web`.
  `http://127.0.0.1:8082/`, `http://180.76.242.105:8148/` and
  `http://180.76.242.105:8148/__thoth/relay-health` returned HTTP 200. `npm run check:foundation`
  passed validation, format, foundation lint, foundation build, foundation typecheck and foundation
  tests; foundation totals were highlight 66, relay 29, protocol 320 and client 112.
- Current limitation: `NTH-EV-029` remains partial. Quick+Dive now has live path, same-session
  `quick_exec`, desktop/mobile screenshots and durable recovery evidence, but the remaining
  real-provider Loop-2 acceptance still needs Quick+none bare `hi` proof and Quick -> Loop -> Clarify
  -> two approvals -> `registered_pending` -> Quick proof on the restored Paseo surface.

## 2026-07-07 [Paseo upstream realtime timeline source audit]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-TD-016`
- User-visible request: Inspect the original Paseo app behavior to understand what provider/agent
  intermediate process information is rendered in the frontend timeline before the final assistant
  output, especially shell/edit style events.
- Source-audit summary: Upstream Paseo normalizes provider activity into `AgentTimelineItem`
  entries: user messages, streamed assistant messages, reasoning/thought chunks, tool calls, todo
  lists, activity/error rows and compaction markers. Tool-call details include shell, read, edit,
  write, search, fetch, sub-agent, plan, worktree setup, plain text and unknown detail shapes.
- Source-audit summary: Codex app-server thread items map `commandExecution` to Shell,
  `fileChange` to Edit/apply-patch, `mcpToolCall` to provider/tool names, `webSearch` to Search and
  `collabAgentToolCall` to Sub-agent. Claude SDK content blocks map text/thinking/tool_use/tool_result
  into assistant/reasoning/tool-call timeline items with running/completed/failed/canceled statuses.
- UI behavior summary: The app renders assistant text as markdown blocks, reasoning as a Thinking
  tool badge, and tool calls as expandable badges with icons and summaries. Desktop expands details
  inline; mobile opens a tool-call sheet. The same `callId` is merged from running to terminal status,
  so users see one live badge update rather than duplicate start/end rows.
- Evidence only: This was source inspection of `.agent-os/upstreams/paseo` and current promoted
  package source. No live Paseo provider execution, screenshots or tests were run in this turn.

## 2026-07-07 [Runtime tool bridge clarify research doc]

- Worked on: `NTH-OBJ-001`, `NTH-WS-003`, `NTH-WS-004`
- User-visible request: Condense the conclusions and references about making Thoth Clarify behave
  like provider runtime tools into a markdown document under `docs/`.
- Document produced: Added `docs/runtime-tool-bridge-clarify-research.md`.
- Content summary: The doc records that Claude Code, Codex app-server and OpenCode all expose
  runtime-tool-capable surfaces, but through different adapters: Claude Agent SDK in-process MCP
  custom tools, Codex app-server `dynamicTools` / `item/tool/call` plus MCP, and OpenCode project or
  global custom tools plus MCP. It recommends a provider-neutral `RuntimeToolBridge` and demoting
  prompt packet parsing to a degraded path rather than the main Clarify acceptance route.
- External source bookkeeping: Updated `.agent-os/official-sources/platform-index.md` with
  `SRC-ANT-018`, `SRC-OAI-015`, `SRC-OC-001` and `SRC-OC-002`.
- Evidence produced: Live-checked Claude custom tools markdown, OpenCode custom tools markdown, and
  official Codex app-server URL; generated local `codex-cli 0.134.0` app-server schema and confirmed
  it contains `DynamicToolSpec`, `item/tool/call`, `item/tool/requestUserInput`,
  `mcpServer/tool/call` and `mcpToolCall`.
- Current limitation: This is a design/research condensation only. No provider runtime tool bridge,
  MCP server, Codex dynamic tool smoke, Claude SDK custom tool smoke or OpenCode custom tool smoke was
  implemented or executed in this turn.

## 2026-07-07 [Loop-2 runtime tool bridge and AgentTimeline closeout]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-016`, `NTH-MS-013`,
  `NTH-EV-029`
- User-visible request: Carry out the approved Loop-2 complete plan: solve the runtime-tool bridge
  problem and the AgentTimeline realtime problem, use `docs/runtime-tool-bridge-clarify-research.md`
  as the runtime-tool reference, complete the same class of issues, and make Loop-2 complete rather
  than falling back to prompt/outputSchema packets or spinner-only UI.
- Implementation summary: The previous implementation wave connected Workspace Secretary structured
  sessions to Codex app-server `dynamicTools` / `item/tool/call` with semantic tools
  `thoth_submit_clarify_card`, `thoth_submit_task_card`, `thoth_submit_pyramid_plan` and
  `thoth_report_blocked`; persisted pending authority decisions; returned
  `DynamicToolCallResponse` after user answers; rendered Clarify, compact Task, Pyramid Plan and
  registered-task cards inside AgentTimeline; kept `Quick + none` bare; continued Quick approvals into
  same-session `quick_exec`; and made Loop approvals stop honestly at durable `registered_pending`.
- Authority-doc closeout: Added `NTH-CD-043` to record that Codex `dynamicTools` semantic runtime
  tools supersede prompt/outputSchema/`submit_clarify_packet` as the Loop-2 acceptance path. Rewrote
  `.agent-os/designs/thoth-app-runtime-contract.md` around RuntimeToolBridge, pending decisions,
  AgentTimeline and authority cards. Updated `.agent-os/designs/thoth-mvp-loop-goals.md`,
  `.agent-os/architecture-milestones.md`, `.agent-os/project-index.md`, `.agent-os/todo.md`,
  `.agent-os/acceptance-report.md`, `docs/testing.md` and
  `docs/runtime-tool-bridge-clarify-research.md` so Loop-2 is verified, Loop-3 is ready and the second
  approval artifact is Pyramid Plan Card rather than old Goal Card wording.
- Evidence summary: `NTH-EV-029` is now the current Loop-2 acceptance authority. Evidence lives under
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/`: Quick+none report
  `1783414416734-quick-none-report.json`, Quick+Dive report `1783416763028-report.json`,
  Loop+Dive registration report `1783415185110-report.json`, Background Tasks recovery report
  `1783415406577-background-tasks-success-report.json`, mobile recovery report
  `1783416247271-mobile-loop-recovery-success-report.json` and independent review
  `independent-ui-mental-model-review.md`.
- Visual review: Opened key evidence screenshots with `view_image`:
  `1783416762955-quick-exec.png` confirmed real Shell/Edit AgentTimeline rows during `quick_exec`;
  `1783415185038-registered-pending.png` confirmed Loop stops at registered task; `1783415406577-
background-tasks-panel-success.png` confirmed the independent registered-task browser; and
  `1783416247271-mobile-loop-registered-recovery.png` confirmed mobile recovery.
- Runtime health checked: `curl -I --max-time 5 http://127.0.0.1:8082/` returned `HTTP/1.1 200 OK`.
  `curl -I --max-time 8 http://180.76.242.105:8148/` returned `HTTP/1.1 200 OK`. The reserved
  Paseo/legacy `127.0.0.1:6767` service was not touched.
- Verification passed in this closeout: `npm run format` completed; `npm run format:check` passed;
  `git diff --check` passed; `npm run check:foundation` passed. Foundation totals were highlight 4
  files / 66 tests, relay 4 files / 29 tests, protocol 34 files / 320 tests and client 4 files / 112
  tests.
- State changes: `NTH-TD-016` / `NTH-MS-013` remain verified by `NTH-EV-029`; `NTH-TD-017` /
  `NTH-MS-014` is the top next action and is ready, no longer blocked by Loop-2.
- Non-goals / residual scope: Loop-5 PlanExec / Review, real background running/review evidence,
  non-Codex runtime-tool adapters and the final Loop-6 dogfood task system remain future milestones.

## 2026-07-07 [Workspace Secretary spinner-only residue cleanup]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-TD-016`
- User-visible request: Clean up the remaining Workspace Secretary spinner-only risks found in the
  follow-up audit: demote `workspace_secretary.liveEvents` so it no longer looks like the main
  realtime channel, and stop `applyWorkspaceSecretaryModelToStream` from clearing live AgentTimeline
  head items when clean model responses race with provider stream events.
- Implementation summary: Renamed the clean-event compatibility schema to
  `WorkspaceSecretaryDeprecatedCleanEventSchema`, added `deprecatedLiveEvents` as the explicit legacy
  field, and kept old `liveEvents` parse support only for backward compatibility. Workspace Secretary
  daemon output no longer initializes or clears `model.secretary.liveEvents`; AgentTimeline /
  `agent_stream` remains the realtime authority surface.
- Implementation summary: Updated `applyWorkspaceSecretaryModelToStream` so clean Workspace Secretary
  turns merge into tail while the live head is preserved. It now removes only optimistic user messages
  from `agentStreamHead`, preventing already-arrived running tool/assistant timeline items from being
  dropped by a later clean-model RPC response.
- Verification passed: `npm --workspace=@thoth/protocol run test --
src/workspace-secretary/rpc-schemas.test.ts` passed 7 tests.
  `npm --workspace=@thoth/app run test -- src/composer/actions.test.ts` passed 36 tests.
  `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 6 tests.
  `git diff --check` passed. `npm run check:foundation` passed validation, format, foundation lint,
  foundation build, foundation typecheck and foundation tests; foundation totals were highlight 66,
  relay 29, protocol 321 and client 112.
- Current limitation: `npm --workspace=@thoth/app run typecheck` was also attempted and still fails on
  pre-existing broad app type issues such as missing `react-dom` declarations, existing spread type
  errors and unrelated tests/config typings. The related app unit test for this change passes.

## 2026-07-07 [Workspace Secretary New Agent stale history fix]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-TD-016`
- User-visible request: Debug why creating `New Agent` in any workspace immediately showed a previous
  Workspace Secretary chat instead of an empty new session.
- Root cause: `WorkspaceDraftAgentTab` hydrated `workspace_secretary.snapshot` on mount for every
  fresh draft tab. That snapshot is workspace-scoped and returns the last active Workspace Secretary
  topic, so the app merged old `model.secretary.turns` into the brand-new draft tab stream and marked
  it as submitted.
- Implementation summary: Added a draft-tab hydrate gate so fresh New Agent drafts do not merge the
  workspace active-topic snapshot. Snapshot merging is only allowed once the draft already owns local
  Workspace Secretary stream items.
- Verification passed: `npm --workspace=@thoth/app run test --
src/composer/draft/workspace-tab-core.test.ts` passed 2 tests.
  `npm --workspace=@thoth/app run test -- src/composer/actions.test.ts` passed 36 tests.
  `npm run build:web` passed and refreshed `packages/app/dist`.
  `curl -I --max-time 5 http://127.0.0.1:8082/` and
  `curl -I --max-time 8 http://180.76.242.105:8148/` returned `HTTP/1.1 200 OK`.
  Local `/ws` upgrade returned `HTTP/1.1 101 Switching Protocols`.
  A headless Chromium check opened `Quick Dive Sort Acceptance`, clicked `New Agent`, and confirmed
  the new draft body did not contain the previous Clarify/Task/quick-sort chat content.

## 2026-07-07 [Quick Clarify intelligent timeline and frontier ledger repair]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-016`, `NTH-EV-029`
- User-visible request: Fully fix the latest Quick+Clarify issues: timeline must not look completed
  before the Clarify card appears; badge copy must be intelligent demand decomposition rather than
  neutral waiting copy; `balanced` / `dive` must not converge after fixed shallow rounds; and the
  solution should use model frontier ledger rather than daemon hard question-quality judgment.
- Regression recorded: Reopened `NTH-EV-029`. The previous Loop-2 runtime-tool evidence is now
  historical for the prior contract, because real user testing showed pending lifecycle and
  clarify-strength/frontier behavior regressions.
- Implementation summary: Extended the semantic runtime tool contract so
  `thoth_submit_clarify_card` requires `public_badge_summary` and `frontier_ledger`, while legacy
  `decision_it_changes` is now optional and no longer required by Codex dynamicTools. Extended
  `thoth_submit_task_card` with `convergence_review`, soft-target rationale handling and mechanical
  frontier self-consistency.
- Implementation summary: Updated daemon authority tooling to persist public badge summaries,
  frontier ledgers and convergence reviews; render Clarify badges as `Requirement Breakdown` with the model summary;
  label rounds as `Clarify 1`, `Clarify 2`, ...; count answered Clarify cards for soft targets; and
  reject Task reviews that downgrade the latest Clarify strength.
- Implementation summary: Updated Workspace Secretary runtime context with clarify card count, soft
  range and latest ledger; kept pending authority decisions in loading state when provider
  `turn_completed` races ahead; and updated app stream/layout reducers so unresolved authority cards
  or running Thoth authority tool calls suppress premature completed/idle footers.
- State changes: `.agent-os/project-index.md`, `.agent-os/todo.md` and
  `.agent-os/acceptance-report.md` now show `NTH-TD-016` as reopened/doing until the new evidence is
  captured. `docs/testing.md` and `docs/runtime-tool-bridge-clarify-research.md` document semantic
  tool contract v2, soft ranges and pending-decision lifecycle.
- Verification passed so far: `npm --workspace=@thoth/protocol run test --
src/thoth-runtime-contract.test.ts src/workspace-secretary/rpc-schemas.test.ts` passed 36 tests.
  `npm run build:protocol` passed. `npm --workspace=@thoth/daemon run test:unit --
src/server/agent/tools/thoth-tools.test.ts src/server/agent/runtime-tool-decisions.test.ts
src/server/agent/providers/codex-app-server-agent.test.ts
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 4 files / 86
  tests. `npm --workspace=@thoth/app run test --
src/utils/tool-call-display.test.ts src/timeline/session-stream-reducers.test.ts
src/agent-stream/layout.test.ts src/composer/actions.test.ts
src/composer/draft/workspace-tab-core.test.ts` passed 5 files / 131 tests.
- Current limitation: Full `npm --workspace=@thoth/app run test`, `npm run build:web`, `npm run
check:foundation`, `git diff --check` and real-provider 8082/8148 Quick+Balanced / Quick+Dive
  evidence are still pending in this work session.

## 2026-07-07 [Quick Clarify frontier-ledger repair revalidation]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`, `NTH-WS-003`, `NTH-TD-016`, `NTH-EV-029`
- User-visible request: Continue the approved Quick+Clarify complete repair. Fix the remaining
  behavior where `balanced` / `dive` still converged too early, keep timeline badges as intelligent
  request decomposition, run real Codex web journeys, and record the reusable flow.
- Implementation summary: Strengthened `packages/drivers/src/runtime-skills/thoth-clarify/SKILL.md`
  so early convergence below the soft minimum is exceptional rather than a normal shortcut. Added a
  compact `clarify_below_soft_target_policy` and material frontier category list to Workspace
  Secretary runtime context. Updated Codex dynamic tool descriptions and Thoth tool-result guidance so
  the model normally continues Clarify before `balanced` card 5 / `dive` card 10 unless it can account
  for every material frontier category.
- Implementation summary: Updated the guarded `.dev/loop2-full-chain.mjs` evidence runner so Quick
  execution waits longer and requires generated workspace files to stabilize before writing the final
  report. This fixed a false-negative report for slower PathTracing runs where files arrived after the
  previous 4-minute wait.
- Verification passed: `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts
src/server/agent/providers/codex-app-server-agent.test.ts src/server/agent/tools/thoth-tools.test.ts`
  passed 3 files / 85 tests. `npm --workspace=@thoth/protocol run test --
src/thoth-runtime-contract.test.ts src/workspace-secretary/rpc-schemas.test.ts` passed 36 tests.
  `npm run build:protocol` passed. `npm --workspace=@thoth/app run test --
src/utils/tool-call-display.test.ts src/timeline/session-stream-reducers.test.ts
src/agent-stream/layout.test.ts src/composer/actions.test.ts
src/composer/draft/workspace-tab-core.test.ts` passed 5 files / 131 tests.
  `npm --workspace=@thoth/app run test` passed 317 files / 2628 tests. `npm run build:web` passed.
  `npm run check:foundation` passed. `git diff --check` passed.
- Real-provider evidence passed: Local `8082` Quick+Balanced sorting report
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783447093160-report.json` reached 5 Clarify
  cards and generated `quicksort.py` / `test_quicksort.py`. Public `8148` Quick+Balanced sorting
  report `1783447426182-report.json` reached 5 cards and generated C++ source/test files. Local
  Quick+Dive sorting report `1783447971613-report.json` reached 12 cards and generated C++ header,
  test, benchmark and Makefile. Local Quick+Balanced PathTracing report `1783449102697-report.json`
  reached 5 cards and generated `index.html`, `src/main.js`, `src/styles.css`. Local Loop+Balanced
  sorting report `1783449979213-report.json` reached `registered_pending` without fake execution.
- Visual review: `view_image` opened `1783446788953-clarify-round-5.png`,
  `1783447093090-quick-exec.png`, `1783447727999-clarify-round-12.png`,
  `1783447971544-quick-exec.png`, `1783449724053-quick-exec.png` and
  `1783450162819-mobile-registered-pending.png`. The successful desktop screenshots show intelligent
  `Requirement Breakdown` badges, paginated cards and Shell/Edit timeline; the mobile screenshot shows a remaining
  blank `New Agent` history-recovery issue.
- Current result: `NTH-EV-029` is partially revalidated but remains reopened. Remaining issues:
  mobile registered-pending workspace/history recovery opened as an empty `New Agent` tab in a
  390x844 viewport, and local Quick+Dive PathTracing report `1783449724169-report.json` reached 10
  Clarify cards but produced incomplete quick_exec output (`index.html` references missing
  `src/main.js`). These are now recorded in `.agent-os/acceptance-report.md`; do not mark
  `NTH-TD-016` verified until they are fixed or explicitly descoped by the user.

## 2026-07-08 [UI review captures moved out of repo]

- Worked on: `NTH-OBJ-001`, `NTH-EV-029`
- User-visible request: Move the repo-local UI review captures directory out of `docs/` and ensure
  UI review captures do not live inside the git repository.
- State changes: Copied the full capture tree to the external evidence root
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/`, preserving 358 files / 49M. Removed the repo-local
  capture directory and staged deletion of the 190 previously tracked capture files.
- State changes: Added a repo-local capture-directory guard to `.gitignore`, changed
  `.dev/loop2-full-chain.mjs`, `scripts/smoke-desktop-ui-scorecard.mjs` and
  `packages/app/e2e/thoth-ui-scorecard.spec.ts` so their default capture roots point outside the repo
  while still allowing explicit environment overrides.
- State changes: Updated `.agent-os/` and `docs/` evidence references from the old repo path to
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/`. Also rewrote old path references inside the moved
  external report/markdown evidence files.
- Verification passed: the repo-local capture directory is absent, git no longer tracks capture
  files there, the external evidence root still contains 358 files / 49M, no old operational capture
  path references remain in the repo scan, and `git diff --check` passed.

## 2026-07-08 [Composer Provider and Loop controls]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`
- User-visible request: Implement the approved Composer Provider/Loop controls change: Provider
  should default to the concrete model name, `Mode` becomes `Loop`, Loop strength is selected inside
  that same control as `Single` / `Light` / `Balanced` / `Infinite`, and `Infinite` uses a dynamic
  laser label in both the menu and selected chip.
- Implementation summary: Added optional `workspaceSecretary.loopStrength` to protocol and daemon
  persisted config, resolved Loop composer strength as `quick -> null` and `loop -> selected strength
or one_plan_one_do`, and updated Workspace Secretary snapshots/send requests to use the real
  selected value instead of hard-coded `balanced`.
- Implementation summary: Updated app composer controls so the Provider chip displays selected or
  default model labels such as `gpt-5.5`, renamed the mode chip to `Loop`, implemented the in-menu
  Loop strength panel, and added the animated `Loop Infinite` label. Workspace Secretary draft tabs
  now pass the configured provider/model into the shared agent controls so they no longer show the
  generic `Provider Provider` fallback.
- Verification passed: `npm --workspace=@thoth/protocol run test -- messages.config
thoth-runtime-contract` passed 2 files / 30 tests. `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 8 tests.
  `npm --workspace=@thoth/app run test -- runtime-controls provider-display workspace-tab` passed
  9 files / 66 tests. `npm --workspace=@thoth/app run test` passed 318 files / 2634 tests.
  `npm run build:web`, `npm run check:foundation`, and `git diff --check` passed.
- Runtime evidence: Restarted only the Thoth dev daemon on `127.0.0.1:6688` so the running schema
  accepted `workspaceSecretary.loopStrength`; the reserved Paseo daemon on `127.0.0.1:6767` was not
  touched. Direct RPC patch verified `run_until_stopped` and restore to `one_plan_one_do`.
- Visual evidence: Playwright screenshots were saved outside the repository under
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-controls-20260708-final/`. Local desktop,
  local mobile, and public `http://180.76.242.105:8148/` desktop all show Provider `gpt-5.5`,
  `Loop Single`, and separate `Clarify Direct`. Local desktop also verified selecting
  `Loop Infinite` changes the chip to the laser-styled `Loop Infinite`, then restored it to
  `Loop Single`.

## 2026-07-08 [Composer Loop label detail cleanup]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`
- User-visible request: Keep `Foreground` / `Background` wording in the Loop menu details, but remove
  those details from the selected chip. The selected short values should be only `Quick`, `Single`,
  `Light`, `Balanced`, or `Infinite`.
- Implementation summary: Changed the RuntimeControls selected Loop label resolver so Quick mode
  renders `Quick` and Loop mode renders only the selected strength label. The root menu still renders
  `Quick (Foreground)` and `Loop (Background)`, and the strength submenu now renders
  `Single (Background)`, `Light (Background)`, `Balanced (Background)`, and `Infinite (Background)`.
  The `Infinite` word itself keeps the laser label.
- Verification passed: `npm --workspace=@thoth/app run test -- runtime-controls` passed 1 file / 6
  tests. `npm run build:web` passed. Playwright verified local `8082` and public `8148`: selected
  chip text is `Quick`, `Infinite`, or `Single` without `Foreground` / `Background`; menu text keeps
  the foreground/background detail. `git diff --check` passed.

## 2026-07-08 [Composer Loop strength submenu label cleanup]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`
- User-visible request: Keep `(Background)` only on the first-level `Loop` menu item; remove it from
  the second-level strength options `Single`, `Light`, `Balanced`, and `Infinite`.
- Implementation summary: Updated `RuntimeControls` so the Loop strength submenu renders plain
  strength labels only. The root menu still shows `Quick (Foreground)` and `Loop (Background)`, and
  the selected chip remains the short value `Quick`, `Single`, `Light`, `Balanced`, or `Infinite`.
- Verification passed: `npm --workspace=@thoth/app run test -- runtime-controls` passed 1 file / 6
  tests. `git diff --check` passed.

## 2026-07-08 [Composer Loop Live/Async wording cleanup]

- Worked on: `NTH-OBJ-001`, `NTH-WS-001`
- User-visible request: Replace the longer `Foreground` / `Background` Loop menu detail wording
  with the shorter recommended labels.
- Implementation summary: Updated the root Loop menu to show `Quick (Live)` and `Loop (Async)`.
  The selected chip remains short (`Quick`, `Single`, `Light`, `Balanced`, `Infinite`), and the Loop
  strength submenu/back row no longer carries foreground/background-style detail copy.
- Verification passed: `npm --workspace=@thoth/app run test -- runtime-controls` passed 1 file / 6
  tests. `npm run build:web` passed and refreshed the web export. `git diff --check` passed.

## 2026-07-08 [Clarify card completion and pending timeline repair]

- Worked on: `NTH-OBJ-001`, `NTH-EV-029`
- User-visible request: Implement the approved Clarify card interaction and pending timeline fix:
  submit disabled until all questions complete, single/multiple question modes, single-select
  auto-advance, only `Recommend`, unified note placeholder, `Cancel` pause semantics, spinner/timer
  without spinner-only, and no premature `Worked for ...` while Clarify authority is still pending.
- Implementation summary: Added `selection_mode: "single" | "multiple"` to the protocol Clarify
  question schemas, semantic Codex dynamic tool schema and daemon handling. Legacy cards default to
  `single`; daemon answer validation rejects multiple `choice_ids` for a single-select question.
- Implementation summary: Reworked `ClarifyDecisionCard` so every question must be completed before
  `Submit` enables, single-select choices replace and auto-advance, multiple-select choices toggle
  without auto-advance, single/multiple modes render with different visual tokens, `You decide` is removed,
  `Recommend` only fills the current question delegation note and advances, and note placeholders now use
  `You may add an explanation or write a note only.`.
- Implementation summary: Changed Clarify stop handling to pause further questioning without forcing
  composer mode/clarify strength back to Quick/direct. Fixed a live UI crash where
  `hasPendingAuthorityDecisionStreamItem` was accidentally used as an item predicate. Added Workspace
  Secretary draft running-state logic so non-none Clarify remains running before the first authority
  card, between submitted Clarify cards and the next card, and between submitted Task and Pyramid Plan.
- Verification passed: `npm --workspace=@thoth/protocol run test -- thoth-runtime-contract
workspace-secretary` passed 2 files / 37 tests. `npm --workspace=@thoth/daemon run test:unit --
src/server/agent/tools/thoth-tools.test.ts src/server/agent/providers/codex-app-server-agent.test.ts
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 3 files / 89
  tests. `npm --workspace=@thoth/app run test -- workspace-tab-core clarify-decision-card layout
session-stream-reducers types/stream agent-stream` passed 18 files / 279 tests.
  `npm --workspace=@thoth/app run test` passed 318 files / 2642 tests. `npm run build:web`,
  `npm run check:foundation`, and `git diff --check` passed.
- Real UI evidence: Created a throwaway `/tmp/thoth-clarify-ui-*` git workspace through the real
  daemon on `127.0.0.1:6688`, verified local `http://127.0.0.1:8082/` and public
  `http://180.76.242.105:8148/`, then removed the daemon project and `/tmp` repo. Captures and JSON
  reports are outside the repo under
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/clarify-card-pending-20260708/`.
- Real UI evidence: Local full interaction report `full-interaction-v2-report.json` shows
  `waitHadWorked=false`, `waitHadTimer=true`, `submitBefore`/`submitAfterQ1`/`submitAfterRecommend`
  disabled, `afterQ1Question2=true`, `afterRecommendQuestion3=true`, `afterQ3CanSubmit=true`,
  `afterSubmitNoRecommendButton=true`, `afterSubmitHasWorked=false`, and no page errors. Public
  report `public-clarify-v2-report.json` shows the same no-premature-`Worked for ...` behavior,
  initial disabled submit, `Single select`, `Cancel`, no `You decide`, timer present, and no page errors.

## 2026-07-09 [Loop Background Goals/PlanExec/Review implementation]

- Worked on: `NTH-TD-019`, `NTH-CD-045`, `NTH-EV-030`
- User-visible request: Implement Loop background mode completely after Clarify + two approvals:
  register a durable background task, show it in Background Tasks, open task/goal/phase detail, run
  linear goals through PlanExec and Review sessions, count failed Review budgets by Loop strength, and
  stream each phase through the existing AgentTimeline substrate.
- Implementation summary: Added the new main-path `Goals Card` authority model and
  `thoth_submit_goals_card` runtime tool while keeping old Pyramid Plan parsing as legacy. Added Loop
  semantic tools for PlanExec result, Review verdict and blocked reporting. Updated Codex dynamic tool
  registration so Clarify and Loop tools are scoped by phase flags instead of leaking into all
  sessions.
- Implementation summary: Added `ThothLoopTaskService` with daemon-owned persistence, worktree lock,
  queued/running/paused/blocked/done/stopped/interrupted states, failed-Review budgets
  (`Single=1`, `Light=5`, `Balanced=10`, `Infinite=30`), current-goal-only looping, PlanExec
  provider plan mode, fresh Review sessions, pause/resume/stop and restart interruption handling.
- Implementation summary: Wired `background_task.list`, `background_task.inspect` and
  `background_task.action` through protocol/client/daemon/session/websocket. Goals Card `accept_loop`
  now registers the new task model and queues the scheduler instead of ending at `registered_pending`
  when the new Goals Card is present.
- Implementation summary: Reworked Background Tasks panel to list real Loop tasks, open task detail,
  show linear goals with current goal spinner and grey inactive goals, show PlanExec/Review phase tabs,
  default to the active phase, embed selected phase AgentTimeline, subscribe stream/permission events
  and route Pause/Resume/Stop actions.
- Bug fixed during verification: Pause/Stop previously could race with the pending phase promise and
  be overwritten as `blocked`; action state now lands before cancellation and canceled phases no
  longer override paused/stopped state.
- Verification passed: `npm --workspace=@thoth/protocol run test -- thoth-runtime-contract
workspace-secretary` passed 2 files / 37 tests. `npm --workspace=@thoth/daemon run test:unit --
src/server/agent/tools/thoth-tools.test.ts src/server/agent/providers/codex-app-server-agent.test.ts
src/server/session/workspace-secretary/workspace-secretary-session.test.ts
src/server/thoth-loop/task-service.test.ts` passed 4 files / 96 tests.
  `npm --workspace=@thoth/app run test -- background-tasks-panel secretary-approval-card
types/stream` passed 4 files / 52 tests. `npm --workspace=@thoth/app run test` passed 319 files /
  2645 tests. `npm run build:daemon`, `npm run build:web`, `npm run check:foundation` and
  `git diff --check` passed.
- Verification note: `npm --workspace=@thoth/app run typecheck` was run and still fails on broad
  pre-existing app type errors unrelated to the new Background Tasks panel. Do not claim app typecheck
  as passed for this session.
- Remaining evidence gap at this point in the session: real Codex Loop background acceptance on local
  `8082` and public `8148` had not been run yet. This was superseded by the next run-log entry, where
  `NTH-EV-030` moved from `partial_code_verified` to passed Single-path real-provider evidence.

## 2026-07-09 [Loop Background real-provider acceptance]

- Worked on: `NTH-TD-019`, `NTH-TD-021`, `NTH-CD-045`, `NTH-EV-030`
- User-visible request: Continue the approved Loop Background complete implementation and verify it
  with real Codex on local `8082` and public `8148`.
- Bug fixed during real-provider verification: Workspace Secretary structured Codex sessions were
  initially launching with `dynamicToolNames: []` because native Thoth tool catalog gating read the
  caller agent from `AgentManager` before `registerSession()`. `AgentManager.buildLaunchContext()`
  now passes `callerAgentConfig`, and `createThothToolCatalog()` falls back to that launch config
  before the caller agent exists. Regression tests cover the launch-config path.
- UI hardening: Background Task phase timelines now carry `testID="loop-phase-timeline"` and auto
  call `AgentStreamView.scrollToBottom("jump-to-bottom")` when a phase loads or receives new items,
  so embedded PlanExec/Review timelines do not visually sit at the long initial prompt while live
  Shell/Thinking/tool events exist below.
- Local real-provider evidence: Ran Loop+Single / Clarify Balanced against
  `http://127.0.0.1:8082/` with throwaway workspace `/tmp/thoth-loop-background-dIy278`. Report:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-background-2026-07-09T02-22-03-920Z/1783563943719-report.json`.
  The run produced 5 Clarify cards, Task Card, Goals Card, durable task
  `loop-task-13fa5321-1d5d-4a52-b655-ae2634f74d9a`, 8 linear goals and Background Tasks detail.
  Follow-up task inspection showed Goal 1 PlanExec and Review completed with reasoning,
  assistant_message and tool_call AgentTimeline entries; Review pass advanced to Goal 2; Goal 2
  Review failed and consumed the Single failed-review budget.
- Public real-provider evidence: Ran the same path against `http://180.76.242.105:8148/` with
  throwaway workspace `/tmp/thoth-loop-background-l16BGt`. Report:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-background-2026-07-09T02-32-23-648Z/1783564545908-report.json`.
  The run produced 5 Clarify cards, Task Card, Goals Card, durable task
  `loop-task-2f4cd8fb-a6a8-457d-8eea-a85df8b9932b`, 10 linear goals and Background Tasks detail.
  It advanced linearly through Goal 1, Goal 2 and Goal 3 Review pass without consuming failed-review
  budget, then was intentionally stopped during Goal 4 PlanExec.
- Evidence summary: Post-run RPC/timeline summary saved at
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop-background-2026-07-09T02-32-23-648Z/1783565728941-post-run-summary.json`.
  It records local/public phase entry counts and confirms PlanExec/Review timelines include
  reasoning, assistant_message and tool_call entries. Key screenshots inspected with `view_image`:
  public task/detail current-goal spinner
  `1783564538646-background-task-list-detail.png`, public phase timeline
  `1783564545842-background-task-planexec-timeline.png`, and additional timeline capture attempts
  under the same external evidence directory.
- Verification passed: `npm --workspace=@thoth/protocol run test -- thoth-runtime-contract
workspace-secretary` passed 2 files / 37 tests. `npm --workspace=@thoth/daemon run test:unit --
src/server/agent/providers/codex-app-server-agent.test.ts src/server/agent/tools/thoth-tools.test.ts
src/server/session/workspace-secretary/workspace-secretary-session.test.ts
src/server/thoth-loop/task-service.test.ts` passed 4 files / 98 tests.
  `npm --workspace=@thoth/app run test -- background-tasks-panel secretary-approval-card
types/stream` passed 4 files / 52 tests. `npm --workspace=@thoth/app run test` passed 319 files /
  2645 tests. `npm run build:web`, `npm run check:foundation`, and `git diff --check` passed.
- State updates: `NTH-EV-030` is now passed for the first real Codex Loop+Single local/public path.
  `NTH-TD-019` moved to verified. `NTH-TD-021` moved to ready for Loop+Light, complete
  all-goals-to-`done`, restart recovery and repeated hardening evidence.
- Not claimed: Loop+Light, complete all-goals-to-`done`, Claude/OpenCode Loop adapters and
  restart-recovery real-provider runs are not verified by this evidence.

## 2026-07-09 [Background Tasks nested timeline wheel chaining]

- Worked on: Background Tasks detail UI hardening after user report that the outer detail page only
  scrolls when the pointer is outside the embedded PlanExec/AgentTimeline area.
- Root cause: The embedded `AgentStreamView` web scroll container uses its own overflow surface and
  `overscrollBehaviorY: "contain"`. When the pointer was over the phase timeline, wheel input stayed
  inside the inner container even when the inner timeline could not continue scrolling, so the outer
  task detail `ScrollView` never received the scroll.
- Implementation summary: Added a Background Tasks scoped web-only wheel bridge on
  `loop-phase-timeline`. It lets the inner AgentTimeline handle wheel input while it can scroll; once
  the inner timeline reaches the top or bottom, the bridge forwards the normalized wheel delta to the
  outer task detail scroll container. This intentionally does not change the global AgentTimeline /
  Workspace timeline behavior.
- Test coverage: Added `shouldForwardLoopPhaseTimelineWheel` coverage plus DOM wheel tests proving
  that edge scrolling chains to the outer detail view and non-edge scrolling remains inside the
  phase timeline.
- Verification passed: `npm --workspace=@thoth/app run test -- background-tasks-panel` passed 1 file
  / 6 tests. `npm run build:web` passed. `npm --workspace=@thoth/app run test` passed 319 files /
  2648 tests. `npm run format:check` and `git diff --check` passed.

## 2026-07-09 [Workspace Secretary draft tab semantic title repair]

- Worked on: Workspace Secretary / Clarify tab chrome bug where a newly submitted secretary session
  stayed labeled `New Agent` instead of adopting a semantic session title.
- Root cause: The new Workspace Secretary / Clarify path runs inside the original `draft` tab using
  `uiAgentId=tabId` and does not retarget the tab to a normal `{ kind: "agent" }` target. Ordinary
  agent creation still uses `onCreated -> retargetCurrentTab`, but the secretary path only dispatches
  `workspace_secretary.send`, so `buildDraftPanelDescriptor()` kept returning the static
  `panels.draft.newAgent` label. Daemon topic titles were also generic (`Current topic` / `Topic N`), so the
  draft descriptor had no semantic title source.
- Implementation summary: Draft tab targets now carry an optional persisted `title` chrome field.
  Workspace Secretary submit derives a provisional title from the first non-empty user prompt line,
  stores it on the current draft tab, and then refreshes it from the active topic title when a daemon
  response or snapshot provides a semantic title. Generic topic names are ignored so a fresh draft
  still does not hydrate or display an unrelated previous workspace topic.
- Implementation summary: Workspace Secretary daemon send handling now renames the active topic from
  the first user prompt using the same provisional-title logic as ordinary agent creation, but only
  while the topic title is still generic.
- Test coverage: Added app tests for draft descriptor semantic titles, Workspace Secretary title
  derivation/model-title filtering, and draft tab title retargeting without changing tab identity.
  Added daemon test proving `workspace_secretary.send` renames the active topic from the first prompt.
- Verification passed: `npm --workspace=@thoth/app run test -- agent-panel-descriptor
workspace-tab-core workspace-tabs-store/state composer/actions` passed 4 files / 65 tests.
  `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 1 file / 11
  tests. `npm --workspace=@thoth/app run test -- background-tasks-panel` passed 1 file / 6 tests.
  `npm run build:web`, `npm run check:foundation`, and `git diff --check` passed.
- Verification note: A full `npm --workspace=@thoth/app run test` run was attempted and failed once
  on the unrelated `background-tasks-panel` phase-switching test while looking for
  `agent-stream-agent-plan-2`; the same file passed when rerun narrowly, so app full-suite pass is
  not claimed for this session.

## 2026-07-09 [Workspace Secretary interrupt button and cancel bridge]

- Worked on: Workspace Secretary draft composer interruption bug where a running provider turn did
  not show the red square cancel button, leaving users unable to actively interrupt a long turn.
- Root cause: Workspace Secretary runs inside a virtual draft tab whose `uiAgentId` is not the real
  provider agent id. The draft tab passed the running virtual status to `AgentStreamView`, but
  `Composer` only read the normal session-store agent status, so it believed no agent was running
  and never switched the empty-input submit button into cancel mode.
- Implementation summary: Added `workspace_secretary.cancel.request/response`, exposed
  `DaemonClient.cancelWorkspaceSecretaryTurn()`, routed Workspace Secretary draft cancellation
  through a dedicated app action, and gave `Composer` an `agentStatusOverride` plus
  `onCancelRunningAgent` hook for virtual agent surfaces.
- Implementation summary: Workspace Secretary cancel now resolves the active topic, cancels the
  real provider agent ids recorded for that topic instead of the draft `uiAgentId`, marks user
  initiated cancellation as `ready`, and suppresses later provider `turn_canceled`/cancel-related
  failure events from becoming `recoverable_error`.
- Authority cleanup: If a runtime authority card is pending during user cancel, the daemon folds the
  card with submitted summary `The current request was interrupted; you may continue typing.` and resolves the waiting runtime decision
  with stop/cancel semantics so dynamic tool calls do not hang.
- UI behavior: Workspace Secretary running + empty input now uses the existing Paseo-style red
  square cancel button. Once the user types, the composer returns to the green send arrow and keeps
  the existing queue/interrupt send preference behavior.
- Verification passed: `npm --workspace=@thoth/protocol run test --
workspace-secretary/rpc-schemas.test.ts` passed 1 file / 8 tests.
  `npm --workspace=@thoth/client run test -- daemon-client` passed 2 files / 106 tests.
  `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 1 file / 13
  tests. `npm --workspace=@thoth/app run test -- actions.test.ts workspace-tab.test.ts
input/state.test.ts input/labels.test.ts` passed 4 files / 55 tests. `npm run build:web`,
  `npm run check:foundation`, and `git diff --check` passed.
- Verification note: `npm --workspace=@thoth/app run test -- composer actions workspace-tab input`
  was attempted but hit the unrelated `src/composer/draft/input-draft.live.test.tsx` `beforeAll`
  hook timeout from the broad pattern. File-level app tests above are the claimed app evidence for
  this change.
- Browser acceptance passed: Started the Thoth daemon on `127.0.0.1:6688` and the real web export on
  `127.0.0.1:8082`, then ran a Playwright/Chromium smoke against a throwaway `/tmp` git workspace.
  Capture directory: `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/workspace-secretary-cancel-20260709T132555Z/`.
  Screenshots confirm running + empty input shows the red `Stop agent` square, running + typed input
  shows the green `Send and interrupt` arrow, and after clicking `Stop agent` the composer returns to
  editable ready state with no red stop button. Daemon metrics for the same run recorded
  `workspace_secretary.cancel.request`, `workspace_secretary.cancel.response`, and `turn_canceled`.

## 2026-07-09 [Original workspace session restore repair]

- Worked on: Original/historical workspace sessions opened from the sidebar restoring as a blank
  `New Agent` draft instead of focusing the existing provider agent timeline.
- Root cause: Sidebar workspace clicks navigated to the workspace route, but historical/completed
  agents are not returned by the active-agent subscription. The app could fetch the historical agent
  and timeline, but the workspace tab reconciliation path only retained `activeAgentIds`; the restored
  historical tab was pruned before the UI could render it. Empty-workspace draft seeding also only
  looked at active agent count, so historical workspaces were briefly treated as empty.
- Implementation summary: Added `restoreWorkspaceAgentTabFromHistory()` to fetch agent history on
  workspace navigation/route mount, upsert matching historical agents into `agentDetails`, and focus
  the newest matching agent tab. Workspace visibility now separates `restorableAgentIds` from
  `activeAgentIds`, so restored history is preserved without auto-opening every historical session or
  weakening archive pruning.
- Implementation summary: Added a non-persisted workspace-layout restored-agent retention set to
  protect the explicitly restored agent tab across the cross-store update race between session details
  and layout reconciliation. Empty draft seeding now waits for the historical-agent probe and refuses
  to seed when restorable history exists.
- Test coverage: Added app tests for history restore, restorable visibility, stale-tab reconciliation,
  restore retention, and empty-draft seeding after history checks.
- Verification passed: `npm --workspace=@thoth/app run test -- agent-visibility
workspace-empty-draft-seed workspace-layout-store workspace-agent-restore navigation
workspace-tab-core` passed 10 files / 135 tests. `npm run build:web` passed.
  `npm --workspace=@thoth/app run test` passed 320 files / 2663 tests. `npm run check:foundation`
  passed. `git diff --check` passed.
- Browser acceptance passed: Real web export on `127.0.0.1:8082` restored two original sessions from
  current daemon state. `Greeting` opened `workspace-tab-agent_e5d25a98-a773-4978-a5f5-8e996a6e2c8a`
  with tab text `hi`, historical user message `hi`, and the Chinese assistant reply; capture:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/session-restore-20260709T151455Z/`.
  `yzy` opened `workspace-tab-agent_5fb3a0ea-5d71-4de6-b712-f1ea56143815` with no draft tab; capture:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/session-restore-yzy-20260709T151530Z/`.

## 2026-07-09 [Loop Background hardening and golden judge promotion]

- Worked on: `NTH-TD-021`, `NTH-CD-045`, `NTH-EV-030`
- User-visible request: Continue the approved Loop Background complete-body repair plan, harden the
  Codex main path beyond the first Single acceptance, and do not fall back to fake
  `registered_pending` tasks when true Loop runtime/capability is missing.
- Implementation summary: Extended Loop protocol/runtime contracts with full PlanExec result
  persistence, `goals_count_rationale`, phase audit metadata, stricter Review verdict validation and
  typed PlanExec result projection into Background Tasks. Failed Review verdicts now require failed
  acceptance, root cause, next-round guidance and anti-repeat strategy; pass verdicts must bind all
  acceptance entries as met; blocked verdicts cannot mark every acceptance as met.
- Implementation summary: Hardened `ThothLoopTaskService` with durable worktree locks, restart
  reconciliation to `interrupted`, strict pending phase result matching for `goal_id` / `round` /
  `phase`, provider exit status/cancel/timeout metadata, complete PlanExec evidence in Review
  prompts and richer task summaries. Goals accept now emits honest `provider_unsupported` when the
  real Loop service/capability is unavailable instead of manufacturing legacy `registered_pending`.
- Implementation summary: Promoted `thoth.loop` quality coverage with
  `packages/drivers/src/loop/golden.ts`, `packages/drivers/src/loop/eval.ts` and
  `scripts/judge-loop-golden.mjs`. The golden set now includes positive and negative fixtures for
  frozen-contract no-question behavior, current-goal boundaries, concrete Review evidence, no Review
  source mutation, non-mechanical retry, provider/permission failure budget semantics, failed-review
  budget exhaustion and all-goals completion.
- UI summary: Background Tasks detail now shows richer budget/current phase detail, pending
  Pause/Resume/Stop button states and a selected-goal PlanExec evidence block.
- Documentation/state updates: Updated `.agent-os/project-index.md`, `.agent-os/todo.md`,
  `.agent-os/acceptance-report.md`, `.agent-os/run-log.md` and `docs/testing.md` to record that code
  hardening and `thoth.loop` judge promotion passed, while Loop+Light, complete all-goals-to-`done`
  and restart recovery still need real-provider evidence.
- Verification passed: `npm --workspace=@thoth/protocol run test -- thoth-runtime-contract
workspace-secretary` passed 2 files / 40 tests. `npm --workspace=@thoth/daemon run test:unit --
src/server/thoth-loop/task-service.test.ts src/server/agent/tools/thoth-tools.test.ts
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 3 files / 32
  tests. `npm --workspace=@thoth/app run test -- background-tasks-panel` passed 1 file / 6 tests.
  `npm run test:drivers -- loop/eval` passed 1 file / 1 test. `npm --workspace=@thoth/app run test`
  passed 320 files / 2663 tests. `npm run build:daemon`, `npm run build:web`,
  `npm run check:foundation` and `git diff --check` passed.
- Judge evidence: `npm run judge:loop:golden` passed. Deterministic report:
  `.agent-os/artifacts/loop-golden-eval-2026-07-09T16-47-13-651Z.json`. Independent Codex judge
  report: `.agent-os/artifacts/loop-golden-codex-judge-2026-07-09T16-47-13-651Z.md`.
- Remaining limitation: This session did not run new real Codex Loop+Light, all-goals-to-`done`,
  pause/resume/stop or daemon restart recovery acceptance. `NTH-TD-021` remains open for those
  real-provider hardening runs.

## 2026-07-10 [Public web connection timeout repair]

- Worked on: Public web review host connection health after Settings showed both Relay and TCP
  connection rows timing out.
- Root cause: The live `8082 -> 8148` web app had been started as a pure static server without
  `THOTH_DAEMON_PROXY_TARGET`, so `/ws` did not proxy to the local Thoth daemon on `127.0.0.1:6688`.
  Direct `TCP (180.76.242.105:8148)` probes therefore timed out even though the HTML page returned 200. Relay health had a separate instability: Node `fetch` to `relay.test.thoth.seeles.ai` was
  hitting `ETIMEDOUT` in this environment while `curl -4` succeeded consistently.
- Implementation summary: Updated `scripts/serve-static.mjs` relay health proxy to use an IPv4-only
  HTTPS request instead of default Node `fetch`. Updated `npm run dev:web:demo` to launch with
  `THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688`, and updated `docs/development.md` /
  `docs/packaging.md` so the documented web review command includes the daemon proxy target.
- Runtime action: Restarted only the Thoth web test app on `0.0.0.0:8082`; kept Thoth daemon on
  `127.0.0.1:6688` and left the reserved Paseo daemon on `127.0.0.1:6767` untouched.
- Verification passed: `curl -I http://127.0.0.1:8082/` returned 200; local and public
  `/__thoth/relay-health` each returned 5/5 successful relay health payloads; `ws://127.0.0.1:8082/ws`
  and `ws://180.76.242.105:8148/ws` both opened; a fresh Playwright Chromium load of
  `http://180.76.242.105:8148/` had no page errors or timeout console messages and created
  `direct:180.76.242.105:8148` in the host registry. `node --check scripts/serve-static.mjs`,
  `npm run format:check` and `git diff --check` passed.

## 2026-07-10 [Paseo UI icon restoration]

- Worked on: User request to restore Thoth frontend interface icons back to the Paseo icon system,
  while keeping Thoth logo/app icon/favicon/brand assets intact.
- Implementation summary: Removed the visible `ThothInventoryIcon` / arcade inventory UI icon path
  from the app shell. `left-sidebar.tsx` now uses Paseo-style lucide icons for add project, home,
  settings and the workspace section header. `settings-screen.tsx` now uses the Paseo lucide icon
  set for settings, host sections and project headers instead of Thoth inventory PNGs.
- Brand exception: `ThothLogo` now imports only the Thoth brand mark directly, so logo rendering
  remains unchanged without pulling the deleted UI inventory registry into the visible interface.
- Verification passed: `npm --workspace=@thoth/app run test -- left-sidebar settings-screen settings
providers-section projects-screen` passed 5 files / 60 tests. `npm run build:web` passed and the
  web export asset list only included the allowed `arcade-inventory/brand/brand-mark` asset from the
  arcade inventory tree. `npm run format:check` and `git diff --check` passed. A code scan found no
  remaining `ThothInventoryIcon`, `inventoryIconName`, or non-brand `arcade-inventory` UI icon paths
  in `packages/app/src` / `packages/app/dist`.
- Browser smoke: Captured local web screenshots for the left sidebar and settings page at
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/paseo-icons-20260710T020418Z/`; the visible UI icons
  render as Paseo-style line icons while the Thoth brand mark remains intact.

## 2026-07-10 [Background Tasks default right surface resizing]

- Worked on: Background Tasks workspace-scoped right surface desktop default-open behavior and
  horizontal resize support.
- User-visible request: Keep a live session on the left and open the Background Tasks control surface on the right for every workspace by default;
  the right-side Background Tasks UI must support dragging the divider to adjust horizontal spacing.
- Implementation summary: `WorkspaceScreen` now resolves the Background Tasks surface as open by
  default on desktop workspaces, while keeping compact/mobile as explicit route/surface behavior.
  The desktop layout renders the live workspace column on the left, a reusable `ResizeHandle`
  divider, and the Background Tasks control plane on the right. Closing the surface records an
  explicit user-close marker so the default-open rule does not fight a user's later choice.
- Implementation summary: `background-tasks-surface-store` now persists `closedByUser` and
  `sidebarWidth`, clamps right-panel width to stable desktop bounds, and preserves enough width for
  the live session column while resizing.
- Verification passed: `npm --workspace=@thoth/app run test -- background-tasks-surface-store
background-tasks-panel` passed 2 files / 13 tests. `npm --workspace=@thoth/app run test` passed
  321 files / 2681 tests. `npm run build:web` passed after final formatting. `npm run
check:foundation` passed. `git diff --check` passed.

## 2026-07-10 [Workspace canonical identity and Background control plane]

- Worked on: Workspace uniqueness, Background Tasks control-surface refactoring and read-only branch display.
- User-visible request: Allow only one workspace per real path / git worktree; normalize git subdirectories to the current
  worktree root; make Background Tasks a workspace-scoped control surface rather than an agent tab; provide a separate
  Background Tasks page on mobile; display only the current checkout for the branch, with no switching entry point.
- Implementation summary: `WorkspaceProvisioningService`, `ThothWorktreeService` and
  `WorkspaceReconciliationService` now use native realpath + git checkout/worktree root for canonical
  workspace identity. Duplicate workspaces merge into the earliest canonical record, duplicate workspaces are archived,
  and agent ownership is migrated; running agents are canceled with user-interruption semantics during session-level
  reconciliation before migration. Agent creation, local workspace, and worktree/open-project paths all use the
  find-or-create/reuse main path.
- Implementation summary: On the App side, `background_tasks` was removed as a `WorkspaceTabTarget` and from the panel registry
  main path; legacy persisted Background tabs are discarded during workspace-tab-store migration/partialization,
  and old `open=background_tasks:*` opens only the workspace surface. Added
  `background-tasks-surface-store`; desktop workspaces render a closable Background control surface on the right, while mobile provides
  the workspace-scoped `/background-tasks` page.
- Implementation summary: Extracted `BackgroundTasksSurface` from the old panel wrapper and made it receive
  `serverId/workspaceId` directly; the left-sidebar Background Tasks entry opens the right rail on desktop and an
  independent page in compact/mobile layouts. `BranchSwitcher` is reduced to a read-only branch pill and no longer opens a branch combobox or calls the switch
  operation; visible copy no longer suggests switching branches.
- Protocol summary: `fetch_workspaces_response.payload` adds optional/defaultable
  `workspaceRedirects` and `dedupeNotice` for subsequent UI rewriting of stale deep links / dedupe notices; the old
  client parses them compatibly.
- Verification passed: daemon narrow tests for workspace provisioning/worktree/reconciliation/session
  invariants passed 4 files / 56 tests. Protocol `messages.workspaces` passed 31 tests. App targeted
  tests for Background Tasks, host routes, sidebar, branch/source-of-truth and workspace tab store
  passed. `npm --workspace=@thoth/app run test` passed 320 files / 2665 tests. `npm run build:web`
  passed. Existing `8082 -> 8148` static server served the latest `packages/app/dist`; local and
  public `/h/local/workspace/demo/background-tasks` returned `200`, and `/__thoth/relay-health`
  returned `status=ok`. `npm run check:foundation` passed. `git diff --check` passed.

## 2026-07-10 [Workspace Secretary fresh draft isolation]

- Worked on: Bugfix for a fresh New Agent draft inheriting another active Workspace Secretary topic
  in the same workspace.
- Root cause: Snapshot hydration already skipped fresh drafts, but
  `workspace_secretary.model.update` is workspace-scoped and the draft subscription still applied it
  unconditionally after matching only `workspacePath`. A newly opened draft could therefore receive
  the active topic stream, mark itself submitted/running, and rename itself to the previous semantic
  topic title.
- Implementation summary: Added `shouldApplyWorkspaceSecretaryModelUpdateForDraft` and guarded the
  Workspace Secretary model-update subscription so only a draft with local secretary stream items,
  an in-progress submitted turn, or a created secretary topic consumes workspace-wide updates. The
  submit/hydrate paths now keep a submitted ref in sync so the first legitimate update for the
  current draft is still accepted immediately. `WorkspaceDraftAgentTab` is now keyed by
  `serverId/tabId/draftId` so React cannot reuse one draft component instance, and its local
  submitted/topic/running refs, for another newly opened draft.
- Verification passed: `npm --workspace=@thoth/app run test -- composer/draft/workspace-tab-core`
  passed 1 file / 16 tests. `npm --workspace=@thoth/app run test -- composer/draft agent-panel`
  passed 7 files / 48 tests. `npm --workspace=@thoth/app run test` passed 320 files / 2669 tests.
  `npm run build:web`, `npm run check:foundation` and `git diff --check` passed.

## 2026-07-10 [Workspace Secretary topic-bound refresh restore]

- Worked on: Bugfix for two Workspace Secretary draft tabs with the same prompt/title, where the
  Clarify tab reopened after browser refresh as a blank draft instead of restoring its prior
  context/card timeline.
- Root cause: The previous fresh-draft isolation fix correctly stopped new drafts from consuming
  workspace-wide active-topic snapshots, but draft tabs did not persist a Workspace Secretary
  `topicId`. Refresh therefore left a semantically titled Clarify draft with no tab-scoped authority
  binding. The daemon also persisted only the active topic's `turns`, so creating a second same-title
  topic could overwrite the restorable context for the first.
- Implementation summary: Draft workspace tab targets now persist `secretaryTopicId`; topic creation
  writes the returned `activeTopicId` back into the tab, and restored drafts request
  `workspace_secretary.snapshot` with that topic id. Workspace-wide model updates are accepted only
  when the active topic matches the bound draft topic. Draft title/topic retargets merge against the
  latest tab target to avoid same-submit overwrites.
- Implementation summary: Workspace Secretary snapshots now store per-topic runtime state
  (`topicStates`) with turns, clarify state, active phase and provider-backed flag. Creating a new
  topic saves the previous active topic first; snapshot requests with `topicId` activate and return
  that topic's own turns instead of the workspace active topic. Old single-active-topic snapshots
  still parse as legacy data.
- Verification passed: `npm --workspace=@thoth/protocol run test -- messages workspace-secretary`
  passed 15 files / 141 tests. `npm --workspace=@thoth/client run test -- daemon-client` passed 2
  files / 107 tests. `npm --workspace=@thoth/app run test -- composer/draft agent-panel
workspace-tabs-store/state` passed 8 files / 66 tests.
  `npm --workspace=@thoth/daemon run test:unit --
src/server/session/workspace-secretary/workspace-secretary-session.test.ts` passed 1 file / 14
  tests. `npm --workspace=@thoth/app run test` passed 320 files / 2674 tests. `npm run build:web`,
  `npm run check:foundation` and `git diff --check` passed.

## 2026-07-10 [Public connection timeout runtime recovery]

- Worked on: Live investigation and recovery of the Settings Connections view showing Relay/TCP timeouts simultaneously.
- Root cause: The `8082` web static server and `THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688` were both still correct,
  and the local Relay proxy, public proxy and direct Relay health checks all returned `200`; what was actually missing was the Thoth daemon,
  with no process listening on `127.0.0.1:6688`. The old daemon log showed neither a crash nor a graceful shutdown, and the old PID was stale,
  indicating that the daemon previously started from an interactive terminal had been cleaned up with the terminal lifecycle.
- Runtime action: Kept the Paseo/legacy `127.0.0.1:6767` and existing `8082 -> 8148` web server, and used the standard
  `npm run dev:daemon` entry point to start a detached Thoth daemon in an independent `setsid` session; runtime logs and the PID
  are stored in ignored `.dev/thoth-runtime/`.
- Verification passed: `6688` health returned `ok`; `6688/ws`, `8082/ws` and `8148/ws` all completed raw
  ping/pong; local and public Relay health were both `ok`; daemon logs recorded `relay_control_connected` and
  `relay_data_connected`. The real Chromium Connections page changed from `Timeout` to the actual RTT `1ms`
  about 14 seconds after daemon recovery. `6767` remains independently served by the original Paseo daemon.

## 2026-07-10 [Archived Codex session history recovery]

- Worked on: Fixed archived Codex Agents opened from History or a persisted workspace tab entering full-page
  `agent-load-error` and failing to restore context because `thread/resume` rejects archived threads.
- Root cause: `fetch_agent_timeline_request` rebuilds the provider session through `ensureAgentLoaded`; the Codex
  adapter originally connected with `thread/resume` followed by `thread/read`. A Codex archived thread allows
  `thread/read(includeTurns=true)` but rejects `thread/resume`, so history replay failed before it started. The production daemon
  currently has no durable timeline store that can bypass provider history.
- Implementation summary: Added internal `AgentResumeSessionOptions.historyOnly`. `ensureAgentLoaded` now selects
  history-only resume for persisted Agents that still have
  persisted Agents with `archivedAt` choose history-only resume; in this mode Codex performs only `thread/read` and
  timeline hydration, does not call `thread/loaded/list` / `thread/resume`, and does not clear local or provider
  archive state. When the user explicitly unarchives or sends another message, the existing provider-first unarchive path is used,
  and the thread is restored before the turn actually starts.
- Real-session evidence: For Agent `188e4b43-df5a-49a5-8a77-a1bb2a7b3ee4` and Codex thread
  `019f468a-b515-7a62-b285-6725afbd2cd9`, archived `thread/read` returned 2 turns / 7 items; after the fix,
  the daemon timeline RPC returned all 7 timeline entries while retaining `archivedAt`. An explicit refresh then succeeded,
  `archivedAt=null`, the session id remains unchanged, and the timeline still contains 7 entries.
- Browser evidence: Real Chromium opened “How is the weather today?” from History and restored two rounds of user/assistant text,
  Thinking and Search tool timeline, with no `agent-load-error`, archived-resume error or page/console
  error. The screenshot is outside the repository.
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/archive-resume-history-ui-20260710.png`。
- Verification passed: daemon Codex provider + AgentManager narrow tests passed 2 files / 193 tests；
  The Thoth daemon was restarted on `6688` with the dev runtime and real RPC/browser re-verification completed; Paseo `6767` was untouched.
- Remaining gate issue: `npm run build:daemon` fails at the pre-existing workspace-response
  type error in `session.ts:4566`; the error is outside this archived-session change, and scope was not expanded this round.

## 2026-07-10 [Background Tasks resize and Loop phase timeline recovery]

- Worked on: Fixed the insufficient width of the workspace's right-side Background Tasks control surface, the inability to resize its internal task list and detail panes,
  and the completed Loop phase incorrectly displaying `This phase has not created a provider session yet.`.
- Root cause: The outer control surface had a hard maximum width of `760px` and forced `520px` for the live session; the internal task list
  was fixed at `300px` with no resize handle. The timeline issue was not a missing provider session: Loop task authority and
  the Codex rollout retained the phase `agentId`/thread, but the phase agent used `internal: true`, and AgentManager skipped internal agents when persisting
  snapshots; after daemon restart, AgentStorage had no phase-agent record, so the UI could not restore the timeline by `agentId`.
  Loop Codex threads also use an independent `CODEX_HOME`, so session home must be retained during recovery.
- Implementation summary: Increased the outer maximum width to `1400px` and changed the live-session minimum width to `420px`;
  added a horizontal task-list/detail resize handle inside Background Tasks and persisted list width per workspace. The Timeline
  UI now distinguishes loading, real fetch errors, missing phase references and genuine queued/no-session states; completed phases
  are no longer incorrectly reported as having no session.
- Implementation summary: Loop PlanExec/Review internal agents now write to AgentStorage through `persistInternal`,
  retaining their `internal` identity during recovery; persisted Codex `thothLoopSessionHome` is restored as
  `CODEX_HOME` in the launch context. Existing tasks read structured Codex `session_meta` through Loop authority phase identity and daemon-owned
  session-home naming, backfill a hidden AgentStorage record as needed, and then use the standard `ensureAgentLoaded` timeline path.
- Real task evidence: For workspace `/tmp/thoth-loop-background-OBM6xj` and task
  `loop-task-e0c2016c-1721-429e-8444-c8991eaed98d`, recovery restored PlanExec agent
  `0a6608a3-2326-4a9c-944d-1a9ed14c7fdc`'s Codex thread
  `019f44aa-b636-7261-b5c2-b43d423ed205` (18 entries) and Review agent
  `e6ef91fe-dfd2-4552-95ca-1b4c0e107c88`'s thread
  `019f44ac-ff1e-7aa3-abd7-1b7bfa91ef6e` (15 entries). In real Chromium, Goal 1's completed
  PlanExec/Review both displayed the original timeline, with no no-session empty state or page/console error.
- Browser resize evidence: In a 1600x1000 viewport, the outer control surface was dragged from `500px` to `855px`, the internal task list
  from `220px` to `495px`, and detail retained `359px`; after refresh, both widths returned to their original values. Screenshots are outside the repository:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/background-task-resize-timeline-recovery-20260710.png`
  and
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/background-task-completed-review-timeline-20260710.png`。
- Verification passed: app targeted tests 2 files / 16 tests；daemon targeted tests 4 files / 216 tests；
  app full tests 321 files / 2684 tests；`npm run build:web`、`npm run format:check`、
  `npm run check:foundation` and `git diff --check` passed.
- Remaining gate issue: `npm run build:daemon` still fails at the pre-existing workspace-response
  type error in `session.ts:4566`; this round did not misattribute that existing error to Loop phase persistence and does not claim that the daemon build passed.

## 2026-07-10 [Clarify config change no longer fabricates a running turn]

- Worked on: Fixed a bug where changing only Clarify strength in a completed Workspace Secretary conversation immediately showed
  a spinner, elapsed timer and red cancel button, visually implying that a message had been sent automatically.
- Root cause: `shouldKeepWorkspaceSecretaryAuthorityTurnRunning` treated the current mutable composer
  `clarifyStrength !== "none"` as evidence that the historical topic still had a structured turn. `secretarySubmitted` remains true
  after a topic has had any message, so changing a completed Direct conversation to Light/Balanced/Dive/Auto locally re-derived it as running
  without a daemon send or new turn. The helper also scanned authority cards before the latest user message and did not recognize
  an "interrupted/stopped" summary as terminal.
- Implementation summary: running is now driven only by daemon-explicit `secretaryTurnInFlight`, or by a Clarify/Task/Goals authority-card
  lifecycle that remains unfinished after the latest user message. Clarify strength is fully removed from execution-state derivation;
  reverse scanning stops at the latest `user_message`, so old cards cannot contaminate a new turn; pause, cancel, interruption and stop are all
  treated as terminal summaries.
- Regression coverage: Added tests for completed Direct config changes, old-authority-card truncation, daemon in-flight state,
  submitted Clarify/Task continuation, Goals completion, pause and user interruption.
- Real browser evidence: On the real historical `Greeting` topic, switched to Direct and then through Light, Balanced,
  Dive and Auto. Each value was sampled every 50ms across the entire transition; the instantaneous maxima of
  `turn-working-indicator`, `turn-working-elapsed` and the cancel button were all 0; the message count remained 2 user / 2 assistant,
  no `workspace_secretary.send.request` occurred, and the original Balanced configuration was restored. The browser had no page/console error.
  Screenshot outside the repository:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/clarify-config-change-no-turn-20260710.png`。
- Verification passed: app targeted tests 3 files / 64 tests；app full tests 321 files / 2686 tests；
  `npm run build:web`、`npm run format:check`、`npm run check:foundation` passed。

## 2026-07-10 [Workspace switch preserves running Secretary turn and current-topic card]

- Worked on: Fixed the related recovery issue where switching to another workspace and back while a Workspace Secretary/provider turn was still running made the spinner,
  elapsed timer and cancel state disappear and show completion prematurely, while multiple old topic cards suddenly appeared near the current Clarify card.
- Root cause: `WorkspaceSecretarySession` had only one global `state`; switching workspaces discarded the addressable runtime state
  of the previous workspace while the old provider generator continued writing to an object detached from the session. The topic runtime snapshot also did not
  save `status`, and activating a topic unconditionally reset it to `ready`. More fundamentally, the production persisted-config schema
  lacked the protocol-supported `topicStates`, so topic snapshots were never actually written to `config.json`.
- Root cause: When requesting a bound topic, the frontend did not validate the response's `activeTopicId`; after the daemon returned an old active topic it overwrote
  the tab binding and projected the wrong context. `applyWorkspaceSecretaryModelToStream` only appended/merged canonical cards by id,
  without deleting stale Clarify/Task/Goals cards from another topic, so one incorrect snapshot accumulated multi-card contamination.
- Implementation summary: The daemon now uses `statesByWorkspacePath`, retaining an independent Secretary state for each workspace
  within the same websocket session; topic snapshots add runtime `status` and restore it when a topic is activated. Disk recovery from
  `loading` becomes an explicit interrupted/recoverable state, preventing a never-ending fabricated spinner after daemon restart.
- Implementation summary: Persisted config and protocol mutable config now include `topicStates`, Clarify/phase/provider
  runtime fields and the status schema. After binding a topic, the frontend accepts only snapshots with the same `activeTopicId` and prevents incorrect responses from overwriting
  the existing topic binding; canonical Secretary projections first remove old model cards and secretary messages, then rebuild from the current authority
  model while retaining real provider AgentTimeline live items.
- Implementation summary: When a tab remount temporarily resets local `secretaryTurnInFlight` to zero, it checks only loading thoughts,
  running tool calls or pending authority cards after the latest user message to retain spinner/elapsed; tools/cards from old turns
  and the current Clarify configuration are no longer treated as runtime evidence.
- Real browser evidence: On a real Codex topic, sent `E2E workspace-switch recovery F20260710: implement a minimal Three.js ray-tracing renderer`,
  switched to another workspace while it was running, then returned and reopened the same deterministic draft tab. Before and after switching,
  `turn-working-indicator=1`, `turn-working-elapsed=1`; the provider continued running, and ultimately only one current topic card appeared
  `Confirm first-version presentation and ray-tracing boundaries`, with no duplicate old cards and no page/console error. Screenshot outside the repository:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/workspace-switch-running-card-dedupe-20260710.png`。
- Recovery limitation: The user's original `topic-dd05121e-50aa-4ee2-9da9-a5d9a335fd10` was isolated by the old production-schema
  failure and could not be recovered in the same turn; this round's real acceptance used a new topic created and persisted after the fix, without presenting the new run as recovery of the old
  turn. The test card was canceled after acceptance and the provider wait was released.
- Verification passed: app targeted tests 2 files / 64 tests；daemon targeted tests 2 files / 56 tests；
  protocol targeted tests 1 file / 2 tests; the full app test command, `npm run format:check` and
  `npm run check:foundation` passed。
- Remaining gate issue: `npm run build:daemon` still fails at the pre-existing workspace-response
  type error in `session.ts:4566`; that error is unrelated to this round's workspace/topic/card lifecycle fix, and this round does not claim that the daemon build passed.

## 2026-07-10 [Secretary card actions remain authoritative after workspace switches]

- Worked on: Fixed the issue where an old Clarify card's `Submit` and `Cancel` appeared clickable but did nothing after workspace/topic switching,
  and the authority-routing issue where the red cancel button could cancel the most recently visited topic instead of the current tab's topic.
- Root cause: Although snapshots were isolated by workspace/topic, `workspace_secretary.send.request` and
  `workspace_secretary.answer.request` still carried no workspace/topic identity, and cancel carried only an optional topicId; the daemon's
  three write paths continued calling parameterless `ensureState()`, relying on a global state pointer rewritten by the latest snapshot. A read request from another workspace
  could change that pointer before the user clicked, causing the card action to find no card/pending decision in the wrong state. After the daemon
  returned a recoverable model, the Workspace Draft stream layout also failed to display `secretaryErrorMessage`, creating a silent no-op.
- Implementation summary: The send/answer/cancel wire schemas and client facade add backward-compatible optional
  `workspaceId/workspacePath/topicId`; Workspace Draft sends the current canonical workspace and bound topic for every write.
  Daemon write paths use request identity for exact `ensureState`; answer also searches all loaded
  workspace states for the authority state by the pending decision's topicId and rejects submissions whose decision topic differs from the active topic.
- Stale-card behavior: When a card exists in the authority transcript but its runtime decision is answered/expired/blocked,
  the daemon no longer returns silently; it collapses the card to readonly, with a summary stating "This question is no longer valid" and a status stating that no
  answer was submitted. If the card does not belong to the requested topic, the returned canonical model removes the incorrect projection. Workspace Draft in stream
  mode also displays a recoverable/error banner instead of only an invisible form error.
- Regression coverage: Added daemon tests for "answering the original workspace/topic after another workspace becomes recent state" and
  "collapsing an expired card instead of silently accepting the button"; App actions assert that send/answer/cancel all forward the three identity fields;
  protocol/client tests cover the new fields and strict wire parsing.
- Real submit evidence: On real Codex topic `topic-b46620c8-3e3d-44f9-a52a-23b13353cf9f`, switched
  workspaces after the card arrived and returned; one current card remained and the spinner persisted. After completing and submitting 3 questions, the card collapsed to
  `3 branch dimensions confirmed`, and the provider continued in the same turn to generate a Task Card. Screenshot:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/workspace-switch-card-submit-continuation-20260710.png`。
- Real cancel evidence: On a real Codex topic using prompt
  `E2E card-cancel ownership I20260710: implement a minimal WebGL renderer`, after switching workspaces and returning there was still only one
  `Determine the delivery boundary of the minimal renderer`; after clicking cancel, the summary was `Paused further questions`, interactive cards changed from 1 to 0,
  the working spinner changed from 1 to 0, and the browser had no page/console error. Screenshot:
  `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/workspace-switch-card-cancel-20260710.png`。
- Original screenshot card evidence: Executed a real daemon RPC for expired card
  `Define the scene JSON contract` (`clarify-card-c670cabc-9b19-4fdb-97e6-b0c853d09eb7`) on `topic-27a07e09-f316-4667-a49d-90df1be77af3`,
  which returned `recoverable_error`, explicitly stating "This question is no longer valid; no answer was submitted", and collapsed the original card to readonly.
- Verification passed: protocol targeted tests 2 files / 10 tests；client targeted tests 2 files / 107 tests；
  daemon Workspace Secretary 18 tests；App targeted tests 2 files / 65 tests；App full test command、
- `npm run build:web`, `npm run format:check` and `npm run check:foundation` passed. The Thoth daemon was restarted with the
  new protocol dist loaded and is listening normally on `6688`; Paseo `6767` retained its original PID and was untouched.

## 2026-07-11 [Deterministic Clarify / Loop user-journey fixture contract]

- Worked on: Turned the user's five locked Thoth business and interaction flows into a deterministic unit-test contract, explicitly separating flow
  verification from provider-agent intelligence, free text, real file implementation and real Codex transport.
- Contract: Added `packages/daemon/src/test-fixtures/thoth-flow-contract.ts`. It declares stable user prompts,
  composer controls, fixture provider events, user actions and final states, without prompt instructions about "what the model must ask or must be intelligent enough to
  judge". The fake provider only replays assistant markers, authority cards, PlanExec results and
  Review verdict。
- Coverage: `UT-01` Quick+Direct bare passthrough；`UT-02` Quick+Clarify -> Task/Goals -> same-topic
  foreground exec；`UT-03` pending Clarify workspace switch/snapshot recovery -> pause -> resume -> foreground
  exec；`UT-04` Clarify+Loop registration -> two linear all-pass goals -> done；`UT-05` Clarify+Loop
  registration -> failed Review -> same-goal Round 2 retry -> pass -> next goal, plus Light 5 failed-Review
  budget exhaustion to blocked.
- Hard assertions: card pending/submitted lifecycle, workspace/topic authority routing, recovery without
  stale card injection, Quick never creates LoopTask, Loop only advances on Review pass, failed Review increments
  the global budget, PlanExec failure context carries Review root cause/guidance/anti-repeat strategy, and no
  goal-six phase is created after the Light budget reaches `5/5`.
- Production alignment: fixture uncovered that `buildPlanExecPrompt` only passed prior guidance. It now also
  injects `Previous Review root cause` and `Previous anti-repeat strategy`, so retry PlanExec has the complete
  Review direction required by the Loop contract.
- Documentation: `docs/testing.md` now gives the narrow command and explicitly states this suite is not a
  real-provider or agent-quality gate.
- Verification passed: new fixture suite `5/5`; combined new fixture + Workspace Secretary + Loop service
  narrow suite `3 files / 37 tests`; `npm run format:check`, `npm run check:foundation`, and
  `git diff --check` passed.
- Remaining gate issue: `npm run build:daemon` remains blocked by the pre-existing workspace response type
  error in `src/server/session.ts:4566`; no new contract or Loop prompt type error was reported before it.

## 2026-07-11 [Scripted real-Codex flow fixture companion]

- Worked on: Completed the five Clarify / Loop user journeys with a real Codex
  app-server E2E entry point instead of only fake-provider state-machine replay, while keeping the test target as transport/authority flow rather than agent intelligence.
- Contract: Added `packages/daemon/src/test-fixtures/thoth-real-provider-flow-script.ts`; each case predefines
  Clarify/Task/Goals dynamic-tool parameters, PlanExec result, Review verdict, markers and user answers. Real Codex
  may execute only these literal calls and may not read/write the temporary workspace, call shell/fetch or make independent decisions.
- E2E: Added `thoth-flow-fixtures.real.e2e.test.ts`, which creates a `/tmp` workspace through real daemon WebSocket RPC,
  sends the fixed script, answers real authority cards, and checks Codex dynamic-tool lifecycle, same-turn resume, Loop
  phase session/timeline, linear goals, Review fail -> same-goal round 2 retry and Review-guidance injection.
- Commands: Added `npm run test:thoth-flow:real`, which runs only this file serially so the old
  `test:integration:real` glob does not include unrelated historical real-provider cases.
- Verification: The deterministic fake-provider fixture suite remained `5/5 passed` this round; the initial real-provider command
  incorrectly reused the old OpenRouter gate, so all five E2Es were skipped because the current shell lacked that API key. That gate does not mean local Codex
  authentication is unavailable; the path was subsequently changed to native Codex CLI auth and the single file must be rerun before real acceptance can be recorded.
- Follow-up verification: The literal payload contract test and the original five local flow tests totaled `10/10 passed`;
  `npm run test:thoth-flow:real` collected the single E2E file and reported `5 skipped`; `npm run check:foundation` and
  `git diff --check` passed. Daemon typecheck still reports only the previous `src/server/session.ts:4566` workspace-response
  mismatch; the test source is outside the daemon production typecheck include.

## 2026-07-11 [Native Codex scripted flow acceptance and retry-race repair]

- Correction: The initial scripted E2E incorrectly reused the OpenRouter real-test harness. The user required the native Codex CLI authentication state of the previously real Thoth
  provider, so a native helper was added that checks only `codex` and
  `$CODEX_HOME/auth.json` (default `~/.codex/auth.json`), without setting `OPENROUTER_API_KEY`, `OPENAI_API_KEY`,
  `OPENAI_BASE_URL` or a custom provider. Session-scoped `CODEX_HOME` continues to be populated by Thoth from native auth/config.
- Real execution: `npm run test:thoth-flow:real` fully ran the five fixed user journeys through the local native Codex app-server path,
  ultimately `5/5 passed` in `275.91s`. It covered Quick Direct, Quick Clarify same-turn
  foreground completion, pending card snapshot/cancel/resume, Loop two-goal all-pass, and Loop Light
  Review fail -> same-goal Round 2 -> pass -> next goal -> done。
- Test hardening: Assistant markers are now merged from consecutive timeline deltas; timeline `clarify` /
  `task_approval` / `goals_approval` are user-safe labels, so tests no longer incorrectly assert raw semantic tool names; the temporary
  workspace allows `.agents`, `.codex` and `.git` metadata created by Thoth/Codex at runtime while still rejecting business files.
- Production bug found and fixed: After a Review failure, PlanExec must reuse the same agent/session; the old PlanExec could still have an active turn after
  a dynamic-tool result, so direct `streamAgent` reported `already has an active run` and left the retry stuck forever. The Loop service now detects in-flight reuse and calls
  `replaceAgentRun` to safely replace the old turn in the same session; phase events also bind to the startup round so old Round 1 cancellation/failure cannot contaminate Round 2.
- Regression: Added an in-flight PlanExec retry simulation to the Loop task-service test; local Loop/fixture/real-script
  contract tests totaled `24/24 passed`. Real native acceptance does not evaluate model questions, plans or code quality: all dynamic
  tool parameters, Review verdicts, markers and user answers are fixed by the test contract.

## 2026-07-11 [Workspace Secretary refresh cancel authority recovery]

- Root cause: Browser refresh creates a new `WorkspaceSecretarySession`, but the old implementation stored
  `topic -> internal provider agent` only in that WebSocket session's in-memory `topicAgents` Map. The real Codex agent continued running in the daemon,
  but the new session could not find it for cancellation and incorrectly returned ready. The frontend also re-derived submitted/invalid authority cards and lingering
  `tool_call: running` as running, leaving the red interrupt button and spinner stuck permanently.
- Repair: The topic-agent mapping is now persisted with the workspace topic snapshot and restored during hydration; old and new snapshots
  can locate a live provider agent within the same workspace through a daemon-only internal-agent label (`surface=workspace-secretary`, `topicId`).
  Cancellation resolves the pending authority decision, collapses all unresolved cards, marks lingering running tools in the UI
  timeline as `canceled`, converges loading thoughts to `ready`, and preserves history without fabricating active
  execution. A submitted card no longer determines the spinner by itself; only daemon loading, a genuinely running tool/thought or an unsubmitted
  authority card can represent an active turn.
- Verification: `workspace-secretary-session` + `agent-manager` narrow tests `138/138 passed`；app composer
  actions + workspace-tab core tests `67/67 passed`; `npm run build:web`, `npm run check:foundation`,
  `npm run format:check` and `git diff --check` passed. Full daemon typecheck still has only the previous
  `src/server/session.ts:4566` workspace-response mismatch, with no new error from this change. The existing `8082` static service
  has been confirmed to read the rebuilt bundle `index-73c7aa8ef1ec2923f54d97572297686e.js`.

## 2026-07-11 [Authority continuation spinner lifecycle repair]

- Real-session evidence: The native Codex transcript for `topic-8e0e7f29-d278-4403-94fc-61a4d5ddba66`
  proves that the provider continued working after the first Clarify card was submitted and continued to submit Task / Goals; the screenshot's
  `Worked for 4m47` was a premature frontend terminal state, not provider completion.
- Root cause: The Workspace Secretary app unconditionally cleared
  `secretaryTurnInFlight` with `status=ready` for every model snapshot. Same-turn continuation after an authority-tool answer is asynchronous, so a delayed ready
  snapshot caused the AgentTimeline footer to render completed first, swallowing the expected spinner + elapsed. Task and Goals
  approvals use the same answer path and therefore had the same problem.
- Repair: Card answers enter in-flight immediately before the RPC begins; the new
  `resolveWorkspaceSecretaryTurnInFlight` clears it only on daemon `provider_turn_completed` / `provider_blocked` /
  `provider_error` or an explicit error. Ordinary ready snapshots and answer RPC responses cannot end a turn prematurely;
  daemon loading always takes priority. Thus provider continuation after Clarify, Task and Goals keeps a running footer,
  and only a true terminal state displays `Worked for ...`.
- Deployment and verification: app core/actions narrow tests `71/71 passed`；Workspace Secretary daemon
  narrow test `20/20 passed` (the answer response must be loading); `npm run build:web`,
  `npm run check:foundation`, `npm run format:check` and `git diff --check` passed. The old Thoth daemon
  `00:55 UTC` non-watch instance was gracefully restarted after confirming there was no running Loop phase; the new `6688` health check
  passed, the retained Paseo `6767` was untouched, and the current `8082` service bundle
  `index-ef5e3e55f6ad45ced8eba25dcd8d5d24.js`。

## 2026-07-11 [Loop phase isolation and control-lifecycle repair]

- Root cause 1: Loop PlanExec/Review agents are intentionally internal, but their `agent_stream`, lazy
  `agent_state` and `fetch_agent_timeline_response` snapshots shared the normal SessionContext transport.
  The timeline response listener unconditionally wrote the internal snapshot into the foreground agent store,
  which created `PlanExec: ...` / `Review: ...` workspace tabs even after the earlier stream filtering.
- Repair: internal status is now carried in stream and agent snapshot protocol projections. The global app
  store ignores internal / `surface=thoth-loop` timeline responses while the scoped Background Tasks panel
  continues to consume the same response and render the phase AgentTimeline in place.
- Root cause 2: a real C++20 task submitted `goal_id: "1"` although the approved goal authority id was `g1`.
  Strict validation rejected it, so PlanExec could not advance to Review. Prompts and Codex tool descriptions
  now show the immutable goal id and phase-run id. The daemon additionally normalizes only the exact display
  ordinal of the currently pending goal; every wrong goal, wrong round and wrong phase remains rejected.
- Phase lifecycle: PlanExec success now persists the full result and moves the durable cursor to Review before
  scheduling the independent Review session. A provider turn that genuinely ends without its required semantic
  result now resolves immediately to an explicit blocked state instead of showing completed or waiting for the
  generic 30-minute timeout.
- Controls: Pause records `pause_after_phase` and lets the active PlanExec or Review finish at its atomic
  boundary; Stop immediately cancels the live provider run; Resume is enabled only for paused/interrupted/stopped
  tasks and continues from the durable phase cursor, preferring the original provider session with a continuation
  prompt. The UI order is `Resume | Pause | Stop`.
- Workspace contract repair: the workspace list now always emits hydrated `workspaceRedirects` and
  `dedupeNotice` defaults, and the workspace test now verifies the approved canonical-worktree behavior: an
  agent may retain a child cwd while sharing the parent worktree workspace.
- Verification passed: Loop service unit `18/18`; combined Loop / agent projection / Workspace Secretary
  daemon narrow suite `55/55`; app Background Tasks / Workspace tab / SessionContext suite `41/41` and full
  app suite `321 files / 2700 tests`; workspace session plus Loop suite `99 passed, 4 skipped`; protocol
  workspace suite `31/31`; `npm run build:daemon`; `npm run build:web`; `npm run check:foundation`;
  `npm run format:check`; `git diff --check`.
- Real browser evidence: after supervised daemon restart with no running Loop task, `8082` displayed the
  Background Tasks surface and embedded PlanExec timeline while the foreground tab row contained only `hi`;
  no PlanExec/Review tab leaked, and the previously stopped C++20 task rendered `stopped`, not `blocked`.
  Captures are under `/tmp/` and were not added to docs or git. Paseo on `127.0.0.1:6767` was not touched.

## 2026-07-11 [Foreground history visibility repair]

- Screenshot symptom: a normal workspace tab showed `Agent failed to load` followed by `History sync timed out
after 65s`, even though the Background Tasks panel was unrelated and only displayed a stopped task.
- Root cause: `Session.handleFetchAgentTimelineRequest` correctly asks the Loop service whether an id belongs
  to a persisted phase. The initial `recoverPhaseAgent` implementation, however, marked _any existing_ stored
  agent as `internal` before proving Loop ownership. Ordinary foreground records therefore became internal;
  SessionContext correctly ignored their timeline response as an internal Background Tasks response, leaving
  the app's initialization deferred unresolved until its 65-second watchdog fired.
- Repair: Loop recovery now first resolves the exact task/goal/phase owner. Only an authority-owned phase may
  be marked internal. Legacy records that have no daemon-owned labels, no Loop runtime configuration and are
  not old raw Secretary provider packets are restored to `internal=false` in both storage and live projection.
  Explicit `surface=thoth-loop` records remain hidden.
- Real migration verification: the screenshot's `Implement a renderer` and `Help me implement an efficient quicksort` histories now
  return as foreground agents in about `410ms` and `1ms`; their stored `internal` flags are false. The
  `PlanExec: Confirm engineering boundaries` record remains `internal=true`. A fresh browser visit to `8082` has neither the
  timeout nor `Agent failed to load`, and no Loop phase tab leaks into the foreground.
- Verification passed: daemon Loop/agent-manager/workspace invariant tests `150/150`; app SessionContext,
  AgentPanel and history-initialization tests `18/18`; `npm run build:daemon`; `npm run format:check`; and
  `git diff --check`. Daemon restart used the supervised RPC after confirming there were no running Loop tasks;
  Paseo `127.0.0.1:6767` was not touched. Capture: `/tmp/thoth-history-visibility-repair.png`.

## 2026-07-11 [Workspace Secretary first-send / refresh / archive recovery repair]

- Symptom and root cause: a first Workspace Secretary prompt briefly showed a spinner and then a blank
  inactive timeline with no cancel control. The provider had not actually started: persisting the topic snapshot
  added `topicAgents`, but the strict persisted daemon-config schema did not allow it. The resulting Zod error
  aborted `workspace_secretary.send` before any provider turn and was misleadingly projected as a provider
  completion failure. Separately, topic-to-internal-agent mapping existed only in a WebSocket-session Map, so a
  refresh could not locate the real running Codex agent for snapshot recovery or cancel. Archive history records
  could also be mistaken for lazy-restorable foreground tabs during layout hydration.
- Repair: protocol and daemon persisted-config schemas now durably store `topicSnapshots[].topicAgents`; internal
  Workspace Secretary provider agents are persisted and restored by the topic mapping or their daemon-owned
  labels. Cancel resolves pending authority decisions and converges stale running tool/thought items rather than
  leaving an orphaned spinner. A first draft now creates its topic and writes the first user turn in the single
  `workspace_secretary.send` RPC: it prebinds a UUID locally but never issues the old `topic.create -> send` pair.
  Provider-side `timeline.user_message` is the daemon-wrapped runtime prompt and is no longer mirrored into the
  user-facing timeline. Archived agent details remain history-only and cannot enter `restorableAgentIds`.
- Real browser evidence: on `http://127.0.0.1:8082/`, a native Codex turn showed the user message, running
  spinner/elapsed footer and red Stop control before refresh; all three remained after refresh; Stop then cleared
  the live indicator without a provider error. The browser contained no `Thoth structured Workspace Secretary
turn.` internal prompt. Captures are `/tmp/thoth-secretary-atomic-before-reload.png`,
  `/tmp/thoth-secretary-atomic-after-reload.png`, and `/tmp/thoth-secretary-atomic-after-cancel.png`; they are
  intentionally outside docs and git. Daemon metrics recorded `workspace_secretary.send.request`, Codex
  app-server thread/turn startup, `workspace_secretary.cancel.request`, and `turn_canceled`, with no
  `workspace_secretary.topic.create.request`.
- Verification: protocol `11/11`, daemon `62/62`, and app `91/91` targeted tests passed. `npm run build:daemon`,
  `npm run build:web`, `npm run check:foundation`, and `git diff --check` passed. Thoth daemon is again listening
  on `127.0.0.1:6688`; Paseo `127.0.0.1:6767` was not touched.
- Follow-up reload hygiene: the expected `Daemon client closed` rejection from a superseded browser client is now
  explicitly treated as lifecycle cleanup by Workspace hydration and the HostRuntime directory bootstrap instead
  of being logged as an application error. App regression coverage is `93/93`; a rebuilt real browser reload had
  zero console errors and no leaked internal prompt. `npm run format:check` and `git diff --check` passed after
  this final adjustment.

## 2026-07-11 [Workspace Secretary authority continuation and tab-menu repair]

- Root cause: Codex app-server can emit `turn_completed` while an authority dynamic-tool callback is still
  waiting for the user's card answer. The old same-topic continuation bridge handled that first race, but it
  released its continuation guard again on the replacement turn's `turn_started`. A snapshot/reload during that
  interval could launch a duplicate continuation. Provider stream events also derived ownership from the mutable
  currently active topic, so a different draft tab's snapshot could project a card/status into the wrong topic.
- Repair: a continuation claim is now keyed to `topicId + provider agentId` and a unique run id, and is released
  only by that continuation's matching terminal provider event. Each provider turn captures its source topic;
  stream state mutations temporarily activate that exact topic, persist it, then restore the topic currently
  displayed by another draft. Pending Clarify, Task and Goals cards now retain `loading` state while remaining
  actionable, so the timeline keeps the spinner/elapsed footer rather than prematurely rendering completion.
  Authority answer lookup prefers the pending decision's durable topic binding over a stale workspace/tab request.
- Tab menu: Workspace Secretary draft tabs now support Rename and retain the same close actions as real Agent
  tabs. Copy Agent ID, copy resume command and Reload agent remain real-Agent-only because a draft has no
  foreground agent identity to execute those actions honestly.
- Verification: Workspace Secretary daemon narrow suite `22/22`, app tab-menu plus draft-core tests `36/36`,
  `npm run build:daemon`, `npm run build:web`, `npm run check:foundation`, `npm run test:foundation`,
  `npm run format:check`, and `git diff --check` passed. Native Codex dynamicTools real-provider fixture suite
  passed `5/5` in `278.70s`; it uses literal scripted authority payloads to exercise provider transport and
  lifecycle rather than model quality. Browser DOM verification at `http://127.0.0.1:8082/` confirmed the draft
  context menu exposes Rename/close actions and the real Agent context menu keeps its real-Agent-only actions.

## 2026-07-12 [Quick Clarify foreground Plan+Exec handoff repair]

- Symptom: after Quick + Clarify approved the Goals Card, the old authority turn could already have emitted
  `turn_completed`. The answer resolved the dynamic tool callback, but `quick_exec` was excluded from the
  continuation launch condition. The topic then remained loading without a new provider turn, or the provider
  opportunistically executed only the first visible goal in the authority turn.
- Repair: Goals Card `accept_quick` now always starts a new plain foreground Plan+Exec user turn in the same
  provider agent/session. The daemon reuses the existing Codex agent id rather than creating a separate bare
  provider session, injects the frozen Task Card, every linear goal id/order/constraints/acceptance and durable
  Clarify answers, asks for one concise whole-task plan, and explicitly requires execution of every goal in order.
  The structured `thoth.clarify` authority turn ends after its tool result instead of racing the handoff.
- Lifecycle hardening: provider runs now carry a topic/agent generation. Terminal events from an authority run
  replaced by the Quick Plan+Exec run are ignored and cannot mark the new run ready or failed. `stop` and
  approval `cancel` now settle directly to `ready`; they no longer leave a spinner when no provider continuation
  should exist.
- Test discipline: deterministic flow fixtures now assert the same-agent Quick handoff prompt rather than relying
  on an agent-invented result. The full native Codex five-journey run initially produced `4/5`: UT-02 timed out
  only because its old assertion required the model to echo `FOREGROUND_EXEC_DONE`, despite the provider having
  already completed both goals with evidence. That marker assertion was removed as an intelligence-dependent
  false failure. The corrected real native Codex UT-02 passed in `77.38s` (`1 passed, 4 skipped`).
- Verification: Workspace Secretary + deterministic Thoth flow daemon tests `29/29`; protocol RPC schema test
  `8/8`; `npm run build:daemon`; `npm run build:web`; `npm run check:foundation`; `npm run format`; and
  `git diff --check` completed without reported failures. Real-provider receipt is intentionally outside git:
  `/tmp/thoth-real-quick-handoff-ut02.log` and `/tmp/thoth-real-quick-handoff-ut02.exit`.

## 2026-07-11 [Loop Engineering authority and native-Codex transport hardening]

- Worked on: `NTH-TD-021`, `NTH-CD-047`, `NTH-EV-031`
- Implemented/verified: SQLite event authority, Task Memory, sealed evidence, budget envelopes, Review mutation holds, contract-preserving replan audit and scoped semantic runtime tools were present in the Loop path. The final real transport defect was in Clarify convergence audit startup: dynamic-tool catalogs were built before their caller session was registered, so the handler captured no live caller and returned `Clarify convergence audit requires the active Codex dynamicTools session.`
- Repair: tool handlers now resolve the caller from AgentManager at execution time; regression coverage creates the catalog before caller registration and executes after registration. Real fixture configuration now injects the literal fixture script into each Secretary/PlanExec/Review provider session, retaining real Codex app-server/dynamicTools transport while avoiding provider-intelligence assertions.
- Verification: daemon typecheck passed; `thoth-tools`, Loop task service and deterministic fixture tests passed `43/43`; native Codex UT-04 all-pass passed in `103.586s`; UT-05 retry/budget passed in `122.501s`; full `npm run test:e2e:real:flow --workspace=@thoth/daemon -- --reporter=verbose` passed `5/5` in `345.73s`.
- Evidence: trace-only files are outside git under `/tmp/thoth-ut04-continuation-trace.ndjson`, `/tmp/thoth-ut04-scripted-phase-trace.ndjson` and `/tmp/thoth-ut05-scripted-phase-trace.ndjson`. No provider API fallback or OpenRouter was used.
- Final gates: `npm run check:foundation`, final `npm run build:web`, `git diff --check`, app Vitest `322/322` / `2703/2703`, daemon combination `146/146`, and all three independent judges passed. The Clarify user-simulation judge initially found that manual provenance omitted companion questions and regressed transcript refs; its fixture and validator were corrected, then `judge:clarify:user-simulation` passed with artifact `.agent-os/artifacts/clarify-user-simulation-2026-07-11T21-07-21-858Z.md`.
- Remaining: browser/device evidence for budget wait, pause/resume/stop, restart/reconnect and restored Background Task phase timeline. `NTH-TD-021` remains `doing`; no unverified browser behavior is claimed complete.

## 2026-07-12 [UI review capture repository purge]

- Removed `docs/ui-review-captures/**` and `assets/thoth-teaser-figure.png` from every local Git ref with a local-only history rewrite. No network operation or push occurred; `origin` was restored afterward. The current tree and all reachable Git objects no longer contain either path.
- Moved the existing `69 MB` UI review evidence directory from `/mnt/cfs/5vr0p6/yzy/thoth-ui-review-captures/` to ignored `.dev/ui-review-captures/`. Updated review scripts and evidence references to the new repository-local ignored path, and removed the obsolete `docs/ui-review-captures` ignore rule.

## 2026-07-12 [Quick Clarify cancel timeline durability repair]

- Symptom: after Quick + Clarify completed Task/Goals approval and entered the same-session foreground
  Plan+Exec turn, clicking the red Stop control could replace all ordinary execution text, reasoning and tool
  lifecycle rows with the clean authority-card projection. The remaining reconstructed cards all received a new
  client timestamp, so the footer incorrectly rendered `Worked for 0s`.
- Root cause: `workspace_secretary.cancel` correctly stopped the real provider agent, but the app only merged its
  clean `SecretaryTurn` snapshot. That model intentionally persists user/card authority, not ordinary Plan+Exec
  AgentTimeline rows. Live head items were not first committed to tail, and refresh/reconnect had no durable
  provider-timeline reference for the virtual Workspace Secretary tab.
- Repair: the protocol now carries an optional topic-scoped `timelineAgentId`, and durable topic runtime snapshots
  persist that real provider agent reference plus the user message id. The daemon binds it before every provider
  run and preserves it through cancel/restart. The app flushes and settles head/tail rows before applying a cancel
  model; it then hydrates the virtual tab from the canonical provider timeline on snapshot/reconnect and forces
  that hydration after cancel. Provider wrapper prompts remain filtered; clean cards overwrite provider card state
  in place while retaining source timestamps and chronology.
- Verification: app actions + draft-core `72/72`; Workspace Secretary daemon `27/27`; protocol RPC/config
  `13/13`; persisted-config `41/41`; full app Vitest exited successfully; `npm run build:daemon`, `npm run
build:web`, `npm run check:foundation`, `npm run format:check` and `git diff --check` passed. Runtime health
  returned success for Thoth `127.0.0.1:6688` and the web review endpoint `127.0.0.1:8082` returned HTTP 200.
  No daemon restart was performed, so no active user turn was interrupted for this repair.

## 2026-07-12 [Quick Clarify stop durable timeline journal completion]

- Deeper recovery root cause: the first cancel repair preserved live Workspace Secretary head/tail items and
  persisted the provider agent reference, but a later `fetch_agent_timeline` still called
  `ensureAgentLoaded()` provider-first. If Codex had archived or pruned the thread, the resume error prevented
  the daemon from returning history even when local timeline rows existed. The old daemon also accepted an
  injectable durable timeline interface without constructing one in production, so no local journal existed for
  that fallback path.
- Repair: added daemon-owned SQLite WAL journal at `<thothHome>/agent-timeline/timeline.sqlite`, wired it into
  `AgentManager`, and fixed initial timeline seeding to restore committed rows plus their stable epoch rather
  than only restoring the next sequence number. Timeline append now lands in this journal during every provider
  turn; normal shutdown closes the database after AgentManager flushes pending writes.
- Recovery boundary: `ensureAgentLoaded()` now tries the provider only for a runnable session. A failed or
  unavailable provider resume falls back to a read-only history projection when journal rows exist. Timeline
  fetch therefore continues to return assistant text, reasoning and tool lifecycle rows without materializing an
  internal Workspace Secretary provider agent as a foreground tab. Running, send, interrupt and permission APIs
  still require a live provider session and are not falsely advertised as available.
- Regression evidence: SQLite reopen/cursor test and the exact Codex `no rollout found` fallback test passed;
  daemon narrow suite passed `188/188`; app cancel/timeline suite passed `72/72`; full app Vitest completed
  before the daemon narrow suite; `npm run build:daemon`, `npm run build:web`, `npm run check:foundation`,
  `npm run format:check` and `git diff --check` passed.
- Runtime evidence: after confirming no active foreground turn, sent the supervised Thoth restart RPC with
  reason `quick_clarify_stop_timeline_durability`. Thoth returned healthy on `127.0.0.1:6688`, web remained
  HTTP `200` on `8082`, and the live journal contained `1` agent with `7` persisted timeline rows after browser
  reconnection. Paseo `127.0.0.1:6767` was not touched.

## 2026-07-12 [Workspace Secretary reload chronology repair]

- Symptom: after a browser reload, the first visible user request in a Workspace Secretary / Quick + Clarify
  session could appear after the entire provider timeline rather than at its original position.
- Root cause: clean authority turns use a client-stable `messageId`, while Codex records the daemon-wrapped
  `Workspace Secretary turn` prompt with a different native message id. The reload projection filtered the
  wrapper prompt, failed to identify it as the same user turn, then appended the clean-model user turn after
  provider text and tools.
- Repair: reload hydration now parses the known wrapper runtime context, matches its `user_input` to an
  unconsumed durable user turn in chronological order, replaces the Codex native id with the clean stable id,
  and merges cards/user turns in place while retaining provider timestamps. Internal card-continuation and
  Quick Plan+Exec prompts still have no matching durable user turn and remain hidden. Repeated identical user
  messages are consumed one-by-one, so later same-text turns cannot overwrite or append the first.
- Verification: focused app action suite passed `45/45`; full app suite passed `322/322` files and
  `2705/2705` tests before the final additional same-text regression, which also passed. `npm run build:web`
  and `npm run check:foundation` passed. A clean Chromium profile loaded the built `8082` workspace surface
  without console errors; it cannot access the human browser's selected session, so no false per-session
  screenshot claim is recorded.

## 2026-07-12 [Provider-neutral Workspace Secretary chronology]

- Follow-up decision: lifecycle fixes must not depend on Codex-native message ids, prompt serialization or
  thread behavior. Codex remains the only currently verified runtime-tool provider for Clarify/Loop authority,
  but Quick foreground execution, cancellation, durable history and reload chronology are provider-neutral.
- Repair: immediately before every real user provider turn, the daemon appends the literal user text and
  client-stable message id to the daemon-owned timeline journal. Workspace Secretary internal agents suppress
  provider-replayed user prompts and retain stable user rows during a forced provider-history rebuild. Provider
  history is therefore execution evidence only; it cannot append a duplicate or displace the authority user
  turn. Legacy histories retain an app-side generic envelope fallback until they acquire an anchor naturally.
- Capability correction: a configured/available provider without the runtime-tool bridge may now run
  `Quick + Clarify=None`; only structured Clarify/Loop authority turns remain honestly unsupported. This covers
  Claude Code, OpenCode and arbitrary ACP adapters without pretending they implement Codex dynamicTools.
- Verification: provider-parameterized daemon tests covered `claude`, `opencode` and `acp.local` durable
  anchors; an AgentManager OpenCode replay test covered forced history rebuild and raw-prompt suppression.
  App chronology tests cover the same three provider ids plus legacy wrapper recovery. Daemon narrow tests
  passed `149/149`, focused app actions passed `48/48`, full app suite passed `322/322` files and `2709/2709`
  tests, and `npm run build:daemon` / `npm run build:web` passed.

## 2026-07-12 [Provider-neutral runtime tool and Loop adapter boundary]

- Scope: audited the whole Workspace Secretary/Clarify/Quick/Loop recovery chain after the accumulated
  timeline, cancel, reload, foreground handoff and Background Task defects. Product state machines must use
  durable task/topic state and declared provider capabilities, never a `provider === "codex"` business branch.
- Repair: new sessions write the generic `extra.thothRuntimeTools` contract with one explicit scope:
  `clarify`, `clarify_audit`, `contract_audit`, `loop_planexec` or `loop_review`. `AgentManager` injects native
  tools solely from this contract plus `supportsNativeThothTools`. Clarify convergence audit, contract audit,
  PlanExec and Review now all carry the same scoped contract; PlanExec and Review never share a semantic-tool
  catalog.
- Compatibility and layering: old nested `extra.codex.thoth*` records are parse-only compatible, including
  legacy Loop phase/session-home metadata. New code never writes those fields. Provider session credential
  preparation and legacy persisted-phase recovery now go through adapter registries. Codex JSONL, `CODEX_HOME`
  and credential mirroring live only in Codex adapter files; a future Claude/OpenCode/ACP adapter adds its own
  registry entry without changing Secretary or Loop authority transitions.
- Behavior coverage: `Quick + Clarify=None` runs for `claude`, `opencode` and `acp.local` even without runtime
  tools. Structured Clarify accepts any adapter that declares native Thoth tools (covered with OpenCode) and
  returns a truthful `provider_unsupported` state when it does not. Loop PlanExec, Review and contract audit use
  the same capability gate; an OpenCode fixture covers Loop registration and contract-audit configuration.
- Verification: daemon focused tests passed `156/156` after the final refactor, including runtime config,
  dynamic-tool catalog, Workspace Secretary, Loop and Codex adapter boundaries. `npm run build:daemon`, app
  Vitest, `npm run build:web`, `npm run check:foundation`, `npm run format:check` and `git diff --check`
  completed without reported failures. A production static audit found no provider-name equality check in the
  Workspace Secretary, Loop, AgentManager, tool authority or virtual-tab lifecycle code; legacy config parsing
  and provider adapter files are the intentional exceptions.

## 2026-07-14 [Loop handoff, archive restore and evidence-budget recovery]

- Worked on: `NTH-TD-021`, follow-up hardening for browser/runtime regressions in Workspace Secretary and
  Background Tasks.
- Archive restore repair: automatic agent restoration, persisted workspace layouts and tab visibility now
  reject `archivedAt` agents before considering pinned/retained state. Archived history remains available but
  cannot be re-opened as the foreground session after reload.
- Loop handoff repair: successful `accept_loop` records `foregroundTurnState: "background_handoff"`, returns
  a ready Secretary model immediately and ignores late provider terminal state for foreground lifecycle. A
  live daemon snapshot confirmed the registered random-generator topic is `ready` with the expected handoff
  detail.
- Evidence repair: non-git baselines are now iterative, bounded and cache-aware; changed-file/line budget use
  is baseline-relative. Existing tasks that were held solely by the old workspace-size accounting are replayed
  and recovered. The live task `loop-task-494e2c0d-f065-4713-9f70-e55c1023c439` recovered from `1665` changed
  files to `0/75` before later independently entering the intentional Review mutation hold.
- Background UI repair: fixed the undefined compact-layout callback, made side-by-side width constraints
  self-consistent and stack the list/detail panes on compact layouts. A freshly exported `8082` build at
  `390x844` rendered the title and controls legibly with no console/page errors. Capture remains ignored at
  `.dev/ui-review-captures/loop-repair-20260714/mobile-background-header-readable-after-final-fix.png`.
- Verification: app Vitest `323/323` files and `2716/2716` tests; targeted Loop/Secretary daemon tests
  `73/73`; `npm run build:daemon`; `npm run build:web`; `npm run check:foundation`; and `git diff --check`
  all passed. Thoth `127.0.0.1:6688` and web review `127.0.0.1:8082` stayed available; Paseo/legacy `6767`
  was not touched. `NTH-TD-021` remains doing because end-to-end browser/device proof of control actions and
  restart/reconnect recovery is still outstanding.

## 2026-07-14 [Agent Harness review cognition boundary]

- User decision recorded as `NTH-CD-050`: the durable daemon authority must not make Agent Harness sessions
  think mechanically. State IDs, phase/round records, receipts, manifests, budgets and recovery rules are
  daemon-only machinery. They support recovery and safety but must not become Review's prompt, tool shape or
  definition of quality.
- Review is explicitly repositioned as an independent, aggressive corrective intelligence stage. It must inspect
  the approved human contract and real work, challenge PlanExec rather than follow it, identify the true root
  obstacle, abandon locally incremental approaches when needed, and provide the highest-leverage next direction.
  Future implementation/evaluation must judge this behavioral quality, not field completion or checklist match.

## 2026-07-14 [NTH-CD-050 canonical-document propagation]

- Worked on: documentation authority only; no runtime/source behavior was changed in this pass.
- Recorded the user decision as `NTH-CD-050`, then propagated it across the core principles, high-level design,
  engineering architecture, App runtime contract, MVP user journey, Loop Goal 5, architecture milestone,
  prompt-contract seed and long-running goal-mode prompt.
- The documents now consistently separate daemon-only authority mechanics from Agent Harness cognition:
  Review receives the approved human contract and inspectable reality, challenges PlanExec independently and
  returns a Review Direction Memo plus minimal semantic lifecycle conclusion. IDs, phase/round, budgets,
  receipts, manifests, recovery state and field-completion requirements remain daemon-only.
- Added `NTH-TD-022` as the explicit future implementation slice. Its acceptance requires removing those
  mechanics from runtime context/tool obligations and proving, with golden data plus an independent judge, that
  Review can reject a locally plausible but conceptually wrong PlanExec route.
- Verification: cross-document residual scan, `npm run format:check` and `git diff --check` passed. `NTH-TD-021`
  remains the global top next action; `NTH-TD-022` is ready behind the documented decision.

## 2026-07-14 [Loop background semantic contract and scheduler hardening]

- Worked on: `NTH-TD-021`, `NTH-TD-022`.
- State changes: made Goals Card registration and phase runtime handling idempotent/fenced across native provider
  turn ids, execution generations and scheduler re-entry; a completed PlanExec now reliably re-arms scheduling
  for its independent Review. Provider silence remains `awaiting_provider`; no phase terminal timeout was
  reintroduced.
- Agent Harness boundary: live PlanExec/Review/blocked tools no longer expose goal/round/phase/run/call ids,
  acceptance matrices, failed-acceptance rows or retry/budget fields. The daemon binds those internally. Review
  first submits an independent assessment, receives PlanExec prose only afterward, and a retry Review receives
  the prior Direction Memo as semantic context.
- Quality repair: the independent Loop judge first failed because golden coverage did not reject skipped
  independent assessment, shallow Memo, budget-driven judgment or pass-budget consumption. Added four negative
  scenarios and semantic evaluator checks; the judge then passed with 19 scenarios.
- Evidence: deterministic daemon slice passed `5` files / `136` tests; Loop eval, independent judge, daemon
  build, web build, app test suite, foundation gate and `git diff --check` passed. Current real Codex UT-04 and
  UT-05 runs exercised semantic PlanExec/Review tools, linear all-pass and `continue -> retry -> pass` paths.
- Current limitation: browser/device proof for Background control actions, restart/reconnect and restored live
  phase timeline remains outstanding. `NTH-TD-021` stays the single top next action; `NTH-TD-022` is in progress
  with the core cognitive boundary implemented.

## 2026-07-15 [Explicit raw Provider versus Thoth entry]

- User decision: `Quick + Direct` is not an ordinary Clarify/Loop combination. It is the raw Provider/Paseo-like
  conversation state and needs a first-class Provider-adjacent Thoth switch. Thoth-on exposes `Clarify` and
  `Loop`; Thoth-off must not inherit a previously selected structured Clarify or Loop mode.
- Implementation: added optional durable `workspaceSecretary.enabled`; new/empty config resolves to direct,
  while legacy saved structured Clarify/Loop values remain enabled. The app's effective Workspace Secretary
  composer model becomes `quick + none + no loop` whenever off. Daemon snapshot projection applies the same
  rule, so stale persisted `Loop + Dive + Infinite` cannot be rendered or sent as structured work while off.
  Standard non-Secretary agent composer sends now use the normal provider-agent transport rather than the
  Workspace Secretary authority RPC.
- Verification: focused app controls/model tests `10/10`; protocol config test `4/4`; daemon persisted-config
  test `42/42`; Workspace Secretary session test `43/43`; `npm run build:web` completed successfully. A real
  Chromium pass on `8082` opened an existing workspace, confirmed the Provider-adjacent switch, toggled it
  `on -> off -> on`, observed both structured controls disappear while off and restore as `Loop Quick` /
  `Clarify Light` after re-enable, with no page error. The captures remain ignored under
  `.dev/ui-review-captures/`.
- Runtime refresh: the pre-existing `6688` daemon did not contain the new config field, so it was gracefully
  restarted as the current `npm run dev:daemon` process with the same `.dev/thoth-runtime/home`. The old
  unproxied `8082` static server was replaced by the documented `THOTH_DAEMON_PROXY_TARGET=127.0.0.1:6688`
  web serve process. Both `8082` and `6688/api/health` were rechecked after restart; Paseo `6767` was not
  inspected, stopped or reused.

## 2026-07-15 [One topic, one provider session]

- User decision recorded as `NTH-CD-053`: a Workspace Secretary tab/topic is one continuous foreground
  provider conversation. Thoth on/off is a per-turn harness overlay, not a `structured` / `bare` provider
  session type. Background PlanExec and Review remain separate only after a Loop handoff.
- Implementation: deleted the `structured` / `bare` discriminator from Workspace Secretary topic-agent keys
  and creation labels. Native-tool-capable topics now provision their stable Clarify tool catalog on the single
  provider session even if the first turn is raw; raw turns retain an unwrapped provider prompt.
- Safety: added a provider-neutral daemon turn-policy fence for Workspace Secretary authority tools. A raw
  turn rejects remembered runtime-tool calls before authority parsing or timeline mutation. The fence is bound
  to the active run generation and provider-native turn id when supplied, so stale calls cannot advance a new
  structured turn. Historical dual mappings reconcile to one canonical mapping and prefer the old structured
  agent for its existing Clarify context.
- Verification: daemon focused tests passed `60/60`; app Thoth-control tests passed `10/10`; `npm run build:daemon`,
  `npm run build:web`, `npm run format:check`, `npm run check:foundation` and `git diff --check` passed. Thoth was
  restarted on `127.0.0.1:6688` and `/api/health` returned `status=ok`; the real Chromium page at `8082` rendered
  without console/page errors. No provider prompt was sent during this smoke, so the live same-native-thread
  sequence remains a deliberate user-interaction check rather than fabricated real-provider evidence. No
  Paseo/legacy service was touched.

## 2026-07-15 [Clarify Dive transparent water chamber]

- User-visible request: make the full `Dive` Clarify menu row feel like a transparent, thick-edged glass chamber
  filled almost to the top with flowing seawater, with the `Dive` lettering visibly submerged and refracted.
- Rejected exploration: an original 21-frame opaque pixel-wave atlas passed its technical checks but looked like
  a pasted texture in the real menu. The atlas, native poster and forced foam-white label were removed rather
  than retained as a fallback.
- Current implementation: the row is now a genuinely transparent layered material. A double-edged glass chamber
  surrounds two independently deforming water bodies whose surface stays near the top. The semantic menu label
  remains present but visually hidden; a dedicated submerged SVG label uses `feTurbulence` and
  `feDisplacementMap`, plus a dark refracted edge and bright transmitted face. Sparse bubbles, bottom depth and
  a separate glass reflection complete the volume. Selected and hovered rows animate slowly; press accelerates
  the fluid. Reduced-motion and native paths retain a static near-full glass state and readable submerged label.
- Visual refinement: shifted both water volumes from pale cyan to a saturated azure-to-cobalt jelly palette,
  centered `Light`, `Balanced` and `Dive` independently of the selected check, centered the submerged SVG word,
  and increased all three option labels to the theme `base` size. The final typography favors optical refraction
  over deformation: displacement was reduced to `0.9/1.6/2.2` for idle/active/pressed, turbulence frequency was
  lowered, and the word now combines deep-blue, cyan and milk-white offset faces. A dedicated front-glass optics
  layer adds a continuous top lens, side-wall refraction and bottom caustic instead of relying on a stronger blur.
- Full-volume refinement: moved both animated water contours from the upper `10-20%` band to a `0-3%` meniscus,
  made the native fallback `100%` full-height, and reduced the two azure volume layers to `0.07-0.27` alpha.
  The result keeps a saturated blue hue and bottom depth while transmitting substantially more of the underlying
  menu surface, so the row reads as a full transparent liquid-glass vessel rather than a partially filled button.
- Verification: focused RuntimeControls test passed `8/8`; the full App suite passed `324/324` files and
  `2725/2725` tests; `npm run build:web`, `npm run format:check`, `npm run check:foundation` and
  `git diff --check` passed. A real Chromium pass on `8082` observed both water layers, live interpolated
  `clip-path`, the SVG text filter, backdrop refraction and active animations, with no page or console errors.
  The optional App-wide typecheck remains red on broad pre-existing React DOM, fixture-schema, WebView and
  Unistyles typing debt and is not recorded as passing. Ignored captures remain under
  `.dev/ui-review-captures/clarify-dive-cinematic-wave-20260715/`.

## 2026-07-16 [Clarify Dive transmission-material refinement]

- Visual reference: inspected `olivierlarose/3d-distorted-glass-effect` through its public source endpoints after
  the local GitHub CLI credential and a direct clone were unavailable. The reference builds its effect from a
  fully transmissive, zero-roughness `MeshTransmissionMaterial` with finite thickness, restrained IOR and
  chromatic aberration, then lets environment light and background content reveal the refraction. No source,
  model or asset from that repository was copied, and no Three.js/WebGL dependency was added to this 32px menu
  control.
- Implementation: added a separate SVG displacement map to the Dive chamber's real CSS `backdrop-filter`, with
  stronger glass displacement than the submerged word. Reduced the full-volume azure layers to a very light
  medium tint, moved perceived depth into thick side walls, top lens reflections and a bottom caustic, and kept
  the existing semantic label, click target, selected check, reduced-motion behavior and native fallback.
- Browser evidence: Chromium on `8082` computed the transmission layer as
  `url("#thoth-dive-glass-refraction") blur(0.16px) saturate(1.18) contrast(1.035)`. The active glass displacement
  was `3.8` while text displacement remained `1.2`; the full menu capture showed a clear center with pale azure
  transmission and concentrated edge thickness. No page or console errors were observed. Captures and the
  machine-readable report remain ignored under `.dev/ui-review-captures/clarify-dive-cinematic-wave-20260715/`.
- Verification: focused RuntimeControls test passed `8/8`; the full App suite passed `324/324` files and
  `2725/2725` tests; `npm run build:web`, `npm run format:check`, `npm run check:foundation` and
  `git diff --check` passed. The App suite emitted two existing Vitest browser-context deprecation warnings but
  no failed tests.

## 2026-07-16 [Clarify Dive visible-refraction correction]

- User acceptance found that the transmission-material pass still had no perceptible refraction. Root cause:
  the SVG backdrop filter was active, but its source pixels were a nearly uniform menu background; the previous
  `1.2px` text displacement was also too weak to provide a recognizable optical reference.
- Replaced the text treatment with three clipped lens bands. The upper, middle and lower portions of `Dive` now
  refract in opposing horizontal directions, while a restrained secondary displacement and cyan/white spectral
  separation preserve a fluid surface. Hover/selected uses offsets of `-2.5`, `+3.4` and `-1.9` viewBox pixels;
  press increases the lens strength without making the full glyph randomly wavy.
- Chromium acceptance on `8082` captured the split contours at both native size and a `4x` pixel inspection.
  The SVG DOM and measured text boxes confirmed opposing slice positions, and the visible word remained centered
  and legible. No page or console errors were observed. The ignored evidence remains under
  `.dev/ui-review-captures/clarify-dive-cinematic-wave-20260715/`.
- Verification: focused RuntimeControls test `8/8`; full App suite `324/324` files and `2725/2725` tests;
  `npm run build:web`, `npm run format:check`, `npm run check:foundation` and `git diff --check` passed. The App
  suite retained two existing Vitest browser-context deprecation warnings and reported no failed tests.

## 2026-07-16 [Clarify Dive return to original menu]

- User rejected both the liquid-glass and visible-refraction directions and requested the original Dive menu
  presentation with only dynamic azure typography.
- Removed the full glass chamber, water volumes, SVG filters, clipped refraction bands, bubbles, optics and all
  related styles. Also removed the effect-only DropdownMenu background-overlay/forced-centering API and SVG test
  stubs, leaving no compatibility or dead rendering path behind.
- Added a single `DiveAzureLabel`: the standard-size menu label uses a slow deep-blue/cyan gradient on Web and a
  matching animated color interpolation on native. Reduced-motion Web keeps a static centered gradient. The
  trigger, menu row, selected check, spacing and hover background use the original DropdownMenu behavior.
- Chromium acceptance on `8082` measured the gradient background position moving from about `0%` to `88%` over
  `1.2s`, confirmed zero legacy glass nodes and observed no page or console errors. Ignored evidence is stored at
  `.dev/ui-review-captures/clarify-dive-text-20260716/`.
- Verification: focused RuntimeControls test `8/8`; full App suite `324/324` files and `2725/2725` tests;
  `npm run build:web`, `npm run format:check`, `npm run check:foundation` and `git diff --check` passed. The App
  suite retained two existing Vitest browser-context deprecation warnings and reported no failed tests.

## 2026-07-16 [Workspace Secretary per-send Quick/Loop hot switch]

- Reproduced the authority mismatch: one topic first used Quick foreground, then sent a new Loop request. The
  approval UI and daemon conflict check both depended on mutable `secretary.composer.mode`, so a late model or
  user control change could offer `accept_quick` for a Loop-owned Card and make registration fail.
- Added optional, backward-compatible `SecretaryTurnControls` to durable user turns and Task/Goal/Goals Cards.
  Daemon freezes the effective controls at send, binds every authority Card to that snapshot, ignores provider-
  supplied runtime mechanics, and reuses the snapshot for approval validation, Loop strength and restart handoff.
- Approval UI now treats the Card snapshot as authority and the live composer only as a legacy fallback. The
  current composer remains untouched after Quick/Loop approval, so user changes made for the next send survive.
- Added integration coverage for Quick -> Loop in one continuous provider session, a second switch back to Quick
  while the Loop Goals Card is pending, correct Light registration, foreground handoff and restart restoration.
  Component tests cover both Card/composer mismatch directions; persisted-config and protocol tests cover durable
  round trips and old records.
- Verification: daemon Workspace Secretary/persistence `91/91`; protocol `13/13`; focused App `33/33`; App unit
  `2706/2706`; App browser `20/20`; `npm run build:daemon`, `npm run build:web` and
  `npm run check:foundation` passed. The combined App multi-project command hung in Vitest's unit/browser
  orchestration twice; running the same unit and browser projects independently completed green. No Paseo/legacy
  service was touched. A read-only Chromium smoke loaded `8082` with HTTP `200` and no console/page errors; its
  ignored screenshot is under `.dev/ui-review-captures/workspace-secretary-hot-switch-20260716/`. No real-provider
  hot-switch conversation run is claimed by this entry.

## 2026-07-16 [Background handoff spinner and Review startup recovery]

- Live diagnosis separated two failures on task `loop-task-ee84025c-7293-4ed4-98ce-f7f09e77c435`. Its Secretary
  topic was durably `background_handoff + ready`, while the App had cleared that model ref on composer-mode change
  and reconstructed a false foreground spinner from retained running timeline items. Independently, G1 Review had
  never started: provider config parsing failed on an unclosed TOML table, so failed reviews correctly remained
  `0/1` even though old task code mislabeled the infrastructure error as blocked.
- Removed composer mode from Workspace Secretary runtime reset identity. Mode still updates the next-send/legacy
  approval preference, but cannot clear durable handoff state.
- Codex provider session isolation now keeps linked shared auth but snapshots writable config per session. Existing
  config symlinks migrate when an old phase is recovered. Generic Loop provider streams that throw before emitting
  an event now enter resumable `interrupted(provider_stream_error)` without consuming failed-Review budget.
- Added explicit Resume from blocked phase cursor and enabled the Background Tasks Resume button for blocked tasks.
  Review semantic `continue` / `reframe_current_goal` remains the only automatic retry path that consumes the
  failed-Review budget.
- Built daemon/web, passed focused daemon `86/86`, focused App `51/51`, foundation and diff/format gates. Restarted
  `6688` through its official RPC after confirming there were no running/queued background tasks; worker PID moved
  from `2742116` to `3647175`, health recovered and `6767` was untouched.
- Issued one real Resume for the affected task at revision 12. G1 Review passed, G2 PlanExec completed and G2 Review
  started automatically. New G2 PlanExec/Review config files are private regular files, the task lineage and all 11
  goals remain intact, and failed-Review usage is still `0/1`. The task remains live; no all-goals completion claim
  is made.

## 2026-07-16 [Background Loop Review Apply live stream recovery]

- Worked on: `NTH-TD-021`, `NTH-EV-036`, `NTH-EXP-024`.
- Diagnosis: the affected stopped task proved Provider approval was healthy: both Review `apply_patch` calls
  completed and reasoning continued. Background Tasks had loaded an internal phase snapshot, but the session's
  global `AgentManager` subscription correctly filtered the internal agent's later stream, so the App never saw
  `permission_resolved` and its 15-second waiter made the approval look frozen.
- Implementation: `Session` now installs one targeted subscription only for a Loop phase confirmed by
  `recoverPhaseAgent()`, reuses the ordinary stream/permission forwarding path, keeps internal state out of
  foreground agent updates, replaces the subscription on phase switch and releases it on cleanup. Added typed
  Loop service test stubs and a regression covering hidden-by-default behavior, foreground behavior, permission
  request/resolution, completed tools, later reasoning, idempotency, switching and cleanup.
- Deterministic verification: daemon `2` files / `249` tests and Background Tasks App `1` file / `13` tests
  passed; daemon/web builds, foundation, root format and `git diff --check` passed. The direct single-file `oxfmt`
  call was debug-only after the root format check identified `session.test.ts`; the rerun root gate passed.
- Runtime refresh: after confirming no `running` or `queued` tasks, `6688` was restarted through official RPC
  request `6c3d10ba-09e9-48e8-830d-f395fbd0fb77`; worker `3647175` was replaced and health returned `ok`.
  Web `8082` and relay health were rechecked. Port `6767` was not inspected, stopped or reused.
- Browser/Provider acceptance: a first throwaway task exposed two harness mistakes (queued Review mistaken for an
  active agent, then a missing `session.message` envelope unwrap) and later demonstrated a `70ms` scoped
  PlanExec resolution. A proof-as-product task was stopped after showing that independent Review correctly would
  not implement PlanExec's missing deliverable. A final PRNG contract task reproduced the intended independent
  Review-test shape. G4 Review sequences were `692 -> 694 -> 695 -> 697 -> 705`; the Apply card disappeared in
  `242ms`, the external `state_contract_probe.cpp` completed, later reasoning streamed and sealed workspace
  receipts stayed byte-identical. A second Review Apply resolved in `253ms`. Live agent-list probing found no
  internal phase leakage.
- Evidence: ignored bundle
  `.dev/ui-review-captures/loop-background-approval-20260716T094404Z/final-acceptance-report.json`, supporting
  WebSocket JSON, screenshots, daemon visibility probe and workspace receipts. Key screenshots were opened and
  inspected. Both throwaway tasks are `stopped`; authority has no `running`, `queued` or `awaiting_provider` task.
- Remaining: `NTH-TD-021` stays `doing` for real browser/device `budget_wait`, pause/resume/stop and daemon
  restart/reconnect restoration. This session closes only the viewed internal phase live permission/stream defect.

## 2026-07-16 [MVP beta release automation local acceptance]

- Worked on: `NTH-TD-007`, `NTH-CD-056`. Created the dedicated `release/mvp-actions` line from
  `dd3a768a`, fixed every root/workspace/nested package at `0.0.0-mvp-beta`, replaced internal `file:`
  dependencies with exact workspace semver and kept all packages private. The release workflow is branch-only,
  serial, nine-job automation that builds native macOS/Windows/Linux desktop packages, one dedicated-key signed
  Android APK, a GitHub-hosted server CLI tgz, updater manifests, source receipt and checksums before replacing
  only `v0.0.0-mvp-beta`.
- Packaging implementation: added a portable server CLI bundle that embeds built `@thoth/*` runtime packages
  and Clarify/Loop skills while leaving third-party native dependencies for target npm installation; added
  production Android signing injection that refuses missing release credentials; disabled commercial desktop
  signing/notarization for the MVP; set updater channel to beta and all product defaults to Relay v3 TLS at
  `relay.test.thoth.seeles.ai:443`.
- Local artifacts: final CLI tgz is `1416295` bytes with SHA-256
  `b76a84405128b8c381adf485978378b1315b574d70f6dffd2639e90da1887e59`; Android APK is `151915238`
  bytes with SHA-256 `f5d03a6f7bb62ebf95577c42621c34308e4820e2905b36c589a70012adebe9da`, package `sh.thoth`,
  APK Signature v2 and no microphone/overlay permission; Linux AppImage is `139651259` bytes with SHA-256
  `e44d33da8d40c6c9315c10386583c73a86d5a84ffa641c315297e5cde030eed3`. The matching unpacked desktop
  passed managed-daemon, bundled-CLI and terminal smoke. Local DEB/RPM assembly reached the external Electron
  Builder `fpm` download and was stopped by a GitHub CDN timeout; native Actions remains the authority for those
  two packages.
- Verification: release contract, format, foundation, daemon/web builds, App `323/323` files and `2708/2708`
  tests, daemon `229` passed files / `3165` passed tests, desktop `28` passed files / `196` passed tests and CLI
  `40/40` E2E files all passed. The final tgz was installed globally in an isolated prefix and passed version,
  runtime-skill, provider-catalog and daemon start/status/stop checks. Hosted Relay v3 encrypted traffic passed
  repeatedly after fixing a real listener-order race and isolating the live test from this host's unavailable
  IPv6 route.
- Remaining release authority: no GitHub branch, tag, Secret or Release mutation is claimed by this local entry.
  Royalvice repo-local authentication, guarded branch pushes, all native Actions jobs, downloaded-asset
  revalidation and proof that `main`/archive releases stayed unchanged remain required before `NTH-TD-007` can
  become verified.

## 2026-07-17 [MVP beta remote release and downloaded-asset acceptance]

- Worked on: `NTH-TD-007`, `NTH-MS-006`, `NTH-EV-037`, `NTH-EXP-026`. Authenticated as Royalvice through the
  ignored repo-local gh config, set the four Android signing Secrets without exposing values, guarded-pushed
  `agent/dev/mvp` to `dd3a768a` and created/pushed the dedicated `release/mvp-actions` line. Remote `main` stayed
  at `e74c6e0d` and the archive Release remained untouched.
- Iterated native GitHub Actions with retained failure evidence: run `29547536716` found protocol/Relay cold
  order; `29547906169` found missing explicit Electron initialization; `29548363865` found daemon/drivers/highlight,
  Android/highlight, Windows `oxfmt` and PowerShell `$HOME` issues; `29549799359` passed every job except Windows
  because npm/PowerShell rewrote electron-builder short config flags. Build-order and cross-platform command
  contracts now reject regressions for each cause.
- Run `29551530114` passed preflight, real Relay, server CLI plus three native CLI smokes, macOS arm64/x64,
  Windows arm64/x64, Linux x64 and signed universal Android. Publish created public prerelease Release
  `355463767`, tag target `aada0ca3`, with an exact 27-asset manifest and checksums. The repository has only this
  MVP prerelease plus `thoth-plugin-final-archive`.
- Re-downloaded the public AppImage, APK and CLI tgz through the Release endpoint and matched all three against
  `SHA256SUMS`. Extracted AppImage passed managed-daemon, bundled-CLI and terminal smoke. APK verified as
  `sh.thoth`, `0.0.0-mvp-beta`, four ABI, Signature v2 and no microphone/overlay permission. The tgz and exact
  GitHub URL both installed globally in isolated prefixes; version, runtime skills and daemon lifecycle passed,
  while npm registry lookup returned `E404` as intended.
- The tracked authority update marks `NTH-TD-007` and `NTH-MS-006` verified and restores `NTH-TD-021` as the one
  top next action. Its docs-only branch push must still pass the same workflow before handoff; no additional
  product or release-code change is included in that confirmation run.

## 2026-07-17 [Installed flow, branding and build-ID updater pre-release]

- Worked on: `NTH-TD-016`, `NTH-TD-007`, `NTH-CD-057`. Ordinary Agent composer turns now freeze Thoth controls
  per send and bind Clarify/Quick to the visible provider agent; daemon workspace identity overrides remote client
  cwd; internal agents remain limited to post-registration Loop phases.
- Replaced startup and native icon assets with transparent Thoth artwork and added corner/legacy-mark checks.
  Replaced the desktop `electron-updater`/rollout implementation with fixed-tag commit identity, streamed
  size/SHA-256 verification and native install strategies; added the equivalent signed-APK Android path and
  `MVP-UPDATE.json` generation.
- Local verification passed full App `325` files / `2728` tests and daemon `229` files / `3166` tests before the
  final review fixes; final protocol `343`, desktop `171`, focused App `49`, foundation, daemon/web builds, release
  contract, brand contract and diff checks passed. A signed `sh.thoth` APK and Linux AppImage were built; the APK
  has Signature v2, update-install permission and no microphone/overlay permission, while `app.asar` contains both
  runtime skills and no legacy Paseo mark.
- Review caught and fixed Linux DEB/AppImage asset selection, cross-filesystem AppImage replacement and Android
  updater leakage into the Web bundle. Exported Chromium startup shows the new Thoth mark. The old Metro update
  E2E remains a recorded `page.goto` timeout and is not acceptance evidence. Remote workflow/Release replacement
  is still pending and no new public Release success is claimed by this entry.

## 2026-07-17 [Installed flow replacement Release acceptance]

- GitHub Actions run `29571377829` passed all jobs and replaced the sole `v0.0.0-mvp-beta` prerelease at commit
  `3ff79cad`. Real Relay, three-OS server CLI smokes, macOS arm64/x64, Windows arm64/x64, Linux x64, signed Android
  and publish all completed successfully. Remote `main` and `thoth-plugin-final-archive` remained unchanged.
- The public Release contains `28` assets, including commit-authoritative `MVP-UPDATE.json`, `BUILD-SOURCE.txt`
  and `SHA256SUMS`. Re-downloaded AppImage, APK and CLI tgz matched public checksums. APK package/signature/update
  permission/forbidden-permission checks passed; extracted AppImage has the exact build commit, both runtime
  skills, the new updater and no old Paseo mark.
- `NTH-EV-038` records packaging and public Release verification. `NTH-TD-016` remains doing because a real
  installed Relay client still needs to exercise provider-backed Clarify/Loop from this replacement build. The
  legacy installed updater requires one manual migration install; no false in-place upgrade claim is made.

## 2026-07-18 [Fast packaged Product API Journey]

- Replaced duplicated packaged Card/Loop orchestration with reusable `ThothApiJourney`: one visible Agent runs
  raw -> Quick Clarify -> raw -> Loop, keeps one provider session, hands Loop to background, consumes exactly one
  failed Review and reaches done. The Journey depends only on the public client API; AppImage and provider setup
  remain replaceable adapters.
- Fixed the Loop scheduler test double for the provider-neutral runtime-session identity contract. Focused daemon
  typecheck, six provider/Loop files (`283/283`), public foreground API E2E (`5/5`) and diff hygiene passed.
- Incremental runtime/AppImage packaging took `75.270s`. The rebuilt AppImage passed the scripted external-harness
  Journey in `14.792s` and the identical real-Codex Journey in `196.341s`; both mounted packaged Clarify/Loop
  skills, used the bundled daemon and completed fail -> retry -> pass. Probe logs contain no read-only SQLite or
  catalog/feature/command control-session error.
- Added `npm run accept:thoth:api` and documented the extension boundary in `docs/testing.md`. Final release work
  still requires Relay, controls/restart, full gates, branch push, Actions replacement and public-download
  repetition; no commit, push or Release mutation occurred in this slice.
- Final installed UI canary found and fixed two renderer-only authority projection defects: Clarify submitted the
  nested question-form ID instead of the daemon Card ID, and Task/Goals Cards omitted frozen Quick/Loop controls.
  The ninth fresh AppImage state completed real UI Quick and Loop approval, foreground handoff and a two-goal
  background task to `done`; evidence remains ignored under `.dev/real-appimage/ui-canary-ninth/`.
- Final local preflight passed full App (`324` files / `2673` tests), daemon (`230` passed files / `3123` passed
  tests), foreground public API (`5/5`), desktop (`26` passed files / `171` tests) and CLI (`40/40`) suites, plus
  release contract, brand contract, foundation, Web/runtime/AppImage builds and diff hygiene. All three
  independent behavior gates passed: `judge:clarify:golden`, `judge:clarify:user-simulation` and
  `judge:loop:golden`.
- The first final judge run exposed two stale or incomplete eval assumptions. Clarify still required the source
  skill path even when executing from packaged `dist`; the check now accepts only the authoritative packaged
  `src|dist/runtime-skills` locations. Loop covered PlanExec permission denial but not Review permission denial,
  provider crashes or timeout. Provider-neutral positive and negative scenarios now prove those operational
  exits cannot fabricate a Review verdict or consume failed-Review budget.

## 2026-07-18 [Installed Thoth product path MVP Release replacement]

- Committed the installed product path as `94b25419` and the clean-checkout audit correction as `5f196637`, then
  fast-forwarded both `agent/dev/mvp` and `release/mvp-actions` using Royalvice repo-local GitHub credentials.
  Remote `main` stayed at `e74c6e0d`; no merge, npm publish or Relay deployment occurred.
- GitHub Actions run `29639444687` passed all jobs. Clean preflight, real Relay v3, three-OS server CLI install,
  macOS arm64/x64, Windows, Linux, signed Android and publish succeeded. The Linux job ran the packaged
  Clarify/Loop public API journey before artifact upload. An initial run `29639377394` failed safely before native
  jobs because the binary audit script's forbidden sentinel strings were self-detected; the scanner now has a
  two-file audit-only allowlist while product source remains zero-tolerance.
- Publish replaced only `v0.0.0-mvp-beta`. Public prerelease `356074788` has `28` assets and targets `5f196637`;
  `thoth-plugin-final-archive` remains untouched. Re-downloaded AppImage, APK and CLI tgz matched public
  `SHA256SUMS`, while `MVP-UPDATE.json` and `BUILD-SOURCE.txt` matched the release commit and workflow.
- The public AppImage repeated raw -> Quick -> raw -> Loop with one visible session, mounted packaged skills,
  consumed one failed Review and reached done. The public APK passed package/version, Signature v2 and permission
  checks. The exact GitHub one-line CLI URL installed into an isolated prefix and passed version, skill presence
  and daemon start/status/stop.

## 2026-07-19 [Durable Card suspension and continuation recovery]

- Reproduced the common root behind provider prose continuing under an open Card, five-hour Card answers doing
  nothing and Task approval failing to produce the next Goals Card: Card tools held a process-local Promise, and
  continuation launch returned once while the old provider generator still reported in flight.
- Replaced the waiter with a durable suspension boundary. Card creation parks and interrupts the provider turn;
  answer commits independently and ForegroundTurnCoordinator waits for actual run release before starting the
  next same-session turn. Parked provider-turn output remains fenced even after a new turn is active.
- Changed `Recommend` to submit the standard `recommend` answer immediately and projected `awaiting_card` as idle,
  removing the false provider spinner/stop state. No provider-name branch or old Workspace Secretary fallback was
  introduced.
- Focused authority/tool/fence tests passed `22/22`, public foreground E2E passed `5/5`, full daemon unit passed
  `3124/3124`, full App passed `2692/2692`, and App Card/state tests passed `12/12`. Daemon/Web builds,
  `check:foundation`, format and diff hygiene passed; full lint reported the existing warning-only baseline with
  zero errors. A final rebuilt AppImage passed the isolated Product API Journey with one visible session, nine
  foreground turns, three PlanExec, three Review, one failed-Review retry and background `done`.
- Committed the fix as `00b470a7`, fast-forwarded both `agent/dev/mvp` and `release/mvp-actions`, and completed
  GitHub Actions run `29683323966`. Preflight, real Relay, three-OS server CLI smokes, Linux, Windows, macOS
  x64/arm64, signed Android and publish all succeeded. The workflow replaced the sole
  `v0.0.0-mvp-beta` prerelease at commit `00b470a7`; the archive Release and `main` remained unchanged.

## 2026-07-19 [Startup brand geometry cleanup]

- Traced the remaining first-load Paseo silhouette to the Web-only startup shimmer, which embedded its own SVG
  mask while native startup already used `ThothLogo`. Replaced it with the shared transparent Thoth brand mark
  and retained only an opacity/brightness animation.
- Deleted all four archived feather brand images under `assets/icons/arcade-inventory/brand/`. Extended the brand
  gate with path, content-hash and embedded-vector checks, and extended packaged AppImage inspection to include
  Electron's external `resources/app-dist` renderer tree in addition to `app.asar`.
- Brand, format, Web build and diff checks passed. A fresh local AppImage contains the Thoth mark and none of the
  archived paths or old vector fingerprint; a clean isolated launch displayed the Thoth welcome mark. The Metro
  startup E2E remained blocked before app mount by its existing `import.meta` module error, and the transient
  startup frame completed before CDP attachment, so neither is overstated as screenshot evidence.
- Committed the cleanup as `b19191ba`, fast-forwarded both `agent/dev/mvp` and `release/mvp-actions`, and completed
  GitHub Actions run `29688512132`. All native/Relay/CLI jobs and publish passed; the fixed MVP prerelease now
  targets `b19191ba` with 28 assets. Public metadata and checksums agree, and the re-downloaded AppImage repeats
  the packaged old-logo absence checks. The archive Release and `main` remain unchanged.

## 2026-07-20 [PR #12 Windows Runtime Skill CRLF release]

- Reviewed and fenced PR `#12` at contributor commit `f2d442e5`, then verified its clean merge against current
  release `b19191ba`. Drivers, foundation, clean release runtime build, release/brand contracts and diff hygiene
  passed before publication.
- Merged through GitHub as two-parent commit `1b6c0164` and synchronized it into `agent/dev/mvp` as equivalent
  two-parent commit `544c0893`, preserving both contributor history and the dev-only release evidence lineage.
- GitHub Actions run `29724438993` passed every native, Relay, Android, CLI and publish job. Release `356572010`
  replaced the sole MVP prerelease with 28 assets at `1b6c0164`; `main`, npm, Relay deployment and the archive
  Release were untouched.
- Public Windows x64 ZIP, Linux AppImage and server CLI tgz matched `SHA256SUMS`; release metadata matched the
  merge commit and workflow. The Windows package's actual Clarify and Loop skills use CRLF and were both parsed
  successfully by the parser extracted from the same `app.asar`.

## 2026-07-20 [Simply Is First engineering constraint]

- Recorded user decision `NTH-CD-059` and requirement `NTH-REQ-019`: Thoth code development must implement the
  locked final architecture as real, independently verifiable modules rather than a simplified end-to-end
  substitute intended for later rewrite.
- Updated the root agent contract, core philosophy, engineering architecture and executable development guide.
  Rapid experiments now have to traverse the final production API, ownership boundary, state machine and product
  lifecycle; fixtures may replace external uncertainty but cannot create a second implementation path.
- Locked the failure posture: unmet acceptance values remain visible evidence to diagnose on the final path.
  Fallbacks, semantic downgrades, provider-specific business branches, hidden success rewrites and implicit
  architecture changes are forbidden. The existing top next action remains `NTH-TD-021`.

## 2026-07-21 [Workspace / Task authority and universal HarnessAdapter local acceptance]

- Worked on `NTH-TD-023`, `NTH-CD-060` and `NTH-EV-043`. Replaced session-shaped Thoth persistence with a global
  catalog plus one authority SQLite shard per Workspace, deduplicated RuntimeBundles, normalized Human Decision,
  Task/Goal/PhaseRun/ExecutionAttempt truth, Task Blackboard and structured same-Workspace `@Task` context.
- Moved provider execution behind the common drivers HarnessAdapter and generation-scoped ToolGateway. Codex,
  Claude Code, OpenCode, Pi and ACP traverse the same conformance journey; product orchestration no longer selects
  behavior by provider name. `.thoth/provider-sessions`, copied provider homes, legacy Loop RPCs and internal
  Agent phase authority are removed rather than retained as fallback.
- Repaired restart and control defects exposed by the final journey: restore the visible Agent before Card
  continuation, reattach dynamic tools on provider-thread resume, consume Pause at PlanExec commit, preserve
  Review-only controls, and make Stop aggregate ownership prevent canceled terminals from restoring an
  interrupted/running spinner.
- Replaced CLI process discovery with explicit ownership. CLI signals the supervisor PID, POSIX adapters signal
  their owned process group, Windows retains its platform implementation, and stop completion accepts owner-lock
  release. Two stale tests were realigned to prove owner-only signals and lifecycle shutdown with a deliberately
  stale PID lock; no `tree-kill` fallback was restored.
- Packaged acceptance passed twice: the final AppImage completed `13` hot-switch turns, migration, `@Task`, one
  failed Review retry, six `thoth.loop` receipts and Stop without an active execution at `6,428,194` durable
  bytes; real Codex kept one visible thread through `10` turns with six receipts at `9,412,373` bytes.
- The final server CLI tgz installed as a non-root user in `node:24-bookworm-slim` without `ps` and completed the
  same authority path over hosted Relay v3 + E2EE, including Card submission across daemon restart, reconnect,
  Pause/Resume, Stop, five PlanExec calls and five Review calls. No pairing credential entered evidence.
- Gates passed: adapter transports `583`, adapter lifecycle `5`, authority `30`, App Task surface `19`, full App
  `2688`, desktop `171`, CLI `40`, foundation `552`, AppImage/Relay package smokes, release/brand/secret/removed-path
  contracts, format/diff checks and all three independent Clarify/Loop judges.
- The first remote run `29836140383` failed safely in preflight before any native or publish job. The tracked
  packaged Relay smoke contains the literal removed-path sentinel solely to assert its absence; the clean checkout
  scanner correctly exposed that its audit-only allowlist had not been extended. The smoke was added to that
  narrow allowlist while product source remained zero-tolerance, and the tracked-state repository validation
  passed again. The existing public Release was untouched.
- The second run `29836687123` passed clean foundation, runtime build and App unit tests before daemon unit found
  a duplicate provider-termination integration test left under `packages/daemon`. Its detached-descendant
  assertion contradicted the new owner/process-group contract and the implementation had already moved to
  drivers. The daemon duplicate was deleted rather than weakened or restored with process scanning; the exact CI
  daemon command then passed `188` files / `2519` tests with `26` explicit skips. Publish again did not run.
- The implementation commit `6eda6f08` was pushed to `agent/dev/mvp` and fast-forwarded to
  `release/mvp-actions`. No tag or Release mutation is claimed yet. The sole top next action is to push the narrow
  preflight correction to both branches, wait for every native job and then revalidate the publicly downloaded
  fixed MVP assets.

## 2026-07-21 [Workspace / Task authority public MVP Release acceptance]

- Pushed the final audit correction as `9aa1367a` and removed the duplicate daemon-owned provider process test as
  `a705bbe8`; both `agent/dev/mvp` and `release/mvp-actions` reached the latter by normal fast-forward. Remote
  `main` remained `e74c6e0d`; npm and Relay deployment were untouched.
- GitHub Actions run `29837814594` passed preflight, Linux packaged Clarify/Loop acceptance, Windows, macOS
  x64/arm64, signed Android, server CLI, three native CLI install smokes, hosted Relay and publish. It replaced
  only `v0.0.0-mvp-beta` as public prerelease `357429846` with `28` assets at `a705bbe8`; the archive Release
  remained intact.
- Re-downloaded `BUILD-SOURCE.txt`, `MVP-UPDATE.json`, AppImage, APK and CLI tgz all matched public
  `SHA256SUMS`. The AppImage build identity is `a705bbe8` and its empty-home journey repeated `13` hot-switch
  turns, migration, structured `@Task`, one failed Review retry, six Loop receipts and Stop without an active
  execution at `6,382,454` durable bytes.
- The public CLI tgz repeated hosted Relay v3 + E2EE, Card continuation across daemon restart, reconnect,
  Pause/Resume, Stop, five PlanExec and five Review calls. Direct Cloudflare egress from this verifier was
  intermittent; the final pass used an ignored HTTP CONNECT tunnel below TLS, while Actions had already passed
  the same journey directly. The exact public URL also installed into a separate prefix and passed version plus
  daemon start/status/stop.
- The public APK is `sh.thoth` version `0.0.0-mvp-beta`, verifies with Signature v2, matches the fixed MVP signing
  certificate and requests neither microphone nor overlay permission. `NTH-EV-043` and `NTH-TD-023` are now
  verified; the sole top next action returns to the distinct `NTH-TD-021` browser/device evidence boundary.

## 2026-07-22 [Deletion-only Voice / Speech / Dictation retirement]

- Recorded `NTH-CD-062`, `NTH-REQ-022` and `NTH-AC-017`: this refactor line only deletes disabled, prohibited,
  duplicate or unreachable code, preserves valid behavior and the sole production path, and uses an affected
  source-level acceptance gate capped at five minutes.
- Completed `NTH-TD-025` without adding a replacement path. Removed retired media wire/client APIs,
  SpeechService/VoiceSession daemon lifecycle and configuration, speak-tool specialization, App dictation/voice
  UI/state/shortcuts/i18n/PCM tooling, microphone settings, and CLI media config/test scaffolding. Preserved text
  send/queue/cancel, task authority, provider streaming, generic tools, WebSocket/Relay/terminal/notification,
  config sanitation and explicit Android microphone-permission denial.
- Conservative non-overlapping statistics exclude every file shared with the concurrent Provider Control work:
  `103` files, `4,899` deletions, `172` additions, net `-4,727`; the combined worktree currently has `23`
  deleted files. This intentionally undercounts media deletion in mixed files.
- `NTH-EV-045` passed in two timed segments totaling `48.602s`: four relevant type boundaries, repository and
  residue guards, targeted formatting, diff hygiene and `805` affected tests all passed. No package, browser,
  Relay, real-provider or release smoke ran.
- Wider diagnostics were kept honest and not repaired in this deletion task: concurrent Provider Control work
  leaves one Client expectation failure, 22 Drivers native-Plan expectation failures, five daemon
  `task-orchestrator` type errors, one Session SQLite binding failure, App type drift and full-format failures in
  concurrent files. The global top next action remains `NTH-TD-024`; this session did not overwrite that work.

## 2026-07-22 [Deletion-only Core shadow and migration scaffold retirement]

- Completed `NTH-TD-026` without adding production code or a replacement path. Deleted the unreachable
  65-file Core source tree while retaining the formal package boundary and all active daemon/drivers sources.
- Removed nine false test placeholders, the Expo starter README and destructive reset command, the abandoned
  Code4Agent Relay mirror command, and false package skeleton/readiness statements. Runtime, wire, SDK, provider
  and UI behavior remain unchanged.
- The independent pre-slice diff is `83` files, `20,153` deletions, zero additions and net `-20,153`; the four
  additional `HEAD` deletions belong to the preceding App dictation README cleanup and are not counted twice.
- `NTH-EV-046` passed the bounded source gate in `36s`: structural and zero-reference guards, repository and MVP
  Release contracts, four foundation type boundaries and `447/447` affected tests passed. Targeted formatting
  and diff hygiene also passed; no package, browser, Relay, provider or release smoke ran.
- The known concurrent Client `providerControl: {}` expectation failure was excluded rather than repaired or
  hidden. Global top next action remains `NTH-TD-024`, and no other Provider Control worktree file was changed.

## 2026-07-22 [Provider-neutral native Plan and background approval authority]

- Completed `NTH-TD-024` through the sole Harness/Workspace authority path. Create/Send freeze provider Plan per
  turn independently of Thoth; Codex, Claude, OpenCode and capable ACP use native mode transitions, while Pi and
  non-Plan ACP remain honest unsupported.
- Loop PlanExec now runs native Plan -> durable Implement approval -> same-thread implementation -> semantic
  result -> independent Review. Fixed the legal continuation race where a provider can submit its semantic result
  while authority still projects `implementing`, before the queued `turn_started` event normalizes it to
  `awaiting_provider`; planning, stale segments, stopped generations and invalid attachments remain fenced.
- Added task-scoped execution approvals with 20-second deadlines, CAS/idempotency, explicit human or daemon actor,
  fake-clock timeout/restart behavior, Stop cancellation and shared Review/audit permission handling. Provider
  questions and Thoth Cards never enter this authority.
- Removed App `plan_mode` specialization, fixed the enabled-but-unsupported Plan switch so it can always turn off,
  added approval countdown/result UI, and repaired update recovery with typed `agent_not_found` plus atomic
  server/workspace-scoped stale-tab removal.
- Added `accept:provider-control:fast` and rebuilt `accept:thoth:fast` as one timed runner with a shared 300-second
  deadline and a static provider-neutral contract. Final runs passed in `37.556s` (`475` assertions) and
  `44.034s` (`502` assertions), respectively. Foundation passed `552` tests; Protocol/Client/Drivers/Daemon
  typechecks, formatting and diff hygiene passed.
- The full App typecheck still exposes its known broad React DOM/Unistyles/WebView debt; all new Provider Control
  fixture drift was fixed and affected App tests passed. No AppImage, Android, Relay, real provider, push, tag,
  npm publication or Release mutation occurred. Top next action returns to `NTH-TD-021`.

## 2026-07-22 [Deletion-only disconnected Paseo Task subsystem retirement]

- Completed `NTH-TD-027` without adding a replacement path. Deleted all seven files under
  `packages/daemon/src/tasks`: the file-backed Markdown TaskStore, Task graph/order logic and their self-only
  tests. The independent diff is `2,244` deletions, zero additions and net `-2,244`.
- Live Thoth scanning found zero consumers outside the directory. Latest upstream Paseo history showed the old
  Planner/Worker/Judge Task CLI was removed as unused in April 2026; only tests kept the lower-level files
  reachable. No public App, protocol, client, daemon-session or package command was removed from Thoth.
- `NTH-EV-048` passed the complete bounded gate in `30s`: structural/residue guards, repository and MVP Release
  contracts, foundation and Daemon typechecks, plus `16/16` focused tests for the surviving Workspace-sharded
  SQLite Task authority. Targeted formatting and diff hygiene passed afterward.
- No AppImage, native package, browser, Relay, provider or release smoke ran. Top next action remains
  `NTH-TD-021`; the newly verified `NTH-TD-024 / NTH-EV-047` Provider Control ledger was preserved.

## 2026-07-22 [Provider Control final Stop and approval-race hardening]

- Final review found that durable Stop projection was correct but a provider that confirmed interrupt without a
  later terminal could leave the Orchestrator ActivePhase, ToolGateway binding, heartbeat and Workspace ownership
  alive. Added an explicit Stop-settled scheduler callback that releases ephemeral ownership and reconsiders the
  next queued Task.
- Added a post-provider-await authority check before any approval continuation. Concurrent Stop, a changed current
  execution or an already accepted semantic result now prevents a stale follow-up segment from starting. Harness
  interrupt also retires pending approval bindings, and provider `mode` approvals retain their typed kind.
- Final `accept:provider-control:fast` passed in `42.143s` with `478` assertions; final `accept:thoth:fast` passed in
  `50.968s` with `506` assertions. The full public foreground suite passed `11/11`, and foundation passed all `552`
  tests. Protocol, Client, Drivers and Daemon typechecks passed independently after respecting Protocol build order.
- Full App typecheck was rerun diagnostically and remains red only on the known broad React DOM declarations,
  Unistyles/WebView typing and unrelated historical fixtures; affected App behavior passed `107/107`. No AppImage,
  Android, Relay, real provider, commit, push, tag, npm publication or Release mutation occurred. Top next action
  remains `NTH-TD-021`.

## 2026-07-22 [Foreground Queue, provider-neutral rewind and image preview recovery]

- Worked on `NTH-TD-028` / `NTH-AC-018`. Replaced App-local Queue and optimistic Timeline writes with a durable
  Workspace Queue, Queue-default migration, serialized Queue/Interrupt dispatch and CAS edit/delete/interrupt.
- Added canonical-message to opaque provider-anchor bindings across adapter contracts. Conversation/both rewind
  resets the Timeline epoch; deterministic legacy migration refuses ambiguous native histories.
- Replaced FilePane and assistant-image durable attachment copies with transient Blob/data URI sources, explicit
  URL release and immediate visibility resampling.
- Queue editing is now an in-place daemon command: text/raw prompt changes while attachments, Thoth/Plan and
  `@Task` snapshots remain frozen.
- `accept:interaction-regressions:fast` passed in `29.693s`; `accept:thoth:fast` passed in `81.357s` with all
  `12/12` public foreground journeys. Foundation passed `555` tests; daemon typecheck, Client build, Web export,
  formatting, secret/path validation and diff hygiene passed.
- Native Actions and public Release verification remain pending. No local AppImage, real-provider, Relay or long
  browser smoke ran, matching the approved bounded acceptance.
- Actions run `29919172438` stopped safely in preflight because two Cursor ACP catalog fixtures predated the
  provider-neutral `planCapability` receipt. Production returned the required honest unsupported result; the
  fixtures were updated to assert it before triggering a replacement run. The existing public Release was not
  modified by the failed run.
- Actions run `29919804667` passed the corrected adapter gate, then exposed four supervisor fixtures that still
  spread a deleted Voice-only `testEnv`. The residual spreads were removed rather than restoring retired media
  configuration; the failed run again left the public Release unchanged.
- Actions run `29920715971` passed preflight and all three native CLI install smokes. Its live Relay E2EE test
  passed, but the packaged journey rejected an empty native mode receipt because the scripted Codex transport
  still emitted an obsolete `{id,label}` collaboration-mode shape. The fixture now emits real Code/Plan modes,
  and the adapter discards malformed entries without a non-empty native name.
- Actions run `29922567878` passed preflight, live Relay E2EE and three native CLI smokes, then showed that the
  scripted provider still submitted PlanExec during the native Plan turn. The daemon correctly fenced that
  out-of-phase semantic call. The fixture now emits a native plan item, waits for daemon-owned Implement approval
  and submits PlanExec only from the same-thread implementation turn.
- Actions run `29924569966` verified the corrected packaged Relay journey and Windows build, but Linux AppImage
  retained a pre-Plan 60-second Loop wait budget. Three required 20-second human approval windows consume that
  entire budget before normal phase work. The packaged AppImage wait is now 120 seconds; the product's approval
  deadline remains exactly 20 seconds and is not bypassed or shortened.

## 2026-07-22 [Interaction regressions native release verification]

- GitHub Actions run `29926576540` completed successfully at release commit
  `0eff56c084f2a0980b754a2c47f9a1af0cc6e4a1`. Preflight, Linux packaged Clarify/Loop, Windows, macOS x64/arm64,
  signed Android, live Relay, server CLI and the Linux/macOS/Windows CLI install smokes all passed; publish then
  replaced the sole `v0.0.0-mvp-beta` prerelease.
- The public tag and Release both target `0eff56c0`. `BUILD-SOURCE.txt` and `MVP-UPDATE.json` identify the same
  commit and workflow `29926576540`; `SHA256SUMS` contains 27 assets. Re-downloaded AppImage, APK and server CLI
  tgz passed their released SHA-256 values.
- Static extraction of the downloaded AppImage verified bundled build identity `0eff56c0` and the shipped Queue,
  provider-neutral rewind anchor, Timeline epoch reset and transient image object-URL code. No second long smoke
  was run; the workflow's packaged Clarify/Loop product journey is the native runtime evidence.
- The archive Release remains present, remote `main` remains `e74c6e0d`, and no npm publication or Relay deploy
  occurred. `NTH-EV-049` and `NTH-TD-028` are verified; `NTH-TD-021` is restored as the sole top next action.

## 2026-07-22 [Agent-scoped native Plan, reliable archive and desktop-only Release]

- Implemented `NTH-CD-064` / `NTH-TD-029`: Provider Plan preference and capability now belong to each visible
  Agent. Workspace authority persists `default | plan` with CAS/idempotent commands; live Harness sessions publish
  native, unsupported or retryable unavailable capability. Composer sends freeze the Agent projection, and New
  Agent drafts start independently at Default.
- Moved Plan into the Provider settings sheet and removed the standalone Composer Plan switch. Codex native Plan
  assistant output is promoted to one durable canonical Plan item; the Implement permission references only a
  stable `planId`, and same-thread continuation preserves the Plan after approval or refresh.
- Reversed top-level and bulk tab close ordering. Agent layout is removed only after daemon archive succeeds;
  failed/partial closes retain their tabs. Archive mutation no longer hides the Agent optimistically while the RPC
  is pending.
- Removed Android self-update code and package-install permission. The MVP workflow no longer builds/publishes an
  APK and no longer copies server CLI into the public payload; server CLI install and Relay smokes remain internal.
  `MVP-UPDATE.json` now has exactly six preferred desktop assets.
- Final `accept:provider-plan-tabs:fast` passed in `24.971s`; full `accept:thoth:fast` passed in `101.927s`; foundation,
  daemon/web builds, Release/brand contracts and diff hygiene passed. Authenticated Codex `0.144.1` passed the real
  public Create/Get/Update/Send Plan-to-Implement journey in `18.17s` on one provider thread.
- Push, desktop native Actions and public Release replacement remain pending. No Android/AppImage local build, npm
  publication, Relay deployment or `main` mutation occurred.
- Commit `0fd3be4e` was pushed to both target branches. GitHub Actions run `29943126952` stopped in preflight before
  any native or publish job because two old test-only ManagedAgent constructors emitted an invalid new
  `providerControl` projection. The prior public Release remained untouched.
- Added the required `providerRunMode: default` and revision `0` to those fixtures without widening the wire schema.
  The exact daemon preflight suite then passed `187/187` files and `2405` tests (`26` skipped); the focused
  Plan/tab gate passed in `19.162s`, and Release-contract, formatting and diff checks passed. A replacement Actions
  run and public desktop-only asset verification remain pending.
- Replacement runs `29944547453` and `29946112486` passed full clean preflight but stopped in the hosted Relay
  packaged journey. Preserved failure authority proved this was not a slow approval: the first native Plan was
  durably present, while the Task was immediately interrupted as having no Plan. The provider's Implement request
  intentionally carried only stable `planId`; the provider-neutral `HostedHarnessAdapter` discarded it because it
  did not associate the preceding canonical Plan item with that approval.
- Bound Implement approvals to the execution's captured Plan and added a transport-neutral fallback continuation
  plus an id-only approval regression. Restored the Relay wait cap to `90s` and kept the new failure authority
  capture. Drivers typecheck and `accept:provider-control:fast` passed; a freshly packaged server CLI then completed
  the hosted Relay journey with Review fail/retry/pass, restart, Pause/Resume, Stop, six `thoth.loop` receipts and
  five PlanExec/five Review calls. Final `accept:thoth:fast` passed in `92.591s` and foundation passed. A clean
  replacement Actions run and public asset verification remain pending.

## 2026-07-22 [Desktop-only MVP Release final verification]

- GitHub Actions run `29949640876` completed successfully at final release commit
  `05775486ba72457f4c7f9506b217ca7c88ebd07a`. Preflight, Windows, Linux, macOS arm64/x64, Linux packaged
  Clarify/Loop, hosted Relay packaged Plan/Loop and the three internal server CLI install smokes all passed before
  publish; no Android job ran.
- Publish replaced the sole `v0.0.0-mvp-beta` prerelease in place. The tag and Release both target `05775486`;
  its `26` public assets are desktop packages or updater metadata only, with no APK, iOS package or server CLI tgz.
  `MVP-UPDATE.json` contains exactly the six preferred macOS, Windows and Linux installers.
- Re-downloaded metadata identifies workflow `29949640876` and commit `05775486`. The public
  `Thoth-x86_64.AppImage` SHA-256 is
  `32b7824a3457a5b8bf9c2d70b5f117cdb2c76fade026ae533f094e59ac8456c5`, matching both the manifest and
  `SHA256SUMS`; extraction confirmed the bundled build identity and captured-Plan/id-only Implement fix.
- `NTH-EV-050` and `NTH-TD-029` are verified. `thoth-plugin-final-archive` remains present, remote `main` remains
  `e74c6e0d`, and no npm publication or Relay deployment occurred. The sole top next action returns to
  `NTH-TD-021`; this documentation-only closeout does not push `release/mvp-actions` or trigger another publish.

## 2026-07-23 [Provider Plan restored to Provider Features]

- Recorded `NTH-CD-065` and completed `NTH-TD-030`: removed the standalone Provider `Run Mode` segmented section
  and restored Plan as the first row inside `Provider Features`, alongside provider-native features such as Fast.
- Preserved the final authority path. The Plan feature still calls the existing Agent-scoped
  `onSelectProviderRunMode(default | plan)` CAS path, retains native/unsupported/unavailable/retry projections and
  does not add global state, provider-specific logic, a Composer control or a second execution route.
- Strengthened the existing product contract to verify exact feature-list placement, Default/Plan toggle mapping
  and absence of the old standalone control. Final `accept:provider-plan-tabs:fast` passed in `18.441s`, covering `3`
  Protocol, `95` Codex adapter, `136` Agent authority and `18` App/archive tests plus the product contract.
- The real Web export passed and bundled `4415` modules. Full App typecheck remains red only on its known broad
  React DOM/Unistyles/WebView and unrelated fixture baseline; the changed Agent controls file has no type error.
  No AppImage/native packaging, provider run, push or Release mutation occurred. Top next action remains
  `NTH-TD-021`.

## 2026-07-23 [Final-architecture Cut 0 clean baseline verified]

- Created isolated branch `agent/refactor/final-architecture-50k` from clean commit `743e8d29` and froze the
  production baseline at `1,234` files, `308,531` physical LOC, `1,298,564` scanner tokens, `1,346,659` AST nodes,
  `5,057` non-type static import edges and `165` runtime dependency edges. No production business logic changed.
- Froze the sealed Release `05775486` catalog/authority SQLite fixture with semantic digest
  `74f79a53c1cae8d58dbedb7d57a553b8696170371a11650e2d70e91720f74d5f`, integrity/FK/entity checks and no
  WAL/SHM sidecars. It retains the authority/event rows that Cut 1 must migrate before deleting the duplicate
  `authority_events` path.
- Froze real Web desktop/mobile screenshots plus keyboard, focus, a11y and responsive transcripts; App performance
  uses seven fresh browser contexts, stable reconnect identity and CDP forced-GC heap. Daemon and response
  performance use seven independent processes/samples with explicit warmup and unchanged Mann-Whitney/MAD rules.
- Preserved two formal failures: the first gate expired at `300.011s` on remote-CFS Metro metadata waits; a
  lockfile/Node-keyed ignored local dependency stage reduced the same real `4415`-module export to `11.960s`. The
  next gate failed at `237.050s` because the original response probe used correlated same-process turns; unchanged
  source ranged from `13.50ms` to `16.94ms`, so the clean baseline was correctly regenerated with independent
  processes rather than weakening the statistical threshold.
- Final `npm run accept:refactor:fast` passed every source/storage/architecture, Foundation, runtime build, public
  behavior, real Web/Playwright, App, TUI and performance phase in `270.302s` under one shared `300s` deadline.
  The final response sample set retained a `30.86ms` outlier and still passed by its seven-sample median; no retry
  or hidden sample replacement occurred.
- `NTH-TD-031` / `NTH-EV-052` are verified. The sole top next action advances to `NTH-TD-032`: pure Core,
  Repository/UoW and lossless Release migration, with no dual read/write or old-store fallback. No AppImage,
  native package, real Provider, hosted Relay, push, tag, Release or publication ran, and reserved Paseo
  `127.0.0.1:6767` was not probed or modified.

## 2026-07-23 [Final-architecture Cut 1 Core and authority cutover verified]

- Promoted `@thoth/core` into the deterministic authority owner and switched Daemon Task, Execution, Card,
  HumanDecision and blackboard mutations to `transitionAuthority`. The normalized Workspace SQLite adapter now
  provides Repository/UoW, revision/CAS, Timeline and projection commits without a second authority path.
- Replaced constructor DDL and schema guessing with explicit schema creation/version validation. Release
  `05775486` migrates under a lock through copy/transform/integrity/FK/entity/digest/fsync/atomic activation;
  failure injection preserves old files. The canonical digest remained
  `74f79a53c1cae8d58dbedb7d57a553b8696170371a11650e2d70e91720f74d5f`.
- Deleted `authority_events`, old task/review/replan reducers, `task-identity.ts`, the old monolithic migration path
  and unused Daemon `openai` / `@anthropic-ai/sdk` dependencies. Consolidated Agent persistence into one UPSERT,
  reused one catalog routing cache and removed the duplicate AgentStorage cache; durable SQLite remains the sole
  authority.
- Preserved every failed exploration in `NTH-EXP-040`: repeated App performance failures, isolated Wrangler
  `401`, lazy chunk white screen/`process` error, `300.018s` timeout, over-dense `2821.44ms` daemon sampling,
  health p95 failure, `rsync 24`, response Mann-Whitney failures, the missing Core-test discovery and the
  redundant Agent locator write. No threshold, sample or feature was removed.
- The final complete gate explicitly ran Core `9/9` and passed in `245.631s`: static `3.133s`, Foundation
  `39.731s`, runtime build/Core tests `7.130s`, Daemon/real Web `16.235s`, behavior/visual/TUI `83.557s`, App
  performance `27.261s` and daemon/response performance `68.550s`. The real Web export contained `4416` modules;
  desktop and compact/mobile screenshot, keyboard, focus, a11y and responsive evidence remained equal.
- Final production metrics are `307,869` LOC (`-662`), `1,296,453` scanner tokens (`-2,111`), `1,343,037` AST
  nodes (`-3,622`), `5,053` static imports (`-4`) and `164` runtime dependency edges (`-1`). Performance medians
  are App interactive `1603.73ms`, daemon ready `2211.68ms`, idle RSS `472506368` bytes and local response
  overhead `14.0867ms`.
- `NTH-TD-032` / `NTH-EV-053` are verified. The sole top next action advances to `NTH-TD-033`: direct capability
  HarnessAdapters, one ExecutionService and ToolGateway, followed by deletion of the AgentClient/Session/Manager
  bridge stack. No AppImage, native package, real Provider, hosted Relay, push, tag, Release or publication ran;
  reserved Paseo `127.0.0.1:6767` was not probed or modified.

## 2026-07-24 [Final-architecture Cut 2 Provider Harness cutover verified]

- Replaced the AgentClient/AgentSession/AgentManager and Hosted Harness bridge stack with direct
  HarnessAdapter/HarnessThread contracts, one ExecutionService and one Workspace-owned ToolGateway. Foreground,
  background, PlanExec and Review now share that production path without a Provider-name branch or fallback.
- Converted Provider discovery to lightweight manifests plus cached dynamic Adapter loaders. Registry construction
  no longer imports or instantiates Provider implementations; explicit use, refresh/diagnostics, recovery or native
  session operations load only the requested Provider, and shutdown closes only loaded Adapters.
- Deleted the old manager, host, task/foreground fences, eager registry APIs, fake Agent Client and duplicate SDK
  contract. Added final-path Harness conformance for Plan capture/Implement approval, permissions/questions,
  replay/cursor, same-thread continuation and interrupt cleanup, plus architecture guards against every old path.
- Focused Daemon tests passed `337/337`, Drivers passed `256/256`, public Harness lifecycle passed `4/4`, and
  `accept:provider-control:fast` passed in `37.897s`. Drivers typecheck/build and Daemon typecheck also passed.
- Preserved the first complete-gate failure in `NTH-EXP-041`: the Welcome a11y capture ran before the existing
  sidebar authority empty state settled. The verifier now waits for that real state; no product UI, expected tree,
  screenshot threshold or behavior changed. The focused real-Web scorecard then passed `3/3`.
- Final `npm run accept:refactor:fast` passed in `238.109s` under one shared `300s` deadline, including Release
  migration, Foundation, real Web export, full public behavior, visual/keyboard/focus/a11y/responsive/TUI evidence
  and seven-sample App/daemon/response performance.
- Cumulative production metrics are `307,539` LOC (`-992`), `1,292,228` scanner tokens (`-6,336`), `1,341,884`
  AST nodes (`-4,775`), `5,035` static imports (`-22`) and `164` runtime dependency edges (`-1`) versus the clean
  baseline. Cut 2 independently reduced LOC by `330`, tokens by `4,225`, AST nodes by `1,153` and imports by `18`.
- `NTH-TD-033` / `NTH-EV-054` are verified. The sole top next action advances to `NTH-TD-034`: one Protocol Zod
  RPC Registry with derived Client facade and Daemon dispatch. No AppImage, native package, real Provider, hosted
  Relay, push, tag, Release or publication ran; reserved Paseo `127.0.0.1:6767` was not probed or modified.

## 2026-07-24 [Final-architecture Cut 3 single RPC Registry verified]

- Protocol now declares `131` inbound operations and `139` outbound response/event schemas through one Registry;
  the Session inbound/outbound union, shared error/version contract, request lookup and typed operation types are all derived from this
  source declaration. Binary file/terminal frames continue to be owned by an independent codec.
- The Client's `112` declarative methods share one typed broker; the old correlated request helpers, per-method response types
  and waiter predicates were removed. The Daemon's `131` handlers are compile-time covered by one mapped table, and the original `13` request
  switch/dispatch groups were removed; Runtime performs only Registry lookup and handler calls.
- Added evidence for requestId mismatches, `rpc_error -> DaemonRpcError`, disconnect waiter cleanup, protocol-version rejection and binary isolation;
  Protocol `351/351`, Client `119/119`, Session/Wire `133/133`, WebSocket `17/17` and public foreground
  `12/12` all passed. The Session test helper uses the real ToolGateway, and the WebSocket fixture uses an independent formal SQLite schema.
- `NTH-EXP-042` preserves the process of first-version token/import recovery, the ToolGateway fixture gap, shared schema-0 SQLite contamination,
  and the first full gate passing in `239.673s` while still producing an unsafe declaration-merging warning. The final typed
  constructor/facade brought Foundation lint to `0 warnings / 0 errors`, with no suppression or downgrade.
- Final `npm run accept:refactor:fast` passed within the shared `300s` deadline in `240.108s`, covering Release migration,
  Foundation, the real `4416`-module Web, public behavior, visual/interaction/TUI and seven-sample performance. App interactive median
  `1613.17ms`; Daemon ready `1813.53ms`, idle RSS `408375296` bytes; local response overhead `14.7321ms`.
- Cumulative production metrics are `306,055` LOC (`-2,476`), `1,289,741` tokens (`-8,823`), `1,338,845`
  AST nodes (`-7,814`), `5,034` imports (`-23`) and `164` runtime dependency edges (`-1`) relative to the clean
  baseline; Cut 3 independently reduced `1,484` LOC, `2,487` tokens, `3,039` AST nodes and `1` import.
- `NTH-TD-034` / `NTH-EV-055` verified; the sole top next action advances to `NTH-TD-035` App authority projection.
  AppImage/native package/real Provider/hosted Relay/push/tag/Release were not run; Paseo `6767` was untouched.

## 2026-07-24 [Feature-zero-loss 50k gate rebaseline]

- Recorded `NTH-CD-067`, `NTH-REQ-026` and `NTH-AC-021`: the remaining main-chain refactor uses compositional OOP,
  preserves the complete public/AgentTimeline/UX contract and must reach at least `50,000` production LOC removed
  before performance optimization.
- Added deferred `NTH-MS-019`; existing performance scripts/baselines and `NTH-TD-038` remain intact there. Added
  `NTH-TD-040` through `NTH-TD-042` and `NTH-EV-061` through `NTH-EV-063` for Provider, shell/terminal and residual
  convergence. The sole top next action remains `NTH-TD-035`.
- Removed only the three performance groups from `accept:refactor:fast`; the complete architecture/storage,
  Foundation/build, public behavior, real Web visual/interaction and TUI gate passed in `140.770s`. Source remains
  `306,055` production LOC and the Release digest remains unchanged.
- No production code, AppImage/native package, real Provider, hosted Relay, push, tag, Release or publication ran.

## 2026-07-24 [Cut 4 canonical AgentTimeline WIP]

- Began the atomic `NTH-TD-035` cut without committing an intermediate dual path. Protocol now owns
  `AgentTimelineEntry`; App added `AuthorityProjectionStore`, `DaemonProjectionService`, canonical cursor/epoch/page
  merge rules, QueryClient optimistic-message reconciliation and exhaustive Timeline ViewModel registries.
- The real Agent panel now consumes protocol-owned entries. Deleted production `types/stream.ts` and
  `session-stream-reducers.ts`; renamed the remaining React event attachment from misleading `SessionProvider` to
  `DaemonProjectionHost`. Older-page, live catch-up, gap/stale cursor, rewind and attachment presentation behavior
  now enter through the canonical projection path.
- Focused suites passed `130/130`; the complete App suite passed `2,573/2,573` across `330` files in `72.37s`; real
  Web export passed with `4,419` modules; Foundation passed with zero lint errors/warnings. The first Foundation run
  stopped at format check on seven changed files; root `npm run format` fixed them and the repeated gate passed.
- Current production metrics are `303,032` LOC (`-5,499` from clean baseline, `-3,023` from Cut 3), `1,294,387`
  tokens, `1,326,946` AST nodes, `5,035` imports and `164` runtime dependency edges. An attempted unsupported
  `metrics:refactor -- --json` option failed explicitly; the standard root script then produced these metrics.
- Cut 4 remains `[doing]`: the old Session entity/client/UI/query state store still has consumers, token/import
  metrics are not yet below the verified Cut 3 values, architecture guards and the complete shared gate have not
  run. No local commit was created. Next action remains `NTH-TD-035`: migrate those consumers to Projection,
  HostRuntime, QueryClient and UiPreferences, delete the old store, then run the full stage-4 gate.

## 2026-07-24 [Final-architecture Cut 4 App Projection verified]

- Completed the atomic `NTH-TD-035` cut. `AuthorityProjectionStore` and `DaemonProjectionService` now exclusively
  own Agent, Workspace, Thoth State and protocol-owned AgentTimeline projection; HostRuntime owns Client/ServerInfo,
  QueryClient owns provider/Git/file and pending overlays, and UiPreferences owns local Agent/Terminal focus.
- Deleted Session Store and selector hooks, Session Context/workspace upserts, duplicate Timeline reducers and the
  third `StreamItem` model. App production scans found no old Store/model references, arbitrary authority setters,
  fallback, compatibility facade or dual write; the sole production projection writer remains
  `packages/app/src/projection/authority-projection.ts`.
- The complete App suite passed `331/331` files and `2,582/2,582` tests in `67.49s`; Foundation passed; real Expo
  Web bundled `4,418` modules; interaction regressions passed in `25.503s`; Provider Control passed in `36.825s`.
  Stage 4 architecture guards and the Release `05775486` semantic digest also passed.
- Final production metrics are `300,931` LOC, `1,278,968` scanner tokens, `1,319,295` AST nodes, `5,032` static
  imports and `164` runtime dependency edges. Relative to clean baseline the reductions are `7,600 / 19,596 /
27,364 / 25 / 1`; relative to Cut 3 they are `5,124 / 10,773 / 19,550 / 2 / 0`.
- `npm run accept:refactor:fast` passed Stage 4 in `144.145s` under one shared `300s` deadline, including real Web
  visual/keyboard/focus/a11y/responsive evidence and the OpenTUI fixed frame. `NTH-EV-056` is verified; the
  `-12,000` Cut A budget was not reached and the final `-50,000` target remains open. The sole top next action is
  `NTH-TD-036`, shared Timeline/ViewModel/responsive UI convergence.
- No AppImage, native package, real Provider, hosted Relay final journey, GitHub Actions, push, tag, Release or
  publication ran, and Paseo `127.0.0.1:6767` was not probed or modified.

## 2026-07-24 [Final-architecture Cut 5 shared UI started]

- Began `NTH-TD-036` from clean commit `7430e080`. The independent hard target is production LOC
  `300,931 -> <=280,931`; Stage 4 baseline tokens/AST/imports are `1,278,968 / 1,319,295 / 5,032` and runtime
  dependencies are `164`.
- Scope is restricted to final AgentTimeline/tool registries and App presentation composition. Public behavior,
  wire/data authority, Provider/VCS semantics, visual/keyboard/focus/a11y behavior and the App
  `331 files / 2,582 tests` floor remain locked. No intermediate commit will be created.

## 2026-07-24 [Final-architecture Cut 5 UI-only budget conflict exposed]

- Continued the existing atomic WIP without reset, stash, Stage switch or intermediate commit. Canonical Timeline
  rendering, Sidebar Workspace rows, Agent controls, Markdown base renderer, floating geometry, desktop/mobile Tab
  menu items/labels, stable descriptor maps, Bottom Sheet background, date buckets, tab-id normalization and dead
  private styles now each have one production owner.
- Latest production metrics are `296,353` LOC, `1,271,951` scanner tokens, `1,300,201` AST nodes, `4,991` static
  imports and `164` runtime dependency edges. Cut B has reduced `4,578 / 7,017 / 19,094 / 41 / 0`, but the
  independent `20,000`-LOC target still misses by `15,422`.
- Conservative reachability found `721/754` production candidates reachable and only `1,777` residual unreachable
  lines, all tied to behavior tests, platform declarations/stubs or test adapters. Structural clone convergence left
  one deliberate `94`-token Plan-vs-shared Markdown difference; no remaining presentation clone can support the
  requested gap without deleting semantics.
- Focused App runs passed `36`, `271`, `41`, `159`, `86` and `7` tests; root lint passed with `0` errors / `23`
  existing warnings; format and diff checks passed. Package Expo lint and direct App tsgo were debug-only red checks
  on existing config/type debt and are recorded in `NTH-EV-057`, not hidden or used as completion evidence.
- Per the locked failure contract, the complete gate was not run after the LOC failure, Stage remains 4,
  `NTH-TD-036` remains doing, `NTH-EV-057` remains unverified and no local commit was created. Continuing requires
  a user decision to expand the atomic architecture scope; Paseo `127.0.0.1:6767` was not probed or modified.

## 2026-07-24 [Refactor intermediate Beta promotion started]

- Recorded `NTH-CD-068`, `NTH-AC-022`, `NTH-TD-043` and WIP `NTH-EV-065`. The user authorized promotion of the
  current functional intermediate state without claiming Cut B `-20,000` or final `-50,000`; `NTH-TD-036` stays
  doing, `NTH-EV-057` stays unverified and Stage stays 4.
- Fresh remote guards match the approved transaction: development `2a97c312`, release `05775486`, main
  `e74c6e0d`; the root worktree is clean and the isolated GitHub identity is `Royalvice`.
- The sole top next action is temporarily `NTH-TD-043`. No local verification deadline, WIP commit, merge, push,
  Actions run, tag replacement or Release mutation has occurred yet.

## 2026-07-24 [Refactor intermediate Beta promotion stopped at first gate]

- Started the single local deadline at `2026-07-24T16:08:51.420Z`. `npm run accept:refactor:fast` failed in the
  first static phase after `0.597s`: the Stage 4 architecture guard still requires the deleted
  `packages/app/src/projection/timeline-view-model.ts` and therefore reports its Registry/all 11 kinds missing.
- Read-only diagnosis found the stale path assertions in `scripts/check-refactor-architecture.mjs`; the actual Cut
  B owner is `packages/app/src/agent-stream/timeline-view-registry.tsx` with exhaustive kind coverage and a
  dedicated test. `NTH-EXP-045` records why restoring the old file would violate the single-path architecture.
- Applied the approved fail-closed rule. No later suite, AppImage, Relay journey, benchmark, load test, TUI stress,
  commit, merge, push, Actions run, tag or Release mutation occurred. `NTH-TD-043` is blocked and remains the top
  action until the guard is corrected and a fresh full local attempt starts from the first gate.

## 2026-07-24 [Refactor intermediate Beta promotion retry authorized]

- The user explicitly authorized continuing `NTH-TD-043`. Changed only the architecture guard ownership:
  Stage 4 now requires the canonical `agent-stream/timeline-view-registry.tsx`, preserves the same 11 Timeline kind
  assertions and forbids the deleted projection ViewModel.
- `NTH-EXP-045` and the first `0.597s` failure remain recorded. No compatibility file, reduced expectation, Stage
  switch, commit, push or Release mutation was used to clear the blocker.
- `NTH-TD-043` returned to doing with no active blocker. The next action is a completely fresh local `3600s`
  attempt beginning at `accept:refactor:fast`; no result from the failed attempt will be reused.

## 2026-07-24 [Refactor intermediate Beta promotion retry stopped at full suites]

- The corrected single-Registry architecture passed the complete `accept:refactor:fast` gate in `144.240s`.
  Source remained `296,353` LOC; Release digest, Foundation, real Web, public behavior, visual/interaction and TUI
  contracts all passed.
- The exact App unit command then passed in `74.82s` with `330 files / 2,566 tests`, below the locked
  `331 / 2,582` floor. The unit project excludes two browser files containing 16 tests; the WIP has `332` total
  App test files, proving the command and all-project floor are inconsistent rather than authorizing lower coverage.
- The already-started full Daemon unit suite reported two `create_agent_request` Workspace failures before being
  interrupted. Per fail-closed rules no later suite, package, benchmark, stress, commit, merge, push, Actions or
  Release step ran. `NTH-EXP-046` records the command/floor mismatch and incomplete Daemon evidence.

## 2026-07-24 [Third Beta promotion attempt preparation started]

- The user approved the proposed complete App path. Recorded `NTH-CD-069`: release acceptance runs both Vitest
  projects through the default App suite and retains at least `331 files / 2,582 tests`; unit-only coverage is not
  accepted and no floor was reduced.
- `NTH-TD-043` returned to doing. The immediate action is to reproduce and repair the two Daemon Workspace
  creation failures, then run the complete App suite and begin a wholly new `3600s` release attempt.

## 2026-07-24 [Third Beta promotion preparation repaired]

- Reproduced the two Session failures as missing real ToolGateway fixture setup and repaired both; focused `2/2`
  passed. The complete Daemon suite then exposed 14 shared schema-0 notification failures, one legacy JSON Agent
  seed and one stale `clients` option. Migrated the fixtures to independent normalized schema-v2 authority homes,
  normalized Workspace Agent persistence and the current `adapters` boundary without changing production fallback.
- Complete Daemon unit passed `188/188 files`, `2,416` tests with `26` skipped. Complete default App passed
  `332/332 files` and `2,586/2,586` tests, including both browser projects. Daemon typecheck, root formatting and
  diff hygiene passed.
- These are preparation receipts only. The next action remains a fresh `3600s` attempt from the first refactor
  gate; neither prior failed release attempt contributes partial completion evidence.

## 2026-07-24 [Third Beta promotion attempt stopped at Desktop discovery]

- Started the fresh deadline at `2026-07-24T17:37:18.738Z`. `accept:refactor:fast` passed in `145.798s`; complete
  App passed `332/332 files` and `2,586/2,586` tests; complete Daemon passed `188/188 files`, `2,416` tests and
  `26` skipped.
- Desktop then failed during discovery after `5.11s`: `20` files / `110` tests passed, while seven files could not
  import Electron because its platform binary was not initialized under the repository's intentional
  `ignore-scripts=true` policy. `NTH-EXP-047` records the missed explicit `npm run setup:electron` prerequisite.
- Fail-closed execution stopped before CLI, release preflight, AppImage, Relay, benchmarks, load/TUI stress,
  commit, merge, push, Actions or Release mutation. The next action is explicit Electron setup plus a narrow
  Desktop preparation pass, followed by a wholly fresh local deadline.

## 2026-07-24 [Fourth Beta promotion preparation repaired]

- Ran the tracked `setup:electron` initializer without enabling global install scripts; complete Desktop passed
  `26` files plus one skipped and `171` tests plus four skipped.
- The first full CLI preparation run failed `5/40` because old fixtures created an `agents/` directory and the
  storage migration treated legitimate pairing/config identity metadata as prior authority. Removed the legacy
  helper directory and restricted fresh-home exceptions to five exact non-authority filenames; unknown/legacy
  storage still refuses startup. `NTH-EXP-048` preserves the diagnosis and rejected broad-ignore alternative.
- Migration passed `12/12`, the five debug-only targeted CLI files passed, and the formal complete CLI suite passed
  `40/40` in `184.1s`. No third-attempt receipt is reused. The next action is a new fourth `3600s` release attempt
  beginning at `accept:refactor:fast`.

## 2026-07-24 [Fourth Beta promotion attempt stopped at packaged migration]

- Started the fresh deadline at `2026-07-24T18:03:55.700Z`. Fast acceptance, App `332/2,586`, Daemon
  `188/2,417`, Desktop `26/171`, CLI `40/40`, foreground/adapters, Release contracts/runtime, all three judges and
  isolation passed. Paseo stayed independently owned on `6767`.
- Built a fresh `137,695,418`-byte AppImage. Its packaged daemon exited before readiness because the smoke still
  seeded removed pre-05775486 `agents/provider-sessions/agent-timeline` storage; the final migration correctly
  refused it. `NTH-EXP-049` records why production compatibility cannot be restored for this fixture.
- Stopped after `1,509s` before hosted Relay, benchmark/load/TUI stress, commit, merge, push, Actions or Release.
  The next action is to use the immutable Release `05775486` fixture in packaged acceptance, prove the journey
  narrowly, and only then begin another fresh full deadline.

## 2026-07-24 [Fifth Beta promotion preparation repaired]

- Replaced the packaged smoke's invented pre-floor storage with the immutable Release `05775486` catalog,
  authority and v1 marker. Assertions now verify v2 activation, exact locator/Timeline preservation, manual
  recovery backups and absence of `provider-sessions`; production migration behavior did not broaden.
- The narrow packaged journey passed with `13` hot-switch turns, Quick/Card/Loop, one failed Review retry, Stop,
  six visible sessions, `3` PlanExec and `3` Review submissions, two RuntimeBundles and Release data preservation.
- This preparation does not repair the fourth attempt retroactively. The next action is a new fifth `3600s`
  deadline from the first fast gate with a newly rebuilt AppImage.

## 2026-07-24 [Fifth Beta promotion attempt stopped at Server CLI dependency closure]

- Started the fresh deadline at `2026-07-24T18:34:30.529Z`. Fast acceptance, App `332/2,586`, Daemon
  `188/2,417`, Desktop `26/171`, CLI `40/40`, foreground/adapters, Release contracts/runtime, all three judges,
  isolation and a newly built complete AppImage journey passed.
- `accept:thoth:relay` failed before contacting the hosted Relay: the Server CLI packer omitted the Daemon runtime
  dependency `@thoth/core`, so its temporary install requested the private package from the public npm registry and
  received `404`. `NTH-EXP-050` records why Core must remain private, required and locally embedded.
- Stopped before hosted Relay evidence, benchmarks, App samples, 200-client Relay load, TUI stress, commit, merge,
  push, Actions or Release mutation. The next action is graph-derived private package closure plus narrow packaged
  Relay proof, followed by a wholly fresh sixth `3600s` attempt from the first gate.

## 2026-07-24 [Server CLI closure repaired; first narrow Relay preparation timed out]

- Replaced the seven-package Server CLI list with the runtime dependency closure from `@thoth/cli`. The Release
  contract reports eight private packages; package construction explicitly embedded Core and produced a
  `1,407,889`-byte ignored tgz without a public `@thoth/*` registry path.
- The first narrow hosted Relay run installed and started the bundle, then timed out on its paired data socket after
  five attempts. Control registration eventually connected; subsequent protocol-3 health and direct TLS probes
  passed. `NTH-EXP-051` preserves why these probes do not replace the E2EE journey.
- No sixth full deadline, benchmark, stress, commit, push, Actions or Release mutation started. One narrow Relay
  retry remains; another failure must stop as an external blocker.

## 2026-07-24 [Narrow hosted Relay retry passed]

- Reused the exact repaired Server CLI tgz for the one permitted retry. The hosted Relay v3 E2EE journey passed
  pairing, reconnect, Quick/Card/Loop, daemon restart with pending-Card restoration, Pause/Resume, Stop, six durable
  Loop attachments, five PlanExec calls and five Review calls without credential leakage.
- The first socket timeout remains `NTH-EXP-051`; the retry clears only the preparation blocker. No prior full-gate
  receipt is reused. The next action is a fresh sixth `3600s` deadline from `accept:refactor:fast`, including all
  performance/load/TUI stress phases before any commit or push.

## 2026-07-24 [Sixth Beta promotion attempt stopped at App performance]

- Started a new shared deadline at `2026-07-24T19:21:09.509Z`. Fast acceptance, App `332/2,586`, Daemon
  `188/2,417`, Desktop `26/171`, CLI `40/40`, public behavior, adapters, Release contracts/runtime, all judges,
  isolation, a newly rebuilt complete AppImage and a newly packed hosted Relay journey all passed.
- Seven-sample Daemon/response performance passed. App heap and Settings navigation improved, but Workspace first
  interactive regressed `1817.51ms -> 2085.29ms`, exceeded the `4.6%` tolerance and was statistically worse at
  `p=0.0003`. `NTH-EXP-052` preserves the full distribution and prohibits baseline/golden/sample changes.
- Fail-closed execution stopped after `1,627.201s`; 200-client Relay load, TUI stress, commit, merge, push, Actions,
  tag and Release mutation did not run. Top action remains `NTH-TD-043`, now blocked on no-UX-change Workspace
  interactive diagnosis and repair before any wholly new release deadline.

## 2026-07-25 [App first-interactive release blocker repaired]

- A clean `7430e080` Cut 4 comparison reproduced the Workspace regression at `2119.09ms`, proving the current Cut B
  UI WIP was not the cause. The fixed overhead came from applying the reconnect/resume `300ms` debounce to initial
  Projection hydration and then serializing Agent before Workspace refresh.
- Initial connection now hydrates immediately and Agent/Workspace refreshes concurrently. Reconnect, App resume,
  Timeline catch-up, the authority model, the Workspace ready marker and UX are unchanged. Focused tests passed
  `57/57`.
- Two independent one-warmup plus seven-sample real-Web runs passed the frozen performance contract at `1581.89ms`
  and `1581.91ms` medians, with exactly one Agent and Workspace fetch per context. Heap remained `46.7MiB` and
  Settings navigation passed.
- This is preparation only. The next action is a wholly new complete `3600s` release attempt from
  `accept:refactor:fast`; no sixth-attempt receipt is reusable and no commit, push or Release mutation occurred.

## 2026-07-25 [Seventh Beta promotion attempt stopped at non-hermetic Server CLI install]

- The fresh window passed fast acceptance, App `332/2,587`, Daemon `188/2,417`, Desktop `26/171`, CLI `40/40`,
  foreground/adapters, Release contracts/runtime, all judges, isolation and a new complete AppImage journey.
- Server CLI packaging resolved a manifest range beyond the root lockfile and exceeded `600s` while fetching the new
  Claude Agent SDK platform package. The attempt stopped before hosted product evidence, performance/load/TUI
  stress and every Git/Release mutation.
- External runtime dependencies are now pinned to exact root-lock versions and cache-preferred bounded fetches.
  Packaging completed in `14s`; the exact tgz passed hosted Relay on its one permitted retry after an initial
  external `1006` failure.
- `NTH-EXP-053` and `NTH-EXP-054` preserve both failures. The next action remains a wholly new complete `3600s`
  attempt from the first gate; seventh-attempt results are not reusable.

## 2026-07-25 [Eighth Beta promotion attempt invalidated by deadline orchestration]

- A wholly new run passed fast acceptance, complete App/Daemon/Desktop/CLI suites, public behavior, Provider
  transports, Release contracts/runtime, three judges, isolation, fresh AppImage, fresh Server CLI, hosted Relay,
  seven-sample Daemon/response performance and seven-sample App performance. The frozen App contract passed at
  `1590.0ms` Workspace interactive, `46.7MiB` heap and `211.8ms` Settings navigation.
- The `200`-client local Relay load established its encrypted clients, but was manually stopped after a UTC
  wall-clock estimate suggested the remaining window was too short. The approved contract requires one monotonic
  `3600s` deadline; separate shells did not preserve such a start value, so neither expiry nor completion was
  proven and the ten-minute load did not finish.
- `NTH-EXP-055` records the failure. No commit, merge, push, Actions, tag or Release mutation occurred. The next
  attempt starts from the first phase under one ignored `performance.now()` runner; all eighth-attempt green
  results remain preparation/failure evidence only.

## 2026-07-25 [Ninth Beta promotion attempt stopped at Clarify simulation provenance]

- The first single-process monotonic attempt passed fast acceptance in `153940ms`, App `332/2587`, Daemon
  `188/2417` with `26` skips, Desktop, CLI `40/40`, foreground/adapters, Release contracts/runtime and Clarify
  golden. The independent Clarify user-simulation judge then failed; the runner stopped at `890894ms` with all
  remaining stages and every Git/Release mutation untouched.
- Diagnosis found that simulated Task Cards omitted the required `convergence_review`; the broad packet validator
  had not applied the semantic tool schema. A second narrow judge exposed normalized fixture inputs that did not
  exactly match immutable verbatim provenance.
- Both Task Cards now carry schema-valid convergence evidence, every pre-Task user input exactly matches the
  transcript, and deterministic validation enforces both properties before the model judge. Targeted tests passed
  `6/6` and the independent judge passed. `NTH-EXP-056` preserves the failed attempt; the next action is a wholly
  new monotonic run from phase one.

## 2026-07-25 [Tenth Beta promotion attempt stopped at non-hermetic TUI stress]

- One monotonic process passed all stages through the local Relay load: fresh AppImage and hosted Relay journeys,
  frozen Daemon/App performance, and `200` E2EE clients for `600000ms` with `24000/24000` pongs, zero failures and
  `19/26/30ms` p50/p95/p99.
- TUI stress then failed after `2352116ms` because it expected a connected offer-ready frame while no process owned
  Thoth `6688`. The script had never started its required daemon; historical success depended on external dev state.
- The stress now starts a real source daemon on a reserved random port with isolated temporary home, drives the
  unchanged public CLI and cleans only its own process group. Narrow `72/96/132x34` all passed with safe connected
  frames. `NTH-EXP-057` preserves the failed full attempt; no commit, push, Actions, tag or Release mutation ran.

## 2026-07-25 [Eleventh Beta promotion local gate passed]

- The single-process monotonic runner completed all `23` phases with `ok=true` in `2336161ms`; fast acceptance
  stayed below its separate `300s` limit. App `332/2587`, Daemon `188/2417` plus `26` skips, Desktop, CLI `40/40`,
  foreground/adapters, three judges, Release contracts and isolation all passed.
- Fresh AppImage and fresh Server CLI/hosted Relay product journeys passed. Frozen Daemon/App performance passed;
  App Workspace interactive median was `1607.946ms`. The `200`-client Relay load completed `600000ms` with
  `24000/24000` pongs and zero failures; hermetic TUI stress passed all three widths.
- Format and diff hygiene passed. This is local evidence only: `NTH-TD-043` remains doing, Cut B remains doing and
  no commit, push, Actions, tag or Release mutation has occurred. Next action is the fresh remote drift guard,
  followed by the approved atomic commit and normal fast-forward transaction only if all SHAs remain frozen.

## 2026-07-25 [Exact-SHA Beta workflow blocked on Windows daemon startup]

- Created atomic source commit `fbc33f72435471534444e1f858647c3c5d427977`, normally fast-forwarded
  `agent/dev/mvp` and `release/mvp-actions`, and left `main` unchanged. Exact-SHA workflow `30157560990` completed
  with failure; the publish job was skipped, so fixed Beta `v0.0.0-mvp-beta` still targets `05775486` and retains
  its existing `26` assets.
- Preflight, Server CLI packaging, Ubuntu/macOS CLI smoke, Linux and both macOS Desktop builds, packaged AppImage
  journey and hosted Relay journey passed. Windows Server CLI smoke job `89678717333` and Windows Desktop job
  `89678617488` both failed when the shared CLI background-daemon start exited with code `1`.
- Read-only diagnosis confirmed the two jobs share `startLocalDaemonDetached`, but its ignored supervisor/worker
  stdio and absent `daemon.log` hide the specific exception. `NTH-EXP-058` records the proven common boundary and
  rejects guessing a root cause or rerunning unchanged.
- Updated `NTH-EV-065` as a failed release attempt and moved `NTH-TD-043` to blocked. This documentation-only
  closeout is pushed only to `agent/dev/mvp`; `release/mvp-actions` is not pushed again. The next action requires
  explicit user authorization to add Windows diagnostics, repair the proven root cause and trigger a new Release.

## 2026-07-25 [Windows blocker repair and re-release authorized]

- The user explicitly authorized determining whether the Cut caused the Windows failure, applying one unified
  repair and rerunning the fixed Beta replacement. Recorded this scope as `NTH-CD-070` and returned `NTH-TD-043`
  to doing.
- Compared old Beta `05775486`, Cut baseline `743e8d29`, Cut 1 commit `26855ab7` and published source `fbc33f72`.
  CLI detached launch, shared process spawn, supervisor and Windows workflow did not change; Cut 1 alone replaced
  storage migration and added parent-directory `fsync` before supervisor log initialization.
- The new `openSync(directory, "r")` durability call is unsupported by Windows Node and explains both Server CLI
  and bundled Desktop CLI exiting before `daemon.log` exists. The next action is one platform-correct storage
  durability policy plus focused fresh-home/migration and packaged Windows acceptance; no consumer-specific patch
  or relaxed readiness contract is allowed.

## 2026-07-25 [Windows Cut regression repaired and locally verified]

- Kept file `fsync`, atomic rename and migration rollback on every platform; centralized the only platform
  distinction in `fsyncDirectory`, which performs the additional parent-directory durability step on POSIX and
  skips the unsupported Node directory-handle operation on Windows. No CLI/Desktop branch or fallback was added.
- Storage migration passed `13/13` with simulated Windows fresh home and Release `05775486` migration; daemon
  typecheck passed. A built source CLI completed isolated cold start/ready/graceful stop on random port `37719`.
- The first full refactor gate stopped at `50.465s` on a stale ignored Web cache. After the formal cache-preparation
  script, a wholly fresh gate passed all stages with exit code `0` in `151.055s`; `NTH-EXP-059` preserves the first
  attempt.
- MVP Release contract passed. A fresh `1,408,855`-byte Server CLI package embedded eight private packages,
  installed `278` packages and completed packaged cold start/ready/graceful stop on random port `40457`.
- Next action: commit this final shared repair, normally push `agent/dev/mvp`, fast-forward and normally push
  `release/mvp-actions`, then require exact-SHA Windows Server CLI/Desktop jobs plus every other job to pass before
  the old fixed Beta is replaced.

## 2026-07-25 [First Windows durability repair failed native proof]

- Committed and normally pushed candidate `f50b9ea7` to both authorized branches. Exact-SHA workflow
  `30159851556` passed preflight, Server CLI package, Linux, both macOS builds, Ubuntu/macOS CLI smoke and hosted
  Relay; Windows CLI job `89684415529` and Desktop job `89684232206` failed at background daemon start. Publish
  skipped and the old fixed Beta stayed intact.
- The failure proved directory `fsync` was a real Cut bug but not the only one. Cut 1 also reopened the temporary
  file read-only before `fsyncSync`; Windows `FlushFileBuffers` requires write access. The second candidate uses
  `r+` without removing file flush, atomic rename or POSIX directory durability.
- Supervisor startup failures before worker logging now append to canonical `daemon.log`, so the existing CLI tail
  exposes the real exception on any further native failure. `daemon.log` is classified as non-authority metadata
  for fresh-home recovery.
- Focused storage and supervisor logging passed `21/21`; daemon typecheck passed. A wholly fresh complete refactor
  gate passed with exit code `0` in `149.010s`. `NTH-EXP-060` preserves the failed native proof. Next action is an
  atomic commit followed by a new guarded normal-push/exact-SHA workflow transaction.

## 2026-07-25 [Windows Cut regression closed and fixed Beta replaced]

- Committed the second shared durability/diagnostic repair as `198562296`, normally fast-forwarded both authorized
  branches and left `main` unchanged. Exact-SHA workflow `30160730623` passed preflight, Server CLI packaging,
  Windows/Linux/macOS CLI smoke, Windows/Linux/both macOS Desktop builds, packaged Linux Clarify/Loop, hosted Relay
  and publish.
- Native Windows proof closed both prior blockers: Server CLI job `89686668495` passed in `1m19s` and Desktop job
  `89686491510` passed in `7m29s`. The common repair keeps one storage/supervisor path; no consumer patch, fallback,
  readiness extension or disabled Windows coverage was introduced.
- The fixed prerelease and tag now target `198562296` and expose exactly `26` desktop-only assets. Downloaded
  metadata and the `137,691,148`-byte public AppImage matched their declared SHA-256; after restoring its executable
  bit, that public AppImage passed the complete Quick/Clarify/Loop/Review-retry/Stop/migration journey.
- `NTH-EXP-061` records the incomplete-download and executable-bit verification trap. `NTH-TD-043` / `NTH-EV-065`
  are verified. `NTH-TD-036` remains doing at Stage 4 with `296,374` production LOC and a `15,443`-LOC independent
  Cut B gap; it is restored as the sole global top next action.
- The documentation-only closeout commit `197ebdeb` was pushed only to `agent/dev/mvp`. An initial normal push
  failed before remote mutation because of a stale VS Code credential socket; the explicit repository-local
  isolated helper then completed the normal fast-forward. `NTH-EXP-062` preserves that operational trap, and the
  Release branch was not pushed again.

## 2026-07-25 [Installed App stale Agent tab regression diagnosed]

- The user supplied two installed-App screenshots where previously closed/archived sessions reappeared as tabs and
  clicking close emitted `Unknown agent ... requestType=archive_agent_request code=handler_error`.
- Source diagnosis found one shared class: persisted Workspace layout is rendered before current entity authority
  reconciliation, while the missing-Agent close policy explicitly falls back to destructive archive. The daemon is
  correct to reject the IDs; UI presentation state must not manufacture their authority.
- Created `NTH-REQ-027`, `NTH-AC-023`, `NTH-TD-044` and WIP `NTH-EV-066`; the sole top next action is temporarily
  `NTH-TD-044`. The final slice will authority-filter Agent/Terminal tabs, prune stale persistence and keep archive-
  before-layout only for known active top-level Agents before returning to `NTH-TD-036`.

## 2026-07-25 [Persisted entity tab regression locally closed]

- Added one authority-backed Workspace tab selector before all pane/tab/action derivation. Persisted missing,
  archived or cross-device-removed Agent tabs and stale Terminal tabs no longer render as actionable entities;
  existing reconciliation removes them from layout persistence and restores surviving split-pane focus.
- Unified close semantics through `executeCloseAgentTab` and authority-aware bulk classification. Missing,
  archived and subagent Agent targets plus stale Terminals clean layout only; a current unarchived root Agent still
  archives before cleanup, and cancel or a real archive failure retains the tab. Protocol and daemon semantics did
  not change.
- The initial red run failed `3/21` as expected. Focused tests passed `86/86`; complete App passed `2,591/2,591`;
  Foundation, real `4,423`-module Web export, interaction `23.337s` and Provider Control `35.272s` passed.
- The first shared gate exposed a stale inline-code static check after `113.948s`. `NTH-EXP-063` records the failure;
  the guard now verifies the final action owner, consumer delegation, authority-backed presentation and action-time
  bulk validation. The strengthened Plan/tab contract passed in `15.212s`, then the final fresh
  `accept:refactor:fast` passed every phase in `138.424s`.
- `NTH-TD-044` / `NTH-EV-066` are verified locally. Stage remains 4; source is `296,437` LOC and the independent
  Cut B gap is `15,506`. The sole top next action returns to `NTH-TD-036`. No commit, push, Release, Relay or Paseo
  mutation occurred.

## 2026-07-26 [Persisted entity-tab fixed Beta publication started]

- The user explicitly authorized committing and normally pushing the verified stale Agent/Terminal tab repair,
  fast-forwarding the Release automation branch to the same source and replacing `v0.0.0-mvp-beta` through the
  existing workflow. Recorded `NTH-CD-071`, `NTH-AC-024`, `NTH-TD-045` and WIP `NTH-EV-067`; the sole top next
  action is temporarily `NTH-TD-045`, while `NTH-TD-036` remains doing with its `15,506`-LOC gap unchanged.
- A fresh fetch found no remote drift: development remains `91eece5b`, Release remains `19856229` and `main`
  remains `e74c6e0d`. The Release branch is an ancestor of the current development HEAD, and the repository-local
  GitHub identity is `Royalvice`.
- Next action: rerun the focused stale-tab tests, strengthened provider-plan/tab contract, format and diff gates,
  then create one atomic source commit before any normal branch push or Release mutation.
- Fresh pre-commit verification passed: focused stale-tab coverage passed `86/86`; the strengthened Provider
  Plan/tab/desktop Release contract passed in `15.383s`; the Agent Project System validator, root format check and
  `git diff --check` passed. The candidate is ready for its atomic source commit.

## 2026-07-26 [Persisted entity-tab repair published and independently revalidated]

- Committed source `30528b814eff68eb63e2379e133aac6ee36d5fb4` and normally fast-forwarded both authorized
  branches. The first direct HTTPS push timed out without remote mutation; the repository-isolated Royalvice helper
  plus the known environment proxy completed the same normal pushes. `NTH-EXP-064` records the distinction between
  credential and network routing; no force push occurred.
- Exact-SHA workflow `30182942323` passed every job. Windows Server CLI `89743435398` and Windows Desktop
  `89743267999` passed, as did preflight, Linux/macOS CLI, Linux/macOS/Windows Desktop, packaged Linux product,
  hosted Relay and publish `89744032659`.
- The fixed prerelease and tag now target `30528b81` and expose exactly 26 desktop-only assets. Downloaded
  `BUILD-SOURCE.txt`, `MVP-UPDATE.json`, `SHA256SUMS` and the `137,695,255`-byte AppImage agree on the source and
  AppImage digest `bf529e760c009a2bc11cb9041e284b8c3b4ed065113b8b757116487c64e3bdfa`; extracted build identity matches.
- The checksum-verified public AppImage passed the complete packaged public API journey with Quick/Clarify,
  Loop/Review retry, Stop, Release migration, canonical Timeline and mounted Clarify/Loop RuntimeBundles. Remote
  `main`, independent Relay source/deployment and Paseo PID `3597831` on `127.0.0.1:6767` remain unchanged.
- `NTH-TD-045` / `NTH-EV-067` are verified. Stage remains 4; `NTH-TD-036` returns as the sole top next action with
  its `15,506`-LOC Cut B gap unchanged. This closeout will be pushed only to `agent/dev/mvp`; the Release branch
  stays on the published source commit to avoid a second release.

## 2026-07-26 [Engineering architecture and root agent contract rewritten]

- Replaced the 1,679-line cumulative engineering architecture with one 962-line Paseo-style current architecture:
  system overview, components, real 10-package module maps, authority/lifecycle, HarnessAdapter/RuntimeBundle/
  ToolGateway, Protocol Registry, Timeline/projection, data flows, storage, recovery, security, deployment and
  conformance now read in one direction instead of relying on a final superseding section.
- Rewrote root `AGENTS.md` as a stable 310-line repository contract. Dynamic branch, release, implementation and
  top-next-action truth now delegates to `project-index.md`; the durable mission, recovery order, package and
  authority ownership, single-path rules, commands, gates, ignored outputs, update discipline and escalation rules
  remain explicit.
- Preserved `NTH-CD-060/061/063/066/067`, the Workspace/Task authority split, native Plan receipt, daemon-owned
  Queue/Interrupt/Timeline, one Provider-neutral HarnessAdapter and the `6688`/reserved Paseo `6767` boundary. No
  product behavior, UX, Protocol, source package or current `NTH-TD-036` scope changed.
- `npm run format`, `npm run format:check`, `npm run validate:repo`, `git diff --check` and the complete
  `npm run check:foundation` passed. Foundation built and typechecked Highlight/Protocol/Relay/Client and passed
  `565/565` tests (`66 + 351 + 29 + 119`). No commit, push, Release, Relay deployment or Paseo mutation occurred.

## 2026-07-26 [All project documentation converged to English]

- Recorded `NTH-CD-072` and translated every remaining Chinese passage in repository guidance, `.agent-os`
  authority/evidence/design/source documents, `docs/` research, README content and runtime Markdown artifacts while
  preserving IDs, code, commands, schemas, hashes, URLs, protocol sentinels and historical pass/fail meaning.
- Renamed the canonical core-principles document to `core-design-principles.md`, updated every live reference and
  removed the stale localized README. The final inventory has 72 document paths backed by 61 physical non-symlink
  files, with no Han content, non-ASCII document path or localized `zh-*` filename.
- Added a tracked-plus-untracked documentation language/filename guard to `validate:repo`. Temporary negative probes
  proved that Han content and a non-English filename each fail with exit code `1`; both probes were removed, and the
  final positive repository validation passed.
- Independent Markdown-link traversal reported `DOCUMENT_LINKS_OK files=61`; stale-path, structural, format and diff
  checks passed. The complete Foundation gate passed lint/build/typecheck and `565/565` tests (`66 + 351 + 29 +
119`). `NTH-EV-068` is verified; `NTH-TD-036` remains the sole top next action. No commit, push, Release, Relay,
  Provider or Paseo mutation occurred.

## 2026-07-26 [Repository-local Paseo synchronization skill verified]

- Recorded `NTH-CD-073` and implemented the canonical
  `.agent-os/skills/sync-paseo-into-thoth` repository-maintenance skill with five stages: Recover and Pin, Assess
  and Plan, Integrate, Verify and Record, and explicitly authorized Publish and Reverify. A tracked
  `.codex/skills/sync-paseo-into-thoth` symlink provides repo-local discovery without copying the skill or writing
  a user-global Provider home.
- Added focused authority, classification, verification and Release references; exact-range, transplant-boundary
  and provenance helpers; root `paseo:*` command entries; and the permanent `test:skill:paseo-sync` fixture.
- The fixture passed its two-commit positive/negative matrix: Timeline/Terminal adaptation remained valid, Voice,
  legacy namespace, direct model API and App Provider SDK paths were blocked, complete provenance passed and two
  omitted commit classifications failed. Skill Creator validation reported `Skill is valid!`, and the real dirty
  worktree boundary audit reported no production violation.
- The first root format check identified seven new files; one debug-only targeted format command repaired only
  those files. The final repository validation, full format check, diff hygiene and complete Foundation gate passed
  with `565/565` tests (`66 + 351 + 29 + 119`). `NTH-TD-046` / `NTH-EV-069` are verified.
- No Paseo range or product source was synchronized and no commit, push, tag, Release, Relay, Provider or Paseo
  service mutation occurred. The sole top next action remains `NTH-TD-036`; future Paseo work starts by invoking
  `$sync-paseo-into-thoth` with an exact target or a request to resolve the official latest SHA.

## 2026-07-26 [Repository maintenance development-only push authorized]

- The user explicitly authorized committing every current non-ignored change and normally pushing only
  `agent/dev/mvp`. Recorded the exact boundary as `NTH-CD-074`; `release/mvp-actions`, `main`, tags, GitHub Release,
  release-workflow dispatch, package/store publication, Relay deployment and the independent Paseo service remain
  out of scope.
- The audited candidate contains the root architecture/agent-contract rewrite, English documentation convergence,
  the verified repository-local Paseo synchronization skill and their existing authority/evidence records. It has
  `31` tracked changed/deleted paths and `13` new paths; the largest new file is `13,197` bytes, the repo-local Codex
  discovery entry is one relative symlink, and the changed-file credential-pattern scan found no secret.
- A fresh authenticated fetch under the repository-local `Royalvice` identity found no remote drift: development
  is `2dd67d3ad40808cc2f56d6e10897f0865375a5b5`, Release automation is
  `30528b814eff68eb63e2379e133aac6ee36d5fb4`, and `main` is
  `e74c6e0de8a110d5e07249880d0e4e4f0ceab691`. The next action is the current formal skill, repository, format,
  Foundation and diff gates before any commit or normal push.
- Fresh pre-commit verification passed: `test:skill:paseo-sync`; the real `44`-path transplant-boundary audit with
  zero blocking or review findings; project-state validation; repository validation; format over `2,451` files;
  diff hygiene; and the complete Foundation lint/build/typecheck plus `565/565` tests (`66 + 351 + 29 + 119`).
  The first project-state validator invocation used unsupported optional arguments and exited `2`; the immediately
  corrected invocation used the helper's declared CLI and passed without any file mutation. The candidate is ready
  for one complete repository-maintenance commit and a normal development-branch push.

## 2026-07-26 [Repository maintenance batch pushed without Release]

- Committed all `44` audited paths as `ca71358aabb8fe03891ea24e57939d82547bcd21`
  (`chore(project): converge docs and add Paseo sync skill`) on `agent/dev/mvp`. The commit contains the complete
  architecture/root-contract rewrite, English documentation convergence, canonical repository-local Paseo skill,
  Codex discovery symlink, deterministic helpers and synchronized authority/evidence records.
- The first ordinary HTTPS push exited `128` before remote mutation because the inherited stale VS Code credential
  socket intercepted authentication, matching the existing `NTH-EXP-062` trap. After the GitHub API confirmed the
  development ref was still the audited old SHA, the repository-local isolated Royalvice helper and known
  environment proxy completed the exact same normal fast-forward; no force push, merge or history rewrite occurred.
- Remote verification reports `agent/dev/mvp=ca71358aabb8fe03891ea24e57939d82547bcd21`,
  `release/mvp-actions=30528b814eff68eb63e2379e133aac6ee36d5fb4`, and
  `main=e74c6e0de8a110d5e07249880d0e4e4f0ceab691`. Fixed tag `v0.0.0-mvp-beta` and Release
  `RE_kwDOSLNO4M4Vc63L` still target `30528b814eff68eb63e2379e133aac6ee36d5fb4` with the same creation and
  publication timestamps. No Release workflow was dispatched, no Release/tag was mutated, and no package, store,
  Relay, Provider or Paseo publication/service operation occurred.
- No Paseo commit range or product source was synchronized by this maintenance batch. Product Stage 4, production
  LOC, the `15,506`-LOC Cut B gap and the sole top next action `NTH-TD-036` remain unchanged.
- The first documentation-closeout `validate:repo` then exposed one tracked-index sequencing gap: the secret scan
  followed the committed Codex skill-discovery symlink into its target directory and failed with `EISDIR`.
  `NTH-EXP-065` records why the pre-commit scan did not see the untracked link. The scanner now classifies entries
  with `lstatSync` and reads only regular tracked files, preserving scans of every canonical skill file without
  copying or removing the discovery link. The repaired candidate requires the same repository and Foundation gates
  before its closeout commit and development-only push.
- Post-fix project-state validation, repository validation, format and diff hygiene passed with the link tracked.
  A fresh complete Foundation gate then passed lint/build/typecheck and all `565/565` tests
  (`66 + 351 + 29 + 119`). The closeout is ready for one normal fast-forward of `agent/dev/mvp`; all Release and
  independent-service boundaries remain unchanged.

## 2026-07-26 [Paseo architecture discussion gate verified]

- Recorded `NTH-CD-075`: Thoth's Paseo-derived origin is provenance, not a continuing structural merge contract.
  Future exact ranges are capability and engineering-intent inventories; local improvements land through current
  Thoth ownership, while architecture-level changes must be surfaced and decided before product-source edits.
- Kept the skill at exactly five stages and strengthened Stage 2 with an architecture review reference, mandatory
  `local/cross-layer/architectural` assessment, a structured discussion packet and a concrete `NTH-CD-*` decision
  gate. Stage 3 now explicitly reconstructs approved capabilities for current Thoth instead of preserving Paseo
  layout, patch shape or ownership for convenience.
- Upgraded exact-range manifests and classifications to schema version 2. The inspector emits conservative
  `review` and `required` architecture signals; provenance permits pending decisions only in analyze mode and blocks
  pending integration, missing discussion fields, required-candidate downclassification and candidate hiding in
  `ignored_commits`.
- The expanded fixture passed local adaptation, required architecture detection, pending analyze, approved decision
  and existing prohibited-boundary cases; pending integrate, downclassification, ignored candidates and incomplete
  coverage failed as intended. Independent Stage 2 forward-testing also stopped the hypothetical protocol/client/
  session rewrite while leaving the local terminal fix correctly classified. `NTH-EXP-066` preserves the initial
  over-broad forward-test that returned no result and was interrupted without writes.
- Skill validation, real-worktree boundary scanning, project/repository validation, formatting, diff hygiene and a
  fresh complete Foundation gate passed, including `565/565` tests (`66 + 351 + 29 + 119`). `NTH-TD-047` /
  `NTH-EV-070` are verified. No real Paseo range, product source, commit, push, tag, Release, deployment or service
  mutation occurred; the sole top next action remains `NTH-TD-036`.

## 2026-07-27 [Paseo v0.2.2 architecture review and provenance resolved]

- Reverified the official annotated `v0.2.2` tag through the repository-local `Royalvice` GitHub configuration and
  pinned the exact `5fc53c57..b589599a` range. The regenerated schema-version-2 manifest contains `393` commits,
  `1,475` paths, `143` architecture candidates, `43` required reviews and `24` excluded voice/audio paths; later
  Paseo `main` remains outside the range.
- Recorded `NTH-REQ-028`, `NTH-AC-025` and concrete architecture/publication decisions `NTH-CD-076` through
  `NTH-CD-088`. They preserve current Workspace/Task/HarnessAdapter ownership while approving selective
  Forge/Browser/Schedule/Timeline/Provider/Desktop/Files/App adaptation, persistent service-port leases and the
  fixed desktop-only Beta transaction; voice/Hub/website/legacy/distribution paths remain rejected and direct file
  editing remains deferred.
- Generated a coherent `14`-group classification under ignored artifacts. Eight two-parent merge commits have no
  independent combined diff and are explicitly retained as merge bookkeeping; no upstream path was fabricated.
  Formal provenance passed `393/393` commit coverage, `143/143` candidate assessment, all `43/43` required
  candidates architectural, zero pending reviews and zero failures.
- Fresh remote truth remains development `265c4af9`, Release automation `30528b81`, `main=e74c6e0d` and fixed
  prerelease id `359902667` at `30528b81` with `26` assets. Independent Paseo PID `3597831` still listens on
  `127.0.0.1:6767`; no product source, commit, push, Release or service mutation has occurred yet.
- `NTH-TD-048` is now the sole top next action and may enter product integration. `NTH-TD-036` remains doing at
  Stage 4; `NTH-CD-087` preserves its independent `15,506`-LOC gap through the measured `DeltaP` translation.

## 2026-07-27 [Paseo v0.2.2 organic integration reached local release readiness]

- Reconstructed the approved Forge/Workspace, Browser, Schedule, Timeline/subagent/idle, Provider portfolio,
  Host service-port/PID, Desktop/Terminal, read-only Files/Changes, and App/Mobile behavior through the canonical
  Protocol/Client/Core/Daemon/Drivers/App/Desktop/CLI owners. Voice/Hub/website/legacy authority/distribution and
  direct editing remain rejected or deferred; no second truth or compatibility router was added.
- Repaired Browser Host reconnect at three layers: the daemon Broker retains requests and affinity across stable
  logical `clientId` registrations, Client queues Browser responses across reconnect, and App coordinates scoped
  request IDs for at-most-once execution and delivery through the replacement Client. Focused Browser/reconnect
  tests passed, as did complete Client `125/125`, App `2,678/2,678`, and Daemon `2,511/2,511` suites.
- Fixed the packaged Browser/Schedule smoke race after renderer evidence showed Schedule navigation could consume a
  stale pre-turn `idle` and destroy the Browser socket. `NTH-EXP-068` records the positive running-then-idle fence;
  the rebuilt AppImage journey passed Browser, Files, Changes, Schedule, preload/renderer, schema-3 migration, and
  the complete 14-turn Thoth flow with `ok=true`.
- Preserved the first complete CLI failure: local Claude `2.1.159` correctly filtered version-gated Fable 5 while
  the test assumed a newest catalog. The deterministic Provider command override now probes `2.1.219` through the
  real daemon catalog and asserts all approved Claude 5 200K/1M entries. The formal rerun passed `30/30` unit tests
  and all `40/40` local/e2e files, including Workspace Schedule; `NTH-EXP-069` records the distinction.
- Current formal provenance passes `393/393` commit coverage, `143/143` candidate assessment, `43/43` required
  architectural candidates, zero pending reviews and zero failures. The current boundary report covers `367` paths with
  zero blocking/review findings. Skill fixtures, format, diff hygiene, typechecks, Protocol `435`, Drivers `590`,
  Client `125`, App `2,678`, Desktop `300`, Daemon `2,511`, and CLI suites passed.
- Root gates passed in order: Foundation with `655` tests; Provider Control `49.341s`; interaction regressions
  `28.870s`; complete Thoth `103.459s`; and the original shared-`300s` refactor gate `196.126s`, including real Web
  Playwright `3/3`, OpenTUI, architecture/storage/LOC contracts, and complete source behavior.
- Real Codex `UT-01-quick-direct-passthrough` passed in an isolated Workspace using existing official auth.
  `smoke:isolation` retained independent Paseo PID `3597831` on `6767` and no Thoth/legacy fallback. The Android
  Debug APK passed at `273,165,007` bytes with Thoth package `sh.thoth.debug` and no `RECORD_AUDIO`; it remains local
  only. The local AppImage is `137,793,946` bytes and passed the formal combined package/journey command.
- Production is `310,932` LOC, so approved `DeltaP=14,495`; translated Cut B/final ceilings are `295,426` /
  `273,026`, preserving the independent `15,506` gap. The candidate is locally `release_ready`, but `NTH-TD-048`
  and `NTH-EV-071` remain in progress until commit, two normal fast-forward pushes, exact-SHA workflow, fixed
  26-asset Release replacement, and downloaded public AppImage verification finish. No remote mutation occurred in
  this stage.

## 2026-07-28 [First Paseo v0.2.2 native Release attempt failed safely and corrective source verified]

- Created source `5e4007a995b2d8bff1e1d7e01c621aebf1b3eec3` and normally fast-forwarded both authorized branches. Exact-SHA
  workflow `30282306284` passed preflight, Server CLI, all three Server CLI install smokes and the real hosted Relay
  journey, but all four native Desktop jobs failed during their build-time packaged renderer smoke. Publish was
  skipped; the old fixed tag and 26-asset public Release remain intact at `30528b81`.
- GitHub logs and an isolated local packaged launch proved one common cause: App startup legitimately creates the
  Desktop-owned `desktop-attachments/` directory before starting the daemon, while storage v3 fresh-home detection
  did not classify it as non-authority and rejected the clean home as older than Release `05775486`.
- Added a retained-attachment characterization test, observed it fail `15/16` with the exact workflow error, and
  added only `desktop-attachments` to the non-authority allowlist. The focused suite then passed `16/16`; complete
  Daemon unit passed `196 files / 2,512 tests` with `26` skipped; Foundation passed `655` tests.
- The corrective AppImage is `137,794,211` bytes with SHA-256
  `66ab61916cf3314d26a912aa5a9f7e0d88c69e1686266b243d991b1b5e384dbb` and passed the complete real-window
  14-turn, schema-v3, Files/Changes, Browser and Schedule journey. The shared `accept:refactor:fast` gate passed in
  `152.842s` under its unchanged `300s` deadline.
- One production allowlist line changes approved `DeltaP` to `14,496` and mechanically translates Cut B/final
  ceilings to `295,427` / `273,027`; the independent `NTH-TD-036` gap remains exactly `15,506`. `NTH-TD-048` and
  `NTH-EV-071` remain in progress pending the corrective exact-SHA workflow and public-download verification.

## 2026-07-28 [Paseo v0.2.2 organic integration published and publicly reverified]

- Corrective source `cf5067fa3835c498f3842a5b2e371d4cb3b25577` remained the exact normal fast-forward target of both
  authorized branches. Exact-SHA workflow `30318942696` completed successfully: preflight `90150568849`, Server
  CLI `90151979969`, Windows Desktop `90151979991`, macOS arm64/x64 `90151980010` / `90151980011`, Linux Desktop
  and packaged journey `90151980014`, macOS/Windows/Linux CLI smokes `90152323567` / `90152323604` /
  `90152323625`, hosted Relay `90152323571`, and publish `90154089694` all passed.
- Fixed tag `v0.0.0-mvp-beta` and public prerelease `360786111` now target `cf5067fa`; the Release is
  `draft=false`, `prerelease=true`, and contains exactly 26 desktop-only assets with no APK, iOS, Server CLI, npm,
  Nix or Docker output.
- Fresh public `BUILD-SOURCE.txt`, `MVP-UPDATE.json`, `SHA256SUMS`, and `Thoth-x86_64.AppImage` downloads agree on
  source and workflow. The AppImage is `137,790,134` bytes with SHA-256
  `3dd624b9f8b506ef694f3d7fe689f78b61b541d22863b376745ca5141e995476`; GitHub metadata, the update manifest,
  checksum file, local digest and extracted `resources/build-identity.json` agree.
- The downloaded AppImage passed the complete formal product journey with `ok=true`: `14` hot-switch turns,
  schema-v3 migration, real Desktop renderer/preload, read-only Files, committed/uncommitted Changes, Browser
  list/new/snapshot/navigate/close with wrong-`browserId` rejection, and a succeeded Schedule with real Task and
  Execution receipts. Evidence remains ignored under
  `.dev/release-verification/cf5067fa3835c498f3842a5b2e371d4cb3b25577/`.
- Remote `main` remains `e74c6e0de8a110d5e07249880d0e4e4f0ceab691`; independent Relay source remains
  `317bcda46571ae0ae508f4d892759eff779d9d73` with protocol-3 health; Paseo remains PID `3597831` on
  `127.0.0.1:6767`; and official Paseo `v0.2.2` still resolves through tag object `4759a5ba` to `b589599a`. No
  Relay/Web deployment, npm/mobile/store/Nix/Docker publication or independent Paseo operation occurred.
- `NTH-EV-071` and `NTH-TD-048` are verified; terminal state is `published`. `NTH-TD-036` is again the sole top
  next action, remains doing at Stage 4 and retains exactly the independent `15,506`-LOC Cut B gap. This closeout
  is pushed only to `agent/dev/mvp`; `release/mvp-actions` stays at the published source to avoid a second Release.

## 2026-07-28 [Paseo v0.2.3 organic integration authority and provenance opened]

- Began approved `NTH-TD-049` in publish mode from clean development source
  `48e73cb24c022182c3c55fce1b171f9a5816ebc5`. The existing fixed Beta remains at published source
  `cf5067fa3835c498f3842a5b2e371d4cb3b25577`; `main` remains `e74c6e0d`, Release `360786111` is a non-draft
  prerelease with exactly 26 desktop-only assets, and workflow `314811076` is active.
- Official Paseo verification resolves annotated tag object `5f71b185` to `43cf858c`; v0.2.2 and v0.2.3 diverge
  at `36f38245`, so the exact inventory is the 36 target-side commits selected by
  `v0.2.2...v0.2.3 --right-only`. Current later Paseo `main=cbbf6c16` is excluded. The regenerated formal manifest
  reports 36 commits, 211 paths, 12 architecture candidates and four required reviews.
- A repository-local `git fetch` produced no response through the proxy and was interrupted after timeout; no
  success was claimed. The same isolated `Royalvice` identity returned live GitHub API receipts for all three
  branches, tag, Release, asset count and workflow. The tracked worktree remained clean before authority edits.
- Recorded `NTH-REQ-029`, `NTH-AC-026`, `NTH-TD-049`, `NTH-EV-072` and concrete decisions `NTH-CD-089` through
  `NTH-CD-096`. `NTH-TD-036` remains doing at Stage 4; the current production baseline is `310,933` LOC, translated
  Cut B/final ceilings are `295,427` / `273,027`, and its independent gap remains `15,506`.
- The coherent classification now uses publish intent; accepted/rejected architecture items reference their
  concrete decisions. `npm run paseo:verify-provenance` passed with `36/36` commit coverage, all `12/12`
  candidates assessed, all four required candidates represented architecturally, nine architectural coherent
  groups, zero pending reviews and zero failures. The architecture gate is cleared and product integration may
  begin through the recorded final Thoth paths.

## 2026-07-28 [Paseo v0.2.3 organic integration reached local release readiness]

- Reconstructed all approved capability groups through the current Thoth chain. The App now has one top-level
  `Tasks` entry with `Tasks | Schedules`; Schedule create/edit/pause/resume/run-now/delete, cadence/timezone/
  isolation/limits/history and both navigation directions use Workspace Schedule/Task/Execution authority.
  Workspace-script list/start/stop uses semantic Client, Workspace command policy, ToolGateway scope/generation
  fencing and durable process/terminal/route/service-port receipts. Protocol and storage changes are append-only
  and legacy Schedule runs preserve unknown execution Workspace as `null`.
- Physical sockets now own the 8 MiB high-water bound and 45-second application lease; negotiated binary E2EE and
  one-handle/revision 256 KiB file streaming land as one path. Strict registered/trusted-proxy authority is shared
  by HTTP and WebSocket. Provider usage/Claude scoped windows, OMP efforts and parent/child runtime residency are
  Driver-owned; Daemon remains provider-neutral. The App/Mobile/Desktop regression set and default persistent
  daemon behavior are integrated. Replaced start-only script RPCs, daemon Provider parsers and the old
  `background-tasks` route were deleted; voice/Hub/writable-editor/Paseo release paths remain absent.
- Focused/package verification passed: Protocol `49/438`, Relay `4/37`, Client `4/128`, Core `1/11`, Drivers
  `47 passed + 3 skipped files / 595 passed + 21 skipped tests`, Daemon `200 files / 2,556 passed + 26 skipped`,
  App `363/2,709`, Desktop `37 files / 300 passed + 5 skipped`, and CLI `30` unit plus `40/40` local/e2e files.
  All affected package typechecks passed. Root Foundation, Provider Control, interaction regression, complete
  Thoth and shared-`300s` refactor gates passed; the final refactor Stage 4 run completed in `158.934s`.
- Real Web UI acceptance passed `1/1` in `42.3s`, including real script start/stop and complete Schedule UI with
  two runs and bidirectional navigation. Android Debug APK passed at `273,165,007` bytes, package
  `sh.thoth.debug`, SHA-256 `042b2e4a...770702`, with no `RECORD_AUDIO`. Real Codex
  `UT-01-quick-direct-passthrough` passed in `28.82s`. Formal isolation retained Paseo PID `3597831` on `6767`
  and no Thoth fallback.
- The hosted Relay gate preserved a first reconnect failure caused by direct Cloudflare `ETIMEDOUT` after the
  service had already negotiated v3 E2EE and binary frames. Re-running the same packaged smoke with Node 24's
  explicit `NODE_USE_ENV_PROXY=1` support passed the full restart/recovery path and a `1,048,649`-byte, five-chunk
  file with SHA-256 `a3f78a20...f361e`; no Relay deployment occurred. `NTH-EXP-072` records the distinction.
- The complete AppImage command initially exposed proxy-contaminated localhost CDP, Tasks hydration/hit-testing,
  asynchronous Files content and a stale storage-v3 assertion. Each failure was retained and repaired without
  force-click, Client-only Schedule acceptance or weaker content checks. The final root command rebuilt a
  `137,822,489`-byte AppImage, SHA-256 `55691516...e177`, and passed preload/renderer, Files/Changes, Browser,
  Workspace scripts, five-chunk direct file transfer, full Schedule UI/navigation/Timeline and Release
  `05775486` migration to storage/SQLite v4. `NTH-EXP-071` records these sequencing rules.
- Current Skill fixtures, exact provenance and boundary pass: `36/36` commits, `12/12` candidates, nine
  architectural groups, zero pending/failures, and `222` changed paths with zero blocking/review findings.
  Production is `315,762` LOC, so `DeltaP23=4,829`; translated Cut B/final ceilings are `300,256` / `277,856`
  and the independent `NTH-TD-036` gap remains exactly `15,506`. `NTH-TD-049` remains the sole top next action and
  is not verified until the release-source SHA, exact-SHA workflow, 26 public assets and downloaded AppImage all
  pass. No commit, push, tag or Release mutation has occurred in this local stage.

## 2026-07-28 [Paseo v0.2.3 organic integration published and publicly reverified]

- Created atomic release-source commit `eaa1aa5fd44c64e97823fa441d04ad3c3bf772d1`
  (`feat: organically integrate Paseo v0.2.3`) and normally fast-forwarded both authorized branches to that exact
  SHA. The first development-branch push attempt omitted `THOTH_GH_CONFIG_DIR`, was rejected by the isolated helper
  and fell through to an unavailable editor askpass; the remote remained at the audited old SHA. The retry used
  explicit repository-local `Royalvice` credentials, disabled askpass and succeeded without force, merge or rebase.
- Exact-SHA workflow `30383055325` (`MVP Beta Release` workflow `314811076`, run `33`) completed successfully.
  Its 11 successful jobs were preflight `90355410082`; Linux Desktop `90358702132`; macOS x64/arm64
  `90358702193` / `90358702225`; Server CLI `90358702226`; Windows Desktop `90358702255`; Linux/macOS/Windows
  CLI smokes `90359273569` / `90359273597` / `90359273664`; hosted Relay `90359273593`; and publish
  `90361615180`.
- Fixed public prerelease `361273193` was published at `2026-07-28T17:54:55Z`. Direct tag
  `v0.0.0-mvp-beta`, Release target and `release/mvp-actions` resolve to `eaa1aa5f`; `draft=false`,
  `prerelease=true` and the Release contains exactly 26 desktop-only assets with no APK, iOS, public Server CLI,
  npm, Nix or Docker output.
- Fresh public downloads under ignored `.dev/release-verification/eaa1aa5f.../` agree on source and workflow.
  `BUILD-SOURCE.txt` is `89` bytes / `0af0b4e2...1eac`; `MVP-UPDATE.json` is `2,455` bytes /
  `b53db387...3fe4`; `SHA256SUMS` is `2,418` bytes / `c3f9d329...918d`; and `Thoth-x86_64.AppImage` is
  `137,822,613` bytes / `b287f036...2b21`. The checksum file, schema-1 update manifest and extracted
  `resources/build-identity.json` all identify `eaa1aa5f` and workflow `30383055325`.
- The freshly downloaded AppImage passed the complete formal real-window journey with exit code `0` and
  `ok=true`. Files/Changes, Browser plus typed wrong-ID rejection, Workspace-script UI start/stop, durable
  terminal/port receipts, a `1,048,649`-byte five-chunk direct file, full Schedule
  create/edit/pause/resume/run-now/delete, Schedule Timeline and both navigation directions passed through the
  public product.
- Final read-only GitHub closeout used repository-local `Royalvice` identity. One initial query batch omitted the
  config environment and exited `4` without mutation; the corrected batch passed with exit `0` and reconfirmed
  development/release branches, tag, Release, workflow, every job and unchanged `main=e74c6e0d`. Independent Relay
  source remains `317bcda46571ae0ae508f4d892759eff779d9d73` with protocol-3 health; Paseo tag object `5f71b185` still
  targets `43cf858c`; Paseo PID `3597831` still owns `127.0.0.1:6767`. No Relay/Web deployment, npm/mobile/store,
  Nix/Docker publication or Paseo operation occurred.
- `NTH-EV-072` and `NTH-TD-049` are verified; terminal state is `published`. `NTH-TD-036` is again the sole top
  next action, remains doing at Stage 4 and retains exactly the independent `15,506`-LOC Cut B gap. This
  evidence-only closeout is pushed only to `agent/dev/mvp`; `release/mvp-actions` stays at the published source to
  avoid a second Release.

## 2026-07-29 [Same-session native Plan and Provider-question decoupling opened]

- Began approved `NTH-TD-050` from clean `agent/dev/mvp@d801b8e9e1e200f65bd94532e537f673c7e9567b`.
- Recorded `NTH-REQ-030`, `NTH-AC-027`, `NTH-CD-097`, `NTH-CD-098` and WIP evidence `NTH-EV-073` before product
  source changes. `NTH-TD-036` remains doing at Stage 4 and will resume as the sole top action only after this
  correction is verified.
- The accepted boundary keeps one native Provider session for a visible Agent, treats prior Clarify use as normal
  session history, activates RuntimeBundles only on authorized turns, preserves Provider-native questions as
  structured interactions and permits Implement only from a completed native Plan item. No commit, push, Release
  or deployment is authorized in this workstream.

## 2026-07-29 [Same-session native Plan and Provider-question decoupling verified]

- Completed `NTH-TD-050` on the uncommitted baseline `d801b8e9`. RuntimeBundle activation is now turn-scoped;
  Codex uses one digest-verified native Skill block on Thoth turns and none on raw/native-Plan turns. A stable
  session tool catalog is fenced by current ToolGateway Workspace/Agent/provider-turn/generation/scope authority.
- Added the Provider-neutral Core interaction reducer, Protocol/Client question API, native completed-Plan events,
  Daemon-owned Implement CAS and schema-v5 interaction/Plan receipts. Removed session-level Clarify config truth,
  Driver synthetic Plan approval, assistant/progress/delta Plan synthesis, permission-shaped questions, header
  matching, comma splitting and first-option fallback.
- Same-thread Codex runtime-tool resume probe passed on thread
  `019fac44-d6c9-7db2-a4ab-2360c2414dbd` with one tool call before and after resume. Real daemon Codex Plan E2E
  passed `1/1` in `145.77s`, including Thoth Clarify, Thoth-off native question, completed Plan, Daemon Implement
  and `REAL_NATIVE_PLAN_IMPLEMENTED` on the same thread.
- The first real-Web launch exposed two test-infrastructure failures: a zero-file metadata fork created an empty
  `projects/` directory that storage migration correctly rejected, and Metro dev emitted raw `import.meta.env` in
  a classic bundle. The fork now creates no empty metadata directories. The formally required built-Web product
  path passed the real-provider UI spec `1/1` in `44.4s`, clicking Provider Features Plan, QuestionFormCard,
  PlanCard and Implement on native thread `019fad82-9d0f-7530-aa45-9b3477588d8c`. A final fresh-export rerun also
  passed `1/1`; `.dev/codex-plan-question-real-web.json` records `unexpected=0`, `73.062s` total and `55.736s` for
  the same real UI test.
- `npm run accept:thoth:appimage` rebuilt the local candidate and passed with exit `0`. Ignored report
  `.dev/packaged-appimage-thoth-flow/report.json` records 16 hot-switch turns, same-thread Provider Plan,
  question id `target`, answer array `["Local"]`, completed-Plan-only Implement, schema-v5 migration and all prior
  packaged Files/Changes/Browser/scripts/large-file/Tasks/Schedules surfaces. Candidate SHA-256 is
  `babb5596ce24cbe111d37ee6d8a82191ef1292510e000814afc7ea3253fbd054` over `137,830,579` bytes.
- Final App passed `365/365` files and `2,713/2,713` tests; Desktop passed `37/37` files and `300` tests plus `5`
  skipped. Provider Plan tabs passed `18.800s`, Provider Control `45.433s`, interaction `27.552s`, complete Thoth
  `100.192s`, and Foundation passed `66 + 438 + 37 + 128`. After the final allowance and handbook update,
  Foundation passed again and the shared-`300s` Refactor gate passed in `173.751s`, with the current source metrics,
  fresh Web export, complete Thoth and visual/TUI contracts. Isolation and diff hygiene passed; the independent
  Paseo PID still owns `127.0.0.1:6767` and Thoth `6688` was not taken over.
- Current production metrics are `316,951` LOC, `1,353,705` tokens, `1,391,743` AST nodes, `5,221` imports and
  `165` runtime dependency edges. `DeltaP50=1,189` translates the Cut B/final ceilings to `301,445` / `279,045`
  while preserving the independent `15,506`-LOC gap. `NTH-EV-073` and `NTH-TD-050` are verified;
  `NTH-TD-036` is again the sole top action at Stage 4. No commit, push, tag, Release or deployment occurred.

## 2026-07-29 [Provider interaction fixed-Beta publication opened]

- The user explicitly authorized committing, pushing and replacing the fixed Beta. Recorded `NTH-REQ-031`,
  `NTH-AC-028`, `NTH-CD-099`, `NTH-TD-051` and release-ready `NTH-EV-074`; `NTH-TD-036` remains doing at Stage 4
  while `NTH-TD-051` temporarily becomes the sole top action.
- Repository-local `Royalvice` authentication and live GitHub preflight passed. Remote development is the audited
  base `d801b8e9`; release automation, fixed tag and public Release `361273193` target `eaa1aa5f`; `main` remains
  `e74c6e0d`; the Release is non-draft/prerelease with exactly 26 assets; workflow `30383055325` remains successful.
- A combined fetch refreshed all branch refs but refused to overwrite the checkout's stale local fixed tag. The
  current remote tag was then fetched non-destructively into `refs/remotes/origin/release-tags/` and verified at
  `eaa1aa5f`. No tag or Release mutation occurred. Both audited branches retain normal fast-forward ancestry.
- Publication remains pending the atomic release-source commit, two normal pushes, exact-SHA workflow, public
  26-asset replacement, fresh downloads and downloaded-AppImage real-window reverification. The old fixed Release
  remains intact during this transaction.

## 2026-07-29 [First Provider-interaction workflow failed safely; corrective candidate verified locally]

- Created release-source commit `c03d60cd14cd4ee330d30a38b0007807eb410a3d`
  (`fix(provider): decouple native plan and questions`) and normally fast-forwarded both `agent/dev/mvp` and
  `release/mvp-actions` to that exact SHA. No force, merge, rebase or `main` mutation occurred.
- Exact-SHA workflow `30453064159` failed with two mandatory jobs after all other native Desktop, preflight,
  Server CLI and CLI smoke jobs passed. macOS x64 Desktop job `90582779776` parsed a newly created but not yet
  complete PID-lock JSON file. Hosted Relay job `90583349364` reached daemon restart, resumed the same native
  thread in a new external fixture process, but the fixture had lost that thread's stable tool catalog. Publish
  job `90585471551` was skipped; Release `361273193`, tag and all 26 assets remained at `eaa1aa5f`.
- Added semantic JSON readiness to the packaged Desktop smoke and a partial-write behavior test. Added
  Provider-owned native-thread catalog persistence to the scripted Codex fixture and a cross-process resume test;
  product Codex resume remains schema-correct and does not send `dynamicTools`.
- Focused Desktop and Drivers tests/typechecks pass; complete Desktop is `37/37` files with `301` passed and `5`
  skipped, while complete Drivers is `49` passed / `3` skipped files and `605` passed / `21` skipped tests. The
  fixed Release contract and formatting pass.
- The hosted Relay journey passes with `ok=true`, same-thread daemon-restart Card-to-Task continuation and the
  existing five-chunk E2EE file. `npm run accept:thoth:appimage` rebuilt the current source and passed with exit
  `0`; the real window verified Provider Features Plan, question id `target`, answer array `['Local']`,
  completed-Plan-only Implement and same-thread implementation plus every existing packaged product surface.
  Corrective AppImage is `137,830,605` bytes with SHA-256 `ba878cda...03059`.
- Corrective promotion revalidation passes with exit `0`: Foundation (`66 + 438 + 37 + 128`), Provider Plan tabs
  `16.091s`, Provider Control `36.467s`, interaction regressions `23.170s`, complete Thoth `85.915s`, shared
  Refactor Stage 4 `150.565s`, App `365/2,713`, hosted Relay, fixed Release contract, formatting, repository
  validation, isolation and diff hygiene. Formal isolation retained Paseo PID `3597831` on `6767` and found no
  Thoth daemon on `6688`.
- Corrective exact-SHA pushes, a new workflow, public download checks and downloaded-AppImage acceptance remain
  pending. The failed workflow will not be rerun as a substitute for a new source SHA.

## 2026-07-29 [Provider interaction fixed Beta published and publicly reverified]

- Created corrective release-source commit `d898f25f087f3d997fb027df355013a3d600f94e`
  (`fix(release): preserve packaged provider resume state`). The first development push invocation omitted
  `THOTH_GH_CONFIG_DIR` and exited `128` before credential acquisition; GitHub still reported `c03d60cd`. Retrying
  with the complete repository-local `Royalvice` environment normally fast-forwarded `agent/dev/mvp`, followed by
  a normal fast-forward of `release/mvp-actions`. No force, merge, rebase or `main` mutation occurred.
- Exact-SHA workflow `30459786832` completed successfully at `d898f25f`. All 11 jobs passed: preflight
  `90602540907`; macOS x64 `90606248602`; Server CLI `90606248632`; Linux `90606248694`; macOS arm64
  `90606248706`; Windows `90606252900`; hosted Relay `90606912965`; macOS/Windows/Ubuntu CLI smokes
  `90606913039` / `90606913056` / `90606913788`; and publish `90609908398`.
- Fixed public prerelease `361828099` and direct tag `v0.0.0-mvp-beta` now target exactly `d898f25f`, are
  non-draft/prerelease, and expose exactly 26 desktop-only assets. No APK, iOS, public Server CLI, npm, Nix or
  Docker asset was published.
- Fresh public downloads under ignored `.dev/release-verification/d898f25f.../` agree across GitHub metadata,
  `BUILD-SOURCE.txt`, schema-1 `MVP-UPDATE.json`, `SHA256SUMS` and extracted build identity. The AppImage is
  `137,826,536` bytes with SHA-256 `ec90e3f8...ebca8`; source is `d898f25f` and workflow is `30459786832`.
- The downloaded AppImage real-window journey passed with exit `0` and `ok=true`: Provider Features Plan, native
  question id `target`, answer array `['Local']`, completed-Plan-only Implement and same-thread continuation on
  `scripted-thread-3953698`, plus Files/Changes, Browser, Workspace scripts, five-chunk file transfer and complete
  `Tasks | Schedules` UI/navigation.
- Final isolation retained Paseo PID `3597831` on `6767` and no Thoth daemon on `6688`. Independent Relay remains
  at `317bcda4`; `main` remains `e74c6e0d`. No Relay/Web deployment, npm/mobile/store/Nix/Docker publication or
  Paseo operation occurred. `NTH-EV-074` and `NTH-TD-051` are verified; terminal state is `published`.
  `NTH-TD-036` is again the sole top action, remains doing at Stage 4 and retains its `15,506`-LOC gap.

## 2026-07-30 [Decision Map Clarify and target-anchored Loop implementation opened]

- The user approved the complete replacement architecture after six research/design rounds. Recorded
  `NTH-REQ-032`, `NTH-AC-029`, `NTH-CD-100`, `NTH-CD-101`, `NTH-CD-102` and `NTH-TD-052`.
- The locked product model is one same-session Decision Map Clarify, one Intent Contract, one Task Anchor and a
  mutable Working Set reviewed at semantic checkpoints. Card quotas, Task/Goals dual approval, linear Goal
  authority, Blackboard dumping and Contract Preservation Audit are superseded rather than retained as fallback.
- Current checkout is clean `agent/dev/mvp` at `6b04aa36166b70f65f1ecd557fdcdc901b5674d8`; public fixed Beta and
  `release/mvp-actions` remain at `d898f25f087f3d997fb027df355013a3d600f94e`, with exactly 26 desktop assets.
  Remote `main` remains `e74c6e0de8a110d5e07249880d0e4e4f0ceab691`.
- Implementation begins at Protocol authority, then schema-v6 migration, Harness/context/evidence, daemon state
  machines, App surfaces, fast/full/packaged acceptance and the authorized fixed-Beta replacement. No tests or
  source implementation claims have been made at session opening.

## 2026-07-31 [Decision Map Clarify and target-anchored Loop reached local release readiness]

- Replaced the production Task/Goals cognition path with schema-v6 Decision Map Clarify, one Intent Contract, one
  Task Anchor, mutable Working Sets/Work Units, semantic checkpoints and fresh read-only Review. RuntimeBundle
  surfaces are exactly four Clarify tools, one internal Challenger tool and four Loop tools. Old Task/Goals names
  survive only inside deterministic schema-v5 migration fixtures and explicit forbidden-residue tests.
- The full owner results pass: CLI `40/40`; App `366/366` files and `2,715/2,715` tests; Desktop `37/37` files,
  `301` passed and `5` skipped; Core `2` files / `20` tests; Drivers `49` passed and `3` skipped files with `606`
  passed and `21` skipped tests; Daemon `199` files with `2,535` passed and `26` skipped plus integration `3` files
  with `8` passed and `4` skipped. The shared `accept:thoth:fast` passed in `135.948s`, including the formal public
  cognition path `22/22`; Foundation passed Highlight `66`, Protocol `415`, Relay `37` and Client `128`.
- Real Codex `UT-02 + UT-04` passed `2` tests with `2` skipped in `209.08s`. The final Clarify cognition, ablation
  and Loop judges all returned `JUDGE_RESULT: PASS`. The fresh Web export built `4,463` modules. Storage migration
  verified Catalog/Authority schema v6 and digest `74f79a53c1ca`.
- Candidate AppImage `7bf5e09f...c0060` is `137,826,663` bytes and passed the complete real-window journey with
  `ok=true`: Decision Map, Intent Contract, Quick, Loop native Plan/Implement, checkpoint/Review retry, `@Task`,
  Stop, Files/Changes, Browser and Schedule. Its isolated durable state is `8,604,983` bytes with exactly two
  content-addressed RuntimeBundles. Hosted Relay v3 E2EE also passed `ok=true`, including daemon restart,
  Clarify, Loop, Pause/Resume/Stop and a `1,048,649`-byte five-chunk transfer.
- Final local promotion checks pass with current exit code `0`: MVP Release contract, brand assets, cognition
  architecture, Stage 4 architecture, schema-v6 storage fixture, formatting, repository/secret validation and
  `git diff --check`. Current production metrics are `320,124` LOC, `1,361,597` scanner tokens, `1,408,770` AST
  nodes, `5,247` imports and `165` runtime dependencies. `DeltaP52=3,173` translates Cut B/final ceilings to
  `304,618` / `282,218` and preserves the independent `15,506`-LOC `NTH-TD-036` gap.
- `NTH-EV-075` is locally `release_ready`, not yet verified or published. The existing fixed Release remains
  unchanged at `d898f25f` until the atomic source commit, both normal pushes, exact-SHA workflow, 26-asset
  replacement, public metadata/checksum/build-identity downloads and downloaded-AppImage reverification pass.

## 2026-07-31 [Decision Map fixed-Beta publication preflight passed]

- Repository-local GitHub authentication resolves to `Royalvice`. One initial auth-status invocation omitted
  `THOTH_GH_CONFIG_DIR` and was correctly rejected before any remote operation; the retry used the locked local
  config plus HTTPS proxy and passed without changing global credentials.
- Live GitHub receipts match every fence: `agent/dev/mvp=6b04aa36166b70f65f1ecd557fdcdc901b5674d8`,
  `release/mvp-actions=d898f25f087f3d997fb027df355013a3d600f94e`, and
  `main=e74c6e0de8a110d5e07249880d0e4e4f0ceab691`. The release source is an ancestor of development HEAD.
- Direct tag `v0.0.0-mvp-beta` and public prerelease `361828099` still target `d898f25f`; the Release is
  `draft=false`, `prerelease=true` and exposes exactly 26 assets. No branch, tag, Release, workflow or service has
  been mutated. The candidate may proceed to one atomic source commit and two normal fast-forward pushes.

## 2026-07-31 [First Decision Map workflow failed safely; CLI observer correction verified]

- Created release-source commit `eacb2b6df0983f0b19f3fd83d4657938b435c73e`
  (`feat(thoth): replace clarify and loop cognition`) and normally fast-forwarded both authorized branches. Exact
  workflow `30601495104` failed only in preflight job `91064968161`; every later native, packaged, Relay and publish
  job was skipped, so fixed Release `361828099` and all 26 assets remained unchanged at `d898f25f`.
- Preflight passed clean install, Electron setup, Release/brand contracts, Foundation, release runtime, complete
  App, complete Daemon, public foreground, adapter and Desktop tests. CLI finished `39/40`; only
  `31-task-schedule` failed while waiting for the first Schedule run to expose Task authority.
- The failing observer allowed `30` polls at `100ms`, only 3 seconds, despite every other asynchronous authority
  wait in the same test using 30 seconds. Four concurrent isolated daemons on the hosted runner exceeded that
  accidental local-speed assumption. Product authority and the same direct test passed locally before the edit.
- The test now uses the existing 30-second semantic deadline and, on a real timeout, reports final Schedule logs,
  inspection and Workspace Task list. It still requires a canonical `taskId`, and no product timeout, retry,
  fallback or assertion was weakened. The focused test passed, then the exact four-way complete CLI command passed
  `40/40` in `180.3s`; `31-task-schedule` completed in `35.2s`.
- A corrective source commit and new exact-SHA workflow remain pending. The failed workflow will not be rerun or
  treated as publication evidence.

## 2026-07-31 [Second Decision Map workflow exposed host-dependent Schedule fixture]

- Created corrective source `a62ff6e107f684a183b5bc9dd8d7054de40acd13`
  (`test(cli): await scheduled task authority`) and normally pushed development. The first release push command
  incorrectly expanded the short SHA into an unread object id; Git rejected it with `needs force` and the remote
  remained unchanged. The real `HEAD` was then read with `git rev-parse`, the release fence was rechecked, and the
  exact commit was normally fast-forwarded without force.
- Exact-SHA workflow `30602467471` again passed every pre-CLI preflight step and failed CLI `39/40`; all downstream
  native, packaged, Relay and publish jobs were skipped, preserving fixed Release `361828099` at `d898f25f`.
- The new diagnostics proved the Schedule run reached terminal `failed` in `402ms` with
  `Provider 'claude' is not available`, `taskId=null` and `executionId=null`. The Workspace Task list contained only
  the earlier confirmed Quick Task. This disproved the incomplete machine-speed diagnosis from the first run.
- `31-task-schedule` provisions its own scripted Codex transport but the first actual Schedule hard-coded Claude,
  so success depended on the developer machine having Claude installed. The Schedule now uses its own fixture
  Provider. A terminal run without Task authority fails immediately with the exact run receipt; the 30-second
  deadline remains only for nonterminal eventual authority.
- The focused formal path passes, and the exact four-way complete CLI command passes `40/40` in `186.9s`;
  `31-task-schedule` completes in `33.8s`. Product runtime is unchanged. A third corrective source commit and new
  exact-SHA workflow remain pending.
