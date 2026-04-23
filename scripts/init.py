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
    CONFIG_FILE,
    DEFAULT_PHASES,
    REQUIRED_AGENT_OS_FILES,
    generate_agent_os_docs,
    generate_dashboard,
    generate_milestones,
    generate_research_config,
    generate_research_tasks,
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
    if (project_dir / CONFIG_FILE).exists():
        print("Project already initialized. Use /thoth:doctor to check health.")
        return 1

    config = parse_config(args.config)
    initialize_project(config, project_dir)

    print(f"Thoth initialized: {config['name']}")
    print(f"- {len(config.get('directions', []))} research direction(s) configured")
    print(f"- Runtime authority seeded under .thoth/")
    print(f"- Dashboard ready at http://localhost:{config.get('port', 8501)}")
    print("- Run /thoth:dashboard to start")
    print("- Run /thoth:status for current state")
    return 0


if __name__ == "__main__":
    sys.exit(main())
