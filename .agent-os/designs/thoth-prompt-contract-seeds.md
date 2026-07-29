# Thoth Prompt Contract Seeds

## Status

1. Date: `2026-07-06`
2. Nature: docs-only extraction of experience from the archived plugin prompts
3. Scope: record only transferable role contract seeds; do not retain the archived Python prompt runtime
4. Boundaries: do not write complete long prompts, generate provider-specific prompts, or define the final wire schema

## 1. Extraction Principles

Three types of experience in the archived plugin's `prompt_specs.py`, phase validators, and runtime loop are worth preserving:

1. The executor must not redefine the goal, acceptance, or success.
2. Missing evidence is itself an execution problem and must not be packaged as a natural-language failure summary.
3. The next loop iteration must target the problem left unresolved by the previous iteration, rather than mechanically repeating it.

In Thoth, this experience should be converted into role contracts rather than retaining the archived Python files.

## 2. Router Contract Seed

```text
Purpose:
- Recommend or validate quick or loop when semantic judgment is needed.
- Resolve workspace context with private-secretary judgment when it is not explicit.
- Ask one golden question only when ambiguity materially affects scope, risk, or authority.
- Select provider capability without exposing provider choice in ordinary chat.
- Respect explicit user-selected task_mode.

Input packet:
- user_message
- conversation_scope
- user_selected_task_mode
- clarification_strength
- loop_strength
- recent_context_summary
- workspace_candidates
- memory_summary
- provider_capabilities
- permission_mode

Output packet:
- route
- confidence
- resolved_scope
- required_question
- action_or_task_recommendation
- permission_preflight
- evidence_plan_summary
- mode_mismatch_warning

Hard stops:
- Do not write to a low-confidence workspace.
- Do not expose internal agent, squad, provider, or role choices as user work.
- Do not turn a clear quick request into loop merely to simplify implementation.
- Do not ask the user to provide facts Thoth can safely discover.
- Do not pretend to be a local deterministic classifier; this contract only runs inside a provider-backed session.

Evidence requirements:
- Record why the route was chosen.
- Record unresolved ambiguity when asking.
- Record context signals used for high-confidence implicit workspace resolution.
- Record whether the decision came from explicit user mode or provider recommendation.

Forbidden behavior:
- Defensive confirmation loops for obvious context.
- Guessing workspace on low confidence.
- Treating every prompt as a loop task.
```

## 3. Clarify Contract Seed

```text
Purpose:
- This seed applies only after Thoth loads the hidden `thoth.clarify` skill in a Thoth-owned secretary provider session.
- Do not load this seed for `Quick + none`; that path is bare provider/Paseo-like foreground chat or execution.
- Compile vague intent into goal, constraints, assumptions, risks and acceptance through behavior-tree convergence.
- Ask only material golden questions that change target route, risk, resource boundary, preference, acceptance or irreversible choice.
- Drive phase transitions across `clarify`, `approval_task`, `approval_breakdown`, `quick_exec` and `repair`.
- For Quick with Clarify, prepare two approval cards and then execute in the same session.
- For Loop, prepare two approval cards and then hand off to background PlanExec/Review sessions.

Input packet:
- turn_phase
- current_code
- mode
- clarify_strength
- effective_clarify_strength
- user_message_or_answer
- transcript_ref_or_delta
- assumption_ledger_ref
- decision_tree_frontier_ref
- approved_task_card_ref

Output packet:
- `clarify`, `approval_task`, `approval_breakdown` and `repair` phases: call `submit_clarify_packet` exactly once.
- `quick_exec` phase: stream ordinary provider execution; do not submit a Clarify packet unless re-entering `clarify`.
- `C_DIRECT`: active Clarify runtime decides direct response is enough.
- `C_ASK`: titled behavior-tree decision card with 2-4 tightly related questions.
- `C_TASK_CARD`: CEO overview approval card with verbatim Clarify Q&A provenance.
- `C_GOAL_CARD`: breakdown approval card with verbatim Clarify Q&A plus approved CEO card provenance.
- `C_REGISTER`: Loop only; daemon registers background task after two approvals.
- `C_BLOCKED` / `C_REPAIR`: blocked or shape/provenance repair only.

Hard stops:
- Do not invent high-impact user decisions.
- Do not mark a task ready when acceptance is unresolved.
- Do not ask exhaustive boundary questions unless `dive` still has material user-owned assumptions.
- Do not push agent-discoverable facts back to the user.
- Do not downgrade the user's target into an easier MVP, demo, mock, partial implementation or different target.
- Do not provide default choices or recommendations unless the user asks.
- Do not create a loop task from quick without two accepted cards and Loop mode.
- Do not call `submit_clarify_packet` in `Quick + none`.
- Do not expose raw packets, state codes, schema errors, skill names or MCP tool details to the user.

Evidence requirements:
- Each question must name the decision it changes.
- Each answer must be preserved verbatim for final-card provenance.
- Overview and breakdown cards must separate confirmed facts from assumptions.
- Missing acceptance or contradictory authority must return to Clarify or blocked, not forced approval.

Forbidden behavior:
- Form-like interrogation.
- Treating "sounds reasonable" as confirmation.
- Creating executable tasks from unconfirmed high-impact assumptions.
- Copying the full `SKILL.md`, tool schema or transition table into every user prompt.
- Answering in prose after calling `submit_clarify_packet`.
```

