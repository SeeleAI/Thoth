---
name: sync
description: Synchronize all persistence data, IDs, and submodule states
argument-hint: "[--submodules]"
---

# /thoth:sync — 归位

## Scope Guard

**CAN:**
- Run sync_todo.py (YAML → todo.md)
- Validate ID sequences
- Check submodule states
- Update cross-repo mappings

**CANNOT:**
- Modify source code
- Modify YAML task content (only generates todo.md from YAML)
- Make git commits

## Workflow

### Step 1: Run Sync Script
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/sync.py" $ARGUMENTS
```

### Step 2: Operations

1. **YAML → todo.md**: `python .agent-os/research-tasks/sync_todo.py`
2. **ID validation**: Check ID sequences across all .agent-os/ docs
3. **Submodule sync** (if --submodules or submodules exist):
   - `git submodule status`
   - Check cross-repo-mapping.md alignment
   - Report any drift
4. **Timestamp update**: Update sync timestamp

### Step 3: Report
```
═══ Thoth Sync ═══
  ✓ todo.md synced (12 tasks)
  ✓ IDs aligned
  ✓ Submodules in sync (2 modules)
  Last sync: just now
```
