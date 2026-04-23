---
name: report
description: Auto-generate progress report for a date range
argument-hint: "--from YYYY-MM-DD --to YYYY-MM-DD [--output <path>]"
---

# /thoth:report — 谶纬

## Scope Guard

**CAN:**
- Read all project files
- Generate markdown report file
- Reference media (images, videos) via markdown links

**CANNOT:**
- Modify any existing files
- Execute experiments or builds

## Workflow

### Step 1: Parse Date Range
From `$ARGUMENTS`:
- `--from YYYY-MM-DD` (required)
- `--to YYYY-MM-DD` (required)
- `--output <path>` (default: `reports/{to_date}-report.md`)

### Step 2: Run Report Script
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/report.py" --from $FROM --to $TO --output $OUTPUT
```

### Step 3: Collection

The script collects:
1. **Completed tasks** in date range (from run-log.md timestamps)
2. **Progress on active tasks** (from YAML current state)
3. **New tasks created** in range
4. **Evidence and deliverables** (scan deliverable paths)
5. **Media references** (images, videos found in deliverables)

### Step 4: Generate Report

Output format:
```markdown
# Progress Report: {from} — {to}

## Summary
- Tasks completed: N
- Tasks in progress: N
- Overall progress: X%

## Completed
### [task-id] Task Title
- Phase: conclusion → completed
- Verdict: confirmed/rejected
- Evidence: [link](path)
- ![screenshot](path/to/image.png)

## In Progress
### [task-id] Task Title
- Current phase: experiment (65%)
- Next: ...

## Blockers & Risks
- [task-id] blocked by [dep-id]: reason

## Media
- [video](path/to/demo.mp4)
```

### Step 5: Report Location
Print: "Report generated: {output_path}"
