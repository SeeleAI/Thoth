# Lessons Learned

## `NTH-EXP-001` Do Not Carry Archived Plugin Runtime Forward

Motivation:

The archived plugin implementation accumulated Python runtime, generated Claude/Codex surfaces, dashboard templates, Textual TUI, selftests and release machinery. It was valuable as a historical experiment but no longer matched the Thoth product direction.

Observed result:

Keeping archived runtime code in the active working tree would make future agents treat archived plugin compatibility as current truth and would compete with the TypeScript / Node authority runtime design.

Conclusion:

Archived plugin source should be recovered from the archive release or archive branch when needed. It should not remain in the active Thoth skeleton.

Retry condition:

Only revisit archived plugin code as reference material for a specific prompt, evidence, privacy, or loop design decision. Do not port it wholesale.

## `NTH-EXP-002` Prompt Assets Should Be Contracts, Not Legacy Code

Motivation:

Old `prompt_specs.py` contained useful hard stops and evidence-first phase lessons, but it was embedded in obsolete Python command projection machinery.

Observed result:

Retaining that file would preserve too much old runtime surface. Deleting it without extraction would lose hard-won prompt lessons.

Conclusion:

Extract prompt value into `.agent-os/designs/thoth-prompt-contract-seeds.md` as structured contract seeds.

Retry condition:

When implementing Router, Clarify, Plan, Execute or Review prompts, use the seed document and current product principles instead of importing archived Python code.

## `NTH-EXP-003` Keep Install Side Effects Out Of First-Day Setup

Motivation:

The first-day infrastructure must let future agents run `npm install` reliably before doing any real feature work.

Observed result:

Plain `npm install` initially hung inside the optional native `dtrace-provider@0.8.8` lifecycle path pulled by `eas-cli -> @expo/logger -> bunyan`. The package was not required for local Android Debug APK packaging or Linux-safe iOS scripts in this round.

Conclusion:

Do not make npm install lifecycle scripts part of required setup. Root `.npmrc` sets `ignore-scripts=true`, `audit=false` and `fund=false`, and local native/toolchain work is owned by explicit root scripts. The unused local `eas-cli` devDependency was removed; future EAS release automation should be introduced deliberately in the release pipeline milestone.

Retry condition:

Only reintroduce EAS tooling when `NTH-MS-006` release automation is actively implemented, and isolate its install/build behavior so `npm install` remains stable.

## `NTH-EXP-004` Java And Gradle Need Explicit Proxy Mapping

Motivation:

Android Debug APK packaging must work on the current Linux host using the project-local toolchain under `.dev/`.

Observed result:

Shell `http_proxy`/`https_proxy` helped `curl` and npm, but the Gradle wrapper did not automatically use those variables. The first Gradle distribution download failed with a 10 second connect timeout until the packaging script mapped proxy variables into `GRADLE_OPTS`.

Conclusion:

Android packaging scripts should translate proxy environment variables into Java system properties for Gradle and keep `GRADLE_USER_HOME` under `.dev/gradle`.

Retry condition:

If future Android packaging fails on dependency downloads, first check `.dev/gradle`, proxy env, Gradle JVM options and partially downloaded Maven metadata before changing app code.

## `NTH-EXP-005` Do Not Force Relay Deployment Through A Protected Monorepo

Motivation:

The first hosted relay plan tried to mirror Thoth relay code into Code4Agent because that repository already had Cloudflare deployment conventions.

Observed result:

Code4Agent active protected-path rules blocked the required `wrangler.jsonc` and workflow changes for the available write actor. The blocked path created coordination overhead without improving relay source authority.

Conclusion:

The test relay deployment authority is now independent repository `SeeleAI/Thoth-Relay`. Thoth remains the product/source integration authority, while the relay repository owns Cloudflare Worker deploy configuration and test deployment to `relay.test.thoth.seeles.ai`.

Retry condition:

Only revisit Code4Agent if repository governance explicitly changes or the company chooses to centralize deploy infrastructure again. Do not treat the old Code4Agent mirror path as an active blocker.

## `NTH-EXP-006` Runtime Isolation Must Be A First-Class Default

Motivation:

Thoth was promoted from a codebase with local daemon conventions that overlapped with an existing Paseo daemon on the user's machine.

Observed result:

If Thoth silently falls back to `localhost:6767`, it can confuse the app, desktop smoke, CLI status and provider sessions by talking to Paseo instead of Thoth.

Conclusion:

Thoth direct daemon default is `127.0.0.1:6688`, with isolated dev state under `.dev/thoth-runtime/`. `127.0.0.1:6767` is reserved for the local Paseo/legacy daemon and should appear only in tests, historical examples or explicit guards proving Thoth avoids it.

Retry condition:

If future app/CLI/desktop behavior unexpectedly connects to the wrong daemon, first run `npm run smoke:isolation`, inspect endpoint fallback code, and check for newly introduced `6767` defaults before debugging provider behavior.

## `NTH-EXP-010` Clarify Golden Fixtures Must Preserve Semantic Provenance, Not Just Schema

Motivation:

`NTH-TD-015` required independent `codex exec` judge review because packet validity and local eval
can miss secretary-behavior problems.

Observed result:

Two independent judge runs failed before final acceptance even though deterministic schema evals
passed. The judge caught that a `you decide` Task Card had lost the original target, a note-only
answer fixture looked like repeated Clarify, a Task Card transcript lacked the initial user goal, a
cleanup branch could be read as a partial-scope downgrade, and a Goal Card fixture mixed an unrelated
approved CEO Task Card with a settings-page transcript.

Conclusion:

Clarify golden data must be semantically coherent end to end: original user goal -> Clarify transcript
-> Task Card -> approved CEO Task Card -> Goal Card split. The presence of provenance fields is not
enough; their contents must match and constrain the generated card. Independent judge failures should
change fixtures, prompt contract or rubric before acceptance.

Retry condition:

When future Clarify/Task/Goal golden cases are added, run `npm run judge:clarify:golden` and treat
semantic drift, repeated questions, hidden target replacement and unrelated provenance as blocking
failures even if TypeScript tests pass.

## `NTH-EXP-011` Internal Runtime Skills Must Stay Session-Scoped

Motivation:

The first Loop-1 Clarify harness put most behavior in TypeScript prompt constants and per-round
compact prompts. That was too easy to make Codex-specific and too easy to leak into every provider
turn.

Observed result:

The revised Loop-1 acceptance required `thoth.clarify` and `thoth.loop` to be standard Skill
artifacts with `SKILL.md` as canonical source, while also forbidding writes to user global provider
skill homes. A fake clean provider home plus independent user-simulation judge proved Thoth can
mount `thoth.clarify` under a Thoth-owned provider session skill home without writing
`~/.codex/skills`, `~/.claude/skills` or `~/.agents/skills`. It also proved ordinary same-state
packets can stay compact and avoid repeating the Skill body.

Conclusion:

Internal runtime skills are source-visible and reviewable, but their runtime visibility is scoped to
Thoth-owned provider sessions. `SKILL.md` owns semantic rules; TypeScript owns load/validate/hash/mount
mechanics, mechanical transition checks and fallback rendering. Normal same-state packets should
carry runtime data only. State transitions and repair may carry `skill_ref` / digest markers, but
must not copy the rules.

Retry condition:

If a future provider integration seems to require global skill installation, treat it as a blocker or
use a Thoth-owned isolated provider/session home. Do not write internal `thoth.*` runtime skills into
the user's global provider skill dirs. If packet repair starts changing goals, transcripts or
approved cards, re-run `npm run eval:clarify`, `npm run judge:clarify:golden` and
`npm run judge:clarify:user-simulation` before accepting the change.

## `NTH-EXP-007` Web Scorecard Settings Paths Must Respect Responsive Layout

Motivation:

The Web scorecard smoke needs to stress rapid Home, Workspace, Settings and composer transitions
without confusing responsive navigation differences with product regressions.

Observed result:

Early Web scorecard attempts treated the Settings sidebar/back path as identical on desktop and
mobile. On narrow viewports the real app uses the menu drawer and can stay on the Settings host root
route instead of the desktop General sub-route. The test then waited for desktop-only visible
controls and hit global timeouts even though the app surface was not blank.

Conclusion:

Scorecard helpers should enter Settings through the real visible control for the current viewport,
accept both Settings root and General sub-route when the app allows either, and run deep
Settings-to-Workspace back loops from desktop width unless the mobile-specific back path is the
behavior being tested.

Retry condition:

If a future Web scorecard run times out around Settings navigation, first check viewport, drawer
state, visible route controls and current URL before treating it as a product UI regression.

## `NTH-EXP-008` UI Shell Evidence Does Not Prove Thoth Product Direction

Motivation:

The Web/Desktop/OpenTUI scorecard work produced real screenshots, route smokes and terminal frames,
but it kept optimizing the promoted Paseo-derived shell shape.

Observed result:

The user review on 2026-07-03 found the APP direction still too close to a Paseo skin: workspace,
session, provider and settings surfaces existed, but the fundamental interaction model did not
start from the Thoth user journey. The missing product center is the workspace secretary
session, hidden built-in clarify/loop runtime skills, compact state-code packets, two explicit Loop
registration confirmations and a separate Background Tasks view.

Conclusion:

Do not continue polishing the old scorecard shell as the primary APP direction. Treat it as
engineering evidence that the substrate can render, not as product acceptance. New APP work must
start from `.agent-os/designs/thoth-app-runtime-contract.md` and
`packages/protocol/src/thoth-runtime-contract.ts`.

Retry condition:

Only revisit the old scorecard shell to harvest reusable components, screenshots or smoke harness
techniques. Do not preserve its information architecture unless a future user decision explicitly
reopens the APP model.

## `NTH-EXP-009` GitHub Push Must Use Project-Local Authority

Motivation:

Thoth keeps GitHub CLI state under ignored `.dev/gh` through `npm run gh -- ...` so repository
automation does not depend on or mutate global `~/.config/gh`. Git pushes must obey the same
authority boundary.

Observed result:

On 2026-07-03, after renaming `agent/dev/ui` to `agent/dev/mvp`, the first `git push -u origin
agent/dev/mvp` failed with GitHub `403` because Git used a stale global or URL-specific credential
identity. The project-local `.dev/gh` login had repository push permission, verified by `npm run gh
-- api repos/SeeleAI/Thoth --jq '{full_name,private,permissions}'`, but plain `git push` still
ignored that authority until the credential helper path was made explicit.

Conclusion:

Do not trust plain `git push` on this host when pushing `SeeleAI/Thoth`. Before pushing, verify the
effective GitHub identity and permission through the project wrapper, then verify Git's effective
credential source. If `git credential fill` resolves to the wrong username, clear the URL-specific
GitHub helper for the push command and use the project-local credential store/token path instead.
Never print the token, never write it into tracked files, and never change global GitHub auth to fix
a repository-local push.

Retry condition:

If a future push fails with `Permission to SeeleAI/Thoth.git denied to ...` for an unexpected user,
first run `npm run gh -- auth status`, `npm run gh -- api user --jq .login`, and a repository
permission check through `npm run gh -- api repos/SeeleAI/Thoth`. Then inspect `git config
--show-origin --get-all credential.helper` and URL-specific `credential.https://github.com.helper`
entries before retrying. Do not retry blindly with the same plain `git push`.

