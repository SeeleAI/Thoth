"""Project initialization and canonical projection rendering for Thoth."""

from __future__ import annotations

import json
import os
import shutil
import textwrap
from pathlib import Path
from typing import Any

from .command_specs import COMMAND_SPECS


CONFIG_FILE = ".research-config.yaml"
ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = ROOT / "templates"

DEFAULT_PHASES = [
    {"id": "survey", "label_zh": "文献综述", "label_en": "Survey", "weight": 20},
    {"id": "method_design", "label_zh": "方案设计", "label_en": "Method Design", "weight": 20},
    {"id": "experiment", "label_zh": "实验", "label_en": "Experiment", "weight": 40},
    {"id": "conclusion", "label_zh": "结论", "label_en": "Conclusion", "weight": 20},
]

DEFAULT_DELIVERABLE_TYPES = ["report", "model", "checkpoint", "data", "script", "config"]

DIRECTION_COLORS = [
    "#CC8B3A", "#8BA870", "#D4907A", "#9B7CB5",
    "#6B9BD2", "#D4A76A", "#7BC8A4", "#C87B8A",
]

REQUIRED_AGENT_OS_FILES = [
    "project-index.md",
    "requirements.md",
    "architecture-milestones.md",
    "todo.md",
    "cross-repo-mapping.md",
    "acceptance-report.md",
    "lessons-learned.md",
    "run-log.md",
    "change-decisions.md",
]


def _now_str() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def parse_config(config_json: str) -> dict[str, Any]:
    config = json.loads(config_json)
    project_dir = Path.cwd()
    config.setdefault("name", project_dir.name)
    config.setdefault("description", "")
    config.setdefault("language", "zh")
    config.setdefault("directions", [])
    config.setdefault("phases", DEFAULT_PHASES)
    config.setdefault("port", 8501)
    config.setdefault("theme", "warm-bear")

    directions = config["directions"]
    if isinstance(directions, str):
        directions = [d.strip() for d in directions.split(",") if d.strip()]
    config["directions"] = directions
    return config


def generate_research_config(config: dict[str, Any], project_dir: Path) -> None:
    lines: list[str] = []
    lines.append("project:")
    lines.append(f'  name: "{config["name"]}"')
    lines.append(f'  description: "{config.get("description", "")}"')
    lines.append(f'  language: "{config["language"]}"')
    lines.append('  version: "0.2.0"')
    lines.append("")
    lines.append("research:")
    lines.append("  directions:")
    for i, direction in enumerate(config["directions"]):
        color = DIRECTION_COLORS[i % len(DIRECTION_COLORS)]
        if isinstance(direction, dict):
            d_id = direction["id"]
            label_en = direction.get("label_en", d_id.title())
            label_zh = direction.get("label_zh", d_id)
            color = direction.get("color", color)
        else:
            d_id = str(direction)
            label_en = d_id.title()
            label_zh = d_id
        lines.extend([
            f'    - id: "{d_id}"',
            f'      label_zh: "{label_zh}"',
            f'      label_en: "{label_en}"',
            f'      color: "{color}"',
        ])
    lines.append("")
    lines.append("  phases:")
    for phase in config["phases"]:
        lines.extend([
            f'    - id: "{phase["id"]}"',
            f'      label_zh: "{phase.get("label_zh", phase["id"])}"',
            f'      label_en: "{phase.get("label_en", phase["id"])}"',
            f'      weight: {phase.get("weight", 25)}',
        ])
    lines.append("")
    lines.append("  deliverable_types:")
    for item in DEFAULT_DELIVERABLE_TYPES:
        lines.append(f'    - "{item}"')
    lines.extend([
        "",
        "dashboard:",
        f'  port: {config["port"]}',
        f'  theme: "{config["theme"]}"',
        "",
        "toolchain:",
        '  python: "python"',
        "  pre_commit: true",
        "  git_hooks: true",
        "  codex_project_layer: true",
        "",
    ])
    (project_dir / CONFIG_FILE).write_text("\n".join(lines), encoding="utf-8")


