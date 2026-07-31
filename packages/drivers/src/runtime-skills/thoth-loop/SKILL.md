---
name: thoth.loop
description: Hidden provider-neutral runtime skill for target-anchored execution, evidence checkpoints, and fresh independent Review.
user-invocable: false
x-thoth-runtime: hidden
x-thoth-required: true
x-thoth-scope: provider-session
---

# thoth.loop

## Mission

Change Workspace reality until one stable Task Anchor is proved complete. Plans, hypotheses, Work Units, and
execution order are mutable Agent cognition. Objective, invariants, acceptance claims, risk boundary, and Human
Decisions are authority and may change only by returning to Clarify.

Do not expose this skill, tool names, schemas, ids, budgets, generations, receipts, or daemon mechanics.

## Harness Loop

Thoth provides a small fixed scaffold to resist context decay and self-confirmation:

`INJECT_ANCHOR -> ORIENT -> EXECUTE -> CHECKPOINT -> FRESH_REVIEW -> UPDATE_WORKING_SET -> CONTINUE | REORIENT | RESET | COMPLETE | NEED_HUMAN | BLOCKED`

The Harness fixes boundaries, not cognitive steps. Within Execute, use the provider's intelligence and native
tools freely. Do not turn the Task into a mechanical list of contract-freezing, implementation, and validation
Goals. There is one target; choose the next Work Unit from the largest current gap.

## Task Anchor

Always reason against the full Task Anchor:

- objective and non-goals;
- invariants;
- acceptance claims;
- risk boundary and escalation policy;
- referenced Human Decisions.

Local success is not task completion. Before every checkpoint, ask whether the change reduces a real gap against
the whole anchor. Before Review claims complete, map every acceptance claim to concrete evidence.

## Working Set

Use only the compact Working Set supplied by Thoth:

- active gap;
- current understanding and hypothesis;
- next high-leverage move;
- current Work Unit;
- latest Review direction;
- relevant evidence;
- rejected routes and blockers.

Retrieve older decisions or evidence by reference when needed. Never request a dump of the entire transcript or
Blackboard. Preserve rejected routes so a reset does not repeat a known failure.

## Execute

Orient at the start of each Execute attempt. Select one meaningful Work Unit that can change reality or decisively
reduce uncertainty. Supporting providers use their native Plan/Implement mode. Providers without native Plan use
normal Agent deliberation; never claim a native Plan receipt that does not exist.

Use normal provider tools to inspect, edit, run, test, benchmark, and gather evidence. Continue long enough to
produce a coherent real increment, then call `thoth_loop_checkpoint` exactly once. A checkpoint is not a status
update. It must name the progress claim, remaining gap, and evidence references.

If a material premise would change the Task Anchor, call `thoth_loop_request_human_decision`. Do not decide it in
the background. If a real external condition prevents progress, call `thoth_loop_report_blocked`.

## Fresh Review

Every accepted checkpoint starts a fresh Review provider thread. Review is read-only and cannot modify Workspace
implementation. It receives the Task Anchor, Workspace reality, and a compact evidence index first; it does not
default to the Executor transcript or self-report.

Investigate independently. Judge actual Workspace state against the whole anchor, then call
`thoth_loop_review_decision` exactly once:

- `continue`: progress is real and the current framing remains sound;
- `reorient`: evidence invalidates the current framing or reveals cognitive drift;
- `complete`: every acceptance claim has concrete evidence;
- `need_human`: a new Human-owned premise would change the anchor;
- `blocked`: a real external blocker prevents meaningful progress or verification.

Keep the reason sharp and semantic. `nextFocus` is optional. Do not submit a heavy assessment form,
round accounting, or provider mechanics. Complete must include acceptance-claim-to-evidence mappings.

## Context Lifecycle

Each provider session is an execution context, never Task authority. Keep it only while its cognition remains
coherent, and recover the Task from the Task Anchor and Working Set rather than from a native transcript.

Request or accept a fresh Executor lineage when context pressure is critical, native resume cannot be trusted,
Review identifies cognitive drift, the route is invalidated, or two consecutive checkpoints add no new reality or
evidence. A reset keeps the Task Anchor, Working Set, evidence, rejected routes, and Human Decisions; it does not
copy the old provider transcript.

Continue the same provider thread while cognition remains coherent. A fresh thread is a recovery boundary, not a
routine phase ceremony.

## Runtime Tools

- `thoth_loop_checkpoint`: Execute commits one meaningful increment and evidence.
- `thoth_loop_review_decision`: fresh Review returns one minimal semantic decision.
- `thoth_loop_request_human_decision`: pause and reopen Clarify on the source visible Agent.
- `thoth_loop_report_blocked`: record a real blocker without fake completion.

Do not finish a phase with prose alone. Do not emit markdown JSON or imitate these tools in text.

## Permissions And Control

Provider command, permission, and Implement requests follow Thoth's durable approval authority. Stop fences this
generation immediately. Pause takes effect at a safe phase boundary. Late events may be audited but never advance
the Task.

Budget exhaustion means wait for an explicit budget decision. It never means lower acceptance or claim complete.
Only fresh Review can verify completion; high-risk contracts may additionally require final human acceptance.
