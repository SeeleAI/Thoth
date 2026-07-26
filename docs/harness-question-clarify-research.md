# Harness Question And Clarify Research

## Status

1. Date: `2026-07-04`
2. Nature: Research conclusions on Claude Code `AskUserQuestion`, Codex `request_user_input`, and OpenCode `question` / `question.asked`
3. Purpose: To inform the design of Thoth Clarify, provider-question, permission-card, and post-contract-freeze auto-answer
4. Scope: Official documentation, the local Codex schema, Multica source, Paseo source, OpenCode docs/source, publicly available Claude Code prompt-extraction materials, and corroborating local Claude Code binary strings
5. Non-goals: Do not implement the runtime or replace `.agent-os/designs/*` canonical authority

## 1. Verdict

Claude Code `AskUserQuestion`, Codex `request_user_input`, and OpenCode `question` / `question.asked` are all provider-/harness-native user-input transports.

They solve: pausing during execution, having the provider hand a question to the host, having the host display the question, and having the host serialize the answer back to the provider.

They do not fully solve: when to ask, what constitutes a high-value question, which facts the agent should investigate itself, how to avoid turning questions into field questionnaires, how to converge ambiguous intent into a verifiable contract, how to distinguish clarification / permission / Task Card approval, or how to prevent PlanExec from repeatedly asking the user after contract freeze.

However, the latest visible prompts / tool descriptions reveal a clear direction:

1. OpenCode `question` is a relatively broad execution-time question tool, allowing execution-time questions about preferences, requirements, direction, implementation choices, and so on.
2. Claude Code `AskUserQuestion` is a narrow-scope genuine user-owned decision blocker: ask only when the answer changes the next action and cannot be resolved from the request, code, or a reasonable default.
3. Claude Code also expresses “read-only research before clarify” as a system prompt: grep / consult docs / consult memory first, then ask a more specific question.
4. Thoth should absorb Claude Code's narrow scope and research-first principle rather than directly turning OpenCode's broad scope into product semantics.

Conclusions for Thoth:

1. Thoth Clarify cannot be a thin wrapper around a native question tool.
2. `AskUserQuestion` / `request_user_input` / `question.asked` should enter Thoth's `ProviderQuestionEvent` or `ClarificationCardCandidate` layer.
3. Thoth product semantics remain defined by the `thoth.clarify` secretary skill, behavior-tree convergence rules, daemon validator, authority store, and evidence ledger.
4. The UI may reuse capabilities similar to the Paseo question card, but must not expose `request_user_input`, `AskUserQuestion`, `permission question`, provider role, packet, state code, or raw JSON.

In one sentence: all three tools provide a channel for “asking the user,” but Thoth must own the authority over “whether to ask, what to ask, how to record it, and when to stop asking.”

## 2. Source And Evidence Map