## `NTH-EXP-011` Clarify Strength Must Be Judged As Behavior, Not As A Field

Motivation:

The 2026-07-04 Loop-1 revision added `none` / `light` / `balanced` / `dive`, assumption owners,
decision-tree frontier refs and multi-question `C_ASK` cards. A schema-only implementation could
have accepted the fields while leaving the agent behavior unchanged.

Observed result:

The deterministic eval had to compare the same Three.js PathTracing prompt across all four strength
levels: `none` stays direct, `light` asks only the core target-grade fork, `balanced` adds acceptance
and ownership leaves, and `dive` walks target, acceptance, risk and discoverable/agent-owned
assumptions without asking implementation trivia. The judge prompt also needed to inspect hidden
`content.meta` and assumption owner handling; otherwise `dive` could drift into a field questionnaire.

Conclusion:

Future Clarify changes must prove strength through behavior differences, not through packet fields
alone. `dive` is not permission to ask every detail; it still filters `agent_can_decide`,
`agent_can_discover` and `standard_answer/common_sense` assumptions. Normal turns should carry
controls and refs compactly, but must not repeat `SKILL.md` rules.

Retry condition:

When changing `thoth.clarify` strength, question cards, assumption owners or output meta, rerun
`npm run eval:clarify`, `npm run judge:clarify:golden` and
`npm run judge:clarify:user-simulation`. If a judge flags unchanged behavior across strengths,
field-questionnaire drift, discoverable facts pushed to the user or target downgrade, fix
`SKILL.md` / fixtures / packet invocation before accepting the revision.

## `NTH-EXP-012` Loop-2 Web E2E Must Prefer Static Export Over Raw Metro Dev Server

Motivation:

The Loop-2 Workspace Secretary e2e initially loaded the app through the existing Metro dev-server
path. The browser stayed white and emitted `Cannot use 'import.meta' outside a module` before the
new shell could render.

Observed result:

`npm run build:web` succeeded and `packages/app/dist/index.html` marked the Expo bundle script as
`type="module"`. The generated bundle still contains `import.meta.env` from Zustand devtools, which
is acceptable for the static export module script. The raw Metro dev-server path served the same
kind of bundle without the post-export module-script fix, so it failed before React mounted.

Conclusion:

For current Web review and Loop-2 scorecard evidence, use the documented static export path:
`npm run build:web`, `npm run serve:web` or `npm run smoke:web:ui-scorecard`. Do not treat raw Metro
dev-server e2e failure as proof that the Workspace Secretary shell is broken unless the static
export path also fails.

Retry condition:

If future app e2e regresses with `import.meta` on a blank page, first check whether the test is using
Metro or static export. Then inspect `packages/app/dist/index.html` for `type="module"` and search
`packages/app/dist/_expo/static/js` for `import.meta` before changing app code.

## `NTH-EXP-013` Loop-2 APP Authority Must Not Drift Back Into Fixtures Or App-Local Relay Models

Motivation:

Loop-2 started with a development fixture APP slice so the Workspace Secretary / Clarify product
shape could be reviewed quickly. That was useful for UI exploration, but it was not enough for final
acceptance because the Loop-2 contract requires typed clean UI model authority from
protocol/client/daemon and real `relay.test.thoth.seeles.ai` validation without fake connected
states.

Observed result:

The final Loop-2 pass moved the active path to `workspace_secretary.snapshot/send/answer/topic.create`
RPCs and daemon-owned clean UI model state. The daemon now probes the real relay health endpoint and
emits `settings.relay` in the clean UI model before schema verification. A first independent review
flagged app-local relay model overwrite as a narrow boundary caveat; the final implementation
removed that production path, and `packages/app/src/thoth-app/clean-ui-model.ts` no longer exports a
relay model factory.

Conclusion:

Future APP work may use explicit test doubles inside tests, but production surfaces must not create
Clarify cards, relay status, Task Cards or Goal Cards from app-local fixtures, assistant text,
markdown JSON or raw packets. Settings relay status belongs to daemon clean UI authority. If a helper
can make the app look like it owns authority, either move it into daemon/protocol or keep it private
to tests.

Retry condition:

If a future UI task reintroduces development fixtures, app-local relay probing, fake connected relay
states, local Task/Goal Card factories or assistant-text parsing, rerun the Loop-2 anti-residual scan
and independent UI mental-model review before accepting the change. Any user-visible fallback to
Paseo semantics, request-user-input framing or fake relay evidence should block acceptance.

## `NTH-EXP-014` Electron Desktop Loop-2 Smoke Should Load Static Export

Motivation:

After Loop-2 web and mobile screenshots passed, a manual `view_image` re-check found that
`/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/desktop-scorecard/` still contained historical pre-Loop-2 One Thoth /
New Agent screenshots. The desktop scorecard script was still navigating old `/open-project`,
workspace and settings routes instead of the current three-view Workspace Secretary root.

Observed result:

Updating the script to target the Loop-2 root exposed another local smoke trap: dev Electron tried to
load `EXPO_DEV_URL` over local HTTP and timed out under the container/Xvfb/proxy environment even
though Node could reach the static server. The reliable path was to let the dev Electron shell load
the same static export that packaged desktop uses through the existing `thoth://app/` protocol. The
new `THOTH_DESKTOP_LOAD_STATIC_EXPORT=1` switch enables that path for desktop scorecard runs.

Conclusion:

For Loop-2 desktop app visual evidence, do not reuse the old `desktop-scorecard` screenshots and do
not depend on dev Electron reaching `EXPO_DEV_URL` over localhost HTTP. Use
`npm run smoke:desktop:ui-scorecard`, which builds the web export, builds desktop main, loads the
static export inside Electron and captures the current `desktop-app-*` screenshots under
`/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-workspace-secretary/`.

Retry condition:

If a future desktop scorecard fails with a blank Electron target, `net::ERR_CONNECTION_TIMED_OUT`,
old `One Thoth` / `New Agent` screenshots or missing `desktop-app-*` captures, first verify the
smoke is using `THOTH_DESKTOP_LOAD_STATIC_EXPORT=1` and the Loop-2 root selectors before changing
Workspace Secretary UI code.

## `NTH-EXP-015` Composer Dropdowns Must Overlay Instead Of Reflowing Mobile Controls

Motivation:

The Workspace Secretary composer now keeps Mode, Clarify strength and Loop strength as collapsed
bottom controls. The first implementation rendered the opened menu as ordinary layout between the
input and bottom control strip.

Observed result:

Desktop looked acceptable, but the mobile Loop menu pushed the bottom control strip downward so the
Loop trigger that opened the menu was no longer visible in `mobile-composer-loop-menu.png`. This
violated the "bottom controls, folded, decluttered" UX intent even though the e2e still passed.

Conclusion:

Composer dropdowns should be upward overlays anchored to the composer, not normal layout that
changes the bottom strip height. The input row, send button and Mode / Clarify / Loop triggers must
remain spatially stable while a menu is open. Manual `view_image` review is required for both
collapsed and open states on mobile.

Retry condition:

When changing Workspace Secretary composer controls, rerun the Loop-2 scorecard with dropdown-open
screenshots and inspect `desktop-composer-clarify-menu.png` plus
`mobile-composer-loop-menu.png`. If a menu hides the trigger row, overlaps the input, resembles a
questionnaire/permission prompt or makes the composer feel like an agent manager dashboard, fix the
layout before accepting the change.

## `NTH-EXP-016` Provider-Backed Streaming Evidence Must Distinguish Safe Progress From Token Text

Motivation:

The reopened Loop-2 acceptance required provider-backed streaming-first Workspace Secretary output
and atomic Clarify cards. Codex native `outputSchema` is the safest structured bridge for this slice,
but it does not always expose safe token-level prose deltas that can be shown before the final packet
is validated.

Observed result:

The final Loop-2 evidence proved clean live provider progress events, final real-provider replies and
daemon-supported `secretary_reply_delta` for safe non-structured text. It did not require exposing
raw assistant deltas, partial JSON, packet fragments or unvalidated card content. An early public
visual check also captured the app before the host probe finished, briefly showing a host-unavailable
state even though the public same-origin daemon and WebSocket proxy later became healthy.

Conclusion:

For provider-backed UI verification, distinguish three cases: safe clean progress events can stream
immediately; safe non-structured direct reply text may stream as `secretary_reply_delta`; structured
`C_ASK` / Task / Goal cards must wait for complete provider output plus daemon validation and then
render atomically. Public web screenshot checks should wait for the Workspace Secretary ready state
rather than judging the first host-probe frame.

Retry condition:

If future Loop-2 or Loop-3 UI evidence seems non-streaming, first inspect whether the provider bridge
is native `outputSchema` and whether clean progress events are present. Do not add assistant
markdown/code-fence parsing, raw delta display or local card fallback to manufacture token-level
streaming. If a public screenshot shows host unavailable, wait for the ready status and confirm the
current bundle plus `__THOTH_INITIAL_DAEMON_CONNECTION__` before changing runtime code.

## `NTH-EXP-017` Dynamic Tool Catalog Creation Is Earlier Than Provider Session Registration

Observed on `2026-07-11` during the real Codex Loop fixture:

1. The Clarify -> Task continuation did start and `thoth_submit_task_card` was called. It did not hang in app-server replacement handling.
2. The Task tool then failed its required independent convergence audit because its catalog had captured `agentManager.getAgent(callerAgentId)` while `AgentManager.buildLaunchContext()` ran before `registerSession()`.
3. The result looked like a loading timeout because the provider correctly received the audit-unavailable tool result and ended its turn, while the Secretary continued waiting for a Task Card that was never created.

Conclusion:

Catalog registration may use the launch config, but handlers that need a live provider caller must resolve it at invocation time. Real-provider fixtures must emit enough trace to distinguish a missing `turn/start` from a successful tool call that returned an authority error.

Retry condition:

When adding an audit, child session or caller-scoped tool, test both catalog creation before caller registration and execution after caller registration. For real transport tests, inject literal tool arguments into every newly-created PlanExec/Review session; otherwise a new provider session will improvise equivalent prose and accidentally turn a flow test into an intelligence test.

## `NTH-EXP-018` Foreground Restore And Background Handoff Must Be Durable State, Not UI Inference

Observed on `2026-07-14`:

1. An archived topic could be retained by an old layout or pinned/retained set and be recreated as a normal
   foreground tab after a reload.
2. Goals Card registration started the durable Loop task, but the foreground Secretary could still infer that
   its provider turn was active and leave a spinner visible.
3. A non-git workspace baseline used recursive manifest aggregation and a total-workspace delta, allowing
   cache-heavy directories to overflow the stack or consume the task file budget before PlanExec changed
   anything.

Conclusion:

Archive state must win over every UI retention hint. Foreground-to-background transfer needs an explicit,
persisted `background_handoff` state whose authority is the durable task registration, not late provider
terminal events. Evidence accounting must be bounded, baseline-relative and cache-aware; a generic
`budget_wait` must never conceal an evidence-capture defect.

Retry condition:

For any provider adapter, replay a persisted archived topic/layout, a late terminal event after background
handoff and a large non-git workspace with build/cache trees. Verify that no foreground tab/spinner returns,
the task budget starts at zero and a capture failure is recoverable rather than represented as a completed,
blocked or budget-exhausted task.