def generate_milestones(config: dict[str, Any], project_dir: Path) -> None:
    content = textwrap.dedent(f"""\
# Milestones for {config['name']}
milestones: []
""")
    (project_dir / ".agent-os" / "milestones.yaml").write_text(content, encoding="utf-8")


def generate_agent_os_docs(config: dict[str, Any], project_dir: Path) -> None:
    name = config["name"]
    templates = {
        "project-index.md": f"# Project Index\n\n- Project: {name}\n- Status: Initialized\n",
        "requirements.md": "# Requirements\n\n## User Goals\n- (Define goals here)\n",
        "architecture-milestones.md": "# Architecture & Milestones\n\n## Current Architecture\n- (Describe architecture)\n",
        "todo.md": "# TODO\n\n## Backlog\n\n## Ready\n\n## Doing\n\n## Blocked\n\n## Done\n\n## Verified\n\n## Abandoned\n\n<!-- RESEARCH-TASKS-AUTO-START -->\n\n_No research task YAML files found._\n\n<!-- RESEARCH-TASKS-AUTO-END -->\n",
        "cross-repo-mapping.md": "# Cross-Repo Mapping\n\n| Main ID | Local ID | Repo | Status |\n|---------|----------|------|--------|\n| (none) | | | |\n",
        "acceptance-report.md": "# Acceptance Report\n\n- No conclusions yet.\n",
        "lessons-learned.md": "# Lessons Learned\n\n- No failed explorations recorded yet.\n",
        "run-log.md": f"# Run Log\n\n- {_now_str()} [project initialization]\n  - Worked on: Project setup\n  - Evidence produced: .thoth authority, AGENTS.md, CLAUDE.md, .codex/\n",
        "change-decisions.md": f"# Change Decisions\n\n| ID | Date | Decision | Rationale | Impact |\n|----|------|----------|-----------|--------|\n| CD-001 | {_now_str()[:10]} | Project initialized | Starting from scratch | All files created |\n",
    }
    agent_os = project_dir / ".agent-os"
    agent_os.mkdir(parents=True, exist_ok=True)
    for filename, content in templates.items():
        (agent_os / filename).write_text(content, encoding="utf-8")


def generate_research_tasks(config: dict[str, Any], project_dir: Path) -> None:
    tasks_dir = project_dir / ".agent-os" / "research-tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    for script_name in ("validate.py", "sync_todo.py", "check_consistency.py", "verify_completion.py", "verify_on_complete.py", "schema.json"):
        src = TEMPLATES_DIR / "agent-os" / "research-tasks" / script_name
        if src.exists():
            shutil.copy2(src, tasks_dir / script_name)
    (tasks_dir / "paper-module-mapping.yaml").write_text("# Paper-Module Mapping\npapers: []\n", encoding="utf-8")
    for direction in config.get("directions", []):
        d_id = direction["id"] if isinstance(direction, dict) else direction
        (tasks_dir / d_id).mkdir(exist_ok=True)


def generate_dashboard(config: dict[str, Any], project_dir: Path) -> None:
    src = TEMPLATES_DIR / "dashboard"
    dest = project_dir / "tools" / "dashboard"
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest, dirs_exist_ok=True)


def render_project_instructions(config: dict[str, Any]) -> str:
    commands = "\n".join(f"- `{spec.command_id}`: {spec.summary}" for spec in COMMAND_SPECS)
    return textwrap.dedent(f"""\
# Thoth Project Instructions

This document is the canonical human-readable project instruction source for `{config["name"]}`.

## Runtime Authority

- `.thoth` is the only runtime authority.
- `run` and `loop` are durable by default and support attach/watch/stop lifecycle.
- Hooks and subagents may enhance throughput but are never correctness requirements.

## Recovery Order

1. Read this file.
2. Read `.agent-os/project-index.md`.
3. Read `.agent-os/requirements.md`, `.agent-os/architecture-milestones.md`, `.agent-os/todo.md`.
4. Read `.agent-os/run-log.md` last for recent context.

## Public Surfaces

{commands}
""")