| Category                     | Source                                                                                                   | Key Evidence                                                                                                                                                                                                                                                                                           |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude official              | `https://code.claude.com/docs/en/agent-sdk/user-input`                                                   | `AskUserQuestion` and tool approval both trigger `canUseTool`; execution pauses until the host responds; Claude generates the questions/options; the host only displays and returns them; 1-4 questions, 2-4 options per question; currently unavailable to subagents; complex input uses custom tools |
| Claude extracted prompts     | `Piebald-AI/claude-code-system-prompts`                                                                  | The README explains that prompt/tool-description strings are extracted from the Claude Code compiled package; `tool-description-askuserquestion.md`, decision guidance, preview field, and clarifying-question research-first prompt expose real usage thresholds and constraints                      |
| Claude local binary evidence | `/root/.local/share/claude/versions/2.1.159` via `strings`                                               | The local binary exposes strings including `AskUserQuestion`, `multiSelect`, `previewFormat`, unique question/option labels, plan-mode guidance, and preview guidance; corroborating evidence only, not a publicly stable API                                                                          |
| Codex official/schema        | `https://developers.openai.com/codex/app-server` + `codex app-server generate-json-schema`               | The local `codex-cli 0.134.0` schema has `item/tool/requestUserInput`; `ToolRequestUserInputParams` is marked `EXPERIMENTAL`; required: `itemId/threadId/turnId/questions`; question required: `id/header/question`; optional: `options/isOther/isSecret`; response: id-keyed `{ answers: string[] }`  |
| OpenCode official            | `https://opencode.ai/docs/tools/`                                                                        | The `question` tool lets the LLM ask the user during execution; each question has a header, question text, and options; the user can select an option or provide a custom answer; page last updated `Jul 3, 2026`                                                                                      |
| OpenCode source              | `sst/opencode` / `anomalyco/opencode` raw source                                                         | `QuestionTool` uses `question.txt` as its tool description; `QuestionTool` calls `question.ask`; the runtime publishes `question.asked`; after host `reply/reject`, it publishes `question.replied/question.rejected`; answers are ordered `string[][]`                                                |
| Multica Claude               | `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/claude.go`                                         | Claude runs in non-interactive `stream-json` mode with explicit `--disallowedTools AskUserQuestion`; comments explain that otherwise the user may not see the question, an empty answer may be returned, and the agent may infer silently                                                              |
| Multica OpenCode             | `/mnt/cfs/5vr0p6/yzy/harness/multica/server/pkg/agent/opencode.go`                                       | OpenCode daemon mode uses `--dangerously-skip-permissions` and explains that it does not rely on `OPENCODE_PERMISSION`, avoiding `permission.question` being bypassed by wildcard allow                                                                                                                |
| Paseo Claude                 | `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/claude/agent.ts`           | `AskUserQuestion` -> `kind="question"`; the host adds `allowOther`; on return, UI header-keyed answers are mapped to the full-question-text keys required by Claude                                                                                                                                    |
| Paseo Codex                  | `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/codex-app-server-agent.ts` | `request_user_input` -> timeline `tool_call` + `permission_requested(kind="question")`; UI header-keyed answers are mapped to Codex id-keyed answers; first-option fallback risk exists                                                                                                                |
| Paseo OpenCode               | `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/server/src/server/agent/providers/opencode-agent.ts`         | Listens for `question.asked`; `multiple` -> `multiSelect`; adds `allowOther`; emits `permission_requested(kind="question", name="question")`                                                                                                                                                           |
| Paseo UI                     | `/mnt/cfs/5vr0p6/yzy/harness/paseo/packages/app/src/components/question-form-card-core.ts`               | The question card supports options, multiSelect, allowOther/isOther, allowEmpty, dismiss, and header-keyed answers                                                                                                                                                                                     |

Repro command:

```bash
codex --version
codex app-server generate-json-schema --out /tmp/codex-app-schema.XF4YEd
```

## 3. Claude Code `AskUserQuestion`

Mechanism:

1. Claude requests user input in two forms: tool approval and clarifying questions.
2. Both use the `canUseTool` callback.
3. `AskUserQuestion` is not ordinary assistant text; it is part of the tool-use / permission-callback mechanism.
4. Claude execution pauses while the callback is pending.
5. Claude generates the questions/options; the host displays and returns them.
6. The host cannot insert its own questions into the `AskUserQuestion` flow; application-owned questions must be implemented separately.
7. If the `tools` array is restricted, it must include `AskUserQuestion`, or Claude cannot ask clarifying questions.

Shape:

1. request: `questions[]`, with `question/header/options/multiSelect` for each question.
2. `header` is a short label; the official documentation says max 12 chars.
3. `options` usually contains 2-4 items, each with `label/description`; TypeScript may also have an option `preview`.
4. response: return `questions` unchanged; use the full question text as the key in `answers`.
5. Free text / Other is a host UI path, not a native Claude option item.

Paseo mapping:

1. `normalizeClaudeAskUserQuestionRequestInput` adds host-only `allowOther: true` to each question.
2. `resolvePermissionKind` maps `AskUserQuestion` + the questions array to `kind="question"`.
3. `normalizeClaudeAskUserQuestionUpdatedInput` maps `{ Provider: "Claude" }` to `{ "Which provider should I use?": "Claude" }` and strips host-only `allowOther`.

