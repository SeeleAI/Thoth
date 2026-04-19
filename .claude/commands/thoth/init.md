---
name: thoth:init
description: Initialize a new project with full Thoth infrastructure
argument-hint: "[project-name]"
---

# /thoth:init — 创世

## Scope Guard

**CAN:**
- Create new files in current directory
- Install Python/Node dependencies
- Initialize SQLite database
- Set up git hooks
- Run validation scripts

**CANNOT:**
- Modify existing project files (refuses if .research-config.yaml exists)
- Push to remote
- Modify files outside current directory

## Plan Mode

1. Read current directory state
2. Draft: list all files to be created, deps to install
3. Approve → generate everything

## Workflow

### Step 1: Preconditions
```bash
git rev-parse --show-toplevel  # Must be in a git repo
test ! -f .research-config.yaml  # Must not already be initialized
```
If `.research-config.yaml` exists: "Project already initialized. Use /thoth:doctor to check health."

### Step 2: Interactive Questionnaire
Use AskUserQuestion in 3 batches:

**Batch 1 — Project Basics:**
- Project name? (default: directory name)
- Description?
- Language? (zh / en)

**Batch 2 — Research Structure:**
- Research directions? (comma-separated IDs, e.g. "frontend,backend,data")
- Phase pipeline? (defaults: survey, method_design, experiment, conclusion)

**Batch 3 — Dashboard:**
- Dashboard port? (default: 8501)
- Theme? (warm-bear / dark / light)

### Step 3: Generate Files
Run: `python "${CLAUDE_PLUGIN_ROOT}/scripts/init.py" --config <answers_json>`

This generates:
- `.research-config.yaml`
- `.agent-os/milestones.yaml`
- `.agent-os/` (9 documents + research-tasks/ with schema + scripts)
- `tools/dashboard/` (backend + frontend)
- `.pre-commit-config.yaml`
- `scripts/` (install-hooks.sh, session-end-check.sh, validate-all.sh, check-required-files.sh)
- `CLAUDE.md`
- `tests/` (project-level test suite)

### Step 4: Setup
```bash
pip install pre-commit pyyaml jsonschema
bash scripts/install-hooks.sh
cd tools/dashboard/frontend && npm install && npm run build
python .agent-os/research-tasks/validate.py
python tools/dashboard/backend/database.py  # init SQLite
```

### Step 5: Verify & Report
```
✓ Thoth initialized: {project_name}
  - {N} research directions configured
  - Dashboard ready at http://localhost:{port}
  - Run /thoth:dashboard to start
  - Run /thoth:status for current state
```

## Error Handling
- pip install fails → report specific package, suggest manual install
- npm install fails → check Node.js version, suggest nvm
- validate.py fails → should never happen on fresh init, report bug