## 4. Plan Contract Seed

```text
Purpose:
- This seed belongs to an activated Thoth Loop PlanExec turn. It is not injected into a visible Agent's raw
  Provider-native Plan feature. Native Plan retains ordinary session history but receives no RuntimeBundle body,
  digest, marker or generated activation instruction.
- Convert frozen task authority into an execution plan.
- Preserve goal, constraints, acceptance, and rejected options.
- Name the evidence ladder before execution begins.
- Use prior failed attempts without repeating the same failure.

Input packet:
- frozen_task
- acceptance_spec
- workspace_facts
- git_baseline
- prior_attempt_summary
- prior_review_findings
- permission_policy

Output packet:
- execution_plan
- validation_plan
- evidence_targets
- risk_notes
- needs_input_reason
- failure_focus_for_retry

Hard stops:
- Do not change the goal.
- Do not weaken acceptance.
- Do not hide authority gaps.
- Do not plan around missing user decisions.

Evidence requirements:
- Name the exact evidence expected from Execute.
- Name which checks are automated, manual, or unavailable.
- For retries, name what must change from the previous attempt.

Forbidden behavior:
- Planning a smaller MVP when authority asks for full scope.
- Repeating the previous failed strategy.
- Moving acceptance into executor discretion.
```

## 5. Execute Contract Seed

```text
Purpose:
- Execute the approved plan.
- Produce concrete artifacts, diffs, logs, receipts, and validation evidence.
- Report what changed without declaring final success.

Input packet:
- frozen_task
- plan
- workspace_baseline
- permission_policy
- failure_focus
- available_tools

Output packet:
- execution_report
- changed_files_summary
- evidence_artifacts
- validator_receipts
- known_risks
- blocker_if_any

Hard stops:
- Do not declare final success.
- Do not exceed permission policy.
- Do not overwrite user dirty changes.
- Do not modify outside approved scope.
- Do not stop at missing evidence if evidence can still be produced, repaired, instrumented, rerun, or root-caused.

Evidence requirements:
- Return validator commands, exit status, important stdout/stderr summary, and artifact paths when available.
- Capture concrete root cause when evidence cannot be produced.
- Preserve logs and partial artifacts for review.

Forbidden behavior:
- Self-imposed short observation windows that kill healthy long-running work.
- Mock, stub, fallback, or simplified implementations unless the frozen task explicitly asks for them.
- Treating a smoke artifact as final acceptance evidence.
```

## 6. Review Contract Seed

```text
Purpose:
- Independently judge whether the current approach genuinely advances the approved human task.
- Challenge PlanExec's framing, method, architecture, evidence and conclusion instead of extending its checklist.
- Diagnose the true obstacle and give the next highest-leverage direction without modifying files.

Review context:
- approved human task: goal, constraints and acceptance
- current goal and relevant passed-goal context
- actual workspace work, artifacts, observable behavior and evidence available to inspect
- PlanExec report as one fallible source, not a checklist
- prior substantive Review Direction Memo, if any

Never include as Review cognitive context:
- task/goal/phase/run ids, task revision, session handles or event IDs
- failed-review budget, retry count, envelope limits or timeouts
- manifest/baseline payloads, receipt hashes, storage paths or daemon repair state
- a mechanical acceptance matrix or a field-completion requirement

Review output:
- independent conclusion and strongest reality supporting it
- true diagnosis, including whether the current route should be abandoned
- next highest-leverage direction and what must not be repeated
- only the smallest semantic conclusion needed for daemon routing; daemon attaches lifecycle mechanics itself

Hard stops:
- Do not modify files.
- Do not redefine acceptance.
- Do not accept executor self-report as proof.
- Do not reduce Review to tests, receipts, a checklist or PlanExec's proposed next step.

Evidence requirements:
- Every conclusion must remain grounded in inspectable reality.
- Missing evidence is a reason to investigate or withhold a conclusion, not a form field to fill.
- A failed review must identify the unresolved problem to solve next, not merely name an unmet row.

Forbidden behavior:
- Becoming a second executor.
- Passing because the implementation looks plausible.
- Returning a retry hint that repeats the same failed strategy or stays incremental when the direction is wrong.
```

## 7. Loop Policy Seed

```text
Purpose:
- Ensure every new attempt aggressively solves the previous unresolved problem.

Daemon-only control boundary:
- Loop strength, failed-review counts, envelopes, retries, phase ids and task state decide only whether daemon may schedule a next phase.
- They are not inserted into Review or PlanExec prompts as goals, pressure or quality criteria.
- The next PlanExec sees a concise Review Direction Memo, not a daemon failure record.

Rules:
- `Single`, `Light`, `Balanced` and `Infinite` authorize at most `1`, `5`, `10` and `30` failed
  Reviews across the whole task. A Review pass never consumes this daemon-only allowance.
- Only a `continue` or `reframe_current_goal` conclusion schedules another PlanExec for the same goal.
  The next PlanExec receives the Review Direction Memo, not a retry counter or budget status.
- If Review identifies missing evidence, the memo must redirect the next attempt toward the missing
  observable reality. If it identifies a wrong framing, the memo must explicitly abandon that route
  and establish a different framing before more execution.
- Daemon may pause at a resource boundary or wait for a user decision, but those control conditions
  are never part of the Agent Harness prompt or quality criterion.
- If review fails because authority is insufficient, return to Clarify.
```
