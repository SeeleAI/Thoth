---
name: status
description: Script-controlled structured print of current project state
argument-hint: "[--full]"
---

# /thoth:status — 卦象

## Scope Guard

**CAN:** Read files and run status script (read-only)
**CANNOT:** Modify any files

## Workflow

### Step 1: Run Status Script
```bash
python "${CLAUDE_PLUGIN_ROOT}/scripts/status.py"
```

### Step 2: Present Output
Display the script's output verbatim. Do NOT paraphrase or restructure.

The script outputs:
```
═══ Thoth Status: {project_name} ═══

▸ Running:
  [■■■■□□□□□□] 42%  e2-h1 Phase1 Joint Training (experiment)

▸ Recent:
  ✓ e3-h2 Gradient Stability — completed 2h ago
  ✗ e5-h1 GBuffer Packing — reverted (guard failed)

▸ Next:
  → e2-h2 Per-Asset Fitting (ready, no blockers)
  → e5-h2 Mask Consistency (blocked by e5-h1)

▸ Health: ● ALL CHECKS PASSED | Last sync: 3min ago
```

With `--full` flag, also shows:
- Direction-level progress
- Milestone progress summary
- Recent activity log entries