Multica mapping:

1. Both Claude / CodeBuddy add `--disallowedTools AskUserQuestion`.
2. Reason: the non-interactive stream-json daemon has no UI to render the prompt; the call may return an empty answer; the agent may infer silently; the user cannot see the question.

Implications for Thoth:

1. Enable native questions only when Thoth daemon/UI/relay/pending state can reliably receive them.
2. When they cannot be received, disable native questions and use a Thoth `C_ASK` packet or ordinary text.

Key points from the extracted preset prompt / tool description:

1. Core threshold: use it only when blocked by a decision that genuinely belongs to the user; that decision cannot be resolved from the request, code, or a reasonable default.
2. `2.1.173` decision guidance: if the user's answer will not change the next action, do not ask; choose conventional defaults yourself; investigate facts that can be verified in the codebase yourself.
3. `2.1.173` research-first prompt: clarifying questions interrupt the user; before asking, spend at most about a minute on read-only investigation, such as grepping code, consulting docs, or consulting memory, to make the question more specific.
4. Plan mode guidance: do not use `AskUserQuestion` to ask “Is the plan okay / Should I continue?”; use it for requirement clarification and approach selection, while plan approval goes through `ExitPlanMode`.
5. UI custom input: the user can always choose Other / custom input; the model must not put `Other` or a catch-all item in options.
6. Recommended option: when there is a recommendation, put it first and append `(Recommended)` to its label.
7. Multi-select: use `multiSelect: true` for multiple selection, and word the question to make clear that multiple choices are allowed.
8. Preview: use only for single-select questions when the user needs visual comparison; suitable for UI mockups, code approaches, and diagrams; not for simple preference questions.

Observed schema / validation hints:

1. Each `AskUserQuestion` call has 1-4 questions, with 2-4 options per question.
2. Question text must be unique; option labels must be unique within a question.
3. `question` should be clear and specific, and end with a question mark.
4. `header` is a short chip/tag; the official Agent SDK documentation says max 12 chars.
5. Option labels should be short, about 1-5 words; the description explains meaning, consequences, or trade-offs.
6. Preview HTML must be a self-contained fragment; do not use an `<html>/<body>` wrapper; do not use `<script>` / `<style>`; use inline styles.
7. Preview supports only single-select and does not support `multiSelect`.

Claude Code product meaning:

1. `AskUserQuestion` is not a “questionnaire tool”; it is a “user-decision blocker tool.”
2. `AskUserQuestion` is not an approval tool; approval / permission / plan approval each have an independent path.
3. The actual strategy is self-investigate -> pick a sensible default -> ask only if the user's answer changes the action.
4. This is closer to Thoth's CEO personal-secretary model than OpenCode's execution-time question.

## 4. Codex `request_user_input`

Mechanism:

1. The Codex app-server sends a server request: `item/tool/requestUserInput`.
2. params contains `itemId/threadId/turnId/questions`.
3. The host displays the questions and returns `answers`.
4. Codex continues the turn.

Local schema summary:

1. `ToolRequestUserInputParams`: `itemId: string`, `threadId: string`, `turnId: string`, `questions: Question[]`.
2. `Question`: required `id/header/question`, optional `options/isOther/isSecret`.
3. `Option`: required `label/description`.
4. `ToolRequestUserInputResponse`: `answers: Record<questionId, { answers: string[] }>`.
5. The current schema marks this protocol `EXPERIMENTAL`.

Paseo mapping:

1. `normalizeCodexQuestionPrompts` requires `id/header/question` and preserves `multiSelect/isOther/isSecret`.
2. `mapCodexQuestionRequestToToolCall` creates a timeline `tool_call` with `name="request_user_input"`.
3. `handleToolApprovalRequest` creates `permission_requested(kind="question")`.
4. A UI header-keyed answer such as `{ Confirm: "Yes" }` is mapped to the Codex id-keyed `{ confirm_path: { answers: ["Yes"] } }`.

Risks:

