---
name: thoth:run:codex
description: Execute a single task using Codex (delegates modification to Codex)
argument-hint: "[--model <model>] [--effort <level>] <task description>"
---

# /thoth:run:codex

## Scope Guard
Same as /thoth:run, but code modification is delegated to Codex.

## Workflow

### Step 1: Parse
Extract from `$ARGUMENTS`:
- `--model <model>` (optional, forwarded to Codex)
- `--effort <level>` (optional, forwarded to Codex)
- Remaining text = task description

### Step 2: Precondition
Same as /thoth:run (quick doctor check).

### Step 3: Delegate to Codex
Invoke the codex rescue subagent:
```
Agent(subagent_type: "codex:codex-rescue", prompt: "<task> --model <model> --effort <effort>")
```

### Step 4: Post-Codex Validation
After Codex completes:
1. Run `python .agent-os/research-tasks/validate.py`
2. If task has completed phases: `python .agent-os/research-tasks/verify_completion.py <task_id>`
3. Git commit (if not already committed by Codex)
4. Update YAML + sync

### Step 5: Report
Display Codex output verbatim, then validation results.
