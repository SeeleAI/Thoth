# Git-as-Memory

How the execution loop uses git history as a learning mechanism.

## Reading History (Every Iteration)

```bash
# 1. Recent experiment sequence
git log --oneline -20

# 2. Last successful change details
git diff HEAD~1

# 3. Which files drove improvements
git log --oneline -20 | grep "experiment"
git show <hash> --stat

# 4. Failed approaches (to avoid repeating)
git log --oneline -20 | grep "Revert"
```

## Pattern Detection

After reading history, identify:
1. **High-value files**: Files that appear in successful (kept) commits
2. **Successful patterns**: Types of changes that improved metrics
3. **Failed patterns**: Types of changes that were reverted

## Anti-Repetition Rule

Before proposing a change in Phase 2:
1. Check git log for similar reverted approaches
2. If found: "This approach was already tried in commit {hash} and reverted."
3. Choose a DIFFERENT strategy

## Learning Loop Example

```
git log shows:
  c3d4e5f experiment(model): add dropout 0.3 — KEPT
  Revert "experiment(model): switch optimizer to SGD"
  a1b2c3d experiment(model): increase hidden layers — KEPT

Agent reasoning:
  ✓ Dropout works, hidden layers work → try variants in same direction
  ✗ Optimizer change failed → don't try that again
  → Pick: "increase hidden layers from 4 to 6" (exploiting success)
```