## `NTH-EXP-019` Durable Authority Must Not Become Agent Harness Cognition

Observed on `2026-07-14`:

1. The Loop authority gained useful durable records for recovery and safety: phase state, rounds, budgets,
   evidence manifests, receipts, retries and task revisions.
2. Those records then began to shape Review prompts, runtime-tool fields and quality criteria, turning an
   independent reviewer into a PlanExec-following checklist/acceptance-matrix filler.
3. This creates a false impression of rigor while making the system more incremental, less capable of
   rejecting a wrong route and less able to give the next PlanExec a high-leverage correction.

Conclusion:

Treat the Agent Harness as a capable reasoning actor. Daemon mechanics remain authoritative for persistence,
recovery, concurrency, permission and lifecycle routing, but are never Review's mental model. Review receives
the approved human task, the actual work and inspectable reality, plus prior substantive direction. It must
independently diagnose, challenge PlanExec, reject local incrementalism when warranted and write a concise
Review Direction Memo. Only the smallest semantic conclusion crosses back into daemon lifecycle routing.

Retry condition:

When editing any Clarify/PlanExec/Review/audit prompt, context pack, runtime tool or golden fixture, reject it
if it injects or requires task/phase/run identifiers, budgets, retry counts, envelopes, manifest/hash details,
receipt schemas, storage paths, repair state or field-completion checklists as cognitive obligations. Run an
independent judge case where PlanExec is locally plausible but conceptually wrong; acceptance requires Review
to identify the non-local correction rather than request another incremental patch.

## `NTH-EXP-020` Phase Completion Must Re-arm Scheduling, And Semantic Tests Need Semantic Routing

Observed on `2026-07-14`:

1. A real Codex PlanExec tool result was accepted and persisted, but the task projection remained
   `PlanExec completed / Review queued`. The scheduler had been active when the phase completion requested
   another scheduling pass, so the request could be lost at the worktree-lease boundary.
2. Codex provider callbacks use a provider-native turn id while AgentManager owns a separate daemon lifecycle
   turn id. Treating them as identical rejected valid dynamic-tool calls as stale.
3. After moving phase/round identity out of live tools, the UT-05 Review fixture could no longer select its
   retry payload from a hidden round. The correct context was the prior Review Direction Memo, not putting a
   mechanical round field back into the Review prompt.
4. The independent golden judge correctly rejected a green deterministic report because it lacked negative
   cases for Review ordering, shallow Direction Memos, daemon-budget reasoning and pass-budget consumption.

Conclusion:

Scheduler state needs a durable re-run intent whenever phase completion can queue work while the scheduler
still owns the lease. Provider adapters must distinguish native correlation from daemon lifecycle ids. A
semantic fixture routes retries from semantic history, such as the Direction Memo, and never reintroduces
daemon mechanics merely to make a scripted test convenient. A golden report is not adequate until the
negative cases can fail for the same reasons a capable but misdirected agent would fail.

Retry condition:

Whenever a new phase can be queued by a provider callback, test it while scheduler execution is already in
flight. For every adapter, test stale native-turn callbacks separately from daemon stream ids. When changing
Agent Harness cognition, rerun an independent judge and add a deterministic negative case for each judge
finding before accepting the green report.

## `NTH-EXP-021` A Computed Optical Filter Is Not Evidence Of Visible Refraction

Observed on `2026-07-16`:

1. Chromium accepted an SVG displacement URL in the Dive row's `backdrop-filter`, and the computed style,
   filter node and displacement values were all present.
2. The pixels behind the transparent row were almost uniform, so displacing them produced no user-visible
   refraction. The text used only a small continuous displacement and still read as ordinary text over blue
   glass.
3. The technical checks and error-free screenshot therefore proved that the effect rendered, but not that the
   requested optical behavior was perceptible.

Conclusion:

Visual-effect acceptance must prove a visible pixel relationship, not merely DOM/CSS activation. Refraction
needs recognizable source detail behind the lens. In a compact control with a mostly uniform backdrop, provide
that detail by optically re-imaging the semantic foreground itself: clipped lens bands, opposing offsets and
restrained chromatic separation. Keep random displacement subordinate so the result reads as refraction rather
than generic blur or warped text.

Retry condition:

For future glass, shader or distortion work, inspect the final capture at native size and enlarged pixel scale.
Acceptance requires a human-visible displaced edge, split contour or changed spatial relationship while the
label remains legible. Computed filters, animation names and a zero-error console are necessary diagnostics but
cannot substitute for this visual evidence.

## `NTH-EXP-022` Current Composer Preference Is Not Historical Execution Authority

Observed on `2026-07-16`:

1. One Workspace Secretary topic first ran a Quick foreground turn, then the user switched to Loop and sent a
   new request in the same provider session.
2. Task/Goals approval rendering and daemon conflict validation both read the mutable clean-model composer.
   A late model update could therefore expose `accept_quick` while daemon separately observed Loop, making a
   valid Loop flow impossible to register.
3. The provider session continuity was correct; the missing boundary was between the user's preference for the
   next send and the durable execution target of the authority flow already in progress.

Conclusion:

Composer controls are future-send intent. At send time daemon must freeze the effective controls on the durable
user turn and bind every Task/Goals Card in that flow to the same snapshot. Card rendering, answer validation,
Loop budget selection and restart handoff must read that Card-owned snapshot. Provider-supplied tool arguments
cannot author runtime mechanics, and a later clean model cannot rewrite historical authority.

Retry condition:

Whenever a composer control can change while a provider turn or authority card remains active, test both switch
directions, a second switch while the Card is pending, and daemon restart after approval. Acceptance requires one
continuous provider session, unchanged Card actions, correct Quick/Loop handoff, preserved next-send preference
and provider-neutral behavior.

## `NTH-EXP-023` A Provider Startup Error Is Not A Failed Review

Observed on `2026-07-16`:

1. A Loop task registered successfully and completed G1 PlanExec, but Review failed before producing any stream
   event because its generated provider `config.toml` was observed mid-write as an unclosed table.
2. Every isolated Codex session linked `config.toml` to the same global writable file. PlanExec teardown and
   Review startup could therefore race through shared configuration despite having separate session homes.
3. The async generator threw before emitting `turn_failed`. The generic wait catch saw the task still running
   and converted the infrastructure error into semantic `blocked`, leaving failed reviews at `0/1` while also
   disabling Resume.
4. Workspace Secretary authority was already persisted as `background_handoff + ready`, but changing composer
   mode cleared the App's model ref. Retained running timeline tools then reconstructed a false foreground spinner.

Conclusion:

Provider session homes need private writable configuration snapshots; shared authentication may remain linked.
An exception before a semantic Review verdict is a recoverable provider interruption, not a Review judgment and
not a budget event. Foreground handoff authority must outrank historical timeline activity, and next-send controls
must not clear the current topic model.

Retry condition:

Test provider generators that throw before their first event, concurrent PlanExec/Review session creation,
background handoff with retained running tool items, and Resume from both interrupted and legacy blocked phase
cursors. Verify failed-Review budget remains unchanged until an actual Review verdict is submitted.

## `NTH-EXP-024` Internal Snapshot Visibility Does Not Imply A Live Phase Stream

Observed on `2026-07-16`:

1. Background Tasks could recover an internal Loop Review agent and render its timeline snapshot, including a
   pending `Apply file changes` permission card.
2. The Provider received the approval and completed two `apply_patch` calls, then continued reasoning. The UI
   nevertheless appeared frozen because its WebSocket session owned only the global `AgentManager` subscription,
   and that subscription intentionally filters every internal agent event.
3. The App already listened for `agent_stream`, `agent_permission_request` and `agent_permission_resolved`; the
   missing boundary was daemon-side scoped routing after `fetch_agent_timeline_request`, not card state,
   permission-handler continuation or Provider recovery.

Conclusion:

Any UI that intentionally exposes a hidden/internal phase snapshot must also establish an equally scoped live
subscription for that exact phase. The exception must be session-local and identity-checked, must reuse the same
serialization semantics as foreground agents, must never forward internal `agent_state` into the Agent directory,
and must release on phase switch and session cleanup. Global internal filtering remains the correct default.

Retry condition:

For every internal timeline surface, test the full sequence after snapshot load: live reasoning, tool running and
completed, permission requested and resolved, turn terminal events, phase switch, disconnect cleanup and absence
from `listAgents()`. A visible snapshot or a Provider-side success receipt alone is insufficient UI acceptance.

## `NTH-EXP-025` Live Relay Gates Must Subscribe Before Causing The Event

Observed on `2026-07-16`:

1. The hosted Relay v3 health endpoint remained green, but the encrypted live test intermittently timed out
   waiting for `connected`.
2. The test created and opened the client WebSocket before attaching the server-control listener. Relay correctly
   emitted `connected` during the client handshake, so a fast path could permanently lose the event. The same
   send-before-listen race existed for hello and encrypted payload receipts.
3. This host also has no usable IPv6 route. DNS rotation caused direct `ws` attempts to alternate between valid
   IPv4 and guaranteed-failing IPv6 even while HTTPS and explicit IPv4 WebSocket probes succeeded.

Conclusion:

For causal stream assertions, install the observer before triggering the action and accept both incremental
events and protocol snapshot/sync forms. Hosted endpoint tests should bound retries and handshake time, and may
pin a transport family when the test host has a known unavailable route; they must still complete a real
authenticated, encrypted bidirectional exchange rather than degrade to a health probe.

Retry condition:

Whenever Relay connection sequencing changes, run the hosted encrypted E2E repeatedly. Acceptance requires a
pre-armed control listener, pre-armed payload listeners, listener/timeout cleanup, real Relay v3 token auth and
successful decryption in both directions. A single HTTP 200 or one lucky WebSocket run is insufficient.

## `NTH-EXP-026` Release Builds Must Prove Cold Graphs And Native Shell Semantics

Observed on `2026-07-17`:

1. The first release run built `@thoth/relay` before `@thoth/protocol`; local residual `dist` directories had
   hidden that dependency order. The next run then found that root `.npmrc` deliberately disables lifecycle
   scripts, so Electron existed as a package but its platform binary had never been installed.
2. Once preflight passed, clean native jobs exposed more implicit state: daemon compilation needed drivers and
   nested highlight output; Android Metro needed highlight output; the terminal WebView spawned an npm `.cmd`
   shim as if it were a POSIX executable; and PowerShell's case-insensitive `$home` collided with read-only
   `$HOME`.
3. After those fixes, Windows still rewrote electron-builder short options such as
   `-c.publish.channel=beta` into a separate `-c` plus a fake config filename. The equivalent long
   `--config.publish.channel=beta` form parsed consistently on POSIX and Windows.
4. Each failure appeared only after a previous layer became green. Treating the first failure as the whole
   release problem would have produced a locally convincing but non-portable pipeline.

Conclusion:

A monorepo release entry must build its complete dependency graph from a clean checkout and must not depend on
npm lifecycle side effects. Cross-platform workflow commands are product code: Node should launch JS CLIs by
their actual entrypoint, PowerShell variables must respect case-insensitive built-ins, and CLI options should use
forms that survive npm plus the native shell. Release contracts should lock the build order and command shape,
while native runners remain the authority for behavior that Linux cannot simulate.

Retry condition:

