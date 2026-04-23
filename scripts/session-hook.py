#!/usr/bin/env python3
"""Claude-facing Thoth session lifecycle hook.

Called by the plugin's hooks.json on SessionStart and SessionEnd events.

Usage:
    python session-hook.py start
    python session-hook.py end
"""

from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from thoth.host_hooks import run_host_hook


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: session-hook.py start|end", file=sys.stderr)
        return 1

    action = sys.argv[1].lower()
    if action not in {"start", "end"}:
        print(f"Unknown action: {action}. Use 'start' or 'end'.", file=sys.stderr)
        return 1

    result = run_host_hook(host="claude", event=action, project_root=Path.cwd())
    if result.stdout:
        print(result.stdout, end="")
    return result.exit_code


if __name__ == "__main__":
    sys.exit(main())
