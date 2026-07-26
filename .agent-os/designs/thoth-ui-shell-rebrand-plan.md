# Thoth UI Shell Rebrand And Final-Form App Surface Plan

Status: Draft for user review
Scope: UI shell, product surface, visual identity, navigation, menu system, app icon and user-visible language
Non-scope: formal task backend, Clarify runtime, Loop runtime, provider intelligence implementation
Last updated: 2026-07-02

## 1. Background

Thoth currently has a basic shell that can be opened, paired, connected to the daemon through relay, and packaged as a desktop test build. However, this shell still visibly inherits Paseo's product form, information architecture, menu language, and visual character.

The next step should not immediately delve into the business implementation of formal task, Clarify, and Loop. Instead, Thoth's final product surface and interaction skeleton should be established first. That way, subsequent backend implementation will not be abstractly “building Thoth,” but connecting real data, permissions, state machines, and provider sessions to stable Thoth product slots.

The core judgments for this round of work are:

1. Thoth is not Paseo with a new skin.
2. Thoth is not a harness toolbox.
3. Thoth is One Thoth: a task control plane and a user-facing, private-secretary-like work interface.
4. The UI may come first, but it must not lie; unimplemented capabilities may only appear as empty, pending configuration, unavailable, or preview states, and must not pretend to be complete.

## 2. Core Goals

### 2.1 Move Away from Paseo's User-Visible Form

Refactor every user-visible UI shell so that when users open the Web App, Desktop App, or future Mobile App, it no longer feels like a renamed version of Paseo.

The acceptance focus is not whether code package names have been completely renamed, but whether the user-visible product experience already belongs to Thoth.

### 2.2 Establish the Thoth App Surface in Its Final Form

First establish the product surfaces that Thoth will retain long term:

1. Global Home / One Thoth entry point.
2. Workspace control page.
3. Task / Loop task view.
4. Provider settings and status.
5. Device / Relay / Pairing connection management.
6. Evidence / Review / Archive evidence and history entry points.
7. Settings / Appearance / Advanced / About.

These entry points may temporarily contain unimplemented states, but their structure should be close to the final product and should no longer drift with Paseo's historical sections.

### 2.3 Establish Thoth's Own Visual Language

The visual direction is fixed as:

1. Game-like.
2. Relaxed.
3. Cute.
4. Cheerful.
5. Full of personality.
6. Neither childish nor cheap, and not like an ordinary AI SaaS.

Thematic imagery may include:

1. Thoth / scribe / god of wisdom.
2. Ibis.
3. Wings.
4. The moon.
5. Scrolls, seals, runes, and task contracts.
6. Bright contrasting colors such as red, gold, white, deep ink, and teal green.

Avoid making the UI a monotonous Egyptian desert palette, brown-and-gold palette, or dark blue-purple gradient. Thoth may use Egyptian mythological imagery, but it should not become an entire heavy, dated, low-contrast faux-antique skin.

### 2.4 Reduce User Cognitive Load and the Barrier to Entry

All UI refactoring must serve the core principle:

1. Users do not need to understand internal concepts such as harness, session, adapter, transport, or daemon.
2. Users see Thoth, workspace, provider, task, clarify, loop, review, and evidence.
3. Complex states must be expressed naturally, in a recoverable and actionable way.
4. States such as “Pairing required,” “Provider not configured,” “Select a model,” and “Workspace not yet registered” must give users a clear next step rather than expose low-level errors.

### 2.5 Reserve Stable Slots for Real Backend Capabilities

Putting the UI first does not mean building a fake demo. Every major UI module must correspond to a future real capability:

1. Composer controls correspond to Mode / Clarify / Loop / Provider / Attachments.
2. A Task card corresponds to a task record in the authority store.
3. A Contract card corresponds to a frozen acceptance contract.
4. A Clarify card corresponds to a decision-tree node within a provider session.
5. A Loop timeline corresponds to the plan-exec-review event stream.
6. An Evidence view corresponds to the review result, diff, test output, and artifact receipt.
7. A Device/Relay view corresponds to the direct daemon, relay pairing, device token, and credential state.

If the backend is not yet implemented, the UI must honestly display unavailable, coming next, needs provider, needs workspace, or preview-only.

## 3. Non-Goals

This round will not:

1. Implement a formal task backend.
2. Implement the Clarify decision-tree runtime.
3. Implement the real execution path for Loop / Review / Contract freeze.
4. Add hidden LLM API calls.
5. Use local deterministic rules to pretend to make intelligent judgments about user intent.
6. Restore the archived Python plugin runtime.
7. Restore voice, speech, dictation, or audio features.
8. Make a separate mock/debug-only UI the primary review entry point.
9. Use a pure landing page as a replacement for the real product interface.
10. Break the currently usable daemon, relay, workspace, web, or desktop entry points for the sake of visual refactoring.