1. Paseo can fall back to the first option for each question when it allows the request but has no mapped answers.
2. Thoth Clarify must not copy this: it would fabricate a user choice.
3. Automatic selection is allowed only when the user explicitly says “you decide,” under a post-contract-freeze auto-answer policy, or for an explicit agent-owned assumption.
4. Every automatic selection must be recorded as non-user-decision evidence.

## 5. OpenCode `question` / `question.asked`

Mechanism:

1. The LLM calls OpenCode's built-in `question` tool.
2. `QuestionTool.execute` calls `question.ask(...)`.
3. `question.ask()` generates an id, puts it in the pending map, and publishes `question.asked`.
4. The host replies or rejects.
5. The runtime publishes `question.replied` or `question.rejected`.
6. Tool execution resumes, and the user's answer is returned to the LLM as tool output.

Observed schema:

1. `QuestionInfo`: `question/header/options/multiple?/custom?`.
2. `Option`: `label/description`.
3. `QuestionRequest`: `id/sessionID/questions/tool?`.
4. `QuestionReply`: `answers: string[][]`.
5. event types: `question.asked`, `question.replied`, `question.rejected`.

Key points from the preset prompt / tool description:

1. OpenCode `question` is used to ask the user during execution.
2. Uses include collecting preferences/requirements, clarifying ambiguous instructions, requesting an implementation choice, and offering the user a choice of direction.
3. `custom` is enabled by default; the host automatically adds custom input; the model must not provide its own `Other` or catch-all option.
4. answers are returned as label arrays ordered by question.
5. The multiple-selection field is `multiple: true`.
6. If there is a recommended option, put it first and append `(Recommended)` to its label.

OpenCode schema annotations:

1. option `label`: display text, about 1-5 words, and concise.
2. option `description`: explains the choice.
3. `question`: the complete question.
4. `header`: a very short label; the source schema says max 30 chars.
5. `options`: available choices.
6. `multiple`: allows multiple selection.
7. `custom`: allows custom input, default true.
8. reply `answers`: returned in question order; each answer is an array of selected labels.

OpenCode product meaning:

1. It is a more general, broader question transport.
2. Its prompt does not have Claude Code's “only when genuinely user-owned decision” threshold.
3. Therefore Thoth cannot directly inherit OpenCode's should-ask policy.
4. Thoth can borrow OpenCode's asked/replied/rejected event lifecycle and ordered answers, but the should-ask rule must be decided by Thoth authority.

Paseo mapping:

1. Listen for `question.asked`.
2. Ignore a session mismatch.
3. Each question must have `question/header`.
4. `multiple === true` -> `multiSelect: true`.
5. Add `allowOther: true`.
6. Emit `permission_requested(kind="question", provider="opencode", name="question")`.
7. Real e2e forces OpenCode to ask exactly one clarifying question and asserts that the pending permission has `kind === "question"`.

Multica contrast:

1. OpenCode daemon mode uses `--dangerously-skip-permissions`.
2. Comments explain that it does not rely on `OPENCODE_PERMISSION`, avoiding merge/order bypasses involving `permission.question` and wildcard allow.
3. Current OpenCode run sessions inject question / plan deny rules.

Implications for Thoth:

1. OpenCode native questions are available, but permission configuration, full-access, and skip-permission change behavior.
2. The driver must perform capability diagnostics and conformance tests.

## 6. Cross-Provider Comparison

| Dimension           | Claude                             | Codex                            | OpenCode                                  |
| ------------------- | ---------------------------------- | -------------------------------- | ----------------------------------------- |
| Native object       | `AskUserQuestion` tool             | app-server `request_user_input`  | `question` tool                           |
| Callback/event      | `canUseTool`                       | `item/tool/requestUserInput`     | `question.asked`                          |
| Answer key          | full question text                 | question id                      | ordered arrays                            |
| Custom answer       | host-side Other                    | `isOther`                        | `custom`, default true in observed schema |
| Secret              | not observed                       | `isSecret`                       | not observed                              |
| Multi-select        | `multiSelect`                      | adapter optional                 | `multiple`                                |
| Permission relation | shares `canUseTool` with approval  | Paseo maps to `kind=question`    | Paseo maps to `kind=question`             |
| Main risk           | noninteractive host hides question | experimental + fallback behavior | config/full-access affects surfacing      |

