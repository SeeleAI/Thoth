# Thoth MVP Loop Goals

## Status

1. Date: `2026-07-09`
2. Nature: the six Codex goal-mode loop contracts for the Thoth MVP
3. Scope: `packages/protocol`, `packages/core`, `packages/daemon`, `packages/drivers`, `packages/client`, `packages/app`, `packages/desktop`
4. Upstream contracts: `.agent-os/designs/thoth-app-runtime-contract.md`, `packages/protocol/src/thoth-runtime-contract.ts`
5. Status: canonical execution plan; used to advance `agent/dev/mvp` from design contracts to the minimum verifiable MVP product path

2026-07-09 update: `NTH-CD-045` supersedes the earlier strictly sequential Loop Goal 3/4/5/6
implementation order for the current branch. The active Loop background path is merged: Clarify ->
Task Card -> Goals Card -> durable background Loop task -> linear goals -> PlanExec / Review phases.
Old `Pyramid Plan Card` and `registered_pending` wording below is historical or legacy compatibility
unless a later section explicitly says otherwise.

## 1. Decomposition Principles

The core of the MVP is not whether the daemon can persist data, enforce gates, or render state; it is using runtime skills, prompt engineering, provider session harnesses, and eval harnesses to make the agent produce higher-quality work behavior.

Thoth's daemon, runtime tool bridge, authority store, repair, permission gate, and UI rendering remain important, but they are the mechanical safeguard layer for the agent harness, not the MVP goals themselves.

The execution order remains an engineering alternation between backend and frontend:

1. Backend loops establish the agent behavior contract, runtime skill, provider harness, runtime tool bridge, eval harness, and daemon authority safeguards.
2. Frontend loops create a low-cognitive-load product experience for the corresponding agent behavior.
3. Every loop goal must be independently assignable to Codex goal mode.
4. Every loop goal must have its own goals, constraints, and acceptance criteria.
5. When each loop goal is completed, the `.agent-os` evidence ledger must be updated; submitting code alone is insufficient.

Fixed order:

1. `NTH-MS-012` / `NTH-TD-015`: Backend, Clarify Agent Harness + Convergence Contract.
2. `NTH-MS-013` / `NTH-TD-016`: Frontend, App Refactor Foundation + Workspace Secretary Clarify Experience.
3. `NTH-MS-014` / `NTH-TD-017`: Backend, Task Contract Compiler + Approval Harness.
4. `NTH-MS-015` / `NTH-TD-018`: Frontend, Task / Pyramid Plan Approval Experience.
5. `NTH-MS-016` / `NTH-TD-019`: Backend, Loop Execution + Review Agent Harness.
6. `NTH-MS-017` / `NTH-TD-020`: Frontend, Background Task Dogfood Experience.

## 2. Global Constraints

These constraints apply to all six loop goals:

1. Thoth is a task control plane, not a harness tool or a hidden LLM API wrapper.
2. All AI/agent capabilities come from configured provider sessions; Thoth itself does not privately call a general-purpose LLM API.
3. The Thoth daemon does not perform natural-language intelligence; it only handles runtime context, tool/card schema validation, state transitions, repair, the two-confirmation gate, the permission gate, persistence, and client broadcast.
4. `thoth.clarify` and `thoth.loop` are built-in, hidden, non-optional, cross-provider-compatible runtime skills, with the standard `SKILL.md` artifact as their canonical source.
5. Users face the Thoth task control plane; PlanExec, Review, provider roles, skills, packets, and state codes are internal mechanisms.
6. The APP MVP frontend substrate must return to the original Paseo app surface, retaining its session/workspace/task/detail, stream, composer, settings, host/provider, attachments, file links, terminal/browser/file panes, responsive layout, and e2e/test capabilities.
7. Loop-2 may expose `registered_pending` through a minimal Background Tasks browsing entry, but it must not pretend to be PlanExec / Review; the final dogfood task system belongs to a later loop goal.
8. Original Paseo surface capabilities such as `New Agent` / session / workspace may remain as the interaction substrate, but the user-visible mental model must map to the Thoth task loop / Clarify runtime control rather than preserving the Paseo agent manager as-is.
9. Background Loop registration requires two user confirmations: Task Card and Pyramid Plan Card. The wire code may continue using
   `C_GOAL_CARD` for compatibility with the old protocol name, but the user-visible semantics are Pyramid Plan Card.
10. Task Card is a compact CEO overview containing only `title`, `goal`, `constraints`, and `acceptance`;
    Pyramid Plan Card is a goal pyramid expressing target / stages / subgoals / acceptance evidence. It must not contain
    risk, why_loop, implementation plan, file paths, commands, or code-level execution steps.
