#!/usr/bin/env python3
"""Synchronize strict Thoth project projections."""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from thoth.project_init import sync_project_layer
from thoth.projections import sync_repository_surfaces
from thoth.task_contracts import load_project_manifest


def main() -> int:
    manifest = load_project_manifest(Path.cwd())
    if not manifest:
        print("Not a Thoth project. Run /thoth:init to set up.")
        return 1

    project_name = manifest.get("project", {}).get("name", "Unknown Project")
    print(f"═══ Thoth Sync: {project_name} ═══")

    sync_project_layer(Path.cwd())
    written = sync_repository_surfaces()
    print("  ✓ strict authority recompiled and project projections refreshed")
    print(f"  ✓ rendered {len(written)} repository surface(s)")
    print(f"  Last sync: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
