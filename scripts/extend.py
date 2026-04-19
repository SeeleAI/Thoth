#!/usr/bin/env python3
"""Thoth plugin extension safety validator.

Validates that extending the plugin (adding/modifying skills, commands, scripts)
does not break existing functionality by running the full test suite.

Usage:
    python extend.py                    # run all plugin tests
    python extend.py --changed FILE...  # report what changed, then test
"""

import argparse
import subprocess
import sys
from pathlib import Path
from typing import List


# The plugin root is the parent of scripts/
PLUGIN_ROOT = Path(__file__).resolve().parent.parent


def run_tests() -> tuple:
    """Run pytest tests/ in the plugin directory. Returns (returncode, stdout, stderr)."""
    tests_dir = PLUGIN_ROOT / "tests"
    if not tests_dir.exists():
        return 0, "No tests/ directory found. Skipping.", ""

    try:
        result = subprocess.run(
            [sys.executable, "-m", "pytest", str(tests_dir), "-v", "--tb=short"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(PLUGIN_ROOT),
        )
        # pytest exit code 5 means "no tests collected" -- treat as pass
        rc = 0 if result.returncode in (0, 5) else result.returncode
        return rc, result.stdout, result.stderr
    except subprocess.TimeoutExpired:
        return 1, "", "Tests timed out (>120s)"
    except FileNotFoundError:
        return 1, "", "pytest not found. Install with: pip install pytest"
    except Exception as exc:
        return 1, "", f"Error running tests: {exc}"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Thoth plugin extension safety validator"
    )
    parser.add_argument(
        "--changed",
        nargs="*",
        default=[],
        help="List of changed files (for reporting)",
    )
    args = parser.parse_args()

    print(f"Plugin root: {PLUGIN_ROOT}")
    print()

    # Report changes if provided
    if args.changed:
        print("Changed files:")
        for f in args.changed:
            fp = Path(f)
            status = "exists" if fp.exists() else "MISSING"
            print(f"  {f} ({status})")
        print()

    # Run tests
    print("Running plugin test suite...")
    print("-" * 50)

    returncode, stdout, stderr = run_tests()

    if stdout:
        print(stdout)
    if stderr:
        print(stderr, file=sys.stderr)

    print("-" * 50)

    if returncode == 0:
        print("PASS: All plugin tests passed. Extension is safe.")
        return 0
    else:
        print("FAIL: Plugin tests failed. Extension may break functionality.")
        print("Fix the failing tests before proceeding.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