Whenever a package, generated asset, native tool or workflow argument enters a release path, delete the
assumption of pre-existing `dist`/postinstall state and run it after clean `npm ci` on every supported OS. Keep
failed run IDs and logs, add a deterministic contract assertion for each repaired cause, and do not mutate the
public Release until all native and smoke jobs are green.

## 2026-07-17 Android-only modules can break the desktop Web renderer

What failed:

The first Playwright desktop-update run loaded a blank renderer and reported `Cannot use 'import.meta' outside a
module`. The settings screen statically imported the Android updater, so Web Metro also bundled the native APK
hashing path and its `@noble/hashes` module even though the Android row was hidden at runtime. A runtime
`Platform.OS` check did not provide a build boundary.

What changed:

The updater now has a `.web.ts` platform implementation with no Android/native imports. The real Android module
remains selected by native resolution. Web export, related UI unit tests and an exported-bundle Chromium startup
then loaded the Thoth splash without the module error. The repository's old Metro Playwright update suite still
timed out in `page.goto` before reaching its assertions, so that runner result is retained as infrastructure
failure rather than claimed product acceptance.

Conclusion:

Platform-conditional rendering is not dependency isolation. Native update, filesystem, intent and crypto code
must be split at module resolution boundaries before it is imported by a shared screen. For startup regressions,
inspect browser `pageerror` before treating missing UI as a selector or timing problem.

## `NTH-EXP-027` Acceptance Journeys Must Be Stable While Environments Are Replaceable

Observed on `2026-07-18`:

The installed-flow checks had accumulated the same Card polling, hot-switch and Loop assertions in daemon tests,
packaged scripts, browser automation and real-provider fixtures. Repeating the behavior did not add confidence;
it created drift, long feedback cycles and opportunities for a Web-only path to look like product acceptance.

Conclusion:

Keep one semantic product Journey over public APIs. The Journey owns user actions and authority assertions;
environment adapters own AppImage/container/Relay lifecycle; provider adapters own harness transport only. A
deterministic external harness should execute the complete Journey on every package build, while real Codex and
UI/Relay/control extensions reuse the same Journey at promotion gates. Provider fixtures may prescribe tool
actions but must never write daemon authority directly.

Retry condition:

When a new surface or provider needs acceptance, first implement the smallest environment or provider adapter.
Do not duplicate Clarify, Card, Quick or Loop orchestration. If the common Journey cannot express a required
behavior, extend its public action vocabulary and run every existing adapter against that extension.

UI acceptance must still cross the renderer boundary at promotion time. API journeys can prove authority and
provider behavior while missing projection identity errors or omitted presentation fields. Use deliberately
different IDs for nested form models and outer authority records, and assert that frozen per-turn controls reach
the rendered Task/Goals action rather than allowing the UI to read mutable global mode.

An eval must validate product authority, not one checkout layout. Runtime skills may resolve from tracked `src`
during development or copied `dist` inside a package; both must satisfy the same content and session-mount
contract, while global installation remains forbidden. Likewise, a Review semantic failure exists only after a
valid Review verdict. Permission denial, provider crash, timeout, transport loss and runtime-tool failure are
operational exits and cannot consume failed-Review budget or synthesize `continue`/`reframe`.

### Card authority must not suspend a provider call stack

A user decision can remain open for hours or survive daemon restart; a dynamic-tool Promise, provider run and
JavaScript callback cannot. Binding Card completion to that process-local stack produced two coupled failures:
providers emitted extra prose while waiting, and accepted answers stopped advancing after the old callback or
run disappeared. Commit the Card first, park the provider turn, and resume from durable authority in a new turn.

Provider terminal delivery is not the same instant as foreground-run cleanup. A continuation attempt made while
the terminal event is inside the generator can still observe `hasInFlightRun=true`. Returning at that point loses
the only wake-up and forces the user to type `continue`. Schedule against the durable lifecycle until cleanup is
actually complete, fence old provider-turn output independently of the current turn, and never use an unscoped
deferred agent cancel that can hit the newly started continuation.

## `NTH-EXP-028` Brand Geometry Must Have One Runtime Source

Observed on `2026-07-19`:

The visible Thoth logo component and generated native assets were correct, while the desktop startup wait still
showed the previous silhouette. The Web startup animation had copied a complete SVG path into CSS masking, so it
bypassed both `ThothLogo` and the asset-path brand check. Electron also packages the Web export as the separate
`resources/app-dist` tree, so scanning only `app.asar` cannot prove renderer branding.

Conclusion:

Animation may transform a shared brand asset but must never duplicate its geometry. Brand gates need both
semantic checks and content checks: reject known legacy paths, reject hashes of renamed legacy bitmaps, reject
embedded legacy vector fingerprints, and inspect every packaged renderer resource root rather than assuming all
product code lives in `app.asar`.

Retry condition:

For every icon or splash change, build the Web export, inspect its emitted asset list, build one native package,
scan both executable code and external renderer resources, and capture a cold-start frame on each native OS at
the next release promotion.

## `NTH-EXP-029` Cross-Worktree Builds Need Independent Workspace Links

Observed on `2026-07-20`:

A temporary PR merge worktree reused the main checkout's root `node_modules`. npm could launch the tools, but
workspace package symlinks still resolved to the main checkout, mixing two commits in one TypeScript graph and
producing an unrelated daemon implicit-any error after all focused and foundation checks had passed.

Conclusion:

A symlink to another checkout's `node_modules` is acceptable only for narrow tools that do not resolve workspace
packages. Release-graph verification requires an independent `npm ci` in the tested worktree; otherwise a mixed
dependency graph can create false failures or, more dangerously, false passes.

Packaged ASAR verification should also prefer targeted reads. Full extraction follows `asarUnpack` references
and can fail when platform packaging deliberately prunes optional native files. Reading the exact parser and
Runtime Skill entries directly proves the intended contract without treating absent unrelated native binaries
as archive corruption.

## `NTH-EXP-030` Resuming A Provider Thread Must Re-Provision Runtime Capability

Observed on `2026-07-21`:

1. A Card could survive daemon restart in Workspace authority, but answering it first failed with `Unknown
agent` because continuation code assumed the visible Agent was still resident in process memory.
2. After restoring the Agent and native thread, Codex resumed the conversation but did not receive dynamic tools;
   the initial thread start had attached the RuntimeBundle catalog, while `thread/resume` had been treated as a
   handle-only operation.
3. The Human Decision was durable in both failures. The missing piece was runtime capability reprovisioning, not
   Task Truth recovery.

Conclusion:

ProviderThread identity and RuntimeBundle attachment are separate receipts. Every create, resume, adopt and
replacement operation must restore the visible Agent lineage, attach the requested immutable bundle through the
adapter, verify the returned receipt and only then launch continuation. A native provider handle alone never
proves Thoth capability.

Retry condition:

Every adapter conformance journey must park a Card, restart the daemon, resume the same native thread and verify
that the next semantic tool call is accepted under the new execution generation. A restored transcript or a
successful plain-text continuation is insufficient.

## `NTH-EXP-031` Process Control Must Follow Ownership, Not Process Discovery

Observed on `2026-07-21`:

1. The packaged CLI failed in a minimal Linux image because daemon Stop depended on `tree-kill`, which shells out
   to `ps`. The image intentionally had no `ps`.
2. PID 1 in the same container did not reap zombies promptly, so `kill(pid, 0)` could continue reporting a killed
   supervisor as present even after its listening socket and owned PID lock were gone.
3. An old regression test required CLI to scan and kill a detached descendant outside the supervisor process
   group. That assertion contradicted the final owner model and could authorize unrelated-process termination.

Conclusion:

The PID lock identifies one supervisor owner. CLI signals that owner only; the supervisor forwards lifecycle
signals to its worker; each provider adapter terminates only its owned process or POSIX process group. Stop
completion is proven by owner-lock release or process disappearance, with daemon unreachability as bounded force
recovery. External process listing is neither a dependency nor authority.

Retry condition:

Run daemon start/restart/stop from the final CLI tgz in a non-root minimal image without `ps`, plus stale-lock,
decoy-process, supervisor-disconnect and detached-descendant tests. Acceptance requires no unrelated kill, no
daemon reachability and no retained owner lock; zombie visibility alone must not keep the command spinning.

## `NTH-EXP-032` Public Artifact Failure Must Be Classified Below The Product Boundary

Observed on `2026-07-21`:

1. The re-downloaded public CLI tgz installed and started its daemon, but the first hosted Relay repetition failed
   while the daemon opened a data socket. Logs showed direct Cloudflare IPv4 `ETIMEDOUT` and IPv6 `ENETUNREACH`;
   the Relay `/health` endpoint still returned protocol `3` through the required host proxy.
2. A second direct attempt completed the core Clarify/Loop journey before the same host route failed during
   reconnect. The identical packaged Relay journey had already passed directly in GitHub Actions.
3. An ignored environment-level HTTP CONNECT tunnel stabilized this host's route. The public tgz then passed the
   full TLS/SNI/WebSocket, Relay v3, application E2EE, restart, control and Loop journey without changing product
   code or bypassing any public API or authority state machine.
4. An initial keystore comparison shell command omitted `set -euo pipefail`; a failed `keytool` stage therefore
   allowed `openssl` to hash empty input and the final `printf` returned success. Strict rerun with the explicit
   ignored keystore path proved the public APK signer really matched the fixed MVP key.

Conclusion:

Public-artifact acceptance must separate package/product failure from the verifier's network and shell boundary.
External routing may be replaced only below TLS and product transport, while all Thoth APIs, state machines and
cryptographic checks remain real. Multi-stage evidence commands require strict failure propagation.

Retry condition:

On hosted transport failure, inspect daemon socket errors, service health and direct TLS independently before
changing code. If only the verifier route is broken, use a documented environment-level tunnel and repeat the
same public journey. Run certificate/checksum pipelines under `set -euo pipefail` and compare the final digest
explicitly before recording evidence.

## `NTH-EXP-033` Native Continuation Can Beat Lifecycle Projection

Observed on `2026-07-22`:

1. The first Loop PlanExec correctly entered native Plan, opened an Implement approval and continued on the same
   ProviderThread, but its semantic result was rejected while the execution still projected `implementing`.
2. The provider transport can resume and call a semantic tool immediately from the approval callback. The
   separately queued `turn_started` event reaches the Workspace authority one microtask later, so requiring only
   `awaiting_provider` created an event-order race despite a valid generation, attachment and ToolGateway binding.
3. `implementing` is already the durable proof that the Implement CAS won for this PlanExec. It is therefore a
   valid PlanExec semantic authority state; planning remains excluded. A later `turn_started` still normalizes
   the projection to `awaiting_provider`, and provider-segment revision fencing prevents stale Plan events from
   advancing implementation.

Conclusion:

Provider lifecycle events are evidence, not the sole authority for a transition already committed by CAS. A
semantic gateway must authorize from the durable aggregate plus generation/phase binding and tolerate legal
transport event reordering, while continuing to reject planning, old generations and stopped executions.

Retry condition:

When a same-thread provider continuation reports a missing semantic authority, inspect the execution lifecycle,
segment revision and ToolGateway binding at the exact tool call. Do not add delays, provider-name branches or a
fixture-only bypass; model the valid intermediate state in the authority contract.

