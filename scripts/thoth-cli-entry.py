#!/usr/bin/env python3
"""Execute the plugin-local Thoth CLI without importing a shadowing repo package."""

from __future__ import annotations

import sys
from pathlib import Path


PLUGIN_ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    plugin_root = str(PLUGIN_ROOT)
    if plugin_root in sys.path:
        sys.path.remove(plugin_root)
    sys.path.insert(0, plugin_root)

    from thoth.cli import main as cli_main

    return cli_main(sys.argv[1:])


if __name__ == "__main__":
    raise SystemExit(main())
