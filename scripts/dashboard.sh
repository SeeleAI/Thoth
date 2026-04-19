#!/usr/bin/env bash
# Thoth dashboard manager.
#
# Usage:
#   bash dashboard.sh start    # Start dashboard (default)
#   bash dashboard.sh stop     # Stop dashboard
#   bash dashboard.sh rebuild  # Stop + rebuild frontend + restart
set -euo pipefail

ACTION="${1:-start}"

# ---------------------------------------------------------------------------
# Detect project
# ---------------------------------------------------------------------------

CONFIG_FILE=".research-config.yaml"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Not a Thoth project. Run /thoth:init to set up."
    exit 1
fi

# Read port from config (default 8501)
PORT=$(python3 -c "
import yaml, sys
try:
    with open('$CONFIG_FILE') as f:
        c = yaml.safe_load(f)
    print(c.get('dashboard', {}).get('port', 8501))
except Exception:
    print(8501)
" 2>/dev/null || echo 8501)

DASHBOARD_BACKEND="tools/dashboard/backend"
DASHBOARD_FRONTEND="tools/dashboard/frontend"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

find_pid() {
    # Find uvicorn process serving our dashboard port
    pgrep -f "uvicorn.*--port.*${PORT}" 2>/dev/null || true
}

is_running() {
    local pid
    pid=$(find_pid)
    [ -n "$pid" ]
}

# ---------------------------------------------------------------------------
# Actions
# ---------------------------------------------------------------------------

do_start() {
    if is_running; then
        echo "Dashboard already running at http://localhost:${PORT} (PID: $(find_pid))"
        return 0
    fi

    # Check backend exists
    if [ ! -d "$DASHBOARD_BACKEND" ]; then
        echo "Error: Dashboard backend not found at $DASHBOARD_BACKEND"
        echo "Run /thoth:init to set up the dashboard."
        exit 1
    fi

    # Build frontend if dist doesn't exist
    if [ -d "$DASHBOARD_FRONTEND" ] && [ ! -d "${DASHBOARD_FRONTEND}/dist" ]; then
        echo "Building frontend..."
        (cd "$DASHBOARD_FRONTEND" && npm run build) || {
            echo "Warning: Frontend build failed. Dashboard will run without frontend."
        }
    fi

    # Start uvicorn in background
    echo "Starting dashboard on port ${PORT}..."
    cd "$DASHBOARD_BACKEND"
    python3 -m uvicorn app:app --host 0.0.0.0 --port "${PORT}" \
        > /dev/null 2>&1 &
    local pid=$!
    cd - > /dev/null

    # Wait briefly and check it started
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
        echo "Dashboard running at http://localhost:${PORT} (PID: ${pid})"
    else
        echo "Error: Dashboard failed to start. Check logs."
        exit 1
    fi
}

do_stop() {
    local pid
    pid=$(find_pid)
    if [ -z "$pid" ]; then
        echo "Dashboard is not running."
        return 0
    fi

    echo "Stopping dashboard (PID: ${pid})..."
    kill "$pid" 2>/dev/null || true

    # Wait for graceful shutdown
    local i=0
    while kill -0 "$pid" 2>/dev/null && [ $i -lt 10 ]; do
        sleep 0.5
        i=$((i + 1))
    done

    # Force kill if still running
    if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
    fi

    echo "Dashboard stopped."
}

do_rebuild() {
    echo "Rebuilding dashboard..."

    # Stop if running
    do_stop

    # Rebuild frontend
    if [ -d "$DASHBOARD_FRONTEND" ]; then
        echo "Building frontend..."
        (cd "$DASHBOARD_FRONTEND" && npm run build) || {
            echo "Error: Frontend build failed."
            exit 1
        }
        echo "Frontend built."
    else
        echo "Warning: No frontend directory found at $DASHBOARD_FRONTEND"
    fi

    # Restart
    do_start
    echo "Dashboard rebuilt and restarted."
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

case "$ACTION" in
    start)
        do_start
        ;;
    stop)
        do_stop
        ;;
    rebuild)
        do_rebuild
        ;;
    *)
        echo "Usage: dashboard.sh [start|stop|rebuild]"
        exit 1
        ;;
esac
