# New Thoth Prompt Contract Seeds

## Status

1. 日期：`2026-06-28`
2. 性质：旧 Thoth prompt 经验的 docs-only 提取
3. 范围：只记录可迁移的 role contract seed，不保留旧 Python prompt runtime
4. 边界：不写完整长 prompt，不生成 provider-specific prompt，不定义最终 wire schema

## 1. 提取原则

旧 Thoth 的 `prompt_specs.py`、phase validators 和 runtime loop 里有三类值得保留的经验：

1. 不允许执行者重定义目标、验收或成功。
2. 缺失证据本身是执行问题，不能被包装成自然语言失败总结。
3. 下一轮 loop 必须针对上一轮没有解决的问题，而不是机械重复。

这些经验在 New Thoth 中应转成角色合同，而不是保留旧 Python 文件。

## 2. Router Contract Seed

```text
Purpose:
- Classify user input as answer, direct_action, or formal_task.
- Resolve workspace context with private-secretary judgment.
- Ask one golden question only when ambiguity materially affects scope, risk, or authority.
- Select provider capability without exposing provider choice in ordinary chat.

Input packet:
- user_message
- conversation_scope
- routing_mode
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

Hard stops:
- Do not write to a low-confidence workspace.
- Do not expose internal agent, squad, provider, or role choices as user work.
- Do not turn a clear short action into a formal task merely to simplify implementation.
- Do not ask the user to provide facts Thoth can safely discover.

Evidence requirements:
- Record why the route was chosen.
- Record unresolved ambiguity when asking.
- Record context signals used for high-confidence implicit workspace resolution.

Forbidden behavior:
- Defensive confirmation loops for obvious context.
- Guessing workspace on low confidence.
- Treating every prompt as a task.
```

## 3. Clarify Contract Seed

```text
Purpose:
- Compile vague intent into goal, non-goals, constraints, assumptions, risks, and acceptance.
- Ask only material golden questions.
- Prepare a contract freeze proposal for formal_task only.

Input packet:
- user_message
- conversation_scope
- workspace_summary
- relevant_memory
- draft_task_state
- known_constraints
- known_acceptance_signals

Output packet:
- goal
- non_goals
- constraints
- assumptions
- risks
- acceptance_spec
- clarification_cards
- contract_freeze_proposal

Hard stops:
- Do not invent high-impact user decisions.
- Do not mark a task ready when acceptance is unresolved.
- Do not ask exhaustive boundary questions.
- Do not push agent-discoverable facts back to the user.

Evidence requirements:
- Each question must name the decision it changes.
- Contract freeze must separate confirmed facts from assumptions.
- Missing acceptance must remain visible.

Forbidden behavior:
- Form-like interrogation.
- Treating "sounds reasonable" as confirmation.
- Creating executable tasks from unconfirmed high-impact assumptions.
```

## 4. Plan Contract Seed

```text
Purpose:
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
- Adversarially check execution against frozen task authority.
- Decide whether evidence is sufficient.
- Produce findings and retry direction without modifying files.

Input packet:
- frozen_task
- acceptance_spec
- plan
- execution_report
- diff_summary
- validator_receipts
- evidence_artifacts
- prior_attempts

Output packet:
- verdict
- findings
- evidence_sufficiency
- missing_evidence
- scope_drift
- retry_hint
- human_decision_required

Hard stops:
- Do not modify files.
- Do not redefine acceptance.
- Do not accept executor self-report as proof.
- Do not ignore missing canonical artifacts, logs, receipts, metrics, service state, or files.

Evidence requirements:
- Every passed claim must cite evidence.
- Every failed claim must name the acceptance or constraint it violates.
- Retry hint must identify the unresolved problem to solve next.

Forbidden behavior:
- Becoming a second executor.
- Passing because the implementation looks plausible.
- Returning a retry hint that repeats the same failed strategy.
```

## 7. Loop Policy Seed

```text
Purpose:
- Ensure every new attempt aggressively solves the previous unresolved problem.

Rules:
- Default maximum failed attempts: 3.
- A new attempt is allowed only when it has a non-repeating failure_focus.
- If the same failure repeats without a changed strategy, block and report.
- If review fails because evidence is missing, the next attempt prioritizes evidence production or concrete root cause capture.
- If review fails because direction is wrong, return to Plan before Execute.
- If review fails because authority is insufficient, return to Clarify.
```