Prompt philosophy comparison:

| Dimension             | Claude Code `AskUserQuestion`                                                                 | OpenCode `question`                                                              |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Ask threshold         | Narrow: a genuine user-decision blocker that cannot be resolved through context/code/defaults | Broad: asking the user during execution is sufficient                            |
| Pre-question research | Explicitly requires a short read-only investigation first                                     | Not enforced by the tool description                                             |
| Default policy        | Agent selects and explains conventional defaults                                              | Agent self-selection of defaults is not emphasized                               |
| User answer impact    | The user's answer must change the next action                                                 | Can be used for preferences, requirements, direction, and implementation choices |
| Plan approval         | Must not use it to ask whether the plan is executable                                         | No equivalent plan-mode semantics                                                |
| Product fit for Thoth | Closer to secretary-style high-value questions                                                | Better suited as a general transport                                             |

Shared constraints:

1. Do not put `Other` in options; custom input is provided by the host/UI.
2. Put the recommended option first and mark it `(Recommended)` in the label.
3. Keep option labels short and use descriptions to explain consequences.
4. Multiple selection must be explicitly enabled, and options need not be mutually exclusive.
5. The tool result must clearly return the user's answer so the agent can continue execution with it.

## 7. UI Substrate: Reuse Carefully

The Paseo question card supports `question/header/options/multiSelect/allowOther/allowEmpty/placeholder/dismissLabel`.

Useful for Thoth:

1. Multi-question navigation.
2. Options and multi-select.
3. Freeform / other.
4. Dismiss / empty answer.
5. Submitted read-only state.

Not reusable as product semantics:

1. The user-visible “question permission” mental model.
2. Provider header as the canonical answer key.
3. `permission_requested` as the Clarify authority event.
4. First-option default.
5. Exposure of the raw provider schema.

## 8. Thoth Product Semantics

Borrow:

1. From Claude: approval and clarification must remain semantically separate even when they share a callback; compact question limits; host-side Other; long-lived pending states require durable authority.
2. From Claude prompt extraction: ask only when blocked by a genuine user decision; investigate before asking; the user's answer must change the next action; do not use clarify for plan approval.
3. From Codex: app-server host-mediated request; `itemId/threadId/turnId` provenance; id-keyed answers; `isOther/isSecret`; experimental diagnostics.
4. From OpenCode: asked/replied/rejected event sequence; pending question list; `tool.messageID/callID` provenance; separation of native question/permission events; custom input provided by the host by default.
5. From Paseo: shared card substrate; provider question normalization; timeline running/completed record.
6. From Multica: disable native questions when they cannot be displayed reliably; explicit policy is required in non-interactive daemon mode; full-access does not make questions safe.

Do not borrow:

1. Claude's “the host cannot control the question” as a Thoth product constraint.
2. Paseo's user-visible question-as-permission mental model.
3. Paseo's unanswered fallback to the first option.
4. Multica's issue-comment-only clarification as the primary UX.
5. OpenCode `permission.question` configuration as Thoth authority.
6. Any raw provider schema as Thoth's canonical card schema.
7. OpenCode's broad should-ask prompt as Thoth's should-ask policy.
8. The closed-source text of the Claude Code extracted prompt as a copyable Thoth asset; absorb principles only, not the implementation.

## 9. Recommended Thoth Model

Driver events should normalize native questions into `ProviderQuestionEvent`:

1. ids: Thoth id, provider, native name, native request id.
2. stage: `clarify`, `quick`, `plan_exec`, `review`.
3. provenance: session id, turn id, item id, tool use id, raw input.
4. normalized questions: order, header, question, options, multiSelect, allowOther, allowEmpty, isSecret.
5. answer mapping: `claude_question_text_key`, `codex_question_id_key`, `opencode_ordered_answer_arrays`, `custom`.

