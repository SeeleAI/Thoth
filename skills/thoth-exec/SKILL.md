---
name: thoth-exec
description: >
  8-phase execution loop protocol with dual mode support (task and metric).
  Adapted from autoresearch. Enforces atomic changes, mechanical verification,
  and automatic rollback. Loaded for /thoth:run and /thoth:loop.
version: 0.1.0
---

# thoth-exec — Execution Loop Contract

## 1. Dual Mode

### Task Mode (`--mode=task`)
- Phase 2: Select next task from YAML pool (highest priority, unblocked)
- Phase 5: Run verify_completion.py
- Phase 7: Update YAML + run-log.md + TSV
- Phase 8: Stop when all tasks complete or iterations exhausted

### Metric Mode (`--mode=metric`)
- Phase 2: Analyze git history for optimization direction
- Phase 5: Run `--verify` command, extract single number
- Phase 7: Write TSV + run-log.md
- Phase 8: Stop at iteration count or plateau

## 2. Atomicity (Phase 3)

- ONE logical change per iteration
- Self-check: if description has "and" with unrelated verbs → split
- If >5 files changed → validate intent before committing

## 3. Commit Protocol (Phase 4)

```bash
git add <specific-files>    # NEVER git add -A
git commit -m "experiment(<scope>): <description>"
```

Commit BEFORE verification — creates clean rollback point.

## 4. Decision Logic (Phase 6)

```
IF improved AND (no guard OR guard passed):
    STATUS = "keep"
ELIF improved AND guard failed:
    Rework (max 2 attempts), then discard
ELIF same or worse:
    git revert HEAD --no-edit
ELIF crashed:
    Fix (max 3 attempts), then revert
```

## 5. References

- `references/loop-protocol.md` — Full 8-phase details
- `references/plateau-detection.md` — Convergence detection logic