## `NTH-EXP-034` Durable Stop Must Retire Ephemeral Execution Ownership

Observed on `2026-07-22`:

1. Stop correctly committed `cancel_requested -> canceled/orphaned` in SQLite and removed the UI spinner, but the
   Workspace Orchestrator could retain its ActivePhase if a provider confirmed interrupt without later yielding a
   terminal event.
2. That stale in-memory owner kept the Workspace occupied even though durable Task truth was already `stopped`, so
   another queued Task might not start. Pending adapter approval bindings could also outlive the stopped execution.
3. A provider approval callback can race with Stop while awaiting the provider transport. Checking generation only
   before that await is insufficient; a returned follow-up could otherwise launch after Stop had already won.

Conclusion:

Durable lifecycle settlement and ephemeral process ownership require an explicit handoff. After Stop settles, the
Task coordinator notifies the scheduler to release ActivePhase, ToolGateway, runtime registration, approval timers
and lease heartbeat, then reconsider the Workspace queue. Every asynchronous approval continuation re-reads the
current Task/Execution authority after the provider await before starting another segment.

Retry condition:

When a stopped Task leaves a Workspace idle-but-blocked or a late provider segment appears, inspect both the durable
ExecutionProjection and the Orchestrator ActivePhase. Do not infer cleanup from a provider terminal; verify the
explicit Stop-settled callback and the post-await authority check.

## `NTH-EXP-035` Interaction State Must Have One Durable Authority

Observed on `2026-07-22`:

1. App-local queued messages duplicated daemon/provider lifecycle state, allowing duplicate input and two
   unsynchronized Timeline regions.
2. Rewind passed UI message ids into provider-native APIs even though the ids belonged to different domains.
3. File preview reused attachment persistence, copying read-only Workspace images into durable attachment storage.

Conclusion:

Queue ordering and canonical Timeline identity belong to Workspace authority; native rewind identity belongs to
the adapter behind an opaque receipt; preview sources are transient UI resources. Crossing those ownership lines
creates duplicated truth, storage growth and recovery bugs.

Retry condition:

Future interaction features must prove one durable owner, explicit identity translation and resource lifetime.
UI may project authority but may not persist a second queue, invent provider anchors or turn previews into durable
attachments.

## `NTH-EXP-036` Baseline Fixtures Must Enter Through Reachable Product Authority

Observed on `2026-07-23` during `NTH-TD-031`:

1. Seeding an Agent record did not materialize a visible Workspace tab, so it could not establish a real App
   first-interactive baseline.
2. A `seed-client.ts` attempt used CommonJS `__dirname` inside the ESM test environment and was reverted instead
   of adding a compatibility shim.
3. The dev mock Provider existed in runtime code but was intentionally absent from the production Draft Provider
   selector, so selecting it would have required an acceptance-only UI path.

Conclusion:

Baseline data is valid only when it traverses the same public Workspace/Agent API and visible production entry as
users. Storage records, module-loader shortcuts and hidden dev Providers cannot substitute for reachable product
authority.

Retry condition:

When a deterministic external Provider is required, configure it behind the normal HarnessAdapter and public
Create/Send path. Never add a hidden selector, direct store write or test-only RPC to make a baseline convenient.

## `NTH-EXP-037` Performance Baselines Need Stable Boundaries, Independent Samples And One Build Owner

Observed on `2026-07-23` during `NTH-TD-031`:

1. `tsx` process startup noise dominated the first daemon measurement; sampling RSS at `250ms` occurred before
   the process reached the stable idle boundary; forty health samples produced an unstable p95.
2. Foundation and acceptance initially rebuilt/cleaned the same Protocol output concurrently, causing a transient
   missing `@thoth/protocol/agent-lifecycle`; repeated daemon/Web builds also consumed most of the shared deadline.
3. App timing initially observed `about:blank`, matched more than one Settings locator and reused one browser page.
   `performance.memory.usedJSHeapSize` was coarsely rounded and varied from `77.6MiB` to `91.7MB` on identical
   source, creating a false statistical regression.
4. Fresh browser contexts fixed sample independence but initially created many daemon reconnect identities and an
   EventEmitter listener warning. Reusing one stable reconnect identity retained browser isolation without growing
   daemon sessions.
5. A formal gate then timed out at exactly `300.011s` because Expo workers spent minutes in CFS
   `rpc_wait_bit_killable` before a real `4415`-module bundle that itself needed only about `10s`. Limiting Metro to
   eight workers still required `2m30s`; it reduced fan-out but did not remove remote-filesystem metadata latency.
   Synchronizing current sources into a lockfile-keyed local dependency stage and running the same Expo export
   there completed in `11.960s`. Source synchronization remains inside every timed gate; the large dependency copy
   is an explicit one-time ignored toolchain cache, analogous to `npm install`.
6. The next formal gate reached isolated performance after all functional and visual phases, then failed at
   `237.050s` because local response overhead measured `14.71ms` against a `13.99ms` baseline with a `3.5%` noise
   ceiling. The probe had called seven sequential turns on one daemon/Client/Agent, so its samples were correlated
   and its baseline MAD understated cross-run scheduler variance. Unchanged-source debug repetitions ranged from
   `13.50ms` to `16.94ms`. The corrected probe runs each of the seven samples in a fresh process with a fresh
   daemon, Client and Agent, performs one independent warmup turn, and leaves the Mann-Whitney plus median/MAD
   failure rules unchanged. The refreshed clean baseline is `15.31ms` median with `0.69ms` MAD; an independent
   candidate run passed at `15.17ms` median.

Conclusion:

Measure a named ready/idle/interactive boundary, warm up separately, take seven independent samples and use the
lowest-level exact metric available. Build artifacts require one sequential owner before behavior phases fan out;
parallel consumers may reuse them but must not clean them.

Retry condition:

Daemon sampling starts only after health-ready and a stable idle window; response samples use separate processes
and warmup turns; App samples use fresh contexts, stable daemon reconnect identity and CDP forced-GC heap. Any
future metric change requires a new clean-baseline run before production edits and may not relax the Mann-Whitney
or median/MAD failure rule. The Web gate must build the real export from the synchronized local stage and fail if
its dependency signature differs from the current lockfile; it may never serve a stale prebuilt bundle.

## `NTH-EXP-038` Release Storage Fixtures Must Follow The Observed Schema And Seal SQLite Sidecars

Observed on `2026-07-23` during `NTH-TD-031`:

1. The first fixture verifier queried a nonexistent `timeline_entries.entry_kind`; Release `05775486` stores the
   canonical item under `item_json`.
2. The first generated fixture retained WAL/SHM sidecars, so copying only the main SQLite files would not have
   frozen all committed data.

Conclusion:

Migration evidence must be derived from the real Release schema and public API, not an inferred column layout.
An immutable fixture is incomplete until WAL is checkpointed, journal mode returns to `DELETE`, sidecars are
absent and integrity/foreign-key/entity/digest checks all pass.

Retry condition:

Every authority schema cut first verifies the sealed `refactor-release-05775486` fixture, injects failures into
copy/transform/validate/activate and compares the canonical entity digest before deleting old migration code.

## `NTH-EXP-039` Visual Baselines Must Isolate Responsive State And Drive Explicit Product Refresh

Observed on `2026-07-23` during `NTH-TD-031`:

1. An untracked Git file did not reliably appear in Changes; a tracked README still required explicit refresh
   before the subscription snapshot exposed it.
2. YAML a11y snapshots were semantically unchanged but `oxfmt` rewrote indentation, causing byte mismatches; JSON
   snapshots removed that formatter ambiguity.
3. Desktop and mobile viewports in one test shared Explorer width preference. Mobile clamped the desktop `400px`
   width to about `280px`, producing intermittent Git-diff screenshot drift. Fresh viewport-specific Workspaces
   removed the cross-breakpoint authority leak.
4. The Mode backdrop intercepted later Explorer clicks. Closing it explicitly fixed the real interaction order.
   Closing Changes, reopening Explorer and then selecting Files added no coverage and was removed in favor of the
   existing Files tab.
5. Compact Workspace already opens its visible `New Agent` composer and has neither the desktop inline plus nor
   desktop new-tab menu trigger. Trying to click those controls was a test assumption, not a product regression.

Conclusion:

Visual acceptance must reproduce existing user-visible controls exactly, isolate persisted responsive layout per
viewport and wait for explicit product invalidation/refresh. Tests must not invent desktop controls on compact
layouts or preserve redundant navigation simply to resemble an earlier script.

Retry condition:

Keep desktop and compact/mobile in fresh Workspaces, close overlays before downstream actions, mutate tracked Git
content, request the public refresh, use formatter-stable JSON transcripts and reject screenshot threshold
increases as a flake fix.

## `NTH-EXP-040` A Shared Performance Gate Must Expose Redundant Durable Work, Not Encourage Reruns

Observed on `2026-07-23` during `NTH-TD-032`:

1. Five App candidate runs failed with Workspace-interactive medians from `1871.01ms` through `2040.53ms`; one
   diagnostic pass did not erase those failures. Real lazy boundaries for Explorer, File and Terminal produced a
   stable final `1603.73ms` without changing the UI. The first lazy build rendered white and then raised
   `process is not defined`: Expo's Metro runtime must remain a classic script, while chunks containing
   `import.meta` must be modules. Marking every script the same way was incorrect.
2. Reusing Wrangler's previous local durable state caused Relay setup to return `401`. Each App E2E run now owns
   an isolated temporary Wrangler state directory; deleting or accepting the stale room was rejected because it
   would make the test depend on prior runs.
3. The first complete Cut 1 gate expired at `300.018s` during response sample `3/7`. Functional work consumed
   about `231s`, so Daemon and real Web builds were made parallel and TUI moved into the existing behavior group.
   The first parallel attempt failed with `rsync 24` because Web staging copied `packages/daemon/dist` while the
   Daemon build cleaned it; excluding that non-Web build output preserved both real builds and removed the race.
4. Removing the one-second daemon sample cleanup interval made processes interfere and worsened ready median to
   `2821.44ms`. The frozen cadence was restored. A separate health p95 failure around `0.31ms` was traced to
   Express response serialization/ETag overhead; the equivalent health route now writes the same validated JSON,
   status and dynamic timestamp directly after the same host/CORS checks.
5. A complete gate at `284.809s` failed `clientToAdapterMs` and local overhead with one-sided Mann-Whitney
   `p=0.0265/0.0364`. Agent/Turn/Card locator read-through caching and a single Agent UPSERT removed repeated SQL,
   but no sample or threshold was changed. A later complete gate passed in `265.753s`; closeout review then found
   that Core was built but its direct state-machine tests were missing from the sole gate. The run was not used to
   verify the TODO; Core `9/9` was added to the same deadline.
6. The first complete run with Core tests reached performance at `240.303s` and again failed only
   `clientToAdapterMs` with `p=0.0265`. Seven independent response diagnostics were used before another full run,
   rather than rerunning the gate. Method-level timing showed every foreground Turn rewrote the already-durable
   Agent-to-Workspace catalog locator at roughly `1.4ms`, then separately wrote the new Turn locator. Agent
   registration already owns the first write. Updating it only when missing or misrouted, plus skipping two
   `total_changes()` probes for transactions known to change, reduced the diagnostic Client-to-adapter median to
   `6.56ms` and final formal median to `6.80ms` while retaining Turn durability and Workspace revision ordering.
