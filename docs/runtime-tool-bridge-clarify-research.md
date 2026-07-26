# Runtime Tool Bridge And Clarify Direction

## Status

1. Date: `2026-07-09`
2. Nature: Research into Claude Code, Codex app-server, and OpenCode runtime tool / native question capabilities and the Thoth Clarify migration direction
3. Purpose: Migrate Thoth Clarify from prompt packet / assistant JSON output to a provider runtime tool bridge
4. Scope: Claude Agent SDK custom tools / `AskUserQuestion`, Codex app-server `dynamicTools` / MCP / `request_user_input`, and OpenCode custom tools / MCP / `question`
5. Current tested status: Codex app-server `dynamicTools` has been implemented in the primary Loop-2 Clarify path. The original
   `NTH-EV-029` real-provider evidence was downgraded to a reopened regression because of the 2026-07-07 Quick+Clarify pending lifecycle and
   strength/frontier behavior regressions; the new contract v2 fix is being reverified.
   `NTH-CD-045` further upgraded the Loop background path from registered-pending handoff to Goals Card ->
   durable Loop task -> PlanExec / Review phases. Claude/OpenCode remain subsequent adapter directions.
6. Non-goal: Do not replace `.agent-os/designs/*` canonical authority or claim that non-Codex provider adapters are complete.

## 1. Verdict

The current direction for Thoth `thoth.clarify` should be upgraded from “prompt asks the provider to output a Clarify packet” to a “session-scoped runtime tool bridge.”

`SKILL.md` can remain the authority for behavior rules, but the model should no longer primarily be responsible for serializing internal packets. A more appropriate structure is:

1. When a provider session starts or enters a phase, the Thoth driver registers / enables Thoth runtime tools.
2. The model submits a Clarify Card, Task Card, Goal Card, or blocked state through a real tool call.
3. The Thoth daemon receives the tool call input and validates its schema, ask gate, authority, provenance, permission, and evidence.
4. The Thoth frontend renders the user-visible card.
5. After the user answers, the Thoth daemon returns the tool result to the runtime according to the provider-specific protocol.
6. The provider continues in the same turn / session.

In short: Thoth may use MCP, but should not treat MCP as the product answer. The correct abstraction is `RuntimeToolBridge`; MCP, Codex `dynamicTools`, Claude SDK in-process MCP tools, OpenCode custom tools, and provider-native question events are merely different adapters for the bridge.

## 1.1 Loop-2 Implementation Result

`NTH-EV-029` originally closed the Codex part of this research direction for Loop-2, then was
reopened after live Quick+Clarify testing exposed lifecycle and strength behavior gaps:

1. Workspace Secretary structured phases use Codex app-server `dynamicTools` / `item/tool/call`.
2. Registered semantic tools are `thoth_submit_clarify_card`, `thoth_submit_task_card`,
   `thoth_submit_pyramid_plan` and `thoth_report_blocked`.
3. Tool calls create persisted pending authority decisions; user answers resolve those decisions and
   return `DynamicToolCallResponse` to Codex.
4. Clarify / Task / Pyramid / registered-task cards render through AgentTimeline, not assistant JSON
   packet parsing.
5. Quick+none stays bare Codex/Paseo and does not register Thoth semantic tools.
6. Historical Loop-2 stopped honestly at durable `registered_pending`. After `NTH-CD-045`, the current
   main Loop background path continues into durable Loop tasks with PlanExec / Review phases; see
   `NTH-EV-030` for code-level evidence and `docs/testing.md` for real-provider acceptance steps.
7. Evidence path: `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/`.

The old `submit_clarify_packet` bridge is now legacy/internal compatibility for Loop-2 purposes. It
is not the accepted product path and must not be user-visible.

## 1.2 Semantic Tool Contract v2

The updated Codex dynamicTools contract keeps runtime tools as the product boundary and adds two
pieces of model-owned evidence that the daemon can persist and audit without judging question quality:

1. `thoth_submit_clarify_card` now requires `public_badge_summary`. This is the user-visible
   AgentTimeline badge body, for example "Breaking down the sorting requirement: first confirm the language, delivery form, and material branch for performance acceptance."
   It replaces neutral waiting copy and no longer uses legacy `decision_it_changes`.
2. `thoth_submit_clarify_card` now requires `frontier_ledger`: current strength, grounded user
   decisions, remaining material user-owned assumptions, agent-owned assumptions, discoverable
   assumptions, why this round matters and convergence state.