11. Do not restore the archived Python/plugin runtime, archived dashboard template, archived Textual TUI, or voice/audio/speech/dictation.
12. Do not touch, reuse, stop, or fall back to the Paseo/legacy daemon at `127.0.0.1:6767`.
13. Relay pairing tokens, raw offers, credentials, and subprotocol tokens must not appear in URL queries, logs, screenshots, docs examples, or final reports.
14. Every loop goal must run at least the root/package gates relevant to its changes; the foundation gate remains `npm run check:foundation`.
15. Development of `thoth.clarify` and `thoth.loop` must be golden-driven; packet/schema or tool-schema tests alone cannot establish skill quality.
16. Every change to a runtime skill, prompt contract, rubric, or key behavioral constraint must be rerun against fixed golden data, preserving the current output and review conclusion.
17. The primary development Codex session cannot self-evaluate skill behavior quality; an independent session, usually through `codex exec`, must review golden transcripts against the rubric.
18. The independent judge's core review dimensions are question quality from a behavioral-psychology perspective, behavior-tree convergence, fit with goals/constraints/acceptance, and whether user cognitive load is reduced.
19. If the independent judge determines that the agent asked immaterial questions, pushed discoverable facts to the user, failed to advance convergence, repeated questions, ignored the frozen contract, wasted the user's attention, or mechanically repeated a failed retry strategy, the loop cannot be accepted; the skill/prompt/rubric must be changed and the golden review rerun.
20. Thoth internal runtime skills must not be written to the user's global provider skill directories, such as `~/.codex/skills`,
    `~/.claude/skills`, or `~/.agents/skills`; they may only be natively loaded or discovered in an isolated filesystem within a Thoth-owned provider session scope. The complete `SKILL.md` must not be pasted into every prompt as a fallback.
21. Ordinary same-state provider runtime context must not repeat `SKILL.md` rules; `skill_ref` / digest markers are included only at session start, on state transitions, when the skill digest/version changes, when context is lost, or after repeated repair failures.
22. The frontend experience must be provider-backed and streaming-first: Quick responses, provider reasoning, shell/edit/read/write/search/fetch/tool/progress/evidence events are progressively rendered through AgentTimeline; Clarify Card, Task Card, and Pyramid Plan Card are rendered once as typed authority cards after the daemon validates the complete runtime tool submission.
23. `Quick + none` is the bare-provider / Paseo-like foreground path: it does not load `thoth.clarify`, wrap a Clarify envelope, register Thoth semantic runtime tools, require structured Clarify output, or enter Clarify repair.
24. `Quick + clarify` uses `turn_phase` to distinguish `clarify`, `approval_task`, `approval_breakdown`, `quick_exec`, and `repair`; except for `quick_exec`, structured phases must call semantic Thoth tools through the provider runtime tool bridge, such as `thoth_submit_clarify_card`, `thoth_submit_task_card`, `thoth_submit_pyramid_plan`, or `thoth_report_blocked`.
25. In Loop-2, the `Loop` secretary session is responsible only for Clarify and the two confirmation cards; after confirmation the daemon registers `registered_pending` and does not start PlanExec / Review. Background execution is implemented by `NTH-TD-019`.

## 3. Loop Goal 1: Backend Clarify Agent Harness + Convergence Contract

Milestone: `NTH-MS-012`
TODO: `NTH-TD-015`
Order: first, backend.

Goal:

Design and implement the first version of the `thoth.clarify` agent harness so that a provider-backed secretary session can, through multiple rounds of Clarify, identify the highest-value branch in the behavior tree of the user's prompt, avoid low-value questions and goal degradation, distinguish information the agent can discover independently from information that requires the user's judgment, and determine whether the current intent has converged enough to answer directly through bare Quick, answer directly through active Clarify, continue Clarify, generate an Overview / Task Card, generate a Pyramid Plan Card, or enter blocked.

The core of this loop is to make the secretary agent capable of clarifying and judging convergence.

Constraints:

1. Clarify is not `request_user_input`, not `AskUserQuestion`, and not a missing-field questionnaire.
2. Clarify must be a secretary-style convergence process driven by behavioral psychology.
3. Local deterministic code does not make semantic judgments; semantic judgments must occur in the provider-backed secretary session.
4. Facts the agent can check independently must not be pushed to the user.
5. The behavior tree is a decomposition tree of the user's prompt; each Clarify round should select the branch point that best eliminates incorrect paths and divergence at that moment.
6. Questions to the user must be limited to those that can change the goal path, risk, resource boundary, preference, acceptance criteria, or an irreversible choice.
7. By default, each round asks only one highest-leverage branch question, unless multiple branches are strongly related and would reduce back-and-forth.
8. Questions must preserve the user's original goal; they may ask about goal level, route, acceptance, risk, or priority, but must not degrade the user's goal into an easier MVP, demo, mock, partial implementation, or another goal.
9. Clarify does not provide defaults or recommendations by default. For highly technical questions that the agent is better suited to judge, the agent should decide independently and record the assumption; it should recommend only when the user asks for a recommendation.
10. Questions must reduce user cognitive load: provide enough context, expose clear branches, and avoid fallback-degradation questions and vague requirements gathering.
11. When the user enters a greeting such as `hi`, `Quick + none` must use the bare provider stream, without loading Clarify, outputting a packet, or producing a card; `Quick + clarify` / the Loop Clarify phase may produce an active Clarify direct response from a real provider session. Both paths must reply briefly and naturally like a secretary, without explaining product mechanics or showing Clarify UI; the daemon may not provide a fixed local greeting.
12. `thoth.clarify` must be produced through the standard skill-create / skill creator process as the Thoth internal `runtime-skills/thoth-clarify/SKILL.md` artifact; `SKILL.md` is the canonical source, and Codex-only formats and Codex-only metadata must not be used.
13. `clarify_strength` must become verifiable behavior: `none` means not entering `thoth.clarify` and going directly through the bare provider foreground stream; `light` asks only the highest-impact core branch; `balanced` goes one or two levels into material leaves; `dive` attempts to eliminate material assumptions while still avoiding minutiae, common sense, standard answers, and discoverable facts.
14. Clarify must distinguish assumption owners: `user_must_decide`, `agent_can_decide`, `agent_can_discover`, and `standard_answer/common_sense`; only high-impact `user_must_decide` items may be asked of the user.
15. The Clarify Card runtime tool/card schema must express a title and 2-4 closely related behavior-tree questions;
    each question has short branch choices, each choice label is no longer than 15 characters, and each explanation is no longer than 30 characters.
