---
name: loop
description: Autonomous long-running execution loop with goal and iteration control
argument-hint: "--mode=task|metric [--executor claude|codex] [--iterations=N] [--goal <text>] [--verify <cmd>] [--guard <cmd>] [--model <model>] [--effort <level>]"
---

# /thoth:loop — 轮回

## Scope Guard

**CAN:**
- All actions that /thoth:run can do
- Multiple iterations of modify → verify → commit/revert
- Create/read TSV results log
- Detect plateau and pause for user input

**CANNOT:**
- Run without explicit mode (--mode is required)
- Run without iteration limit in metric mode (--iterations required)
- Modify plugin files
- Modify .research-config.yaml

## Plan Mode

1. Read: current state, task pool, git history
2. Draft: loop configuration (mode, goal, iterations, verify command)
3. Approve → start loop

## Workflow

### Step 1: Parse Configuration
Required: `--mode=task` or `--mode=metric`

Optional:
- `--executor claude|codex` (default: `claude`)
- `--model <model>` and `--effort <level>` when `--executor codex`

For metric mode, also required:
- `--goal <description>`
- `--verify <shell command>` (must output single number)
- `--iterations=N`

Optional:
- `--guard <shell command>` (regression check)
- `--plateau-patience=N` (default: 15)

### Step 2: Interactive Setup Gate
If any required parameter is missing, use AskUserQuestion to collect it.
Validate --verify command with dry run before starting.

### Step 3: Initialize
```bash
# Create results log
echo "# metric_direction: higher_is_better" > thoth-results.tsv
echo -e "iteration\tcommit\tmetric\tdelta\tguard\tguard-metric\tstatus\tdescription" >> thoth-results.tsv
```

### Step 4: Loop (8 Phases)

**Phase 0: Preconditions**
- git working tree is clean
- .research-config.yaml exists
- No merge conflicts

**Phase 1: Review**
```bash
git log --oneline -20
tail -20 thoth-results.tsv
```
Read YAML state (task mode) or analyze patterns (metric mode).

**Phase 2: Ideate**
- Task mode: pick highest priority unblocked task from pool
- Metric mode: analyze git history, propose next optimization

**Phase 3: Modify**
ONE atomic change. Self-check: if >5 files, validate intent.

If `--executor codex`, delegate only Phase 3 to the internal `codex-worker`
agent and then resume loop control in Thoth.

**Phase 4: Commit**
```bash
git add <specific-files>
git commit -m "experiment(<scope>): <description>"
```

**Phase 5: Verify**
- Task mode: `python .agent-os/research-tasks/validate.py` + verify_completion
- Metric mode: run --verify command, extract number, validate format

**Phase 5.5: Guard** (optional)
If --guard provided: run guard command. Pass/fail or metric-valued.

**Phase 6: Decide**
Apply decision logic from `contracts/exec.md`.
- keep → move to next iteration
- discard → `git revert HEAD --no-edit`
- rework → retry Phase 3 with constraint (max 2 attempts)
- crash → fix attempt (max 3), then revert

**Phase 7: Log**
Append to TSV. Update YAML (task mode). Append to run-log.md.

**Phase 8: Continue or Stop**
- Iterations exhausted → stop
- All tasks complete (task mode) → stop
- Plateau detected (metric mode) → pause, ask user:
  1. Stop here
  2. Continue with reset patience
  3. Change strategy

## Error Handling
- Two consecutive metric-errors → halt loop, report
- Git conflict during revert → `git revert --abort && git reset --hard HEAD~1`
- Pre-commit hook failure → fix issue, do NOT skip hooks