3. `decision_it_changes` is accepted only as legacy optional input. It is not required by dynamicTools
   and must not drive timeline badge copy.
4. `thoth_submit_task_card` now requires `convergence_review`, including a `ready_for_task`
   frontier ledger. If the model converges below the soft target, `balanced < 5` or `dive < 10`, the
   review must include `below_soft_target_rationale`.
5. The daemon still does not mechanically judge whether questions are "good". It validates that the
   ledger exists, is shape-valid, is mechanically self-consistent, does not claim ready while listing
   remaining material user-owned assumptions, and does not downgrade the latest Clarify strength when
   submitting Task.
6. AgentTimeline pending lifecycle is part of the bridge contract: a Thoth authority tool call starts
   as a running badge, opens a pending card, folds into a readonly submitted card after user answer,
   completes the same call id, and only then allows the provider continuation / turn completion to
   appear as completed.

## 2. Current Problem With Prompt Packets

Current `thoth.clarify` has already centralized its behavior rules in `packages/drivers/src/runtime-skills/thoth-clarify/SKILL.md` and uses `submit_clarify_packet` / packet schema for mechanical daemon validation. This is better than raw prompt JSON, but fundamental problems remain:

1. The model must perform both semantic judgment and internal protocol serialization.
2. Too much internal state, such as `C_ASK` / `C_TASK_CARD` / `next` / `errors` / provenance, is exposed to the provider.
3. The boundaries among assistant text, markdown JSON, structured output, and runtime packets are easy to blur.
4. Repair still centers on “packet shape” rather than the “tool call contract.”
5. Card atomicity depends on output parsing rather than the runtime tool call boundary.
6. The name `submit_clarify_packet` itself still directs the model's mental model toward “submitting an internal packet,” rather than “submitting a user-decision card.”

The goal is not to remove the packet schema, but to reduce its prominence in the model interface:

```text
Current:
  model emits packet -> daemon validates packet -> UI renders

Target:
  model calls semantic runtime tool -> daemon validates tool input -> daemon constructs internal packet/event -> UI renders
```

## 3. Provider Capability Matrix

| Runtime                        | Host-registered runtime tool                                                                             | Native user-question transport          | Recommended Thoth adapter                                                                                         | Maturity                                                                          |
| ------------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Claude Code / Claude Agent SDK | Yes. Custom tools via in-process MCP server passed to `query()` as `mcpServers`.                         | `AskUserQuestion` through `canUseTool`. | `claude_sdk_mcp_tool` for Thoth-owned tools; `AskUserQuestion` normalized as provider-native question.            | Officially documented and suitable for first-class bridge work.                   |
| Codex app-server               | Yes. `dynamicTools` / `item/tool/call` in current app-server schema; also MCP server tool calls.         | `item/tool/requestUserInput`.           | `codex_app_server_dynamic_tool` for Thoth-owned tools; `requestUserInput` normalized as provider-native question. | Implemented and real-provider verified for Loop-2 Codex path.                     |
| OpenCode                       | Yes. Project/global custom tools in `.opencode/tools/` or `~/.config/opencode/tools/`; also MCP servers. | Built-in `question` / `question.asked`. | `opencode_custom_tool` for Thoth-owned tools; `question.asked` normalized as provider-native question.            | Officially documented; blocking/resume behavior still needs Thoth-specific probe. |

The universal rule is capability-based, not provider-name-based:

```ts
type ClarifyTransport =
  | "native_question"
  | "custom_runtime_tool"
  | "mcp_runtime_tool"
  | "dynamic_tool"
  | "output_schema_degraded"
  | "unsupported";
```

If a provider cannot expose tools and cannot resume from host-mediated user input, Thoth must not claim it supports full Clarify authority. It may run a degraded direct/Quick path or a non-authoritative draft path, but not the full card/approval loop.

## 4. Claude Code Direction

Claude Agent SDK custom tools are a strong fit for Thoth-owned runtime tools. The official custom tools page states that custom tools let applications define functions Claude can call during a conversation. A tool has name, description, input schema and handler; tools are wrapped in an in-process MCP server via `createSdkMcpServer` / `create_sdk_mcp_server`, passed to `query()` in `mcpServers`, and can be pre-approved through `allowedTools`.

Recommended Thoth shape:

