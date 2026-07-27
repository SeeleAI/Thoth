---
name: sync-paseo-into-thoth
description: Review an exact commit range from the official getpaseo/paseo repository, detect architecture-level upstream changes that require user discussion, and selectively integrate compatible capabilities into Thoth's increasingly divergent canonical Workspace/Task/HarnessAdapter architecture with provenance, tests, documentation, and explicitly authorized publication. Use when asked to inspect, compare, sync, port, transplant, adopt, or release new Paseo commits or features into Thoth. Do not use for ordinary Thoth work unrelated to Paseo upstream changes.
---

# Sync Paseo Into Thoth

Integrate useful Paseo capabilities without importing Paseo product authority or assuming its code
shape remains compatible. Keep one reproducible range, one final Thoth ownership path, and evidence
for every completion or publication claim.

## Non-Negotiable Boundaries

1. Treat `AGENTS.md` and current `.agent-os` authority as higher priority than this skill.
2. Resolve `latest Paseo` to an exact official commit SHA before analysis or implementation.
3. Treat Paseo as a production-grade frontend, transport, desktop, and Provider engineering source,
   not as Thoth product authority and not as disposable old code.
4. Assume Thoth and Paseo structurally diverge over time. Review upstream intent and behavior first;
   never treat a floating diff, cherry-pick, directory copy, or Paseo ownership layout as the landing
   plan.
5. Preserve the boundary: Provider owns cognition; Thoth owns deterministic truth; Drivers own
   translation; ToolGateway owns callback fencing; UI owns presentation only.
6. Do not reintroduce AgentManager or Provider-session task authority, file-backed JSON truth,
   Provider-name business branches, hidden model calls, dual paths, compatibility routers, or
   runtime fallback to `127.0.0.1:6767`.
7. Reject voice, speech, dictation, and audio capability paths unless a later canonical user
   decision explicitly changes the product boundary.
8. Treat changes to ownership, formal interfaces, state, storage, protocol, transport, Provider
   lifecycle, package topology, recovery, security, or release topology as architecture-level. Stop
   before product-source edits, present the architecture discussion packet, and require a concrete
   user decision recorded as `NTH-CD-*`.
9. Preserve user changes. Never restore files with destructive Git commands or overwrite a dirty
   overlap to simplify a transplant.
10. Use root `package.json` scripts as formal command entry points. Historical green evidence does
    not prove a gate passed in the current run.

## Operating Modes

- `analyze`: Run Stages 1-2 only and make no product-source changes.
- `integrate`: Run Stages 1-4 and stop at verified or release-ready.
- `publish`: Run all five stages, but enter Stage 5 only with explicit authorization for the
  concrete push, tag, Release, deployment, or publication operation.

Infer the least expansive mode from the request. A request to inspect or compare means `analyze`.
A request to port or sync means `integrate`. Mentioning future publication does not by itself
authorize a concrete Release mutation. `integrate` never overrides a pending architecture decision;
fall back to the Stage 2 discussion result and stop.

## Stage 1: Recover and Pin

1. Read, in order, `AGENTS.md`, `.agent-os/project-index.md`, the top-next-action entry in
   `.agent-os/todo.md`, and the latest relevant `.agent-os/run-log.md` entry.
2. Read the affected design and handbook documents. Use
   [references/authority-routing.md](references/authority-routing.md) to select them. Read each
   affected package's `AGENTS.md` before editing `packages/*`.
3. Record the Thoth branch, HEAD, remote state when relevant, dirty paths, active blockers, top next
   action, and current Release truth. Do not change the sole top next action merely to run this
   maintenance workflow.
4. Read the last accepted Paseo SHA from `.agent-os/upstream-transplant.md`. Resolve the requested
   target against the official `getpaseo/paseo` repository and retain the exact target SHA.
5. Keep raw clones, archives, and generated reports only under ignored `.agent-os/upstreams/` or
   `.agent-os/artifacts/`. Never stage the raw upstream cache.
6. Generate the source manifest through the formal root entry:

   ```text
   npm run paseo:inspect -- --repo <paseo-git-repo> --from <base-sha> --to <target-sha> --out <manifest.json>
   ```

7. Treat manifest architecture signals as conservative triage, not the final judgment. Review every
   commit for semantic architecture impact even when no automatic signal fires.

Stop before implementation if either SHA is unverified, the range is not reproducible, or a dirty
overlap cannot be preserved safely.

## Stage 2: Assess and Plan

1. Read [references/change-classification.md](references/change-classification.md) and
   [references/architecture-review.md](references/architecture-review.md).
2. Review every commit and changed path in the manifest by upstream intent and observable behavior,
   not by patch applicability. Assign each coherent capability or change
   to exactly one disposition: `adopt`, `adapt`, `reject`, or `defer`.
3. Split mixed commits. For example, adapt a terminal fix and reject dictation changes from the
   same upstream commit instead of accepting or rejecting the entire commit.
4. Assign every coherent change an architecture impact of `local`, `cross-layer`, or
   `architectural` with a concrete assessment. An automatic `required` architecture candidate may
   not be silently downclassified or ignored.
5. For every architecture-level change, prepare the discussion packet: exact commits and paths,
   upstream intent, Thoth impact, authority assessment, at least two options, recommendation, and
   the user decision required. Keep it `defer` with review status `pending`, present it to the user,
   and stop before Stage 3. Continue only after the concrete decision is recorded in
   `.agent-os/change-decisions.md` and referenced by the classification.
6. For every `adopt` or `adapt` item, identify the final Thoth module, formal interface, state
   owner, replaced path, and independent acceptance evidence before editing source.
7. For every `reject` or `defer` item, retain a concrete reason. Escalate only when a goal,
   authority, license, acceptance, destructive-operation, or publication decision belongs to the
   user.