16. `C_ASK` may carry internal `content.meta` recording `effective_clarify_strength`, tree depth, QA
    round count, remaining material assumptions, and question value reason; this metadata is not shown directly to the user.
17. A user's card response must support attaching a note to the choices for each question; the user may also select nothing and write only a note.
18. Tool schemas, packets, and state codes are mechanical constraints, not product goals.
19. The daemon provides only mechanical schema, state-code, and repair safeguards; it does not decide what to ask.
20. When Clarify ends and enters Task Card, Thoth must mechanically attach the full verbatim transcript of all preceding Clarify questions and answers to the runtime tool submission / authority event.
21. When Clarify enters Pyramid Plan Card, Thoth must attach both the full verbatim transcript of all preceding Clarify questions and answers and the original CEO Task Card confirmed by the user in the first round to the runtime tool submission / authority event.
22. Pyramid Plan decomposition must use the verbatim Clarify transcript and the confirmed CEO Task Card as authority; it must not rely on implicit provider memory or invent, omit, alter, or over-interpret the user's confirmed goals, constraints, and acceptance criteria.
23. `Quick + none` must not mount `thoth.clarify`, construct a Clarify input envelope, register Thoth
    semantic runtime tools, require structured Clarify output, or force ordinary provider output into an
    authority card.
24. `Quick + clarify` must explicitly use `turn_phase`: `clarify`, `approval_task`,
    `approval_breakdown`, `quick_exec`, and `repair`.
25. The `clarify` / `approval_task` / `approval_breakdown` / `repair` phases must call semantic Thoth tools through the provider runtime
    tool bridge; the `quick_exec` phase streams execution in the same secretary session and does not submit
    a Clarify authority card unless a new high-impact user decision point is encountered and it returns to `clarify`.
26. In Loop-2, the secretary session in `Loop` mode completes only Clarify and the two confirmation cards; after confirmation the daemon registers
    `registered_pending` and must not secretly run PlanExec / Review in the secretary session.
27. `submit_runtime_packet` / `submit_clarify_packet` are old generic names or a legacy bridge; the current primary semantic tools are
    `thoth_submit_clarify_card`, `thoth_submit_task_card`, `thoth_submit_pyramid_plan`, and
    `thoth_report_blocked`.
28. Tool/skill capabilities are injected through provider session config, Codex `dynamicTools`, MCP tools list,
    ACP/harness control surface, or a scoped runtime bridge; complete tool schemas or `SKILL.md` rules are not copied into each user prompt.
29. Ordinary same-state runtime context carries only runtime data, does not repeat Skill rules, and does not include `skill_ref`; runtime data includes
    controls / `clarify_strength` / `effective_clarify_strength`, transcript ref, assumption ledger ref,
    and decision-tree frontier ref.
30. State-transition turns carry `skill_ref` / digest / `according_to_loaded_skill` without copying transition rules;
    they carry `controls_changed` when Clarify strength changes.
31. Repair fixes only tool input shape / state / provenance; it does not reinterpret user intent or modify the transcript, goal, or
    confirmed CEO Task Card.
32. `thoth.clarify` / `thoth.loop` must not be installed in the user's global provider skill directories; they are visible only within the Thoth-owned
    provider session scope.

Acceptance:

1. A `thoth.clarify` skill/prompt contract exists and specifies agent behavior for every Clarify state code.
2. A convergence rubric exists defining when to continue asking, stop asking, answer directly through Quick, generate a Task Card, or enter blocked.
3. Behavioral-psychology question principles exist: highest-leverage behavior-tree branch, preservation of the user's original goal, no fallback degradation, no recommendation by default, avoidance of discoverable facts, avoidance of overly broad questions, and avoidance of repeated questions.
4. An eval harness exists that can simulate multiple Clarify rounds with a deterministic fixture provider or transcript fixture.
5. A Clarify golden dataset exists, recording user input, context, expected behavior-tree branch node, acceptable output range, prohibited question types, and low-cognitive-load judgment for each scenario.
6. Scenario eval covers the user saying `hi`: `Quick + none` must use the bare provider stream, without loading Clarify, submitting a packet, or producing a card; `Quick + clarify` may use an active Clarify direct response, without clarifying or producing a card. Both must reply briefly and naturally and must not use fixed daemon copy.
7. Scenario eval covers the user saying “help me get this project done properly”: ask the highest-leverage behavior-tree branch first, not a field questionnaire.
8. Scenario eval covers a vague but low-risk small task: do not over-clarify.
9. Scenario eval covers a request to register a background task with unclear acceptance criteria: ask about acceptance.
10. Scenario eval covers missing risk/permission/resource boundaries: ask about boundaries rather than technical implementation.
11. Scenario eval covers the user remaining vague after answering: the second-round question must advance the process and must not repeat.
12. Scenario eval covers information being sufficient: stop Clarify and output a task candidate.
13. Scenario eval covers the user saying “you decide” or requesting a recommendation: only then should the agent advise; when a technical judgment is better left to the agent, it should decide independently and record the assumption rather than repeatedly pushing the question back to the user.
14. Scenario eval covers a high-risk request: the agent requires explicit confirmation or permission.
15. Scenario eval covers contradictory requirements: the agent identifies the conflict and asks one decision question.
16. Scenario eval covers fallback degradation: for example, when the user requests A, the agent must not ask whether to do the easier B, an MVP, mock, demo, or partial substitute instead.
17. Scenario eval covers the standard Skill artifact: `SKILL.md` has YAML frontmatter, `name`,
    `description`, a Markdown body, state codes, transition rules, question rules, good/bad cases, and
    an output contract, and is not in a Codex-only format.
