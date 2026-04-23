# Thoth Audit Contract

These rules govern validation and evidence collection.

## Evidence

- Do not claim a phase is complete without real measured evidence.
- `criteria.current` must be populated before a completed phase is accepted.
- Every non-null verdict must reference real files in `evidence_paths`.

## Verification Gate

Before marking a task phase as completed:

```bash
python .agent-os/research-tasks/verify_completion.py <task_id>
```

Only proceed on `PASS`.

## State Updates

When task state changes, update all required persistence surfaces together:

1. YAML task file
2. `.agent-os/run-log.md`
3. `.agent-os/research-tasks/sync_todo.py`
