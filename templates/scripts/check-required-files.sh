#!/usr/bin/env bash
set -e
cd "$(git rev-parse --show-toplevel)"

REQUIRED_FILES=(
    ".agent-os/project-index.md"
    ".agent-os/requirements.md"
    ".agent-os/architecture-milestones.md"
    ".agent-os/todo.md"
    ".agent-os/change-decisions.md"
    ".agent-os/acceptance-report.md"
    ".agent-os/lessons-learned.md"
    ".agent-os/run-log.md"
)

MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        echo "MISSING: $f"
        MISSING=$((MISSING + 1))
    fi
done

if [ $MISSING -gt 0 ]; then
    echo "ERROR: $MISSING required file(s) missing"
    exit 1
fi

echo "All ${#REQUIRED_FILES[@]} required files present."
exit 0
