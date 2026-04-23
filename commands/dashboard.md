---
name: dashboard
description: Start, stop, or rebuild the project dashboard
argument-hint: "[start|stop|rebuild]"
---

# /thoth:dashboard — 神殿

## Scope Guard

**CAN:**
- Start/stop the dashboard server
- Rebuild the frontend
- Print dashboard URL

**CANNOT:**
- Modify dashboard code (use /thoth:extend for plugin, /thoth:run for project)
- Modify any project files

## Workflow

### Default (start)
```bash
bash "${CLAUDE_PLUGIN_ROOT}/scripts/dashboard.sh" start
```

### Arguments

**start** (default):
1. Check if dashboard is already running → print URL if so
2. Check if frontend dist exists → build if not:
   ```bash
   cd tools/dashboard/frontend && npm run build
   ```
3. Start uvicorn:
   ```bash
   cd tools/dashboard/backend && python -m uvicorn app:app --host 0.0.0.0 --port ${PORT} &
   ```
4. Print: "Dashboard running at http://localhost:{port}"

**stop**:
1. Find running uvicorn process
2. Kill it gracefully
3. Print: "Dashboard stopped"

**rebuild**:
1. Stop dashboard if running
2. Rebuild frontend:
   ```bash
   cd tools/dashboard/frontend && npm run build
   ```
3. Restart dashboard
4. Print: "Dashboard rebuilt and restarted"