```text
createSdkMcpServer("thoth_runtime", tools=[
  thoth_submit_clarify_card,
  thoth_submit_task_card,
  thoth_submit_goal_card,
  thoth_report_blocked
])

query({
  options: {
    mcpServers: { thoth_runtime },
    allowedTools: [
      "mcp__thoth_runtime__thoth_submit_clarify_card",
      "mcp__thoth_runtime__thoth_submit_task_card",
      "mcp__thoth_runtime__thoth_submit_goal_card",
      "mcp__thoth_runtime__thoth_report_blocked"
    ]
  }
})
```

Claude-native `AskUserQuestion` should remain a separate path:

```text
AskUserQuestion
  -> canUseTool(...)
  -> ProviderQuestionEvent(transport="claude_ask_user_question")
  -> ClarificationCardCandidate
  -> Thoth ask gate
  -> frontend card or hidden reject/repair
  -> answer serialized by full question text
  -> canUseTool allow(updatedInput)
```

Design boundary:

1. `AskUserQuestion` is provider-native question transport.
2. `thoth_submit_*` tools are Thoth-owned authority submission tools.
3. Do not force all Thoth Clarify through `AskUserQuestion`, because host cannot simply inject arbitrary Thoth-authored questions into Claude's native flow.
4. Do not force all Thoth Clarify through assistant text packets, because Claude custom tools now provide a cleaner runtime surface.

## 5. Codex Direction

Codex app-server should use `dynamicTools` as the primary Thoth-owned runtime tool surface when available.

Current local evidence:

1. `codex-cli 0.134.0`
2. `codex app-server generate-json-schema` succeeded on `2026-07-07T04:57:50Z`.
3. Generated schema contains `DynamicToolSpec`, `DynamicToolCallParams`, `DynamicToolCallResponse`, `item/tool/call`, `item/tool/requestUserInput`, `mcpServer/tool/call`, `mcpToolCall` and `item/mcpToolCall/progress`.

Recommended Codex path:

```text
thread/start(dynamicTools=[
  thoth_submit_clarify_card,
  thoth_submit_task_card,
  thoth_submit_goal_card,
  thoth_report_blocked
])
  -> model calls dynamic tool
  -> app-server emits item/tool/call
  -> Thoth daemon/frontend creates pending authority event
  -> client response returns DynamicToolCallResponse content items
  -> Codex continues
```

Codex-native `request_user_input` remains separate:

```text
item/tool/requestUserInput
  -> ProviderQuestionEvent(transport="codex_request_user_input")
  -> ClarificationCardCandidate
  -> Thoth ask gate
  -> answer serialized id-keyed
```

Design boundary:

1. Prefer `dynamicTools` for Thoth-owned card submissions.
2. Prefer `request_user_input` only for provider-native user questions.
3. MCP is supported in the app-server surface and can be a fallback or external-tool route.
4. Do not use first-option fallback. Missing user answers must be rejected, blocked or recorded as explicit non-user policy auto-answer.
5. Keep Codex app-server dynamic tools behind real-provider conformance tests when changing the bridge;
   Loop-2 acceptance is recorded under `NTH-EV-029`.

## 6. OpenCode Direction

OpenCode supports custom tools through project or global tool files. The official custom tools page states that custom tools are functions the LLM can call during conversations, work alongside built-in tools, can live under `.opencode/tools/` or `~/.config/opencode/tools/`, are written as TypeScript/JavaScript tool definitions, and use an async `execute(args, context)` handler. The context includes session information such as `sessionID`, `messageID`, `directory` and `worktree`.

Recommended OpenCode custom tool path:

```text
.opencode/tools/thoth-submit-clarify-card.ts
.opencode/tools/thoth-submit-task-card.ts
.opencode/tools/thoth-submit-goal-card.ts
.opencode/tools/thoth-report-blocked.ts
```

Each tool should forward to the local Thoth daemon through a scoped bridge, not embed product authority in the tool file:

```text
OpenCode tool execute(args, context)
  -> Thoth daemon runtime-tool endpoint / socket
  -> daemon validates authority and persists pending decision
  -> frontend renders card
  -> user answers
  -> tool returns answer result to OpenCode
```

OpenCode-native question remains separate:

```text
question tool
  -> question.asked
  -> ProviderQuestionEvent(transport="opencode_question")
  -> ClarificationCardCandidate
  -> Thoth ask gate
  -> reply with ordered string[][]
```

Design boundary:

