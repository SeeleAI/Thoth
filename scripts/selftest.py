#!/usr/bin/env python3
"""Thin wrapper for the Thoth heavy self-test runner."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from thoth.selftest import main


if __name__ == "__main__":
    raise SystemExit(main())