7. A pre-performance formal attempt also stopped at `14.611s` on one unformatted catalog cache file. It remained
   a failed gate; the repository formatter was applied only to that file before the complete rerun.
8. The final gate passed all phases in `245.631s`. It retained all seven response samples, including the highest
   `15.70ms` local-overhead sample, and passed without retrying, replacing samples, reducing coverage or changing
   the Mann-Whitney/MAD rules.

Conclusion:

A bounded gate is useful only when every mandatory test is inside it and a red performance distribution triggers
hot-path accounting. Routing projections may be cached, but durable business truth may not. The fastest safe
write is usually the write whose ownership proves it is already complete, not an asynchronous durability
shortcut.

Retry condition:

On another statistical regression, preserve `.dev/refactor-performance-current.json`, inspect every independent
sample and time the exact synchronous operations before the adapter or projection boundary. Remove duplicate SQL,
catalog writes, serialization or routing work while keeping commit-before-publish ordering. Do not tighten sample
spacing, rerun for a lucky distribution, replace an outlier, move persistence after notification or omit a newly
introduced module's direct tests from the shared gate.

## `NTH-EXP-041` Visual Evidence Must Wait For The Authority State It Claims To Capture

Observed on `2026-07-24` during `NTH-TD-033`:

1. The first complete Cut 2 gate failed after `89.204s` because the Welcome a11y tree lacked `No projects yet`,
   `Add a project to get started` and the sidebar Add-project button.
2. The same browser frame already showed all three main Welcome entry tiles. The missing nodes belonged to the
   existing sidebar empty state, whose Workspace authority request was still in flight when the scorecard captured
   the tree immediately after the main entry became visible.
3. Updating the frozen a11y snapshot or relaxing its expected nodes would have hidden a timing error in the
   verifier. Product rendering did not change. The scorecard instead waits for the existing
   `sidebar-project-empty-state`, after which the focused real-Web scorecard passed `3/3` and the complete gate
   passed in `238.109s`.

Conclusion:

An asynchronous UI receipt is valid only after the specific authority-backed state represented by that receipt is
observable. Waiting for an unrelated nearby control is not proof that every projection in the capture has settled.
Acceptance should synchronize on the real product state, never rewrite the golden output to match an early frame.

Retry condition:

When a screenshot or a11y tree intermittently misses an existing projection, inspect the request and render
lifecycle for that exact region. Wait on its public test id or user-visible state; do not add sleeps, increase image
thresholds, update snapshots, mock the authority response or change product UI to satisfy the verifier.

## `NTH-EXP-042` RPC 收敛必须同时删除泛型层，并让测试装配跟随正式边界

Observed on `2026-07-24` during `NTH-TD-034`:

1. 第一版 Registry 已经删除大量 Client/Daemon switch 与 waiter boilerplate，但新增的独立
   `rpc-registry-core.ts` 和条件泛型使 scanner tokens 达到 `1,293,756`、static imports 达到 `5,042`；
   相对已验证 Cut 2 分别回升 `1,528` 和 `7`。只有 LOC/AST 下降不满足每刀全部复杂度指标继续下降的合同，
   因而该形态没有切 stage、没有提交。
2. 将 Registry core 内聚到既有 Protocol schema authority、删除额外文件与重复跨包 imports 后，所有
   `131/139` schema 和 mapped types 仍保留，但最终 tokens/imports 降至 `1,289,741 / 5,034`。简单不是把
   声明能力删掉，而是让声明源与已经拥有 Zod schema 的模块共址。
3. Session/Wire 聚焦测试第一次运行时，`session.test.ts` 的 `126/126` 项都在构造前失败：Cut 2 后测试
   helper 没有配置正式 `ToolGateway`。给 helper 装配同一个真实 ToolGateway 边界后，Session/Wire
   `133/133` 通过；没有在 Session 中加入 nullable gateway、fallback 或 test-only production branch。
4. WebSocket suite 的 `17/17` 项第一次都因共享 `/tmp/thoth-test/catalog.sqlite` 仍是 schema 0 而失败。
   测试改为每项拥有独立临时 Thoth home，并由正式 storage schema 初始化/校验；最终 `17/17` 通过，避免
   测试顺序和机器残留状态成为 authority。
5. 第一个完整 stage 3 gate 在 `239.673s` 通过，但 Foundation lint 报告 class/interface unsafe
   declaration merging。该 run 未用于关闭 TODO。直接改成 export alias 产生 `TS2300`，匿名 class facade
   又产生 private-member `TS4094`；最终使用 named `DaemonClientRuntime` + typed constructor/facade，保留
   构造和实例类型、动态方法覆盖与 runtime duplicate guard，lint 达到 `0 warnings / 0 errors`。
6. 最终完整 gate 在 `240.108s` 通过。所有失败输出都保留，没有通过 suppress lint、降低测试、修改
   public surface manifest、隐藏 schema-0 文件或接受 tokens/imports 回升来制造绿色结果。

Conclusion:

声明式 Registry 只有在删除三份同步 boilerplate 的同时不制造第四层泛型框架时才是真正收敛。测试 fixture
也必须装配最终 production boundary；如果 fixture 依赖旧构造习惯或共享持久状态，它不能证明新主链。

Retry condition:

后续 Registry/Facade 重构若出现 LOC 下降但 token/import 回升，先删除泛型中间层和重复 module edge；若
Session/transport 测试在构造期统一失败，先核对最终 composition boundary 与独立 storage home。不得把正式
依赖改成 optional、给 Runtime 增加测试 fallback、放宽 lint，或修改 public-surface 统计集合来绕过失败。

## `NTH-EXP-043` Session Store 删除后测试装配必须迁移到最终 Owner

Observed on `2026-07-24` during `NTH-TD-035`:

1. 旧测试第一次完整迁移前，App suite 为 `330` files、`310` passed / `20` failed，`2,451` passed /
   `106` failed。失败集中于测试仍装配已删除的 Session Store；恢复兼容 Store 会制造第二套 authority，
   因而选择把 fixture 和断言迁入 Projection、HostRuntime、QueryClient 和 UiPreferences 的正式边界。
2. 第二次完整 App suite 为 `328/330` files、`2,569/2,573` tests，剩余四项失败来自 Timeline gap reset
   会先创建正式 `loadingTail` placeholder，以及 fake Client 缺少正式
   `subscribeAgentThothStateUpdates()`。测试跟随最终 loading/subscription contract 后通过，没有放宽生产语义。
3. Archive query suite 最初 `5/5` 失败，因为旧 `beforeEach` 仍调用 `useSessionStore`。测试改为重置并断言
   QueryClient pending cache；没有恢复 Store proxy。HostRuntime ServerInfo event 新测试最初因 fixture 缺
   Protocol `status: "server_info"` 失败，补齐正式 wire shape 后通过，没有放宽 parser。
4. DaemonProjectionService stale-Agent 测试最初 deep-equal 失败，因为 canonical Agent 保留正式
   `projectPlacement`。最终改为验证 stale event 不替换对象 identity，没有删除字段或弱化快照语义。
5. WIP 中曾运行不受支持的 `npm run metrics:refactor -- --json` 并明确失败；最终指标只来自标准根命令
   `npm run metrics:refactor`。

Conclusion:

删除旧 authority 后，批量测试失败首先说明 fixture 仍依赖旧 ownership，并不证明需要兼容层。测试必须
装配最终 Store/Service/Query 边界；Protocol fixture 必须满足正式 wire schema，canonical entity 字段不能为
旧 deep-equal 断言而裁掉。这样才能证明单主链，而不是让测试迫使生产代码恢复双轨。

Retry condition:

后续 Cut 若在删除旧 Store/Controller 后出现大面积 fixture 失败，先按 owner mapping 迁移 setup、fake Client
和断言，再检查最终 service lifecycle。不得新增兼容 facade、nullable production dependency、test-only
authority writer、放宽 parser 或删除 canonical 字段来让旧测试继续通过。

## `NTH-EXP-044` UI 组合复用不能凭预算假设制造两万行重复

Observed on `2026-07-24` during `NTH-TD-036`:

1. 规划把 shared UI 单刀估算为 `-20,000` LOC，但完成 canonical Timeline Registry、统一 Sidebar row、
   ContextMenu/Dropdown substrate、Agent controls、Markdown renderer、Workspace tab menu/descriptor、Sheet
   background、死文件和死样式后，真实 production delta 只有 `-4,578` LOC。
2. SettingsRouteRegistry 试验只减少 `4` LOC，却增加 `490` scanner tokens；它只改变代码形状，没有消除
   真实复杂度，因此被撤回，没有为了满足“Registry”名义保留无收益抽象。
3. 保守入口图扫描得到 `754` 个 production candidates、`721` 个可达文件和 `33 / 1,777 LOC` 个不可达
   文件。剩余不可达项由现有行为测试、平台声明/stub 或 test adapter 直接拥有，不能在“功能和测试零损失”
   合同下当作自由删除预算。
4. 归一化函数结构扫描把 `>=80` tokens 的跨文件 clone 从 `9` 组收敛到 `1` 组；最后一组只有 `94`
   tokens，而且是 Plan Markdown 与普通 Markdown 明确不同的 paragraph/code/list presentation 边界。
5. 最终指标为 `296,353 / 1,271,951 / 1,300,201 / 4,991 / 164`，LOC 仍比本刀 ceiling 高
   `15,422`。没有删 feature、删测试、压行、移动生产逻辑、越界修改 VCS/Provider/RPC 或虚假切 Stage。

Conclusion:

“大文件很多”不等于“UI 有两万行重复”。共享抽象只有在同时删除两套真实实现时才是裁剪；把不同业务
组件塞进 Registry、PanelFrame 或巨型基类会增加 token/import 和耦合。预算若与 reachability/clone/consumer
事实冲突，必须暴露估算失败，而不是让数值反向驱动功能删除。

Retry condition:

只有用户批准扩大原子范围到相邻的 VCS、Provider、Shell/Terminal 或 transport 最终模块后，才继续寻找
剩余 `15,422` 行；仍需逐模块执行最终实现、全部消费者切换、旧路径删除和行为验收。若坚持 UI-only，必须
先给出新的、可定位到具体重复 owner 的删除清单；不得重复 Settings Registry 试验或抽象不同语义组件凑数。

## `NTH-EXP-045` Architecture guards must move with the final owner they enforce

Observed on `2026-07-24` during `NTH-TD-043`:

1. The first release gate, `npm run accept:refactor:fast`, failed in its static phase after `0.597s`, before any
   functional, visual, packaged or performance test ran.
2. Cut B intentionally deleted `packages/app/src/projection/timeline-view-model.ts` and replaced the third model
   with `packages/app/src/agent-stream/timeline-view-registry.tsx`, which declares strategies for all 11 protocol
   Timeline kinds and has a dedicated exhaustive kind test.
3. `scripts/check-refactor-architecture.mjs` still hard-coded the deleted path at lines `194`, `247` and `265`, so
   it interpreted the intended single-path cutover as a missing architecture. This is checker drift, not evidence
   that the old ViewModel should be restored.
4. The release attempt stopped immediately under `NTH-AC-022`. No compatibility file, stub, bypass, changed
   expected output, commit, push or Release mutation was used to make the gate green.