1. Use OpenCode custom tools for Thoth-owned card submissions.
2. Use OpenCode `question.asked` for native provider questions.
3. OpenCode's broad question policy must not become Thoth's should-ask policy.
4. Blocking tool-call behavior, timeout, cancellation, daemon restart and same-turn resume must be probed with real OpenCode sessions before claiming full support.
5. Prefer unique tool names; do not override built-in `question`, `bash`, `read` or `write`.

## 7. RuntimeToolBridge Architecture

Thoth should introduce a provider-neutral bridge:

```ts
interface RuntimeToolBridge {
  provider: "claude" | "codex" | "opencode" | "acp" | "other";
  sessionId: string;
  capabilities: RuntimeToolCapabilities;
  registerTools(input: RegisterRuntimeToolsInput): Promise<RegisterRuntimeToolsResult>;
  handleToolCall(call: RuntimeToolCall): Promise<RuntimeToolResult | PendingDecision>;
  answerPendingDecision(input: PendingDecisionAnswer): Promise<void>;
  rejectPendingDecision(input: PendingDecisionReject): Promise<void>;
}

interface RuntimeToolCapabilities {
  nativeQuestion: boolean;
  hostRegisteredTools: boolean;
  mcpTools: boolean;
  dynamicTools: boolean;
  blockingToolCall: boolean | "probe_required";
  toolResultCanResumeSameTurn: boolean | "probe_required";
  recommendedTransport:
    | "claude_sdk_mcp_tool"
    | "codex_app_server_dynamic_tool"
    | "opencode_custom_tool"
    | "generic_mcp_tool"
    | "native_question_only"
    | "unsupported";
}
```

The daemon should normalize all incoming surfaces into two families:

```text
ProviderQuestionEvent
  source examples:
    Claude AskUserQuestion
    Codex request_user_input
    OpenCode question.asked

RuntimeToolSubmission
  source examples:
    Claude SDK MCP tool
    Codex dynamic tool
    OpenCode custom tool
    generic MCP tool
```

Then both should pass through Thoth authority:

```text
provider/native event or runtime tool call
  -> normalized event
  -> schema validation
  -> ask gate / approval gate / permission gate
  -> persisted pending decision
  -> clean frontend card
  -> answer serialization
  -> provider-specific tool result
```

## 8. Tool Names And Model-Facing Contract

Do not expose raw `C_ASK`, `C_TASK_CARD`, `C_GOAL_CARD`, `next`, `errors` or packet internals as the main model-facing API.

Prefer semantic tools:

1. `thoth_submit_clarify_card`
2. `thoth_submit_task_card`
3. `thoth_submit_goal_card`
4. `thoth_report_blocked`

The existing `submit_clarify_packet` can remain as a temporary low-level compatibility bridge, but should not be the long-term primary tool.

Example high-level tool input:

```json
{
  "title": "Confirm the delivery boundary",
  "why_now": "Different choices will change the execution route and acceptance evidence",
  "decision_it_changes": "Whether to proceed with a releasable implementation, research validation, or a documentation proposal",
  "questions": [
    {
      "id": "delivery_boundary",
      "question": "Which delivery form matters most this time?",
      "choices": [
        {
          "id": "production",
          "label": "Releasable implementation",
          "description": "Validate against a real runnable path"
        },
        {
          "id": "research",
          "label": "Research validation",
          "description": "Focus on proving the technical approach"
        }
      ]
    }
  ],
  "allow_choice_notes": true,
  "allow_note_only": true
}
```

Example tool result:

```json
{
  "status": "answered",
  "authority_event_id": "NTH-EV-...",
  "answers": [
    {
      "question_id": "delivery_boundary",
      "choice_id": "production",
      "note": "A genuinely releasable result is required; no demo"
    }
  ],
  "next_instruction": "Continue Clarify only if another high-impact user-owned decision remains; otherwise submit a Task Card."
}
```

## 9. Migration Plan

1. Add `RuntimeToolBridge` capability model in driver/daemon boundary.
   - current result: Codex capability and daemon/provider tests exist for the Loop-2 path; Claude and
     OpenCode remain future adapters.

2. Add semantic Thoth runtime tool schemas.
   - verify: schema tests reject raw packet leakage, provider terms, target downgrade, discoverable-fact questions and plan approvals.

3. Implement Codex dynamic tool adapter first or in parallel with Claude SDK MCP adapter.
   - current result: implemented for Codex and verified through real public web app journeys.

