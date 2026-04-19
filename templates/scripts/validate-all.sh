#!/usr/bin/env bash
set -e
cd "$(git rev-parse --show-toplevel)"

PASS=0
FAIL=0
TOTAL=0

run_check() {
    local name="$1"
    shift
    TOTAL=$((TOTAL + 1))
    if "$@" > /dev/null 2>&1; then
        echo "  ✓ $name"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $name"
        FAIL=$((FAIL + 1))
    fi
}

echo "Running validation checks..."
echo ""

run_check "Schema validation" python .agent-os/research-tasks/validate.py
run_check "Consistency check" python .agent-os/research-tasks/check_consistency.py
run_check "Todo sync freshness" python .agent-os/research-tasks/sync_todo.py --check-only
run_check "Required files" bash scripts/check-required-files.sh

echo ""
echo "Results: $PASS passed, $FAIL failed (out of $TOTAL)"

if [ $FAIL -gt 0 ]; then
    echo "SOME CHECKS FAILED"
    exit 1
else
    echo "ALL CHECKS PASSED"
    exit 0
fi