18. Scenario eval covers Clarify answer/card: the card has a title and 2-4 closely related questions;
    each question has short branch choices, each label is no longer than 15 characters, each explanation no longer than 30 characters, and each choice may carry a note or be left unselected with only a note.
19. Scenario eval covers the same Three.js PathTracing prompt producing different behavior under `none` / `light` / `balanced` / `dive`:
    `none` uses the bare provider foreground stream; `light` asks only the highest-impact core branch;
    `balanced` goes 1-2 levels into material leaves; `dive` continues eliminating material assumptions and proves that strength is not merely written into a field.
20. Scenario eval covers assumption ownership: `agent_can_decide`, `agent_can_discover`, and
    `standard_answer/common_sense` must not be pushed back to the user as questions.
21. Scenario eval covers `C_ASK` internal metadata: effective strength, tree depth, QA round count,
    remaining material assumptions, and question value reason.
22. An independent `codex exec` judge reviews golden transcripts to determine whether questions follow behavioral psychology, advance behavior-tree convergence, preserve the user's original goal, satisfy goals/constraints/acceptance, and avoid wasting user cognitive effort.
23. The judge review must explicitly identify any fallback goal degradation, low-value questions, field-questionnaire behavior, repeated questions, pushing discoverable facts to the user, unsolicited default recommendations, or failure to advance convergence.
24. Golden eval covers entering Task Card after multiple Clarify rounds: the runtime tool submission / authority event must contain the complete verbatim Clarify Q&A transcript, and Task Card content must be traceable to the transcript.
25. Golden eval covers entering Pyramid Plan Card after the user confirms Task Card: the runtime tool submission / authority event must contain both the complete verbatim Clarify Q&A transcript and the original CEO Task Card confirmed by the user; the second card must decompose goal levels rather than repeat the Task Card or contain implementation steps.
26. The independent judge must review whether the Task Card / Pyramid Plan Card omits, alters, invents, over-interprets, or deviates from the Clarify transcript and confirmed CEO Task Card.
27. Golden eval covers no-global-install, session-scoped-skill-visible, bare-provider-skill-invisible,
    normal-turn-does-not-repeat-skill-rules, transition-turn-carries-skill-reference, and
    repair-tool-input-shape-only.
28. Golden eval covers the semantic runtime tool bridge: structured phases must call exactly one appropriate
    Thoth semantic tool; `quick_exec` does not require a Thoth authority tool call; `submit_runtime_packet` /
    `submit_clarify_packet` are no longer the primary Clarify contract.
29. Golden eval covers prompt hygiene: tool schemas / `SKILL.md` rules are not copied into each user prompt; per-turn
    input contains only phase, state, controls, user input, transcript/provenance refs, and a short expectation.
30. Golden eval covers Quick wrap-up: after Task Card and Pyramid Plan Card confirmation, Mode=Quick enters streaming
    `quick_exec` in the same secretary session without registering a background task; Mode=Loop registers
    `registered_pending` in Loop-2 without starting PlanExec / Review.
31. The independent `codex exec` judge must review `SKILL.md`, invocation context, transition context, repair
    instruction, and golden outputs.
32. The independent `codex exec` user-interaction simulation must be based on the installed Thoth runtime artifact and simulate `hi`, a vague large task,
    Three.js PathTracing, branch answers, note-only answers, “you decide”, “enough/do not ask again”, unclear acceptance, risk/deletion boundaries,
    contradictory requirements, Task Card confirmation, and Pyramid Plan Card confirmation, with explicit PASS/FAIL.
33. Final acceptance criterion: the agent's questions feel like a secretary's, not a form's; they reduce user burden and can be judged by an independent judge to converge reliably;
    Quick+none preserves the bare-provider experience; Quick+clarify switches reliably among Clarify / approval / quick_exec phases;
    the final two confirmation cards have complete provenance; the internal runtime skill does not pollute the bare-provider environment;
    ordinary runtime context does not repeat Skill rules.

## 4. Loop Goal 2: Frontend App Refactor Foundation + Workspace Secretary Clarify Experience

Milestone：`NTH-MS-013`
TODO：`NTH-TD-016`
Order: second, frontend.

Goal:

Return to the original Paseo production-grade React Native / Expo / web / desktop app surface as the main frontend substrate for Thoth Loop-2; delete, revert, or isolate the currently self-written Thoth toy-shell main entry, and connect only the Thoth Clarify runtime, phase-aware context, Codex `dynamicTools` semantic runtime tool bridge, composer controls, pending decision authority, and AgentTimeline authority cards to Paseo's original stream / session / workspace / task/detail system.