def generate_thoth_runtime(config: dict[str, Any], project_dir: Path) -> None:
    thoth_dir = project_dir / ".thoth"
    for rel in ("project", "runs", "migrations", "derived"):
        (thoth_dir / rel).mkdir(parents=True, exist_ok=True)
    manifest = {
        "schema_version": 2,
        "project": {
            "name": config["name"],
            "description": config.get("description", ""),
            "language": config.get("language", "zh"),
        },
        "runtime": {
            "authority": ".thoth",
            "runs_dir": ".thoth/runs",
            "project_manifest": ".thoth/project/project.json",
            "project_instructions": ".thoth/project/instructions.md",
        },
        "hosts": {
            "claude": {"projection": "CLAUDE.md"},
            "codex": {"projection": "AGENTS.md"},
        },
    }
    (thoth_dir / "project" / "project.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (thoth_dir / "project" / "instructions.md").write_text(render_project_instructions(config), encoding="utf-8")
    for rel in ("runs/.gitkeep", "migrations/.gitkeep", "derived/.gitkeep"):
        (thoth_dir / rel).write_text("", encoding="utf-8")


def generate_pre_commit_config(config: dict[str, Any], project_dir: Path) -> None:
    content = textwrap.dedent("""\
repos:
  - repo: local
    hooks:
      - id: research-tasks-schema
        name: Validate research task YAML schema
        entry: python .agent-os/research-tasks/validate.py
        language: python
        files: '\\.agent-os/research-tasks/.*\\.ya?ml$'
        additional_dependencies: ['pyyaml', 'jsonschema']
        pass_filenames: false
      - id: sync-todo-freshness
        name: Check todo.md sync freshness
        entry: python .agent-os/research-tasks/sync_todo.py --check-only
        language: python
        files: '\\.agent-os/research-tasks/.*\\.ya?ml$'
        additional_dependencies: ['pyyaml']
        pass_filenames: false
""")
    (project_dir / ".pre-commit-config.yaml").write_text(content, encoding="utf-8")


def generate_scripts(config: dict[str, Any], project_dir: Path) -> None:
    scripts_dir = project_dir / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    scripts = {
        "install-hooks.sh": "#!/usr/bin/env bash\nset -e\npre-commit install\n",
        "check-required-files.sh": "#!/usr/bin/env bash\nset -e\nfor f in project-index.md requirements.md architecture-milestones.md todo.md cross-repo-mapping.md acceptance-report.md lessons-learned.md run-log.md change-decisions.md; do test -f \".agent-os/$f\" || { echo \"MISSING: .agent-os/$f\"; exit 1; }; done\n",
        "session-end-check.sh": "#!/usr/bin/env bash\nset -e\npython .agent-os/research-tasks/validate.py\npython .agent-os/research-tasks/check_consistency.py\npython .agent-os/research-tasks/sync_todo.py --check-only || python .agent-os/research-tasks/sync_todo.py\nbash scripts/check-required-files.sh\n",
        "validate-all.sh": "#!/usr/bin/env bash\nset -e\npython .agent-os/research-tasks/validate.py\npython .agent-os/research-tasks/check_consistency.py\npython .agent-os/research-tasks/sync_todo.py --check-only\nbash scripts/check-required-files.sh\n",
    }
    for filename, content in scripts.items():
        path = scripts_dir / filename
        path.write_text(content, encoding="utf-8")
        path.chmod(0o755)


def render_host_projection(config: dict[str, Any]) -> str:
    return textwrap.dedent(f"""\
# AGENTS.md

This file is generated from `.thoth/project/instructions.md` for `{config["name"]}`.

## Mission

- Preserve user-defined goals, requirements, and acceptance boundaries.
- Recover context from files rather than chat history.
- Treat `.thoth` as the only runtime authority.

## Recovery Order

1. Read this file.
2. Read `.thoth/project/instructions.md`.
3. Read `.agent-os/project-index.md`, `.agent-os/requirements.md`, `.agent-os/architecture-milestones.md`, `.agent-os/todo.md`.
4. Read `.agent-os/run-log.md` last.

## Runtime Rules

- `run` and `loop` are durable by default and support attach/watch/stop lifecycle.
- Hooks and subagents may enhance throughput but are never correctness dependencies.
- Dashboard truth comes from `.thoth/runs/*`, not host session state.
""")


def generate_host_projections(config: dict[str, Any], project_dir: Path) -> None:
    content = render_host_projection(config)
    agents_path = project_dir / "AGENTS.md"
    claude_path = project_dir / "CLAUDE.md"
    agents_path.write_text(content, encoding="utf-8")
    try:
        if claude_path.exists():
            claude_path.unlink()
        os.link(agents_path, claude_path)
    except OSError:
        claude_path.write_text(content, encoding="utf-8")


def generate_codex_project_layer(config: dict[str, Any], project_dir: Path) -> None:
    codex_dir = project_dir / ".codex"
    hooks_dir = codex_dir / "hooks"
    hooks_dir.mkdir(parents=True, exist_ok=True)
    (codex_dir / "config.json").write_text(json.dumps({
        "schema_version": 1,
        "project_layer": "enabled",
        "thoth_authority": ".thoth",
        "official_surface": "$thoth",
    }, indent=2) + "\n", encoding="utf-8")
    setup_path = codex_dir / "setup.sh"
    setup_path.write_text("#!/usr/bin/env bash\nset -e\npython --version\n", encoding="utf-8")
    setup_path.chmod(0o755)
    (hooks_dir / "hooks.json").write_text(json.dumps({
        "enabled": True,
        "hooks": [{"id": "thoth-session-end", "command": "bash scripts/session-end-check.sh"}],
    }, indent=2) + "\n", encoding="utf-8")


def generate_tests(config: dict[str, Any], project_dir: Path) -> None:
    tests_dir = project_dir / "tests"
    tests_dir.mkdir(parents=True, exist_ok=True)
    (tests_dir / "conftest.py").write_text("from pathlib import Path\n\nPROJECT_ROOT = Path(__file__).parent.parent\n", encoding="utf-8")
    (tests_dir / "test_structure.py").write_text(textwrap.dedent("""\
from pathlib import Path


REQUIRED_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    ".research-config.yaml",
    ".thoth/project/project.json",
    ".thoth/project/instructions.md",
    ".codex/config.json",
]


def test_required_files_exist():
    root = Path(__file__).parent.parent
    missing = [path for path in REQUIRED_FILES if not (root / path).exists()]
    assert not missing, missing
"""), encoding="utf-8")


def initialize_project(config: dict[str, Any], project_dir: Path) -> None:
    (project_dir / ".agent-os" / "research-tasks").mkdir(parents=True, exist_ok=True)
    (project_dir / "reports").mkdir(exist_ok=True)
    generate_research_config(config, project_dir)
    generate_milestones(config, project_dir)
    generate_agent_os_docs(config, project_dir)
    generate_research_tasks(config, project_dir)
    generate_thoth_runtime(config, project_dir)
    generate_dashboard(config, project_dir)
    generate_pre_commit_config(config, project_dir)
    generate_scripts(config, project_dir)
    generate_host_projections(config, project_dir)
    generate_codex_project_layer(config, project_dir)
    generate_tests(config, project_dir)


def sync_project_layer(project_dir: Path) -> None:
    """Regenerate project-local projections from canonical authority/config."""
    config_path = project_dir / CONFIG_FILE
    if not config_path.exists():
        return
    try:
        import yaml
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pyyaml is required to sync a project layer") from exc

    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    normalized = {
        "name": config.get("project", {}).get("name", project_dir.name),
        "description": config.get("project", {}).get("description", ""),
        "language": config.get("project", {}).get("language", "zh"),
        "directions": config.get("research", {}).get("directions", []),
        "phases": config.get("research", {}).get("phases", DEFAULT_PHASES),
        "port": config.get("dashboard", {}).get("port", 8501),
        "theme": config.get("dashboard", {}).get("theme", "warm-bear"),
    }
    generate_thoth_runtime(normalized, project_dir)
    generate_host_projections(normalized, project_dir)
    generate_codex_project_layer(normalized, project_dir)
