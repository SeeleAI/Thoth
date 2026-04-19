#!/usr/bin/env bash
set -e
cd "$(git rev-parse --show-toplevel)"

echo "=== Session End Health Check ==="
echo ""

bash .agent-os/validate-all.sh

echo ""
echo "=== Session End Check PASSED ==="
