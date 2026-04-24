#!/usr/bin/env python3
"""Thin compatibility wrapper for Thoth project initialization."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from thoth.project_init import (
    DEFAULT_PHASES,
    REQUIRED_AGENT_OS_FILES,
    audit_repository_state,
    build_init_preview,
    generate_agent_os_docs,
    generate_dashboard,
    generate_milestones,
    generate_scripts,
    generate_tests,
    generate_thoth_runtime,
    generate_pre_commit_config,
    generate_host_projections,
    generate_codex_project_layer,
    initialize_project,
    parse_config,
)


def main() -> int:
    parser = argparse.ArgumentParser(description="Thoth project initializer")
    parser.add_argument("--config", required=True, help="Project config as JSON string")
    args = parser.parse_args()

    project_dir = Path.cwd()
    config = parse_config(args.config)
    result = initialize_project(config, project_dir)
    audit = result["audit"]
    preview = result["preview"]
    final_config = result["config"]

    print(f"Thoth {result['mode']} completed: {final_config['name']}")
    print(f"- Migration: {result['migration_id']}")
    print(
        f"- Audit: {len(audit.get('top_level_entries', []))} top-level entries, "
        f"{len(audit.get('docs_files', []))} docs files, "
        f"{len(audit.get('agent_os_files', []))} .agent-os files, "
        f"{len(audit.get('code_roots', []))} code roots"
    )
    print(
        f"- Managed paths: {len(preview.get('create', []))} create, "
        f"{len(preview.get('update', []))} update, "
        f"{len(preview.get('preserve', []))} preserve"
    )
    print(f"- {len(final_config.get('directions', []))} research direction(s) configured")
    print(f"- Runtime authority seeded under .thoth/")
    print(f"- Dashboard ready at http://localhost:{final_config.get('port', 8501)}")
    print("- Run /thoth:dashboard to start")
    print("- Run /thoth:status for current state")
    return 0


if __name__ == "__main__":
    sys.exit(main())
