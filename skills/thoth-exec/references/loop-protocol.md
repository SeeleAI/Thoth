# 8-Phase Loop Protocol

Adapted from autoresearch autonomous-loop-protocol. Supports dual mode.

## Phase 0: Precondition Checks

Before entering the loop:
```bash
git rev-parse --show-toplevel    # Must be in git repo
git diff --quiet                 # Working tree must be clean
test -f .research-config.yaml   # Thoth project must exist
```

If dirty tree: "Uncommitted changes detected. Commit or stash first."

## Phase 1: Review

Read context for the current iteration:
```bash
git log --oneline -20            # Recent experiment history
git diff HEAD~1                  # What changed last iteration
tail -20 thoth-results.tsv      # Recent results
```

**Task mode**: Also read YAML task state (which tasks are pending, in_progress).
**Metric mode**: Analyze patterns in successful vs. discarded commits.

## Phase 2: Ideate

### Task Mode
1. Load all tasks from .agent-os/research-tasks/
2. Filter: status != completed, not blocked by hard dependencies
3. Sort by priority (explicit priority or milestone order)
4. Pick the highest priority task
5. Determine which phase of the task to work on next

### Metric Mode
1. Read git log: which files appear in successful (kept) commits?
2. Read results TSV: what kind of changes improved the metric?
3. Identify unexplored areas (files not yet touched)
4. Propose a specific, concrete change hypothesis

## Phase 3: Modify

Make ONE atomic change:
- Self-check: can this change be described in one sentence without "and"?
- If >5 files need modification: pause, validate the scope is correct
- Write the code change

## Phase 4: Commit

```bash
git add <file1> <file2> ...      # Explicit files, NEVER git add -A
git diff --cached --quiet         # Verify something is staged
git commit -m "experiment(<scope>): <one-line description>"
```

Commit BEFORE verification — this creates a clean rollback point.

## Phase 5: Verify

### Task Mode
```bash
python .agent-os/research-tasks/validate.py
python .agent-os/research-tasks/verify_completion.py <task_id>  # if marking complete
```

### Metric Mode
```bash
eval "$VERIFY_COMMAND"
```
Output MUST be a single number matching `^-?[0-9]+\.?[0-9]*$`.
Strings like "PASS", "85.2%", "342ms" → metric-error.

## Phase 5.5: Guard (Optional)

If `--guard` is set:
```bash
eval "$GUARD_COMMAND"
```

Pass/fail guard: exit code 0 = pass, non-zero = fail.
Metric-valued guard: output is a number, must be ≥ threshold.

## Phase 6: Decide

```
IF metric_improved AND (no guard OR guard_passed):
    STATUS = "keep"
    
ELIF metric_improved AND guard_failed:
    # Rework: try to keep improvement without breaking guard
    Revert, rework (max 2 attempts)
    If still failing: STATUS = "discard"
    
ELIF metric_same_or_worse:
    git revert HEAD --no-edit
    STATUS = "discard"
    
ELIF crashed:
    Try fix (max 3 attempts)
    If still crashing: git revert HEAD --no-edit, STATUS = "crash"
```

### Rollback Strategy
Prefer `git revert` over `git reset --hard` (preserves history for learning).
Fallback: `git revert --abort && git reset --hard HEAD~1` (if revert conflicts).

## Phase 7: Log

### TSV
```tsv
{iteration}\t{commit_hash_or_-}\t{metric}\t{delta}\t{guard}\t{guard_metric}\t{status}\t{description}
```

### Run Log
Append to `.agent-os/run-log.md`:
```markdown
- **{timestamp}** iteration {N}: {status} — {description} (delta: {delta})
```

### YAML (Task mode only)
Update task phase status, criteria.current, deliverables.

## Phase 8: Continue or Stop

### Stop Conditions
- Iterations exhausted (`--iterations=N` reached)
- All tasks completed (task mode)
- Plateau detected (metric mode, see plateau-detection.md)
- Two consecutive metric-errors → halt

### Continue
Increment iteration counter, go to Phase 1.
