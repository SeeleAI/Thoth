# Thoth Memory Contract

These rules govern historical awareness.

## Git-as-Memory

Before proposing iterative changes, inspect recent history:

```bash
git log --oneline -20
git diff HEAD~1
git log --oneline -20 | grep "Revert"
```

## Anti-Repetition

- Avoid repeating recently reverted approaches.
- Prefer changes that reflect successful recent patterns.

## Results Logging

- Metric loops should maintain a machine-readable TSV results log.
- State changes must stay recoverable from files, not chat alone.