## 4. Product Constraints

### 4.1 The UI Must Be the Real Product Entry Point

The Thoth I dev UI must be the same experience as the releasable full UI. Dev-only diagnostics may exist, but the debug UI must not be treated as the primary human review entry point.

### 4.2 The UI Must Not Lie

Unimplemented capabilities may appear, but their status must be represented honestly:

1. Available.
2. Not configured.
3. Waiting for provider.
4. Waiting for workspace.
5. Pairing required.
6. Not yet connected.
7. Preview.

Do not display false success states, false task results, false provider output, or false loop progress.

### 4.3 Visual Personality Must Serve Efficiency

Game-like styling, cuteness, and cheerfulness are qualities, not reasons to sacrifice interaction efficiency.

The UI must still be suitable for sustained work:

1. Reasonable information density.
2. Scannable status.
3. Stable controls.
4. No cramped typography.
5. Clear important actions.
6. Clear error and recovery paths.

### 4.4 Consistent Across Platforms Without Forcing Equivalence

Web, Desktop, and Mobile may use different layouts, but their core language must be consistent:

1. The same brand assets.
2. The same design tokens.
3. The same main sections.
4. The same task / provider / workspace / relay status semantics.

Desktop may have a more complete menu bar and local daemon management capabilities. Mobile may focus more on remote control and review. At the current stage, Web is the primary human review entry point.

### 4.5 Preserve Currently Verified Basic Capabilities

The following must remain after refactoring the UI shell:

1. The Web entry point `8082 -> 8148` can be opened.
2. The Thoth daemon defaults to `127.0.0.1:6688`.
3. The local Paseo daemon `127.0.0.1:6767` is not touched.
4. The Relay test endpoint `relay.test.thoth.seeles.ai` can be paired.
5. The Workspace addition flow does not show a blank screen.
6. Inputs such as `hi`, when no provider/model is currently configured, still produce an honest error rather than crash.
7. The Desktop test build can still be built.

## 5. Engineering Constraints

### 5.1 Use the Existing Source as Scaffolding; Do Not Undertake a Major Business Rewrite

The current app/desktop source may serve as scaffolding for UI refactoring. User-visible components may be moved, renamed, and reorganized, but this round will not delve into changing daemon/core/provider task logic.

### 5.2 Do Not Expand Package Boundaries

The root workspace remains at 10 packages. `packages/app/highlight` remains a nested package; do not add a root workspace.

### 5.3 Design System First

First establish reusable Thoth design tokens and UI foundation components, then change specific pages.

This round should not scatter one-off colors, shadows, spacing, and icon styles across individual pages.

### 5.4 Icon and Image Strategy

1. App icons, logos, character art, and splash-screen images may use AI-generated bitmap assets.
2. AI-generated assets must retain a source note: purpose, prompt summary, generation date, and manual selection notes.
3. For ordinary UI control icons, prefer an existing icon library such as lucide, unless a brand character or special game-like control requires a custom asset.
4. The App icon must have a simplified version; do not use the complete horizontal logo directly.
5. Small icons must remain recognizable at 16px, 32px, 64px, 128px, and 1024px.

### 5.5 Do Not Introduce New Visual Debt

1. Do not use a single hue to carry the entire UI.
2. Do not use large areas of low-contrast brown-gold, sand, or dark blue-purple gradients.
3. Do not use decorative orbs, bokeh blobs, or meaningless gradient backgrounds.
4. Do not nest UI cards inside cards.
5. Card corner radii should default to no more than 8px unless the existing design system clearly requires otherwise.
6. Buttons, badges, and input fields must not overflow with Chinese or English text at mobile widths.

## 6. Information Architecture Goals

### 6.1 Global Home

Home is the entry point to One Thoth, not a marketing landing page.

It should present:

1. Currently available workspaces.
2. Recent task / conversation.
3. Provider readiness.
4. Device / relay connection state.
5. A quick way to start a Thoth conversation.

### 6.2 Workspace Page

The Workspace page is currently the most important work surface.

It should contain:

1. Workspace identity.
2. Provider selector / status.
3. Composer.
4. Mode / Clarify / Loop controls.
5. Active task area.
6. Timeline / evidence preview.
7. An entry point for project files / context status.

### 6.3 Composer Controls

The Composer must retain these controls:

1. `+`: Add images and small files; the MVP limit is under 10MB.
2. Provider: Entry point for model, permissions, thinking strength, fast mode, and provider runtime settings.
3. Mode: Quick / Loop.
4. Clarify: Auto / Don't Ask / Light / Balanced / Dive Dive Dive.
5. Loop: Auto / Single Pass / Light / Balanced / Try Try Try.

