# Plateau Detection

In unbounded metric mode, detect when the loop has stopped making progress.

## Tracking

```python
best_metric = baseline
best_iteration = 0
iterations_since_best = 0
plateau_patience = 15  # configurable via --plateau-patience

for each iteration:
    if valid_result and status not in (no-op, crash, hook-blocked, metric-error):
        if metric > best_metric:  # (or < for lower-is-better)
            best_metric = metric
            best_iteration = current
            iterations_since_best = 0
        else:
            iterations_since_best += 1
    
    if iterations_since_best >= plateau_patience:
        PAUSE → ask user
```

## User Options When Plateaued

Present via AskUserQuestion:
1. **Stop here** — End the loop, keep current best
2. **Continue** — Reset patience counter, run another N iterations
3. **Change strategy** — Modify goal, scope, or verify command

## Noise Handling

For volatile metrics (benchmarks, ML accuracy):
- If `--noise=high`: run each verification 3 times, take median
- Min-delta threshold: ignore improvements below noise floor
- Confirmation run: if improvement is within 2x noise, run again to confirm