The core of this loop is not “against Paseo”; it is to stop disguising the product with a toy shell. Paseo's mature UI capabilities must remain; the Thoth task-control-plane mental model must be connected through Clarify / runtime tool bridge / pending authority / AgentTimeline. The Paseo agent-manager mental model must not be preserved unchanged, and production-grade stream, composer, attachments, settings, panes, and responsive layout must not be discarded merely to rename things.

1. Restore / retain the original Paseo frontend app capabilities and layout as the primary entry.
2. Retain agent-stream, bottom anchor, turn boundary, virtualization, native-web render strategy, original composer, attachments, file drop, file links, markdown/code/diff/highlighted content, adaptive modal sheet, card/sheet primitives, settings, host picker, provider settings, relay pairing, diagnostics, workspace/session list/detail layout, terminal/browser/file panes, keyboard/focus/accessibility, desktop/mobile responsive layout, and the existing e2e/test harness.
3. Delete, revert, or isolate the main-path dependencies on `packages/app/src/thoth-app/thoth-app-shell.tsx` and toy-shell routes/e2e/snapshots.
4. Map three controls on the original Paseo composer: `Models` -> `Provider`, `Think` -> `Clarify`, `Feature` -> `Mode`.
5. `Provider` writes to `workspaceSecretary.providerSession` in daemon Settings or an equivalent provider-session configuration; mock/dev providers cannot be used for acceptance.
6. `Clarify` maps to `clarify_strength`, supporting at least `none/direct`, `light`, `balanced`, and `dive`; `auto` may be retained.
7. `Mode` maps to `Quick` / `Loop`; Quick is foreground conversation and does not register a background task; Loop enters Clarify convergence and the subsequent task-contract path.
8. Clarify cards render stably in Paseo's original transcript / agent-stream, not as a separate page or toy-shell card.
9. This round uses Paseo's original session/workspace/task/detail view system as the primary system for Loop/task/background state; a minimal Background Tasks browsing entry may show a `registered_pending` list and details, but must not pretend to be PlanExec / Review.
10. Settings retain original Paseo capabilities and connect provider/session, clarify runtime status, relay status, workspace/session diagnostics, and required internal-skills status; real relay acceptance is bound to `relay.test.thoth.seeles.ai`.
11. The real provider AgentTimeline is the user-visible experience: bare provider text and thinking/progress/tool/evidence events from `Quick + none` stream into AgentTimeline; Clarify / Task / Pyramid cards must come from validated semantic runtime tool submission and render atomically after complete validation.
12. The `Quick + clarify` UI journey must support `clarify -> approval_task -> approval_breakdown -> quick_exec`, with `quick_exec` streaming in the foreground within the same session and no background-registration result displayed.

Constraints:

1. Do not write a parallel Thoth app shell; the current toy shell cannot remain the primary entry.
2. Do not use `WORKSPACE SECRETARY`, `Current request convergence`, `Quick foreground · Loop background`, `Real provider connected`, `Both Quick and Loop write history through real provider results`, `Current secretary topic`, `New secretary topic`, complete `/mnt/cfs/...` paths, `provider-backed clean UI model`, `C_DIRECT` / `C_ASK`, packets, repair, schemas, raw JSON, provider roles, or other internal mechanisms as production main-screen copy.
3. These internal details may appear in Settings diagnostics, tooltips, or test assertions, but not as the primary visual language or ordinary user path.
4. The frontend must not display `thoth.clarify`, `SKILL.md`, packets, state codes, repair, provider roles, PlanExec, Review, raw JSON, schema errors, or runtime skill invocation.
5. The frontend must not locally decide whether to continue Clarify, whether convergence has occurred, or whether to enter Task Card or blocked; it must not infer UI state from assistant text, markdown JSON, code fences, snippets, or raw packets, and may consume only AgentTimeline items and typed authority card models provided by daemon/client/protocol.
6. The frontend must not locally generate semantic cards, Task Cards, or Pyramid Plan Cards; it must not choose defaults for the user or use first-option fallback.
7. The frontend must not wrap an ordinary provider stream from `Quick + none` as a Clarify card or display skill, packet, repair, or structured-output failure under `Quick + none`.
8. If the protocol view model is not yet complete, use only a clearly named development fixture adapter; fixture/mock/dev paths must not impersonate production authority or fake relay-connected status; Quick / Clarify / Loop acceptance must not use an offline fixture, mock success, or deterministic daemon reply/card instead of a real provider.
9. A Clarify card must be a Thoth decision card, not a re-skinned `request_user_input`, `AskUserQuestion`, permission question, or command-line prompt; it should, however, reuse Paseo's existing card/request-user-input rendering capabilities.
10. A Clarify card supports a title, why-now, 2-4 closely related questions, 2-4 short choices per question, a short explanation per choice, per-option note, note-only, “your recommendation”, and “you decide”; after submission it is readonly, and multiple rounds must not overwrite history.
11. Do not preselect, recommend by default, or use visual weight to lead the user through default choices; submit structured intent only when the user actively selects “your recommendation” or “you decide”.
12. Mobile and desktop have equal acceptance requirements; a Clarify card must not cover the composer, compress the chat stream, cause keyboard occlusion, overflow buttons, or create unrecoverable scrolling.
13. No visible voice/audio/dictation capability may be added or retained; do not reuse, probe, or fall back to the Paseo/legacy daemon at `127.0.0.1:6767`; do not use `#`, `example.com`, a localhost relay, a fake device link, or mock success to impersonate a real relay.
14. `.agent-os/upstreams/paseo` may be used only as an ignored reference; it must not be staged/committed or become a runtime dependency.
15. “No fallback” means no functional fallback: without a real provider, real relay, and qualified semantic runtime tool bridge, the UI must show an honest unavailable / blocked / needs provider / unsupported / needs relay state and block the action. It must not use fixed local replies, mock success, offline fixtures, provider waterfalls, first-option fallback, assistant markdown JSON extraction, text parsing, fake providers, fake cards, or fake relays to impersonate completion.
16. Ordinary assistant responses are progressively rendered as AgentTimeline; Clarify Card, Task Card, and Pyramid Plan Card must aggregate the complete runtime tool input and be appended as complete cards only after daemon schema/provenance/authority validation, with no partial card, partial choice, or partial approval button.