Constraints:

1. Scope is not a standalone button; express it through `@workspace` or a later `@target` mechanism.
2. Under Quick, the Loop control should be grayed out or shown as not applicable.
3. Clarify applies to both Quick and Loop.
4. Control names may receive further UI copy refinement, but their semantics must not drift.

### 6.4 Provider Page

Provider is the source of capabilities, not Thoth's own model settings.

It should contain:

1. A Provider list.
2. Statuses such as Claude / Codex / ACP / OpenCode / mock.
3. model id.
4. permission mode.
5. thinking strength.
6. fast mode.
7. provider session readiness.
8. An honest representation of the real auth status.

### 6.5 Tasks / Loop Page

Tasks is the entry point to the final capabilities, but this round may begin with the shell.

It should contain:

1. A formal task list.
2. task status.
3. contract card.
4. clarify decisions.
5. loop timeline.
6. review / evidence summary.
7. The final locations for stop / pause / resume / archive.

Before the backend is connected, it must display a real empty state or not-connected state.

### 6.6 Settings

Settings must be fully Thoth-ified.

Suggested groups:

1. General.
2. Providers.
3. Connections.
4. Devices.
5. Appearance.
6. Workspaces.
7. Advanced.
8. About Thoth.

Paseo concepts must no longer appear visibly to users in Settings.

### 6.7 Desktop Menu Bar

The macOS / desktop menu bar should be refactored around Thoth semantics:

1. Thoth.
2. File.
3. Workspace.
4. Task.
5. Provider.
6. View.
7. Window.
8. Help.

Menu items may initially connect to existing capabilities or be disabled, but their naming and grouping should be close to the final form.

## 7. Visual System Goals

### 7.1 Brand Assets

The following must be produced or replaced:

1. App icon.
2. Dock icon.
3. favicon.
4. Desktop icon.
5. Android adaptive icon.
6. Web app manifest icon.
7. Full wordmark.
8. Compact mark.
9. Optional mascot / assistant avatar.
10. About page brand image.

### 7.2 Design Tokens

The following must be defined:

1. Color palette.
2. Background layers.
3. Text colors.
4. Status colors.
5. Border colors.
6. Spacing scale.
7. Radius scale.
8. Shadow / elevation.
9. Motion duration.
10. Game-like accent style.

### 7.3 Component Tone

Components should feel relaxed, cheerful, and game-like while preserving work efficiency.

Key components:

1. Sidebar item.
2. Top bar.
3. Workspace header.
4. Composer.
5. Mode segmented control.
6. Provider popover.
7. Clarify strength picker.
8. Loop strength picker.
9. Task card.
10. Contract card.
11. Evidence card.
12. Relay/device status row.
13. Empty state.
14. Toast.
15. Modal.

## 8. Copy and Personality Goals

Thoth should feel like a private secretary with personality, not a system backend.

Copy principles:

1. Keep the tone relaxed but not ingratiating.
2. Tell the user the next step directly.
3. Do not expose implementation names as the primary copy.
4. Error messages should first explain the reason in terms people can understand.
5. Do not use “digital employee” as the primary term.
6. Retain One Thoth, task control plane, workspace, provider, task, loop, review, and evidence as the primary terms.

Example directions:

1. `Relay timed out` is less useful than `Pairing required`.
2. `Provider unavailable` is less useful than `No executable Provider selected yet`.
3. `No workspace` is less useful than `Give Thoth a workspace first`.
4. `Select model` needs to become a provider settings entry point rather than a dead-end error.

## 9. Execution Phases

### 9.1 Phase 0: UI Inventory

Goals:

1. Scan the current app/desktop user-visible pages.
2. Mark remaining Paseo patterns.
3. Mark Thoth capabilities that are available and unimplemented.
4. Establish a page and component migration checklist.

Acceptance:

1. There is a UI inventory table.
2. There is a list of user-visible Paseo residue.
3. There is a list of underlying capabilities that must not be changed.

### 9.2 Phase 1: Brand And Asset System

Goals:

1. Produce an app icon direction.
2. Produce a full wordmark and compact mark.
3. Replace app/desktop/web icon assets.
4. Establish an asset provenance note.

Acceptance:

1. The Web favicon is the new Thoth icon.
2. The Desktop dock icon is the new Thoth icon.
3. The Android debug icon is the new Thoth icon.
4. The icon is recognizable at small sizes.

### 9.3 Phase 2: Design Tokens And Base Components

Goals:

1. Establish the Thoth palette.
2. Establish background/card/button/input/badge/token.
3. Unify the style of foundation components.

Acceptance:

1. The main pages no longer resemble the default Paseo theme.
2. The UI does not consist of one monotonous hue.
3. Chinese and English copy does not overflow at mobile or desktop widths.

### 9.4 Phase 3: App Shell And Navigation

Goals:

1. Refactor Global Home.
2. Refactor the sidebar / navigation.
3. Refactor the Workspace page shell.
4. Refactor the Settings entry point and categories.

Acceptance:

1. All user-visible main sections use Thoth semantics.
2. There are no user-visible Paseo names.
3. The first screen after opening Web and Desktop is a Thoth product experience, not an engineering tool interface.

### 9.5 Phase 4: Composer And Controls

Goals:

1. Refactor the composer.
2. Connect `+`, Provider, Mode, Clarify, and Loop to their final control locations.
3. Make the status of unimplemented capabilities explicit.

Acceptance:

1. Quick / Loop are visible.
2. The five Clarify levels are visible.
3. The five Loop levels are visible, but Loop is unavailable under Quick.
4. The Provider settings entry point is clear.
5. `+` expresses images and small files only.

### 9.6 Phase 5: Status, Empty, Error States

Goals:

1. Rewrite key empty states.
2. Rewrite relay / daemon / provider / workspace / model error states.
3. Rewrite the unimplemented task state.

Acceptance:

1. Error messages provide the next step.
2. Meaningless internal errors are not exposed as the primary copy.
3. The currently known states `Select model`, `Pairing required`, and daemon offline all have clear recovery paths.

### 9.7 Phase 6: Desktop Shell

Goals:

1. Refactor the desktop menu.
2. Replace desktop app metadata.
3. Verify the mac zip, Linux AppImage, and web preview.

Acceptance:

1. The Desktop menu bar uses Thoth semantics.
2. The mac zip can be opened for testing.
3. The Linux AppImage does not regress.
4. Release artifacts do not enter git.

## 10. Acceptance Criteria

### 10.1 Visual Acceptance

1. On opening the Web App, users can clearly perceive from the first screen that it is Thoth.
2. On opening the Desktop App, the dock icon, window title, menu bar, and About page are all Thoth.
3. The overall style is game-like, relaxed, cute, and cheerful.
4. The UI does not resemble an ordinary AI SaaS blue-purple gradient template.
5. The UI does not resemble a recolored version of Paseo.

### 10.2 Information Architecture Acceptance

1. The main navigation sections are in Thoth's final form.
2. The Workspace page has the final composer control locations.
3. The locations of Provider, Task, Device/Relay, and Evidence/Review are clear.
4. Settings categories are clear.
5. Desktop menu bar groups are clear.

### 10.3 Honest-State Acceptance

1. When the formal task backend is unimplemented, do not display false task success.
2. When the Clarify runtime is unimplemented, do not display false clarify output.
3. When the Loop runtime is unimplemented, do not display false loop progress.
4. When no Provider is configured, provide an entry point to Provider settings.
5. When Relay credentials expire, display pairing required.

### 10.4 Non-Regression Acceptance

The following must pass:

1. Web build.
2. Web open-project smoke.
3. Workspace route smoke.
4. `hi` does not produce a blank screen.
5. Relay fresh pairing smoke.
6. Settings expired relay credential smoke.
7. Desktop dev launch or packaged smoke.
8. At least the current foundation gate.
9. `git diff --check`.
10. `npm run format:check`.

### 10.5 User-Visible Paseo Residue Scan

The user-visible app/desktop/web surface must not contain:

1. Paseo.
2. getpaseo.
3. app.paseo.sh.
4. relay.paseo.sh.
5. Paseo icon.
6. Paseo menu/category names that no longer match Thoth.

The following may exist:

1. NOTICE / provenance.
2. `.agent-os/upstreams/` ignored raw cache.
3. Historical design archives.
4. Necessary provenance in source comments.

## 11. Deliverables

After this plan is completed, the following should be delivered:

1. Thoth app icon asset set.
2. Thoth visual token implementation.
3. Thoth app shell navigation.
4. Thoth workspace shell.
5. Thoth composer controls.
6. Thoth settings shell.
7. Thoth desktop menu shell.
8. Thoth status/empty/error copy.
9. Web preview URL.
10. Desktop test artifact path.
11. Screenshot evidence for desktop and web.
12. Verification command summary.

## 12. Minimum Definition of Success

Minimum success is not “every button runs the complete business flow,” but rather:

1. When users open Thoth, their first impression is already that of an independent product.
2. Users can understand the locations of workspace, provider, mode, clarify, and loop.
3. Currently real and available capabilities remain usable.
4. Unimplemented capabilities do not lie.
5. Future agents can continue connecting the backend through this UI shell instead of continuing to be led by Paseo's product structure.
