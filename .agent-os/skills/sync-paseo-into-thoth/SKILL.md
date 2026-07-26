---
name: sync-paseo-into-thoth
description: Review an exact commit range from the official getpaseo/paseo repository, classify and selectively integrate compatible upstream features into Thoth's canonical Workspace/Task/HarnessAdapter architecture, update provenance and project authority documents, add or update behavioral tests, run the required root acceptance gates, and prepare or execute an explicitly authorized Thoth release. Use when asked to inspect, compare, sync, port, transplant, adopt, or release new Paseo commits or features into the Thoth repository. Do not use for ordinary Thoth work unrelated to Paseo upstream changes.
---

# Sync Paseo Into Thoth

Integrate useful Paseo changes without importing Paseo product authority. Keep one reproducible
Paseo range, one final Thoth ownership path, and evidence for every completion or publication claim.

## Non-Negotiable Boundaries

1. Treat `AGENTS.md` and current `.agent-os` authority as higher priority than this skill.
2. Resolve `latest Paseo` to an exact official commit SHA before analysis or implementation.
3. Treat Paseo as a production-grade frontend, transport, desktop, and Provider engineering source,
   not as Thoth product authority and not as disposable old code.
4. Preserve the boundary: Provider owns cognition; Thoth owns deterministic truth; Drivers own
   translation; ToolGateway owns callback fencing; UI owns presentation only.
5. Do not reintroduce AgentManager or Provider-session task authority, file-backed JSON truth,
   Provider-name business branches, hidden model calls, dual paths, compatibility routers, or
   runtime fallback to `127.0.0.1:6767`.
6. Reject voice, speech, dictation, and audio capability paths unless a later canonical user
   decision explicitly changes the product boundary.
7. Preserve user changes. Never restore files with destructive Git commands or overwrite a dirty
   overlap to simplify a transplant.
8. Use root `package.json` scripts as formal command entry points. Historical green evidence does
   not prove a gate passed in the current run.

## Operating Modes

- `analyze`: Run Stages 1-2 only and make no product-source changes.
- `integrate`: Run Stages 1-4 and stop at verified or release-ready.
- `publish`: Run all five stages, but enter Stage 5 only with explicit authorization for the
  concrete push, tag, Release, deployment, or publication operation.

Infer the least expansive mode from the request. A request to inspect or compare means `analyze`.
A request to port or sync means `integrate`. Mentioning future publication does not by itself
authorize a concrete Release mutation.

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

Stop before implementation if either SHA is unverified, the range is not reproducible, or a dirty
overlap cannot be preserved safely.

## Stage 2: Assess and Plan

1. Read [references/change-classification.md](references/change-classification.md).
2. Review every commit and changed path in the manifest. Assign each coherent capability or change
   to exactly one disposition: `adopt`, `adapt`, `reject`, or `defer`.
3. Split mixed commits. For example, adapt a terminal fix and reject dictation changes from the
   same upstream commit instead of accepting or rejecting the entire commit.
4. For every `adopt` or `adapt` item, identify the final Thoth module, formal interface, state
   owner, replaced path, and independent acceptance evidence before editing source.
5. For every `reject` or `defer` item, retain a concrete reason. Escalate only when a goal,
   authority, license, acceptance, destructive-operation, or publication decision belongs to the
   user.
6. Write a classification JSON in ignored artifacts and validate complete commit coverage:

   ```text
   npm run paseo:verify-provenance -- --manifest <manifest.json> --classification <classification.json>
   ```

For `analyze`, finish with the exact range, disposition matrix, landing plan, risks, and evidence
gaps. Do not edit product source.

## Stage 3: Integrate

1. Add or update behavioral tests first at the correct ownership layer.
2. Implement each accepted item through the sole final chain:

   ```text
   App / Desktop / Mobile / TUI / CLI
     -> semantic Client
     -> Protocol Registry and codecs
     -> Daemon application use cases
     -> Core + ToolGateway / HarnessAdapter + projections
     -> Workspace SQLite shards
   ```

3. Put Provider-native events, tools, approvals, sessions, and capability translation in Drivers.
   Put durable Workspace, Task, Card, HumanDecision, Timeline, and Evidence truth in Daemon/Core.
   Keep App, Desktop, TUI, and CLI as shells over semantic Client APIs.
4. Switch all affected consumers and delete the replaced path in the same controlled scope. Do not
   leave a fallback, duplicate store, dual read/write, or Provider-specific product branch.
5. Declare every imported external dependency directly in the importing package.
6. Modify only paths traced to the accepted classification. Preserve adjacent user changes and
   record out-of-scope problems without expanding the transplant.

Stop and form a canonical decision if evidence shows the locked architecture cannot support the
upstream capability without changing Thoth's goals, ownership, or acceptance meaning.

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

Stop and ask for a decision only when the user owns the unresolved goal, architecture, license,
acceptance, destructive-operation, external-service, or concrete publication choice. Do not ask the
user to decide implementation details discoverable from the repositories and current authority.

Never claim `integrated`, `verified`, `release_ready`, or `published` when the corresponding code,
current-run gates, ledgers, exact SHAs, or public receipts are missing.

## Resource Routing

- Read [references/authority-routing.md](references/authority-routing.md) in Stage 1.
- Read [references/change-classification.md](references/change-classification.md) in Stage 2.
- Read [references/verification-matrix.md](references/verification-matrix.md) in Stage 4.
- Read [references/release-protocol.md](references/release-protocol.md) only when preparing or
  executing publication.
- Use `scripts/inspect-paseo-range.mjs` only through `npm run paseo:inspect`.
- Use `scripts/check-transplant-boundaries.mjs` only through
  `npm run paseo:check-boundaries`.
- Use `scripts/verify-transplant-provenance.mjs` only through
  `npm run paseo:verify-provenance`.

## Output Standard

Always report the exact Paseo base/target SHAs, Thoth base/result SHA, dispositions, final landing
modules, tests and gates actually run, documentation/evidence updated, unresolved risks, and one of
the four truthful terminal states. Keep raw generated manifests under ignored artifacts and keep
durable conclusions in the canonical English project ledgers.