Acceptance:

1. The anti-toy-shell / anti-internal-copy residual scan passes: the production main interface has no toy-shell copy, acceptance copy, complete local paths, or packet/schema/raw JSON/provider-role/state-code/repair leakage; the minimal Background Tasks entry may show only `registered_pending` and must not become a fake PlanExec / Review toy main view.
2. The Paseo capability-retention scan/source review passes: the main path still uses agent-stream, bottom anchor, turn boundary, virtualization/native-web render strategy, original composer, attachments/file drop/file links, markdown/code/diff/highlighted content, adaptive sheets/cards, settings, host/provider, relay pairing, diagnostics, workspace/session list/detail layout, terminal/browser/file panes, responsive layout, and the e2e/test harness.
3. Composer controls pass: Provider / Clarify / Mode appear in the original composer control area; Provider writes real provider/session configuration; Clarify maps to strength; Mode maps to Quick/Loop; attachments, slash commands, drafts, keyboard, send, focus, and mobile behavior do not regress.
4. Clarify card passes: the card renders stably in the Paseo transcript / agent-stream and supports a title, why-now, 2-4 closely related questions, 2-4 short choices per question, short explanations, per-option note, note-only, “your recommendation”, “you decide”, submitted readonly state, and history preservation across rounds.
5. The authority boundary passes: source review proves that the app renders only AgentTimeline items and typed authority card models, does not parse assistant text, markdown JSON, code fences, snippets, or raw packets, does not locally judge convergence, does not generate Task/Pyramid Cards, and does not choose for the user.
6. Stream/render review passes: real provider-backed bare text and thinking/progress/tool/evidence from `Quick + none` display progressively; Clarify / Task / Pyramid cards appear atomically only after validated semantic runtime tool submission and daemon validation.
7. Tests pass: Clarify card component/unit tests, `npm --workspace=@thoth/app run test`, Loop-2 narrow real-provider e2e, `npm run build:web`, real `relay.test.thoth.seeles.ai` acceptance, and `npm run check:foundation` are all actually run and recorded.
8. The real journey passes: `hi` under `Quick + none` is a bare provider stream with no Clarify card/packet/repair; `Quick + clarify` supports Clarify -> Task Card -> Pyramid Plan Card -> same-session `quick_exec`; Quick -> Loop -> Clarify -> two-card confirmation -> `registered_pending` is stable; without a configured real provider/relay/bridge, actions are honestly blocked rather than fake success.
9. Visual evidence is complete: save desktop and mobile screenshots, a screenshot showing the retained original Paseo app layout, composer Provider/Clarify/Mode screenshots, a streaming Quick screenshot or trace, a `hi` no-card screenshot, a complete atomic Clarify card screenshot, a submitted readonly card screenshot, Task/Pyramid cards, quick_exec Shell/Edit timeline, registered_pending, Settings real relay status, and a Playwright trace/video.
10. Screenshots must be opened and reviewed with `view_image`; merely proving that the files exist is insufficient.
11. The independent UI mental-model review passes: an independent `codex exec` sees only screenshots, traces, key code summaries, and the acceptance checklist; if it finds a toy shell, damaged Paseo capabilities, a degraded composer, unstable Clarify cards, Quick+none turned into a protocolized flow, `quick_exec` unlike ordinary provider execution, non-atomic authority cards, app parsing of raw packets/markdown JSON, fake provider/relay/mock success, user-visible debug/acceptance copy, or fake Background Tasks running/review, it returns FAIL.
12. `.agent-os` bookkeeping is complete: update change-decisions, loop goals, goal prompt, architecture milestones, todo, project-index, acceptance-report, run-log, and lessons-learned when necessary; if any key evidence is missing, `NTH-TD-016` remains doing or blocked and must not be verified.

Current Result:

`NTH-TD-016` / `NTH-MS-013` has been verified by `NTH-EV-029`. `NTH-EV-026` and `NTH-EV-028` are historical evidence:
they proved portions of the mechanisms for the three-view toy Workspace Secretary shell, provider-backed streaming, and atomic Clarify QA cards,
but are no longer current Loop-2 authority. Current passing evidence proves that the restored Paseo app surface is the main path,
Paseo production capabilities have not regressed, and the toy shell is no longer the user entry; `Quick + none` is a bare Codex/Paseo stream;
`Quick + Dive` calls semantic Thoth runtime tools through Codex app-server `dynamicTools` / `item/tool/call`;
Clarify/Task/Pyramid cards render into AgentTimeline through pending authority decisions;
same-session Quick `quick_exec` displays a real Shell/Edit timeline; after Loop confirmation, only durable
`registered_pending` is registered, without faking PlanExec / Review.