8. Write a schema-version-2 classification JSON in ignored artifacts and validate complete commit
   coverage plus the architecture discussion gate:

   ```text
   npm run paseo:verify-provenance -- --manifest <manifest.json> --classification <classification.json>
   ```

For `analyze`, finish with the exact range, disposition matrix, architecture candidates, discussion
packets, landing plan, risks, and evidence gaps. Report `architecture_review_required` when any
decision remains pending. Do not edit product source.

## Stage 3: Integrate

1. Add or update behavioral tests first at the correct ownership layer.
2. Reconstruct the accepted capability for current Thoth. Reuse an upstream algorithm or component
   only when its ownership and interfaces already fit; never preserve Paseo structure merely to
   reduce porting effort.
3. Implement each accepted item through the sole final chain:

   ```text
   App / Desktop / Mobile / TUI / CLI
     -> semantic Client
     -> Protocol Registry and codecs
     -> Daemon application use cases
     -> Core + ToolGateway / HarnessAdapter + projections
     -> Workspace SQLite shards
   ```

4. Put Provider-native events, tools, approvals, sessions, and capability translation in Drivers.
   Put durable Workspace, Task, Card, HumanDecision, Timeline, and Evidence truth in Daemon/Core.
   Keep App, Desktop, TUI, and CLI as shells over semantic Client APIs.
5. Switch all affected consumers and delete the replaced path in the same controlled scope. Do not
   leave a fallback, duplicate store, dual read/write, or Provider-specific product branch.
6. Declare every imported external dependency directly in the importing package.
7. Modify only paths traced to the accepted classification. Preserve adjacent user changes and
   record out-of-scope problems without expanding the transplant.

Stop and form a canonical decision if evidence shows the locked architecture cannot support the
upstream capability without changing Thoth's goals, ownership, or acceptance meaning. A prior
architecture approval covers only the exact discussion packet and does not authorize adjacent
upstream restructuring.

## Stage 4: Verify and Record

1. Read [references/verification-matrix.md](references/verification-matrix.md).
2. Run the narrow affected tests, affected typecheck/build, and single-path guards first.
3. Run the deterministic boundary check against the Thoth base:

   ```text
   npm run paseo:check-boundaries -- --repo . --base <thoth-base-sha> --out <boundary-report.json>
   ```

4. Run the current required root gates. At minimum use `npm run check:foundation`; when the current
   refactor or UI contract is affected, also run the canonical affected acceptance entry such as
   `npm run accept:refactor:fast`. Add real Web, Desktop, Relay, Provider, TUI, or packaged journeys
   when the changed behavior requires them.
5. Re-run provenance verification after the classification or range changes. Run
   `git diff --check` before closeout.
6. Update only the ledgers affected by actual state changes:
   `.agent-os/upstream-transplant.md`, `todo.md`, `project-index.md`, `acceptance-report.md`,
   `lessons-learned.md`, `run-log.md`, canonical designs, official-source index, or executable
   `docs/*` handbooks. Keep exactly one global top next action.
7. Report `verified`, `failed`, `blocked`, or `release_ready`; never use a passing tone as a
   substitute for current exit codes and evidence.

Stop here unless `publish` mode has concrete authorization and every release prerequisite is green.

## Stage 5: Publish and Reverify

1. Read [references/release-protocol.md](references/release-protocol.md) and the current
   `docs/release.md` in full.
2. Reconfirm the exact Thoth source SHA, authorized branches, tag, Release target, remote drift,
   asset scope, and operations explicitly authorized by the user.
3. Use normal, non-destructive Git and the repository-local GitHub entry. Do not force push, merge,
   retag, publish, deploy, or mutate an independent service outside the exact authorization.
4. Require the exact-SHA workflow and every mandatory job to pass. A failed workflow must leave the
   previous Release intact; do not manually assemble a passing publication.
5. Re-download public assets and verify checksums, build identity, Release metadata, and the required
   packaged product journey before reporting `published`.

## Stop and Escalation Rules

Stop and ask for a decision when the user owns the unresolved goal, architecture, license,
acceptance, destructive-operation, external-service, or concrete publication choice. Do not ask the
user to decide implementation details discoverable from the repositories and current authority.

An architecture-level Paseo change is always such a decision: surface it even when a selective
adaptation appears technically possible. Do not begin implementation while its review is pending.

Never claim `integrated`, `verified`, `release_ready`, or `published` when the corresponding code,
current-run gates, ledgers, exact SHAs, or public receipts are missing.

## Resource Routing

- Read [references/authority-routing.md](references/authority-routing.md) in Stage 1.
- Read [references/change-classification.md](references/change-classification.md) in Stage 2.
- Read [references/architecture-review.md](references/architecture-review.md) for every automatic
  architecture candidate or manually identified architecture-level change.
- Read [references/verification-matrix.md](references/verification-matrix.md) in Stage 4.
- Read [references/release-protocol.md](references/release-protocol.md) only when preparing or
  executing publication.
- Use `scripts/inspect-paseo-range.mjs` only through `npm run paseo:inspect`.
- Use `scripts/check-transplant-boundaries.mjs` only through
  `npm run paseo:check-boundaries`.
- Use `scripts/verify-transplant-provenance.mjs` only through
  `npm run paseo:verify-provenance`.

## Output Standard

Always report the exact Paseo base/target SHAs, Thoth base/result SHA, dispositions, architecture
candidates and review status, final landing modules, tests and gates actually run,
documentation/evidence updated, unresolved risks, and the truthful terminal state. Use
`architecture_review_required` when discussion is pending; never describe that state as integrated
or release-ready. Keep raw generated manifests under ignored artifacts and durable conclusions in
the canonical English project ledgers.