4. Implement Claude SDK MCP adapter.
   - verify: real Claude SDK smoke where a custom tool blocks on Thoth UI and returns structured result; separately verify `AskUserQuestion` still maps to `ProviderQuestionEvent`.

5. Implement OpenCode custom tool adapter.
   - verify: real OpenCode smoke for `.opencode/tools/thoth-submit-clarify-card.ts`, including timeout/cancel/reply behavior.

6. Demote assistant text packet parsing to legacy/degraded path.
   - current result: Loop-2 acceptance cannot pass through markdown JSON, assistant text packet parsing
     or native `outputSchema` packets.

7. Rewrite `thoth.clarify` `SKILL.md` output section.
   - verify: golden eval expects tool calls, not text packets; independent judge checks that raw packet/state code is not user-visible.

## 10. Acceptance Scenarios

1. Claude custom tool: Claude calls `mcp__thoth_runtime__thoth_submit_clarify_card`; Thoth frontend renders card; user answer returns as tool result; Claude continues.
2. Claude native question: `AskUserQuestion` enters `ProviderQuestionEvent`; answer serializes by full question text; permission and clarification remain separate authority events.
3. Codex dynamic tool: app-server emits `item/tool/call`; Thoth returns `DynamicToolCallResponse`; Codex continues same turn/session.
4. Codex native question: `item/tool/requestUserInput` enters `ProviderQuestionEvent`; answer serializes id-keyed; no first-option fallback.
5. OpenCode custom tool: `.opencode/tools/thoth-submit-clarify-card.ts` receives context, blocks or persists pending decision, and returns user answer to OpenCode.
6. OpenCode native question: `question.asked` enters `ProviderQuestionEvent`; answer serializes as ordered arrays.
7. Generic MCP: provider calls Thoth MCP runtime tool; daemon records provenance and does not expose raw MCP/tool schema to frontend.
8. Unsupported provider: if no native question, no registered tool and no same-turn resume exists, Clarify authority is disabled or degraded honestly.
9. UI hygiene: no `AskUserQuestion`, `request_user_input`, `question.asked`, `permission question`, raw JSON, packet code or state code appears in user-visible card text.
10. Recovery: pending decision survives browser reload and daemon restart or fails with explicit recoverable blocker; it is never replaced by a silent default.

## 11. Relation To Existing Docs

This document refines, but does not replace:

1. `docs/harness-question-clarify-research.md`
   - native user question transport and ask-gate policy.
2. `.agent-os/designs/thoth-app-runtime-contract.md`
   - current canonical runtime phase contract and `NTH-CD-041` / `NTH-CD-042` frontend/runtime overrides.
3. `packages/protocol/src/thoth-runtime-contract.ts`
   - current code-level packet, provider question event and card candidate schemas.

Current design now says MCP/runtime tools should come through provider session configuration, Codex
`dynamicTools` or another scoped runtime bridge, not by copying full tool schema or `SKILL.md` rules
into every user prompt. This document records both the research direction and the current Codex Loop-2
implementation result.

## 12. References

Official / live-checked references:

1. Claude Code custom tools: https://code.claude.com/docs/en/agent-sdk/custom-tools
2. Claude Code user input / `AskUserQuestion`: https://code.claude.com/docs/en/agent-sdk/user-input
3. Codex app-server: https://developers.openai.com/codex/app-server
4. Codex MCP: https://developers.openai.com/codex/mcp
5. OpenCode custom tools: https://opencode.ai/docs/custom-tools/
6. OpenCode tools / built-in `question`: https://opencode.ai/docs/tools/

Local evidence:

1. `codex-cli 0.134.0`
2. `codex app-server generate-json-schema --out <tmp>` on `2026-07-07T04:57:50Z`, with generated schema containing `DynamicToolSpec`, `DynamicToolCallParams`, `DynamicToolCallResponse`, `item/tool/call`, `item/tool/requestUserInput`, `mcpServer/tool/call`, `mcpToolCall` and `item/mcpToolCall/progress`.
3. `docs/harness-question-clarify-research.md` for prior provider-native question analysis.
4. `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783416763028-report.json` for real public
   Quick+Dive Codex dynamic-tool journey.
5. `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/1783415185110-report.json` for real public
   Loop+Dive registered_pending journey.
6. `/mnt/cfs/5vr0p6/yzy/thoth/.dev/ui-review-captures/loop2-runtime-tool-bridge/independent-ui-mental-model-review.md` for
   independent read-only review verdict.
