# Architecture Review

Use this reference during Stage 2 whenever the manifest reports an architecture candidate or manual
review finds an architecture-level upstream change. Paseo is an independently evolving engineering
source; structural similarity to its earlier Thoth import is not evidence that a new patch still fits.

## What Counts as Architecture-Level

Treat a coherent change as `architectural` when it changes one or more of these boundaries:

- product or authority ownership;
- package topology, dependency direction, or composition root;
- Protocol, Client, RPC, codec, transport, or compatibility contracts;
- Workspace, Task, Timeline, Card, HumanDecision, Evidence, storage, schema, or migration truth;
- Provider session, HarnessAdapter, ToolGateway, approval, resume, interrupt, or lifecycle semantics;
- security, recovery, isolation, deployment, or Release topology;
- a subsystem replacement or cross-layer refactor whose behavior cannot be landed independently.

A large diff is not automatically architecture-level, and a small diff can be. Judge upstream intent,
ownership, contracts, state, lifecycle, and migration consequences rather than line count alone.

## Automatic Signals

`paseo:inspect` emits conservative architecture candidates:

- `review`: inspect and explicitly assess the signal; a local or cross-layer result is allowed with a
  concrete explanation.
- `required`: classify at least one coherent part of that commit as `architectural`; it cannot be
  ignored or silently downclassified.

Automatic signals do not replace manual review. Mark a manually discovered architectural change even
when the manifest has no signal.

## Discussion Gate

Before product-source edits, create one discussion packet per coherent architecture decision:

1. exact upstream commits and paths;
2. what Paseo changed and the problem it is solving;
3. which current Thoth modules, interfaces, owners, state, migrations, and consumers are affected;
4. whether Paseo's ownership conflicts with current Thoth authority;
5. at least two real options, normally selective adaptation, rejection, or a canonical Thoth revision;
6. a concrete recommendation and its tradeoffs;
7. one user-owned decision question.

Do not ask the user to choose file layout or implementation detail. Ask only whether Thoth should
preserve its architecture and selectively adapt the capability, reject it, or revise a canonical
boundary.

## Classification Shape

Every change includes `architecture_impact` and `architecture_assessment`. Architecture-level changes
also include:

```json
{
  "architecture_impact": "architectural",
  "architecture_assessment": "Why this changes a Thoth architecture boundary.",
  "architecture_review": {
    "status": "pending",
    "discussion": {
      "upstream_change": "What Paseo changed and why.",
      "thoth_impact": "Affected Thoth modules, interfaces, state, migration and consumers.",
      "authority_assessment": "Conflict or compatibility with current Thoth authority.",
      "options": ["Option one with tradeoff.", "Option two with tradeoff."],
      "recommendation": "Recommended direction and reason.",
      "decision_question": "The exact user-owned architecture decision."
    }
  }
}
```

While status is `pending`, use disposition `defer` and `release_intent: analyze`. Present the packet
and stop. After discussion:

- `approved`: reference the concrete `NTH-CD-*` decision, then use `adopt`, `adapt`, or `defer` as the
  decision permits;
- `rejected`: reference the concrete `NTH-CD-*` decision and use `reject`.

The general divergence policy is not approval for a specific architecture transplant. The decision
record must name the exact Paseo change, Thoth boundary, and selected direction.

## Organic Integration Standard

Port the capability, not the historical shape of its patch. Re-derive it through the current Thoth
module, formal interface, state owner, migration, consumer cutover, and behavioral acceptance. If that
requires a second authority, compatibility router, dual path, Provider-name branch, or hidden fallback,
the proposed integration is not organic and must not proceed.
