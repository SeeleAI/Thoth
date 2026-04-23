---
name: doctor
description: Audit local persistence data for drift, conflicts, and alignment
argument-hint: "[--quick] [--fix]"
---

# /thoth:doctor — 诊脉

## Scope Guard

**CAN:**
- Read all project files
- Run validation scripts
- Run project-level tests
- With --fix: auto-fix minor issues (sync freshness, missing files)

**CANNOT:**
- Modify source code
- Modify YAML task content (only sync operations)
- Modify plugin files

## Workflow

### Step 1: Run Doctor Script
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/doctor.py" $ARGUMENTS
```

### Step 2: Checks Performed

1. **Schema validation**: `python .agent-os/research-tasks/validate.py`
2. **Consistency check**: `python .agent-os/research-tasks/check_consistency.py`
3. **Todo sync freshness**: `python .agent-os/research-tasks/sync_todo.py --check-only`
4. **Required files**: `bash scripts/check-required-files.sh`
5. **ID integrity**: Check for duplicate/missing IDs across docs
6. **Submodule sync**: `git submodule status` (if submodules exist)
7. **Milestone refs**: Verify all milestone task_ids exist
8. **SQLite integrity**: `PRAGMA integrity_check`
9. **Project tests**: `pytest tests/ -v` (if tests/ exists)

### Step 3: Report

```
═══ Thoth Doctor: {project_name} ═══

  ✓ Schema validation ......... PASS (12 tasks, 4 modules)
  ✓ Consistency check ......... PASS
  ✗ Todo sync freshness ....... FAIL (stale by 2 commits)
  ✓ Required files ............ PASS (9/9)
  ✓ ID integrity .............. PASS
  ✓ Milestone references ...... PASS (6 milestones)
  ✓ SQLite integrity .......... PASS
  ✓ Project tests ............. PASS (8 tests)

  Result: 1 issue(s) found
  Fix: Run /thoth:sync to update todo.md
```

### --quick Flag
Runs only checks 1-4 (fast, for precondition checks).

### --fix Flag
Auto-fixes:
- Stale todo.md → runs sync_todo.py
- Missing required files → creates from template
