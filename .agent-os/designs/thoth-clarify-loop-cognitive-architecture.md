# Thoth Clarify And Loop Cognitive Architecture

## Status

Canonical under `NTH-CD-100`, `NTH-CD-101` and `NTH-CD-102`. It supersedes the Task Card + Goals Card and
linear-Goal portions of older Clarify/Loop documents while preserving `NTH-CD-060` Workspace/Task/HarnessAdapter
authority, same-visible-session RuntimeBundle activation, ToolGateway fencing and exact Human Decision history.

## Core Formula

```text
Clarify = discover intent -> resolve ownership -> ask material human branches -> confirm one Intent Contract
Loop = inject one Task Anchor -> change reality -> capture evidence -> independent Review -> correct or finish
```

Provider Agents own cognition, investigation, planning and tool use. Thoth owns durable truth, lifecycle,
boundaries, context selection, evidence receipts, independent-role scheduling and recovery.

## Clarify

Clarify keeps a durable Decision Map. Human-owned nodes cover objective, preference, irreversible risk,
acceptance and value tradeoffs. Agent-owned nodes cover professional implementation decisions. Evidence-owned
nodes are resolved from Workspace reality. A Card contains one to four related Human-owned branches, always
offers an explicit recommendation without preselection, and supports node or subtree delegation.

```text
GROUND -> EXPAND_MAP -> AUTO_RESOLVE -> SELF_CHALLENGE -> ASK -> PROPAGATE
       -> STABILITY_CHECK -> CHALLENGE_ONCE -> PROPOSE_CONTRACT -> HUMAN_CONFIRM -> COMMIT
```

Light explores structural and irreversible branches. Balanced explores every material branch. Dive recursively
expands every high-impact frontier and has no question-count target or cap. The same visible Provider session
performs all ordinary Clarify cognition. Exactly one fresh internal Challenger may reopen missing branches before
the final proposal; it does not create a repeated critic loop.

The confirmed Intent Contract contains objective, non-goals, invariants, acceptance claims, risk boundary,
Human Decision references and escalation policy. Decision Map state is a recoverable cognitive projection;
Human Decisions and the confirmed contract are authority.

## Loop

A Task has one stable Task Anchor. Plans and Work Units are mutable Agent hypotheses and never require human
approval unless they change the Anchor. The Working Set contains only the active gap, current understanding,
hypothesis, next high-leverage move, relevant evidence, rejected routes, blockers and latest Review direction.

```text
INJECT_ANCHOR -> ORIENT -> EXECUTE -> CHECKPOINT -> FRESH_REVIEW -> UPDATE_WORKING_SET
              -> CONTINUE | REORIENT | RESET | COMPLETE | NEED_HUMAN | BLOCKED
```

Every meaningful checkpoint ends one mutating attempt and starts a fresh read-only Review. Review judges real
Workspace state against the whole Task Anchor, not a local Goal or Executor narrative. Context pressure,
unrecoverable resume, semantic drift, invalidated routes or two mechanically empty checkpoints force a fresh
Provider-thread lineage from the durable Anchor and Working Set.

Supporting Providers use native Plan/Implement. Providers without native Plan use honest Agent-managed
deliberation and never emit a fake native receipt. Single, Light and Balanced permit one, five and ten
non-complete Reviews; Infinite has no semantic count limit. A new Human-owned premise pauses the Task and reopens
Clarify on the source visible Agent. Completion is automatic unless the Intent Contract requires final human
acceptance.

## Persistence And Presentation

One global catalog and one SQLite authority shard per Workspace remain the only durable stores. Schema v6 owns
Clarify sessions/nodes, Intent Contracts/acceptance claims, Loop cycles, Working Sets, Work Units, Review
decisions and Evidence mappings. Old Goal tables and Blackboard are removed after deterministic migration.

Desktop keeps the complete known Decision Map in a right-side panel; narrow layouts use a full-screen panel.
Timeline shows current decision Cards and the final Intent Contract. Task detail shows the Task Anchor,
Acceptance Claims, current gap, Work Units, Review and Evidence rather than a Goal rail.
