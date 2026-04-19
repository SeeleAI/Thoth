---
name: thoth-audit
description: >
  Evidence rules, verification protocols, deliverable checks, and inter-skill
  contracts. Ensures no task is marked complete without real measured evidence.
  Loaded for /thoth:run, /thoth:loop, /thoth:discuss.
version: 0.1.0
---

# thoth-audit — Audit System Contract

## 1. Evidence Requirements

- Every completed phase MUST have `criteria.current` filled with a real measured value
- `criteria.current` = null when phase is completed → FAIL (verify_completion.py enforces this)
- Every verdict MUST have `evidence_paths` pointing to files that exist on disk
- Empty evidence_paths with a non-null verdict → FAIL

## 2. Verification Gate

Before marking ANY phase as `completed`:
1. Run `python .agent-os/research-tasks/verify_completion.py <task_id>`
2. Only proceed if output is `PASS`
3. If `FAIL`: fix the issues first, then re-verify
4. NEVER bypass verification. NEVER use estimated or placeholder values.

## 3. Structured Deliverables

All deliverables use array format:
```yaml
deliverables:
  - path: "path/to/artifact"
    type: "report"  # report | model | checkpoint | data | script | config
    description: "Brief description"
```

verify_completion.py checks every path exists on disk.

## 4. Failure Documentation

When a hypothesis is rejected or an experiment fails:
1. Fill `results.failure_analysis` in the YAML
2. Sync failure to `.agent-os/lessons-learned.md`
3. Never silently discard failed explorations

## 5. State Update Atomicity

When changing task state, ALL of these must update in the same action:
1. The YAML task file itself
2. `.agent-os/run-log.md` (append entry)
3. Run `python .agent-os/research-tasks/sync_todo.py` (updates todo.md)

## 6. Inter-Skill Contracts

See `references/contracts.md` for the 5 binding contracts:
- CONTRACT-CONFIG
- CONTRACT-TASK
- CONTRACT-MILESTONE
- CONTRACT-API
- CONTRACT-EVIDENCE
