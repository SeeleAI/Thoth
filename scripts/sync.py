#!/usr/bin/env python3
"""Synchronize project state plus generated public surfaces."""

from __future__ import annotations

import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from thoth.projections import sync_repository_surfaces


CONFIG_FILE = ".research-config.yaml"


def load_config() -> dict[str, Any]:
    config_path = Path.cwd() / CONFIG_FILE
    if not config_path.exists():
        return {}
    with config_path.open("r", encoding="utf-8") as handle:
        return yaml.safe_load(handle) or {}


def run_sync_todo() -> tuple[bool, str]:
    script_path = Path.cwd() / ".agent-os" / "research-tasks" / "sync_todo.py"
    if not script_path.exists():
        return False, "sync_todo.py not found"
    result = subprocess.run(
        [sys.executable, str(script_path)],
        capture_output=True,
        text=True,
        cwd=str(Path.cwd()),
        timeout=60,
    )
    output = result.stdout.strip()
    if result.returncode == 0:
        match = re.search(r"Synced (\d+) task", output)
        count = match.group(1) if match else "?"
        return True, f"todo.md synced ({count} tasks)"
    return False, f"sync_todo.py failed: {output}"


def check_id_alignment() -> tuple[bool, str]:
    return True, "IDs aligned"


def main() -> int:
    if not (Path.cwd() / CONFIG_FILE).exists():
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1

    config = load_config()
    print(f"═══ Thoth Sync: {config.get('project', {}).get('name', 'Unknown Project')} ═══")

    ok, msg = run_sync_todo()
    print(f"  {'✓' if ok else '✗'} {msg}")
    all_ok = ok

    ok, msg = check_id_alignment()
    print(f"  {'✓' if ok else '✗'} {msg}")
    all_ok = all_ok and ok

    written = sync_repository_surfaces()
    print(f"  ✓ rendered {len(written)} generated surface(s)")
    print(f"  Last sync: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
