---
name: thoth:run
description: Execute a single task (foreground), with verification and commit
argument-hint: "<task description or task_id>"
---

# /thoth:run — 施法

## Scope Guard

**CAN:**
- Modify source code files
- Run build/test commands
- Create git commits
- Update YAML task state
- Run validation and sync scripts

**CANNOT:**
- Start long-running loops (use /thoth:loop)
- Modify .research-config.yaml (use /thoth:discuss)
- Modify plugin files (use /thoth:extend)
- Discuss without executing (use /thoth:discuss)

## Plan Mode

1. Read: current task state, git status, relevant code
2. Draft: specific changes planned, files to modify
3. Approve → execute exactly as planned

## Workflow

### Step 1: Parse
Parse task from `$ARGUMENTS`. Can be:
- Free text: "fix the auth bug in login.py"
- Task ID: "e2-h1" (looks up YAML task file)

### Step 2: Precondition
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.py" --quick
```
Must pass. If not: report issues, suggest /thoth:doctor.

### Step 3: Execute
1. Make the code changes (ONE focused change)
2. Run validation:
   ```bash
   python .agent-os/research-tasks/validate.py
   ```
3. If task has completed phases, verify:
   ```bash
   python .agent-os/research-tasks/verify_completion.py <task_id>
   ```
4. Git commit:
   ```bash
   git add <specific-files>
   git commit -m "experiment(<scope>): <description>"
   ```
5. Update YAML task file (status, criteria.current, deliverables)
6. Sync:
   ```bash
   python .agent-os/research-tasks/sync_todo.py
   ```

### Step 4: Report
Print structured result: what changed, validation status, commit hash.

## Error Handling
- Validation fails → report specific errors, do NOT commit
- verify_completion fails → report what's missing, do NOT mark completed
- Git commit blocked by hooks → fix issues, retry