Conclusion:

An architecture guard is part of the atomic cutover. When ownership moves from a projection ViewModel to the
canonical Agent Stream Registry, the guard must validate the new owner and retain exhaustive semantic coverage in
the same final change. Keeping the old path in the guard pressures developers to restore a forbidden dual model.

Retry condition:

Change the Stage 4 guard to require the actual Registry and all 11 kinds, preserve the prohibition on the deleted
ViewModel and rerun the complete release attempt from the first command. Do not add an empty compatibility file or
weaken the exhaustive checks.

## `NTH-EXP-046` Test-count floors must match the selected Vitest project

Observed on `2026-07-24` during the second `NTH-TD-043` attempt:

1. `accept:refactor:fast` passed completely in `144.240s` after the architecture guard repair.
2. The approved App command selected only `--project unit` but also required the historical complete-suite floor
   `331 files / 2,582 tests`. It passed with `330 / 2,566` because `vitest.config.ts` excludes browser tests from
   the unit project; the separate browser project contains two files and 16 tests, while the WIP contains `332`
   total App test files.
3. Treating the green unit command as satisfying the higher floor would silently drop browser coverage. Lowering
   the floor would rewrite the acceptance contract. The attempt therefore stopped.
4. The subsequently started Daemon unit suite printed two Workspace creation failures before it was interrupted.
   No result from that incomplete run is treated as a complete suite receipt.

Conclusion:

A count floor is meaningful only for the same discovery configuration that produced its baseline. An all-project
baseline cannot be attached to a unit-only command, and a green exit code cannot override the locked coverage
floor. Separately, interrupted suites may expose failures but cannot be reported as fully executed.

Retry condition:

Use a command and floor from the same App project set without deleting or skipping tests, and repair the two
Daemon Workspace creation tests before restarting the release gate. Preserve both the successful unit receipt and
the incomplete Daemon failure as diagnostic evidence, not release completion.

## `NTH-EXP-047` Explicit native dependency setup belongs before the timed release gate

Observed on `2026-07-24` during the third `NTH-TD-043` attempt:

1. The complete fast gate, App suite and Daemon suite passed inside the fresh local deadline.
2. The Desktop suite discovered `20` passing files and `110` passing tests, but seven files failed before test
   execution because importing Electron reported that it was not installed correctly.
3. Root `.npmrc` intentionally sets `ignore-scripts=true`, so ordinary dependency installation does not download
   the Electron platform binary. The tracked contract exposes `npm run setup:electron` for exactly this explicit
   native/toolchain initialization, but the release preparation had not checked it.
4. The failure stopped the attempt before CLI, packages, benchmarks, stress, commit, push or Release mutation.
   Reusing the earlier green phases after initializing Electron would violate the one-deadline contract.

Conclusion:

Native dependency readiness is release preparation, not a product fallback. A timed release gate must validate
its explicit ignored toolchain prerequisites before the first command while preserving `ignore-scripts=true`.

Retry condition:

Run `npm run setup:electron`, prove the Desktop suite narrowly, and then restart the entire local release sequence
under a new `3600s` deadline. Do not weaken test discovery or enable global lifecycle scripts.

## `NTH-EXP-048` Fresh authority storage is not the same as an empty Thoth home

Observed on `2026-07-24` while preparing the fourth `NTH-TD-043` attempt:

1. The CLI helper mechanically created the removed `agents/` directory, so the final migration correctly rejected
   it as unrecognized pre-Release storage.
2. Separately, the public `daemon pair` and onboarding flows create `config.json`, daemon identity/key material,
   relay credentials and a CLI client ID before first daemon startup. Treating any non-empty home as legacy storage
   therefore rejected a valid current product sequence.
3. Allowing arbitrary files or restoring the old `agents/` fixture would weaken the no-guess migration contract.
   The final fix recognizes only the exact current non-authority metadata filenames and leaves unknown directories,
   legacy `agents/` data and malformed databases fail-closed.
4. Migration passed `12/12`; all five affected CLI startup scenarios passed; the complete CLI suite passed
   `40/40` files. No production compatibility reader, old schema import or silent fallback was introduced.

Conclusion:

Freshness for a versioned authority store must be defined by absence of prior authority data, not by total home
emptiness. Current identity/config metadata may safely precede authority initialization; unknown storage may not.

Retry condition:

If another legitimate pre-daemon artifact appears, prove it is non-authority and add its exact owner plus migration
test. Never replace the allowlist with a broad ignore rule or accept legacy authority directories.

## `NTH-EXP-049` Packaged migration smoke must start at the locked Release floor

Observed on `2026-07-24` during the fourth `NTH-TD-043` attempt:

1. All source suites, public behavior, judges, isolation and the fresh AppImage build passed.
2. The packaged smoke manually seeded JSON `agents/`, standalone `agent-timeline/timeline.sqlite` and copied
   `provider-sessions/`. That layout predates Release `05775486`, while the final migration contract explicitly
   supports exactly `05775486` and rejects anything older or unrecognized.
3. The packaged supervisor therefore exited with code `1` before emitting the desktop smoke marker. The retained
   home contains the prohibited old trees and no `catalog.sqlite`, `storage-layout.json` or daemon log, matching
   the expected fail-closed path.
4. Reintroducing the deleted importer, accepting arbitrary legacy directories or changing the packaged wait would
   make the smoke green by weakening production. The repository already owns an immutable Release `05775486`
   catalog/authority fixture with a semantic digest and must use that same source in packaged migration acceptance.

Conclusion:

A migration test is only meaningful when its source equals the documented support floor. A fixture from an older
deleted architecture tests rejection, not upgrade, and must not pressure production into an unauthorized fallback.

Retry condition:

Copy the immutable Release `05775486` fixture into the isolated packaged home, write its version-1 marker, verify
its locator/Timeline rows after AppImage-managed migration and retain the absence of `provider-sessions`. Then
rerun the complete packaged journey before starting another full release deadline.

## `NTH-EXP-050` Server CLI bundle must close over private runtime workspace dependencies

Observed on `2026-07-24` during the fifth `NTH-TD-043` attempt:

1. Every source, Release-contract, isolation and freshly built AppImage phase before hosted Relay passed.
2. `package-server-cli.mjs` kept a hand-written list of seven private runtime packages. Daemon gained a formal
   `@thoth/core` runtime dependency during the refactor, but that list was not updated.
3. The temporary bundle install received local tarballs for the listed packages, then followed Daemon's manifest
   to `@thoth/core@0.0.0-mvp-beta`. Because Thoth packages remain private and are not published to npm, the install
   failed with a public-registry `404` before any hosted Relay connection or credential creation.
4. Publishing Core, making it optional, using a registry fallback or stripping the dependency would hide the
   bundle defect and violate the private-package/runtime contracts.

Conclusion:

A deployable private-workspace bundle must derive its package set from the runtime dependency graph, not from a
manually synchronized list. The final archive must also assert every reachable private package is embedded, so a
new internal dependency cannot silently escape to the public registry.

Retry condition:

Make the Server CLI packer traverse runtime `dependencies` and `optionalDependencies` from `@thoth/cli`, embed the
complete reachable `@thoth/*` closure, and extend the MVP Release contract plus archive assertions accordingly.
Then prove the package and hosted Relay narrowly before restarting the entire local release deadline.

## `NTH-EXP-051` Hosted Relay health does not prove the paired data socket journey

Observed on `2026-07-24` while preparing the sixth `NTH-TD-043` attempt:

1. The repaired Server CLI tgz installed and its daemon reached direct readiness. Relay control registration
   eventually connected after initial IPv4 timeouts.
2. Five fresh pairing offers were issued without leaking their credentials, but the client data WebSocket timed out
   and the product journey never began.
3. Immediately afterward the public Relay health endpoint returned protocol `3`, and a direct TLS 1.3 handshake to
   the same host succeeded. Those probes establish current endpoint reachability, not paired E2EE data-path success.
4. Treating health/control success as journey success would drop pairing, E2EE and reconnect semantics. Rebuilding
   the same tgz or changing product timeouts without evidence would hide a likely transient network boundary.

Conclusion:

Hosted Relay acceptance must remain an end-to-end paired data journey. A bounded retry may distinguish a transient
Cloudflare/socket route from a deterministic product defect, but the first failure must remain visible and no full
release deadline may start until a narrow journey actually passes.

Retry condition:

Retry the same packaged journey once after independent health/TLS probes. If it fails again, stop with an external
Relay/network blocker; do not weaken the journey, increase the approved retry count or substitute health evidence.

## `NTH-EXP-052` A green functional refactor can still fail first-interactive performance

Observed on `2026-07-24` during the sixth `NTH-TD-043` attempt:

1. Source/visual tests, complete package suites, fresh AppImage and hosted Relay journeys all passed. Daemon startup,
   RSS, idle CPU, health and response distributions also passed their frozen contract.
2. All seven App Workspace interactive samples were slower than every frozen baseline sample: candidate
   `2072-2111ms` versus baseline `1693-1859ms`. The low candidate MAD makes this a stable regression rather than a
   single outlier.
3. The same samples improved JS heap from `50,742,068` to `49,061,368` bytes and Settings navigation from
   `207.05ms` to `198.45ms`, localizing the failure to first Workspace readiness instead of a global browser or
   state-size degradation.
4. Updating the baseline, reducing samples, accepting heap as compensation, moving the ready marker or continuing
   to load/stress/publish would each violate the frozen release contract.

Conclusion:

Behavioral equivalence and smaller memory do not imply startup equivalence. Shared UI/state refactors can add work
before the existing ready boundary even when later interactions improve; that work must be profiled and removed at
its real owner rather than hidden in the acceptance harness.

Retry condition:

Profile the current and clean-baseline Workspace navigation under the identical seven-sample fixture, identify the
new pre-ready critical path and repair it without UX or readiness-semantic changes. Preserve this failed distribution
and require a fresh complete release attempt after narrow proof.

Retry result on `2026-07-25`:

1. Clean Cut 4 reproduced the failure at `2119.09ms`, excluding the later Cut B presentation work.
2. Removing only the initial `300ms` debounce and running Agent/Workspace hydration concurrently produced two stable
   `1581.9ms` medians without changing the ready marker, baseline, sample count or UX.
3. Reconnect and resume remain debounced. The lesson is to distinguish initial authority hydration from bursty
   lifecycle revalidation instead of applying one scheduler policy to both.

## `NTH-EXP-053` Server CLI ranges made release packaging depend on npm publication timing

Observed on `2026-07-25` during the seventh `NTH-TD-043` attempt:

1. The repository lockfile selected Claude Agent SDK `0.3.196`, but the staged Server CLI copied `^0.3.195` and npm
   selected newly published `0.3.220`.
2. The new platform artifact was not in the verified cache and the install exceeded `600s`; no hosted product
   journey started.
3. Copying manifest ranges into a synthetic release root is not hermetic even when source installation is locked.

Conclusion: synthetic release manifests must resolve external versions from the root lockfile. With exact pins and
cache-preferred bounded fetches, the same packaging path completed in `14s`.

## `NTH-EXP-054` Hosted Relay pairing remained transient after deterministic packaging

Observed on `2026-07-25` during retry preparation:

