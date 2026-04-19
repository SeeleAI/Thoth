---
name: thoth:discuss
description: Discussion mode — update docs/YAML/config/DB, strictly NO code modification
argument-hint: "<topic or question>"
---

# /thoth:discuss — 论道

## Scope Guard

**CAN:**
- Modify YAML task files (create, update status, set verdict)
- Modify .research-config.yaml and milestones.yaml
- Modify .agent-os/*.md documents
- Write to SQLite database (research events, todos)
- Modify research plans, milestones, architecture design
- Run validate.py and sync_todo.py (verification scripts)
- Actively discuss and confirm with user

**CANNOT (HARD CONSTRAINTS — NEVER VIOLATE):**
- Modify ANY source code file (*.py, *.ts, *.js, *.vue, *.cpp, etc.)
- Run build, compile, or training commands
- Execute experiments
- Install or uninstall dependencies
- Modify dashboard code or plugin scripts
- Run any script that isn't validate.py, sync_todo.py, or check_consistency.py
- Make git commits without explicit user approval

## Plan Mode

1. Read: current docs, YAML state, config
2. Draft: what documents/YAML/config will be modified
3. Approve → update as planned

## Workflow

### Step 1: Parse Topic
Read discussion topic from `$ARGUMENTS`.

### Step 2: Discuss
Engage in interactive discussion with user. Be proactive:
- Ask clarifying questions
- Propose alternatives
- Challenge assumptions (constructively)
- Reference existing state from .agent-os/ docs

### Step 3: Update Persistence
As decisions are made during discussion:
1. Update relevant YAML task files
2. Update .agent-os/ documents
3. Update config files if needed
4. Write to database if needed

### Step 4: Auto-Validate
After each batch of changes:
```bash
python .agent-os/research-tasks/validate.py
python .agent-os/research-tasks/sync_todo.py
```
If validation fails: inform user immediately.

### Step 5: Record Decisions
Append to `.agent-os/change-decisions.md`:
```markdown
### YYYY-MM-DD: <decision title>
**Context**: <why this came up>
**Decision**: <what was decided>
**Impact**: <what changes as a result>
```

### Step 6: End Check
Run quick doctor check before ending discussion.

## Error Handling
- If user asks to modify code → "That's outside /thoth:discuss scope. Use /thoth:run instead."
- Validation failure → show errors, ask user how to resolve
