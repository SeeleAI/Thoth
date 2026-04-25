#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$PROJECT_ROOT" ]; then
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi
cd "$PROJECT_ROOT"

DASHBOARD_DIR="tools/dashboard"
BACKEND_DIR="$DASHBOARD_DIR/backend"
FRONTEND_DIR="$DASHBOARD_DIR/frontend"
if [ -n "${PYTHON:-}" ]; then
    PYTHON_BIN="$PYTHON"
elif [ -x ".venv/bin/python" ]; then
    PYTHON_BIN="$PROJECT_ROOT/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
else
    echo "Error: neither python3 nor python was found" >&2
    exit 127
fi

ACTION="${1:-start}"

case "$ACTION" in
    start)
        if [ ! -d "$FRONTEND_DIR/dist" ]; then
            echo "Building frontend..."
            (cd "$FRONTEND_DIR" && npm run build)
        fi
        PORT="${DASHBOARD_PORT:-8501}"
        echo "Starting dashboard on http://localhost:$PORT"
        (cd "$BACKEND_DIR" && exec "$PYTHON_BIN" -m uvicorn app:app --host 0.0.0.0 --port "$PORT") &
        echo "Dashboard PID: $!"
        ;;
    stop)
        pkill -f "uvicorn app:app" 2>/dev/null && echo "Dashboard stopped" || echo "No dashboard running"
        ;;
    rebuild)
        echo "Rebuilding frontend..."
        cd "$FRONTEND_DIR" && npm run build
        echo "Frontend rebuilt. Restart dashboard with: bash $0 start"
        ;;
    *)
        echo "Usage: $0 [start|stop|rebuild]"
        exit 1
        ;;
esac
