# Verification Matrix

Use this reference during Stage 4. Re-read current root scripts and `docs/testing.md`; command names,
test totals, and acceptance scopes may change.

## Verification Order

1. Run the narrow behavioral test at the owning layer.
2. Run the affected package typecheck and build through root scripts.
3. Run architecture, source, and single-path guards affected by the change.
4. Run `npm run paseo:check-boundaries -- --repo . --base <thoth-base-sha>`.
5. Run `npm run paseo:verify-provenance` against the exact manifest and classification.
6. Run `npm run check:foundation`.
7. Run the current comprehensive acceptance entry when its scope is affected.
8. Add real product journeys when unit/source gates cannot prove the behavior.
9. Run `git diff --check` before closeout.

## Ownership Matrix

| Changed boundary  | Required proof                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Protocol          | Schema parse, compatibility, Registry derivation, binary round-trip when relevant          |
| Client            | Semantic API, direct/Relay parity, correlation, reconnect, typed errors                    |
| Core              | Pure transitions, invalid states, idempotency, conflicts, deterministic replay             |
| Daemon repository | SQLite transaction, migration, rollback, shard isolation, crash reopen                     |
| ToolGateway       | Scope/generation fencing, duplicate and late callbacks, CAS conflict behavior              |
| HarnessAdapter    | Capability, thread, event, tool, interrupt, approval, Plan, persistence receipts           |
| Application flow  | Raw/Clarify/Quick/Loop/Card/PlanExec/Review/Stop/rewind behavior as affected               |
| App               | Focused interaction/component test, complete App suite, real Web when presentation changes |
| Desktop           | Desktop suite, managed daemon lifecycle, packaging only when distribution is affected      |
| Relay             | E2EE parity; hosted journey or load test only when the real transport contract changes     |
| TUI/CLI           | Public semantic command, stable structured output, OpenTUI smoke when interaction changes  |
| Release           | Release contract, exact-SHA workflow, public asset checksum and packaged journey           |

## Evidence Rules

- Record the exact command, exit code, important result, and artifact/report path.
- Do not reuse a historical pass as current evidence.
- Do not delete or narrow a flaky or failing test to complete the transplant.
- A fixture may replace external uncertainty only through the same public API and lifecycle.
- Source inspection proves source shape, not live Provider, Relay, packaged, or browser behavior.
- A local package or preview is not a Release.
- Mark below-target or partial results honestly and preserve the failure in `lessons-learned.md` when
  it changes future retry behavior.