1. The first exact-tgz journey received close code `1006` after five pairing attempts.
2. The sole permitted retry of the unchanged tgz passed the complete Relay v3 E2EE and product journey.
3. Health probes were not used as substitute evidence, and the first failure remains recorded.

Retry condition: a future complete attempt may use at most the contract's existing two hosted attempts and must
report both outcomes without exposing credentials.

## `NTH-EXP-055` UTC wall-clock estimation cannot enforce a shared monotonic release deadline

Observed on `2026-07-25` during the eighth `NTH-TD-043` attempt:

1. The attempt passed every stage through the frozen Daemon and App performance contracts, then established the
   `200` encrypted local Relay clients required by the final `600000ms` load phase.
2. The load was stopped manually after a UTC wall-clock estimate suggested fewer than eight minutes remained.
   Because the stages had run in separate shells, no single monotonic start value survived across the attempt.
3. UTC wall time can jump and cannot prove either expiry or compliance with the locked monotonic `3600s` deadline.
   The partial load therefore proves neither its ten-minute duration nor the complete local gate.

Conclusion: the entire release gate must be orchestrated by one process using `performance.now()`, with every child
receiving only the global remaining duration and `accept:refactor:fast` additionally capped at `300s`. Persist the
phase receipts to an ignored machine-readable result. Retry only from the first phase; none of the eighth-attempt
green stages may be combined with the retry.

## `NTH-EXP-056` A broad packet validator hid invalid Clarify semantic evidence

Observed on `2026-07-25` during the ninth `NTH-TD-043` attempt:

1. The monotonic runner correctly stopped at the independent Clarify user-simulation judge after `890894ms`.
   Every prior phase passed, but the two simulated `C_TASK_CARD` outputs omitted the semantic tool schema's required
   `convergence_review`.
2. Existing deterministic validation checked only the broad `ClarifyRuntimePacketSchema`, whose content is not the
   operation-specific semantic tool input. Five earlier independent judges happened not to identify the mismatch.
3. After adding the missing convergence evidence, a narrow judge found that several fixture `userInput` strings
   differed from the supposedly verbatim transcript. The source had normalized or expanded user answers inside
   provenance instead of preserving the immutable text.

Conclusion: test/eval packets must validate their content through the same operation-specific schema as production,
and verbatim provenance must be compared against exact per-turn inputs before an independent model judge runs. The
fixture and deterministic validator now enforce both contracts; the targeted test passed `6/6` and the independent
judge passed. Retry the complete release gate from phase one because the ninth attempt remains failed evidence.

## `NTH-EXP-057` OpenTUI PTY stress depended on an unowned daemon process

Observed on `2026-07-25` during the tenth `NTH-TD-043` attempt:

1. The complete monotonic gate passed through the ten-minute `200`-client Relay load, then TUI stress rendered an
   honest recovery frame because no Thoth daemon owned `127.0.0.1:6688`.
2. The stress asserted connected/offer-ready behavior but did not start a daemon. Its historical pass had depended
   on an unrelated development daemon already listening on `6688`, so the test was not hermetic.
3. Changing the expected frame to recovery would reduce the device/provider churn contract. Starting or stopping
   an arbitrary existing `6688` process would violate ownership and isolation.

Conclusion: the stress script now owns a real source daemon with an isolated temporary `THOTH_HOME` and reserved
random port, drives the same CLI path at all three widths, and terminates only its own process group. Narrow
`72x34`, `96x34` and `132x34` receipts passed with connected/provider/offer state and no credential or `6767`
leakage. Retry the complete release gate from phase one; the tenth attempt remains failed evidence.

## `NTH-EXP-058` Windows background-daemon smoke discarded the exception needed to identify the root cause

Observed on `2026-07-25` in exact-SHA workflow `30157560990` for `NTH-TD-043`:

1. Windows Server CLI smoke job `89678717333` and Windows Desktop build job `89678617488` independently reached
   the same public CLI background-start boundary and exited with `Daemon failed to start in background (exit code
1)`. Linux and macOS Server CLI smoke, Linux packaged execution and both macOS builds passed.
2. The CLI spawns the supervisor with `stdio: ["ignore", "ignore", "ignore"]`, waits only `1200ms`, and on early
   exit tails `daemon.log`. The Windows failures produced no recent daemon log, so the supervisor's actual startup
   exception was not present in either Actions log.
3. The two jobs therefore prove a shared Windows-only launch-path failure, but they do not prove whether the cause
   is detached process creation, supervisor entry resolution, storage preparation, PID locking or worker spawn.
   Selecting one of those explanations from source shape alone would be unsupported.
4. Retrying the workflow unchanged would consume release time without improving evidence. Changing the smoke to
   ignore the early exit, extending readiness only, or disabling Windows coverage would weaken the release
   contract and is rejected.

Conclusion: before another release attempt, preserve or surface the supervisor startup exception on Windows and
add a real Windows test covering packaged Server CLI plus bundled Desktop CLI cold background start. Use that
evidence to make one root-cause repair, then rerun the complete exact-SHA workflow. Do not mutate the old fixed Beta
unless every required job is green.

Resolution under `NTH-CD-070`: old-Release/current-source comparison narrowed the only shared early-startup change
to Cut 1 storage migration. Commit `26855ab7` added parent-directory `openSync + fsyncSync` before supervisor log
initialization. Node does not expose that directory-handle operation on Windows, while file `fsync` and atomic
rename remain supported. The final policy retains file durability everywhere and performs parent-directory `fsync`
only on POSIX; simulated Windows fresh/migrated storage, source CLI and packaged CLI passed locally. Exact Windows
proof remains the next workflow run.

## `NTH-EXP-059` Refactor Web acceptance cache is a required untimed prerequisite

Observed on `2026-07-25` while validating the Windows repair:

1. The first fresh `accept:refactor:fast` passed static contracts, Release storage and Foundation, then failed after
   `50.465s` because `/tmp/thoth-refactor-web-5d74e57ca1aa` was missing or stale.
2. The gate intentionally refuses to install or refresh Web dependencies inside its shared `300s` deadline. Reusing
   its earlier green phases or treating this as a code pass would violate fail-closed acceptance.
3. `npm run setup:refactor-web-cache` rebuilt the ignored cache. A new gate started from static contracts and passed
   every stage in `151.055s` with exit code `0`.

Conclusion: prepare the content-addressed Web dependency cache before every timed refactor gate when the source or
lock digest changes. Cache preparation is not part of the timed receipt, and a cache-miss run never contributes
partial acceptance evidence.

## `NTH-EXP-060` Windows storage durability had both directory-handle and file-handle constraints

Observed on `2026-07-25` in exact-SHA workflow `30159851556`:

1. Candidate `f50b9ea7` skipped parent-directory `fsync` on Windows and passed simulated Windows storage, source
   CLI, packaged CLI and the complete local fast gate. Both real Windows jobs nevertheless failed at the same
   pre-log daemon start; every non-Windows and hosted Relay job passed.
2. Simulating only `process.platform` on Linux cannot reproduce Windows kernel handle-access requirements. The
   remaining Cut 1 code reopened a fully written temporary file with mode `r` and then called `fsyncSync`.
   Windows implements this through `FlushFileBuffers`, which requires a handle opened with write access.
3. Extending readiness, skipping Windows jobs or branching Server CLI/Desktop behavior would not repair storage
   durability and remains forbidden. Replacing all durability calls with no-ops would weaken the atomic migration
   contract and is also rejected.
4. The second correction uses mode `r+` for the file flush, keeps atomic rename and POSIX directory flush, and
   records all supervisor failures before worker logging into `daemon.log`. Focused storage/logging tests passed
   `21/21`; future Windows failures will expose their actual exception through the existing CLI log tail.

Conclusion: platform simulation is useful for branch coverage but cannot substitute for native OS handle tests.
Storage durability must distinguish file flush access requirements from directory-entry flush availability, while
all product consumers continue through one shared startup implementation.

## `NTH-EXP-061` Public AppImage verification must await download completion and restore executable mode

Observed on `2026-07-25` after workflow `30160730623` published the replacement Beta:

1. A nested GitHub download yielded an ongoing process session after the orchestration window. Inspecting its file
   before awaiting completion produced partial sizes and mismatched hashes; this was local in-progress state, not a
   corrupt public asset. Redundant downloads were stopped and their partial files were retained under ignored
   verification storage rather than presented as Release evidence.
2. A fresh 16-range public download completed at the GitHub-declared `137,691,148` bytes and matched the API,
   `MVP-UPDATE.json` and `SHA256SUMS` digest
   `8b817a8c4fb38fe7adcd6a470e9230b2cc59c5c475d3318bbe3a1492b1518ff4`.
3. The first packaged journey then failed at AppImage extraction because an HTTP download creates a regular
   non-executable file. `chmod 755` changed only mode metadata, not bytes or SHA-256; the immediate retry passed the
   complete packaged product journey.

Conclusion: post-Release verification must use a fresh directory, await the download process to completion, assert
both declared size and digest, restore the executable bit and only then invoke the AppImage. Partial files and a
pre-`chmod` extraction failure are tooling evidence, not product acceptance or product failure.

## `NTH-EXP-062` Headless closeout push must override stale editor credential routing

Observed on `2026-07-25` after the Release evidence commit:

1. The first normal development-branch push exited `128` before changing the remote because the inherited VS Code
   askpass socket no longer existed and the configured GitHub CLI helper did not support the attempted `erase`
   operation.
2. The repository-local `.dev/git-credential-isolated.mjs` helper reads only the ignored Royalvice GitHub config.
   Clearing inherited helpers and selecting it per command allowed the same normal fast-forward push to succeed;
   no credential was printed, no force push occurred and `release/mvp-actions` was not touched.

Conclusion: headless authenticated Git writes in this workspace must explicitly clear inherited editor helpers and
select the repository-local isolated helper. A failed credential negotiation is not evidence of remote mutation.

## `NTH-EXP-063` Static archive-order guard followed a former consumer instead of the final action owner

Observed on `2026-07-25` while closing `NTH-TD-044`:

1. Focused `86/86`, complete App `2,591/2,591`, Foundation, real Web, interaction regression and Provider Control
   all passed after single-Agent close moved into `executeCloseAgentTab`.
2. The first complete `accept:refactor:fast` nevertheless failed after `113.948s`. The Plan/tab contract searched
   only `workspace-screen.tsx` for inline `await archiveAgent(...)` followed by inline layout cleanup. The final
   action still archived before cleanup, but the guard did not follow ownership into `close-tab-policy.ts`.
3. Copying archive/cleanup code back into the Screen, retaining a second inline path or deleting the order check
   would respectively break single ownership or weaken the contract. The guard was instead moved to the same final
   boundary as the behavior tests: it requires Screen delegation, the missing/archived/subagent layout-only policy
   and literal awaited archive before layout cleanup in `executeCloseAgentTab`.
4. The focused Plan/tab gate then passed in `16.246s`, and a wholly fresh shared gate passed every phase in
   `142.211s`. After the guard additionally required authority-backed presentation and bulk-action revalidation, the
   strengthened focused gate passed in `15.212s` and the final wholly fresh shared gate passed in `138.424s`.

Conclusion: static architecture guards must validate the canonical owner plus its consumer delegation, not a
former caller's code shape. When ownership moves, preserve the semantic assertion at the new boundary and rerun the
entire gate; do not duplicate production logic to satisfy a stale string search.
