---
name: thoth:extend
description: Safely add or modify plugin skills, commands, and scripts
argument-hint: "<what to add or modify>"
---

# /thoth:extend — 铸符

## Scope Guard

**CAN:**
- Add new command files to the thoth plugin
- Add new skill files to the thoth plugin
- Modify existing command/skill files
- Add new scripts to the thoth plugin
- Create corresponding unit tests

**CANNOT:**
- Modify target project files (use /thoth:run)
- Delete existing commands or skills without user confirmation
- Bypass the test gate
- Skip version bump

## Plan Mode (REQUIRED)

This command ALWAYS uses plan mode:
1. Analyze what needs to change
2. Draft plan with exact file diffs
3. User reviews and approves
4. Execute exactly as planned

## Workflow

### Step 1: Parse Request
What to add or modify from `$ARGUMENTS`.

### Step 2: Impact Analysis
1. List all files that will be created or modified
2. Check for naming conflicts with existing public commands and internal agents
3. Identify affected test suites
4. Check for scope overlaps with existing commands

### Step 3: Conflict Check
If ANY potential conflict detected:
- STOP immediately
- Present the conflict to user
- Wait for user decision before proceeding

### Step 4: Execute (after plan approval)
1. Create/modify command, skill, or script files
2. Create corresponding unit tests (REQUIRED for new functionality)
3. Run full test suite:
   ```bash
   cd "${CLAUDE_PLUGIN_ROOT}" && pytest tests/ -v
   ```
4. **If ANY test fails → revert ALL changes, report failure**

### Step 5: Finalize
1. Bump version in `.claude-plugin/plugin.json` (patch increment)
2. Update `CHANGELOG.md`
3. Report success with summary of changes

## Error Handling
- Test failure → revert all changes, show which test failed
- Name conflict → stop, present conflict, ask user
- Scope overlap → stop, present overlap, ask user
