#!/usr/bin/env bash
set -e
cd "$(git rev-parse --show-toplevel)"

echo "Installing pre-commit hooks..."

if ! command -v pre-commit &> /dev/null; then
    echo "Installing pre-commit..."
    pip install pre-commit
fi

pre-commit install
echo "Pre-commit hooks installed."

echo "Running initial validation..."
pre-commit run --all-files || true

echo "Done. Hooks will run automatically on git commit."