The provider question should become `ClarificationCardCandidate`, not direct UI authority:

1. candidate id.
2. source: provider native question or `thoth_clarify_packet`.
3. clarify session id.
4. tree node id.
5. title / primary question.
6. why now.
7. decision it changes.
8. downstream branches affected.
9. risk if assumed.
10. default if skipped.

The validator must reject or repair if:

1. `decisionItChanges` is missing.
2. `whyNow` is missing during Clarify.
3. The user answer would not change the next action.
4. A conventional default is obvious and low-risk.
5. The question asks for agent-discoverable facts.
6. The question asks for plan approval instead of requirement/approach clarification.
7. The question downgrades the user's target.
8. The question is a field questionnaire.
9. Options are unbounded or unstable.
10. Options include a model-authored `Other` / catch-all.
11. A recommended option exists but is not first.
12. The text is too long for the UI.
13. Raw provider terms leak through.
14. The candidate contains an executable UI instruction or command injection.

Authority events should split:

1. `provider_question.requested / answered / dismissed`
2. `permission.requested / approved / denied`
3. `clarification_card.candidate_received / validated / repaired / rejected`
4. `task_card_approval.requested`
5. `goal_card_approval.requested`

UI may share primitives; authority event types must remain separate.

## 10. Stage Policy

Universal ask gate:

1. Before any user-facing question, Thoth should perform bounded read-only investigation when local evidence may answer it.
2. Ask only if the answer changes the route, risk, scope, acceptance, provider action, or user-visible artifact.
3. If a sensible default exists, use it, record the assumption, and mention it when useful.
4. If the question is really approval, render an approval card, not Clarify.

Quick:

1. Covers a normal answer, status query, concept explanation, summary, small edit, git push, one-shot command, or web search.
2. No Draft Task, contract freeze, PlanExec, or Review.
3. Permission preflight still applies.
4. A native provider question may be forwarded in passthrough mode.
5. If the question implies multi-round diagnosis / broad writes / unclear acceptance, suggest a Loop upgrade.

Clarify:

1. Provider question -> `ClarificationCardCandidate`.
2. The candidate must pass the validator before rendering.
3. An invalid candidate becomes hidden evidence and a repair prompt.
4. Repair targets the same card / same tree node.
5. Failure shows a calm state, not raw JSON/schema errors.

PlanExec after contract freeze:

1. Provider clarification should usually not bother the user.
2. Auto-answer from the frozen contract where possible.
3. If policy allows, auto-answer with the first recommended option, but record it as a policy decision, not a user answer.
4. Permission requests are never auto-approved by question policy.
5. If the question proves the contract insufficient, block or return to an explicit user-decision path.

Review:

1. Review should rarely ask the user questions.
2. If needed, it likely means acceptance contradicts evidence, a user preference is required, or external state cannot be verified.
3. Review must not modify files; the question should become a blocking review decision card.

## 11. Driver Notes

Claude driver:

1. Detect `toolName === "AskUserQuestion"`.
2. Preserve the original questions.
3. Add host-side `allowOther` only in the UI model.
4. Strip host-only fields before returning.
5. Serialize answers by full question text.
6. Persist the pending question in the authority store; do not rely only on an in-memory Promise.
7. If the native question cannot surface reliably, disable it and use the Thoth packet path.
8. Enforce extracted-prompt semantics at the Thoth layer: do not show low-value questions asking for discoverable facts or plan approval.
9. Preserve `preview` only after sanitizer/surface support exists; otherwise strip it or convert it to text evidence.

Codex driver:

1. Handle `item/tool/requestUserInput`.
2. Preserve `itemId/threadId/turnId`.
3. Preserve `isOther/isSecret`.
4. Treat the schema as experimental.
5. Return id-keyed answers.
6. Forbid silent first-option fallback in Clarify.
7. Record running/completed provider-question evidence.

OpenCode driver:

1. Listen for `question.asked`.
2. Preserve request id, session id, and tool message/call id.
3. Map `multiple` -> `multiSelect`.
4. Map `custom` -> `allowOther`.
5. Reply with ordered arrays.
6. Reject through the native reject path.
7. Separate `permission.asked` and `question.asked`.
8. Test full-access / skip-permission behavior.
9. Do not inherit OpenCode's broad question policy as product behavior; run candidates through the Thoth ask gate.
10. Preserve the `custom` default in the UI model, but do not let a provider-authored `Other` become a canonical option.

## 12. Risks And Mitigations

1. Noninteractive host hides question: Multica disables Claude `AskUserQuestion` for this reason; mitigate with a capability test or by disabling native questions.
2. Question and permission collapse: Claude shares a callback, and Paseo maps to `permission_requested(kind=question)`; mitigate with separate authority events and UI semantics.
3. Silent first-option fallback: Paseo Codex can do this; mitigate by forbidding it in Clarify and logging policy auto-answer separately.
4. Low-quality provider question: the provider may ask for discoverable facts or implementation trivia; mitigate with a validator, repair loop, golden eval, and independent judge.
5. Schema drift: Codex is experimental; OpenCode/Claude evolve; mitigate with conformance tests, diagnostics, raw request evidence, and schema-version recording.
6. Secret leakage: Codex has `isSecret`; mitigate with a redaction policy for transcript/evidence.
7. Prompt drift: Claude Code tool descriptions change across versions; mitigate by treating the extracted prompt as reference evidence, not the canonical product contract.
8. Leaked-source supply-chain risk: public mirrors of leaked Claude Code source may be malicious; mitigate by preferring official docs, prompt-extraction repository metadata, and local installed binary strings over unknown archives.
9. Over-asking: OpenCode's broad prompt can normalize frequent interruptions; mitigate with a Claude-style ask gate and research-first requirement.

## 13. Prompt-Level Acceptance Checklist

For any Thoth clarify/question card:

1. Does this question survive a one-minute read-only investigation?
2. Does the user's answer change what Thoth does next?
3. Is there no safe conventional default?
4. Is it not a permission / plan approval / contract approval question?
5. Is it one titled card with a tight decision branch, not a field questionnaire?
6. Are there 2-4 meaningful choices?
7. Is the recommended choice first and marked as recommended when a recommendation exists?
8. Are `Other` / custom text provided by UI, not model-authored as an option?
9. Are option labels short and descriptions consequence-oriented?
10. Is multi-select used only when choices are genuinely compatible?
11. If preview is present, is it necessary for visual comparison and safe for the surface?
12. Can the answer be serialized back to the native provider without losing provenance?
13. Is the event recorded as question, permission or approval correctly?

## 14. Acceptance Scenarios

1. Claude native question: `AskUserQuestion` -> `ProviderQuestionEvent` -> validated card -> answer serialized by full question text.
2. Claude noninteractive path: driver disables `AskUserQuestion`; no empty-answer silent inference.
3. Codex request: `item/tool/requestUserInput` -> id-keyed answers -> no first-option fallback.
4. OpenCode question: `question.asked` -> `multiSelect/allowOther` mapping -> ordered answer arrays.
5. PlanExec after freeze: provider clarification auto-answered from the frozen contract; permission is not auto-approved.
6. Invalid Clarify question: a target-downgrade or field-questionnaire candidate is rejected and repaired before the user sees it.
7. Quick passthrough: a native question can be forwarded, but broad/unclear work recommends a Loop upgrade.
8. Claude-style gate: an agent-discoverable fact is answered through read-only investigation rather than surfaced as a question.
9. OpenCode broad question: the driver receives it, but Thoth rejects/repairs it if it asks for a low-value preference with an obvious default.

## 15. Relation To Current Thoth Design

Current design already aligns:

1. Quick handles short bounded actions and does not enter the loop.
2. Only `loop` enters Clarify -> Contract Freeze -> Attempt.
3. Clarify and Review are independent provider sessions.
4. Drivers stream provider text, tool calls, question events, permission events, and completion events.
5. Drivers distinguish provider question events from permission events.
6. Provider question sources include Codex `request_user_input`, Claude `AskUserQuestion`, ACP/native question events, and Clarify-generated golden questions.
7. During Clarify, provider questions become clarification cards.
8. During Quick passthrough, provider questions are forwarded like native provider questions.
9. During PlanExec after freeze, provider clarification questions are auto-answered from the frozen contract or the first recommended option.
10. Provider questions do not grant risky-tool permission.
11. `C_ASK` is not a field questionnaire and does not have Codex `request_user_input` semantics.

Relevant docs:

1. `.agent-os/designs/thoth-engineering-architecture.md`
2. `.agent-os/designs/thoth-app-runtime-contract.md`
3. `.agent-os/designs/thoth-mvp-loop-goals.md`

## 16. Recommended Next Work

1. Add the `ProviderQuestionAdapter` contract in the driver layer.
2. Add Claude / Codex / OpenCode fixture tests for native question parsing and answer serialization.
3. Add `ProviderQuestionEvent` and separate authority events instead of reusing permission as the canonical question event.
4. Add the `ClarificationCardCandidate` validator and repair loop.
5. Add a PlanExec post-freeze auto-answer policy with evidence.
6. Add golden tests for Claude key mapping, Codex id mapping, OpenCode ordered arrays, no first-option fallback, invalid target-downgrade question, and permission not being auto-approved.
7. Add prompt-level golden cases for research-first, user-answer-changes-action, and no-plan-approval-through-clarify.

## 17. Open Questions

1. `rawInput` should persist full raw input, redacted input, or hash + redacted copy?
2. `isSecret` answers can enter Clarify transcript or must stay redacted?
3. Claude option `preview` should be supported? If yes, what sanitizer / sandbox?
4. How to identify “recommended option” provider-neutrally after contract freeze?
5. OpenCode `custom` default true is stable enough, or must runtime-probe?
6. In full-access / dangerously-skip-permissions mode, should native questions still surface?
7. Mobile offline pending question should pause provider session, defer, or reject?
8. Quick + Don't Bother Me should forward all native provider questions or still filter low-value questions?
9. Should Thoth support Claude preview HTML in MVP, or convert preview to text-only evidence until sanitizer is designed?
10. Should OpenCode `custom: false` ever be respected, or should Thoth always offer CEO freeform override?

## 18. Sources Added In This Revision

1. Claude Code extracted prompt repo: `https://github.com/Piebald-AI/claude-code-system-prompts`
2. Claude Code AskUserQuestion tool description: `system-prompts/tool-description-askuserquestion.md`
3. Claude Code AskUserQuestion decision guidance: `system-prompts/tool-description-askuserquestion-decision-guidance.md`
4. Claude Code AskUserQuestion preview guidance: `system-prompts/tool-description-askuserquestion-preview-field.md`
5. Claude Code clarifying-question research-first prompt: `system-prompts/system-prompt-clarifying-question-research-first.md`
6. OpenCode question tool description: `packages/opencode/src/tool/question.txt`
7. OpenCode question tool implementation: `packages/opencode/src/tool/question.ts`
8. OpenCode question schema: `packages/schema/src/v1/question.ts`

## 19. Final Recommendation

Use three layers:

1. Driver transport layer: receive Claude `AskUserQuestion`, Codex `request_user_input`, and OpenCode `question.asked`; parse / normalize / serialize only.
2. Thoth authority layer: canonical `ProviderQuestionEvent`; separate question / permission / approval; stage policy for show / auto-answer / reject / repair / block; preserve provenance and evidence.
3. Product Clarify layer: `thoth.clarify` decides whether to ask, what to ask, and when to stop; `C_ASK` remains a behavior-tree branch card; the UI renders secretary decision cards, not provider-native terms.

Conservative implementation order:

1. Provider-question model.
2. Three provider adapters with fixture tests.
3. Card candidate validator.
4. APP card rendering.
5. PlanExec frozen-contract auto-answer.

This lets Thoth absorb current harness question capabilities without surrendering product authority to any one provider.
