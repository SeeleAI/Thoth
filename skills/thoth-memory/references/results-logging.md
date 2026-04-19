# TSV Results Logging

## File

`thoth-results.tsv` — created at loop start, gitignored.

## Schema

```
iteration	commit	metric	delta	guard	guard-metric	status	description
```

| Column | Type | Example |
|--------|------|---------|
| iteration | int | 0, 1, 2, ... |
| commit | string | "a1b2c3d" or "-" (if reverted) |
| metric | float | 87.1, baseline |
| delta | float | +1.9 or -0.6 (from best) |
| guard | enum | pass, fail, or - |
| guard-metric | float or - | 48500 or - |
| status | enum | keep, discard, crash, no-op, hook-blocked, metric-error, baseline |
| description | string | "add tests for auth middleware" |

## Reading Patterns

```bash
# Recent experiments
tail -20 thoth-results.tsv

# What succeeded?
grep 'keep' thoth-results.tsv | tail -5

# What failed?
grep 'discard' thoth-results.tsv | tail -3

# Progress summary (every 10 iterations)
KEEPS=$(grep -c 'keep' thoth-results.tsv)
DISCARDS=$(grep -c 'discard' thoth-results.tsv)
echo "Progress: ${KEEPS} keeps, ${DISCARDS} discards"
```
