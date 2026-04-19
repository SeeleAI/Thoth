---
name: thoth-memory
description: >
  Git-as-memory patterns, TSV results logging, and state persistence rules.
  Ensures every iteration learns from history and never repeats discarded
  approaches. Loaded for /thoth:run and /thoth:loop.
version: 0.1.0
---

# thoth-memory — Memory & Persistence Contract

## 1. Git-as-Memory

Every iteration MUST read recent history:
```bash
git log --oneline -20              # See experiment sequence
git diff HEAD~1                    # Inspect last change
git log --oneline -20 | grep "Revert"  # Identify failed approaches
```

### Pattern Detection
- Track which files appear in successful (kept) commits
- Prioritize changes to high-value files
- Cross-reference with results TSV: "what kind of changes succeeded?"

### Anti-Repetition
- Before proposing a change, check if a similar approach was already reverted
- If found: choose a different strategy
- "Repeating a reverted experiment is always wrong"

## 2. TSV Results Logging

**File**: `thoth-results.tsv` (created at loop start, gitignored)

**Format**:
```
iteration	commit	metric	delta	guard	guard-metric	status	description
0	a1b2c3d	85.2	0.0	pass	-	baseline	initial state
1	b2c3d4e	87.1	+1.9	pass	-	keep	add auth tests
2	-	86.5	-0.6	-	-	discard	refactor helpers
```

**Statuses**: keep, discard, crash, no-op, hook-blocked, metric-error

## 3. State Persistence (Triple-Write)

When task state changes, ALL three must update:
1. **YAML** task file (primary source)
2. **run-log.md** (append timestamped entry)
3. **TSV** results log (if in loop mode)

## 4. References

- `references/git-memory.md` — Detailed git history reading patterns
- `references/results-logging.md` — TSV schema and reading patterns