## 5. Loop Goal 3: Backend Task Contract Compiler + Approval Harness

Milestone：`NTH-MS-014`
TODO：`NTH-TD-017`
Order: third, backend.

Goal:

Implement the `thoth.clarify` agent harness from converged intent to an approvable task contract. Enable the secretary agent to compile multiple rounds of Clarify results into two contract layers: a CEO-level Task Card and a Pyramid Plan Card.

The core of this loop is to make the agent write contracts, not plans.

Constraints:

1. Task Card must not be an implementation plan; it must be complete approval material.
2. Pyramid Plan Card must not be a step-by-step execution plan; it may only be a goal pyramid of target / stages / subgoals / acceptance evidence.
3. Task Card permits only `title`, `goal`, `constraints`, and `acceptance`.
4. The agent must determine when not to register Loop and to remain in Quick instead.
5. The agent must turn vague user language into clear acceptance criteria without inventing goals the user did not authorize.
6. If acceptance criteria are insufficient, it must return to Clarify rather than force a contract.
7. The daemon's two-confirmation gate is a mechanical guarantee, but contract quality comes from the agent harness.
8. The contract must be CEO-readable, concise, precise, and approvable.

Acceptance:

1. A Task Contract Compiler prompt/rubric exists.
2. A Task Card rubric exists, covering only `title`, `goal`, `constraints`, and `acceptance`, and explicitly prohibiting `risk`, `why_loop`, and implementation plan.
3. A Pyramid Plan Card rubric exists, ensuring target / stages / subgoals / acceptance evidence are hierarchical, traceable, and not an implementation plan.
4. Eval covers a converged small task: the agent recommends Quick and does not register Loop.
5. Eval covers a converged background task: the agent outputs a Task Card.
6. Eval covers unclear acceptance: the agent returns to Clarify.
7. Eval covers a very large user goal: the agent decomposes it into a small number of hierarchical stages / subgoals.
8. Eval covers the agent not writing an implementation plan into the Pyramid Plan Card.
9. Eval covers the agent not pushing execution details it can decide itself to the user.
10. Eval covers the agent updating the contract after the user modifies the Task Card.
11. Eval covers the agent preserving constraint consistency after the user modifies the Pyramid Plan Card.
12. Eval covers high-risk tasks expressing boundaries through constraints / acceptance without adding a risk field.
13. Contract content must be validatable by the daemon runtime tool/card schema.
14. Final acceptance criterion: the agent can compile Clarify results into a task contract the user is willing to approve, a subsequent agent can execute, and Review can accept.

## 6. Loop Goal 4: Frontend Task / Pyramid Plan Approval Experience

Milestone：`NTH-MS-015`
TODO：`NTH-TD-018`
Order: fourth, frontend.

Goal:

Turn Loop 3's contract-compilation capability into an approvable user experience. Users should not see system-generated JSON; they should see the secretary present two clear, lightweight, editable approval cards: Task Card and Pyramid Plan Card.

The core of this loop is to let users approve a task organized by a secretary like a CEO, rather than inspect a schema like an engineer.

Constraints:

1. Task Card must be compact and must not become a PRD or plan document.
2. Pyramid Plan Card must express target / stages / subgoals / acceptance evidence as a goal pyramid and must not list execution steps, file paths, or commands.
3. The user must be able to modify, confirm, cancel, or remain in Quick.
4. Both confirmations must be clear user actions.
5. The UI must not display packets, state codes, or skills.
6. When the user modifies a contract, return to the agent harness for reorganization rather than modifying authority locally in the frontend.
7. After confirmation, return to Workspace Secretary; do not send the user to a background log page.
8. The same secretary session can continue Quick and can later register another Loop.

Acceptance:

1. Workspace Secretary can display a Task Card.
2. Task Card supports registering as a background task, remaining in Quick, modification, and cancellation.
3. After the user modifies a Task Card, the agent can regenerate a better Task Card.
4. The Pyramid Plan Card appears after the first confirmation.
5. Pyramid Plan Card displays goal hierarchy, stages, subgoals, and acceptance evidence; it does not repeat the full Task Card or display risk.
6. Pyramid Plan Card supports confirmation and registration, modification, and cancellation.
7. After the user confirms the Pyramid Plan Card, display a Registered Card and a Background Task link.
8. After registration, the composer returns to Quick and the user can continue chatting.
9. E2E covers Task Card modification, cancellation, and confirmation; Pyramid Plan Card modification, cancellation, and confirmation; and returning to Quick after registration.
10. Acceptance focuses on low-burden user approval, not forcing the user to understand the backend state machine.

## 7. Loop Goal 5: Backend Loop Execution + Review Agent Harness

Milestone：`NTH-MS-016`
TODO：`NTH-TD-019`
Order: fifth, backend.

Goal:

Implement the `thoth.loop` agent harness so that background PlanExec and Review provider sessions can execute against a frozen contract, request permission, produce evidence, advance themselves, accept independent review, and form non-repeating retry guidance on failure.

The core of this loop is to make the background agent capable of execution and self-review, rather than making the daemon run a task queue.

Constraints:

1. PlanExec may advance only the current goal and must not skip goals.
2. PlanExec may investigate, execute, and verify independently, but high-risk actions require permission.
3. PlanExec must not repeatedly push questions already frozen after Clarify back to the user.
4. If the provider asks about execution details, Thoth should answer from the frozen contract or recommended defaults and record the answer.
5. The Review session must be independent and must not modify the workspace.
6. Review is not synonymous with running tests, checking PlanExec's self-report, or filling out an acceptance matrix; it must independently challenge the current path and determine whether the problem definition, method, or architecture is already wrong.
7. A failed Review must identify the true crux, the wrong path to abandon, and the highest-leverage direction for the next round; local patching is allowed only when it remains the correct path.
8. Loop retry is not a mechanical rerun; an independent Review's directional judgment must change the strategy.
9. `Goal x/y`, `Round a/b`, task/phase id, budget, receipt, manifest, and recovery state constrain only daemon scheduling and recovery; they must not become the Agent Harness prompt/tool mental model.
10. The daemon handles session orchestration, packet repair, permission gate, stream/evidence persistence, binding the minimal semantic conclusion to authority state, and recovery.

Acceptance:

1. A `thoth.loop` skill/prompt contract exists.
2. A PlanExec behavior rubric exists.
3. A Review behavior rubric exists.
4. A retry/non-repetition rubric exists.
5. A Loop golden dataset exists, recording frozen contracts, expected behavior, prohibited strategies, and evidence requirements for single-goal, multi-goal, permission, review, retry, blocked, and done scenarios.
6. A deterministic or fixture harness covers successful single-goal execution.
7. The harness covers multiple goals advancing only the current goal.
8. The harness covers PlanExec stopping and requesting permission when it encounters a permissioned action.
9. The harness covers PlanExec using the frozen contract or recommended defaults for omitted execution details without repeatedly asking the user.
10. The harness covers Review pass producing an independent, explainable completion judgment rather than repeating the executor's report.
11. The harness covers Review fail identifying the true crux, clearly naming the path to abandon, and specifying the change for the next round.
12. The harness covers retry changing strategy through directional judgment rather than mechanically patching or repeating commands on the same approach.
13. The harness covers the Review session being unable to modify the workspace.
14. The harness covers a user-understandable blocker when a task is blocked.
15. The harness covers an evidence summary when a task is done.
16. An independent `codex exec` judge reviews golden Loop transcripts to determine whether PlanExec follows the frozen contract, whether Review independently challenges the current path, whether it reaches the root cause, whether it dares to reject incremental traps, and whether retry truly changes strategy without wasting user cognitive effort.
17. The judge review must explicitly identify skipping goals, ignoring constraints, pushing frozen execution details back to the user, insufficient evidence, Review being reduced to test-running/form checking, being led by PlanExec, mechanical reruns, or unintelligible blockers.
18. Final acceptance criterion: the background agent does more than run commands; it advances under the frozen contract, while Review acts as independent corrective intelligence that directs the next round toward a more correct method after failure rather than leaving behind field-complete fake evidence.

## 8. Loop Goal 6: Frontend Loop/Task Dogfood Mapping

Milestone：`NTH-MS-017`
TODO：`NTH-TD-020`
Order: sixth, frontend.

Goal:

Integrate the Clarify, Contract, Loop, and Review agent-harness outputs into a user-perceivable MVP closed loop. The frontend continues to use the restored Paseo session/workspace/task/detail view system as its substrate: Settings provides configuration, the session/workspace transcript carries Clarify and contract cards, and the task/detail surface shows background execution, evidence, permissions, review, retry, completion, or blocked state.

The core of this loop is to make users feel that Thoth is genuinely a secretary system that accepts tasks, advances them in the background, and reports progress.

Constraints:

1. Do not create an independent Background Tasks toy main view.
2. By default, show only information a CEO can understand: task goal, constraints, acceptance, current goal, current round, and whether user action is needed.
3. The provider stream may be expanded but must not become the main interface.
4. Translate the Review verdict into a user-understandable state.
5. A permission request must emphasize risk and decision, not technical logs.
6. done must have an evidence summary.
7. blocked must explain what judgment the user needs to make.
8. Web/Desktop are different packaging of the same APP experience; do not create a separate mock review page.
9. TUI is not included in this APP MVP loop.
10. Do not leak relay tokens, raw offers, credentials, or the `6767` fallback.

Acceptance:

1. End-to-end dogfood smoke covers Settings displaying provider, daemon, and runtime skill status.
2. Dogfood smoke covers completing Clarify in the restored session/workspace transcript.
3. Dogfood smoke covers user approval of the Task Card.
4. Dogfood smoke covers user approval of the Pyramid Plan Card.
5. Dogfood smoke covers a registered task appearing in the restored task/detail surface.
6. Dogfood smoke covers the current goal displaying running.
7. Dogfood smoke covers expanding the stream for inspection.
8. Dogfood smoke covers the user handling a permission request.
9. Dogfood smoke covers displaying Review status.
10. Dogfood smoke covers displaying a retry round after a failed Review.
11. Dogfood smoke covers a passed goal turning green.
12. Dogfood smoke covers task done displaying an evidence summary, or blocked displaying the user's next step.
13. Web static export has a real smoke test/screenshot.
14. Desktop dev/review entry has a real smoke test/screenshot.
15. The UI does not expose internal concepts such as packets, skills, or provider roles.
16. Final acceptance criterion: users can begin with a vague intent, pass through secretary clarification, contract approval, background execution, and Review reporting, and see a complete task loop.
