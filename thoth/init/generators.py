"""Project materialization generators for `.agent-os`, `.thoth`, scripts, and host projections."""

from __future__ import annotations

import json
import os
import shutil
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from thoth.command_specs import COMMAND_SPECS
from thoth.plan.compiler import compile_task_authority
from thoth.plan.store import ensure_task_authority_tree

LEGACY_CONFIG_FILE = ".research-config.yaml"
ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_DIR = ROOT / "templates"

DEFAULT_PHASES = [
    {"id": "survey", "label_zh": "文献综述", "label_en": "Survey", "weight": 20},
    {"id": "method_design", "label_zh": "方案设计", "label_en": "Method Design", "weight": 20},
    {"id": "experiment", "label_zh": "实验", "label_en": "Experiment", "weight": 40},
    {"id": "conclusion", "label_zh": "结论", "label_en": "Conclusion", "weight": 20},
]

DIRECTION_COLORS = ["#CC8B3A", "#8BA870", "#D4907A", "#9B7CB5", "#6B9BD2", "#D4A76A", "#7BC8A4", "#C87B8A"]
REQUIRED_AGENT_OS_FILES = ["project-index.md", "requirements.md", "architecture-milestones.md", "todo.md", "cross-repo-mapping.md", "acceptance-report.md", "lessons-learned.md", "run-log.md", "change-decisions.md"]
OPTIONAL_AGENT_OS_FILES = ["milestones.yaml"]
GENERATED_SCRIPT_FILES = ["install-hooks.sh", "check-required-files.sh", "session-end-check.sh", "validate-all.sh", "thoth-codex-hook.sh"]
GENERATED_TEST_FILES = ["tests/conftest.py", "tests/test_structure.py"]
MANAGED_DIRECTORY_ROOTS = [".agent-os", ".claude", ".thoth", "scripts", "tests", "tools", "tools/dashboard"]
LEGACY_REMOVE_PATHS = [LEGACY_CONFIG_FILE, ".agent-os/research-tasks", "tests/test_validate.py", "tests/test_check_consistency.py", "tests/test_sync_todo.py", "tests/test_verify_completion.py"]
DISCOVERY_CODE_SUFFIXES = {".py", ".js", ".ts", ".tsx", ".vue", ".sh", ".rs", ".go", ".java", ".c", ".cc", ".cpp", ".h", ".hpp"}
THOTH_CLAUDE_BASH_ALLOW_PATTERN = "Bash(*thoth-claude-command.sh*)"

def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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


def _normalize_direction_entry(direction: Any, index: int) -> dict[str, Any]:
    color = DIRECTION_COLORS[index % len(DIRECTION_COLORS)]
    if isinstance(direction, dict):
        direction_id = str(direction.get("id") or f"direction-{index + 1}").strip()
        return {
            "id": direction_id,
            "label_zh": direction.get("label_zh", direction_id),
            "label_en": direction.get("label_en", direction_id.title()),
            "color": direction.get("color", color),
        }
    direction_id = str(direction).strip() or f"direction-{index + 1}"
    return {
        "id": direction_id,
        "label_zh": direction_id,
        "label_en": direction_id.title(),
        "color": color,
    }


def generate_milestones(config: dict[str, Any], project_dir: Path) -> None:
    path = project_dir / ".agent-os" / "milestones.yaml"
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    content = textwrap.dedent(f"""\
# Milestones for {config['name']}
milestones: []
""")
    path.write_text(content, encoding="utf-8")


def generate_agent_os_docs(config: dict[str, Any], project_dir: Path) -> None:
    name = config["name"]
    templates = {
        "project-index.md": f"# Project Index\n\n- Project: {name}\n- Status: Initialized\n",
        "requirements.md": "# Requirements\n\n## User Goals\n- (Define goals here)\n",
        "architecture-milestones.md": "# Architecture & Milestones\n\n## Current Architecture\n- (Describe architecture)\n",
        "todo.md": "# TODO\n\n## Backlog\n\n## Ready\n\n## Doing\n\n## Blocked\n\n## Done\n\n## Verified\n\n## Abandoned\n",
        "cross-repo-mapping.md": "# Cross-Repo Mapping\n\n| Main ID | Local ID | Repo | Status |\n|---------|----------|------|--------|\n| (none) | | | |\n",
        "acceptance-report.md": "# Acceptance Report\n\n- No conclusions yet.\n",
        "lessons-learned.md": "# Lessons Learned\n\n- No failed explorations recorded yet.\n",
        "run-log.md": f"# Run Log\n\n- {_now_str()} [project initialization]\n  - Worked on: Project setup\n  - Evidence produced: .thoth authority, AGENTS.md, CLAUDE.md, codex hook projection\n",
        "change-decisions.md": f"# Change Decisions\n\n| ID | Date | Decision | Rationale | Impact |\n|----|------|----------|-----------|--------|\n| CD-001 | {_now_str()[:10]} | Project initialized | Starting from scratch | All files created |\n",
    }
    agent_os = project_dir / ".agent-os"
    agent_os.mkdir(parents=True, exist_ok=True)
    for filename, content in templates.items():
        path = agent_os / filename
        if path.exists():
            continue
        path.write_text(content, encoding="utf-8")


def generate_dashboard(config: dict[str, Any], project_dir: Path) -> None:
    src = TEMPLATES_DIR / "dashboard"
    dest = project_dir / "tools" / "dashboard"
    shutil.copytree(src, dest, dirs_exist_ok=True)


def render_project_instructions(config: dict[str, Any]) -> str:
    commands = "\n".join(f"- `{spec.command_id}`: {spec.summary}" for spec in COMMAND_SPECS)
    return textwrap.dedent(f"""\
# Thoth Project Instructions

This document is the canonical human-readable project instruction source for `{config["name"]}`.

## Runtime Authority

- `.thoth` is the only runtime authority.
- Execution planning is compiler-driven: `Decision -> Contract -> generated Task`.
- Task-level current conclusions live in `.thoth/project/tasks/*.result.json`; generated tasks are read-only projections.
- `run` and `loop` only execute generated tasks from `.thoth/project/tasks/*.json`.
- Free-form execution is forbidden; ambiguous work must go back through `discuss`.
- `init` must audit the current repository before it standardizes any Thoth-managed surface.
- `run` and `loop` are durable by default and support attach/watch/stop lifecycle.
- Hooks and subagents may enhance throughput but are never correctness requirements.
- Claude Code and Codex project surfaces must stay aligned when new features are introduced.

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
    ensure_task_authority_tree(project_dir)
    directions = [_normalize_direction_entry(direction, index) for index, direction in enumerate(config.get("directions", []))]
    manifest = {
        "schema_version": 2,
        "project": {
            "name": config["name"],
            "description": config.get("description", ""),
            "language": config.get("language", "zh"),
            "directions": directions,
            "phases": config.get("phases", DEFAULT_PHASES),
        },
        "dashboard": {
            "port": config.get("port", 8501),
            "theme": config.get("theme", "warm-bear"),
        },
        "runtime": {
            "authority": ".thoth",
            "runs_dir": ".thoth/runs",
            "project_manifest": ".thoth/project/project.json",
            "project_instructions": ".thoth/project/instructions.md",
            "decision_dir": ".thoth/project/decisions",
            "contract_dir": ".thoth/project/contracts",
            "task_dir": ".thoth/project/tasks",
            "task_result_pattern": ".thoth/project/tasks/*.result.json",
            "compiler_state": ".thoth/project/compiler-state.json",
            "legacy_audit": ".thoth/project/legacy-audit.json",
            "execution_policy": {
                "mode": "strict-task-only",
                "free_form_execution": False,
                "task_source": ".thoth/project/tasks",
            },
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
    compile_task_authority(project_dir)


def generate_pre_commit_config(config: dict[str, Any], project_dir: Path) -> None:
    content = textwrap.dedent("""\
repos:
  - repo: local
    hooks:
      - id: thoth-doctor
        name: Validate strict Thoth authority
        entry: python -m thoth.cli doctor --json
        language: python
        pass_filenames: false
      - id: thoth-sync
        name: Refresh generated Thoth projections
        entry: python -m thoth.cli sync
        language: python
        pass_filenames: false
""")
    (project_dir / ".pre-commit-config.yaml").write_text(content, encoding="utf-8")


def generate_scripts(config: dict[str, Any], project_dir: Path) -> None:
    scripts_dir = project_dir / "scripts"
    scripts_dir.mkdir(parents=True, exist_ok=True)
    scripts = {
        "install-hooks.sh": "#!/usr/bin/env bash\nset -e\npre-commit install\n",
        "check-required-files.sh": "#!/usr/bin/env bash\nset -e\nfor f in project-index.md requirements.md architecture-milestones.md todo.md cross-repo-mapping.md acceptance-report.md lessons-learned.md run-log.md change-decisions.md; do test -f \".agent-os/$f\" || { echo \"MISSING: .agent-os/$f\"; exit 1; }; done\n",
        "session-end-check.sh": "#!/usr/bin/env bash\nset -e\npython -m thoth.cli sync\npython -m thoth.cli doctor\nbash scripts/check-required-files.sh\n",
        "validate-all.sh": "#!/usr/bin/env bash\nset -e\npython -m thoth.cli sync\npython -m thoth.cli doctor\nbash scripts/check-required-files.sh\n",
        "thoth-codex-hook.sh": "#!/usr/bin/env bash\nset -euo pipefail\nROOT=\"$(git rev-parse --show-toplevel 2>/dev/null || pwd)\"\ncd \"$ROOT\"\nEVENT=\"${1:-}\"\nif [ -z \"$EVENT\" ]; then\n  echo \"Usage: thoth-codex-hook.sh <start|stop>\" >&2\n  exit 0\nfi\nif command -v thoth >/dev/null 2>&1; then\n  exec thoth hook --host codex --event \"$EVENT\"\nfi\nif [ -n \"${THOTH_SOURCE_ROOT:-}\" ]; then\n  export PYTHONPATH=\"${THOTH_SOURCE_ROOT}${PYTHONPATH:+:${PYTHONPATH}}\"\n  exec python -m thoth.cli hook --host codex --event \"$EVENT\"\nfi\nexit 0\n",
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

- Planning authority lives in `.thoth/project/decisions`, `.thoth/project/contracts`, and generated `.thoth/project/tasks`.
- TaskResult authority lives in `.thoth/project/tasks/*.result.json`.
- `run` and `loop` execute by `--task-id` only; free-form goals belong in `discuss`.
- `run` and `loop` are durable by default and support attach/watch/stop lifecycle.
- Hooks and subagents may enhance throughput but are never correctness dependencies.
- Dashboard truth comes from `.thoth/runs/*`, not host session state.
- New feature work must keep Claude Code and Codex project surfaces in sync.
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


def render_codex_hooks_payload() -> dict[str, Any]:
    def _hook_command(event: str) -> str:
        return (
            "bash -lc '"
            f"if command -v thoth >/dev/null 2>&1; then exec thoth hook --host codex --event {event}; fi; "
            "ROOT=\"$(git rev-parse --show-toplevel 2>/dev/null || pwd)\"; "
            f"if [ -x \"$ROOT/scripts/thoth-codex-hook.sh\" ]; then exec bash \"$ROOT/scripts/thoth-codex-hook.sh\" {event}; fi; "
            "exit 0'"
        )

    return {
        "hooks": {
            "SessionStart": [
                {
                    "matcher": "startup|resume",
                    "hooks": [
                        {
                            "type": "command",
                            "command": _hook_command("start"),
                            "statusMessage": "Loading Thoth runtime context",
                        }
                    ],
                }
            ],
            "Stop": [
                {
                    "hooks": [
                        {
                            "type": "command",
                            "command": _hook_command("stop"),
                            "statusMessage": "Recording Thoth runtime summary",
                        }
                    ],
                }
            ],
        }
    }


def generate_codex_hook_projection(project_dir: Path) -> None:
    payload = render_codex_hooks_payload()
    path = project_dir / ".thoth" / "derived" / "codex-hooks.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def generate_tests(config: dict[str, Any], project_dir: Path) -> None:
    tests_dir = project_dir / "tests"
    tests_dir.mkdir(parents=True, exist_ok=True)
    (tests_dir / "conftest.py").write_text("from pathlib import Path\n\nPROJECT_ROOT = Path(__file__).parent.parent\n", encoding="utf-8")
    (tests_dir / "test_structure.py").write_text(textwrap.dedent("""\
from pathlib import Path


REQUIRED_FILES = [
    "AGENTS.md",
    "CLAUDE.md",
    ".thoth/project/project.json",
    ".thoth/project/instructions.md",
    ".thoth/project/compiler-state.json",
    ".thoth/project/legacy-audit.json",
    ".thoth/derived/codex-hooks.json",
]


def test_required_files_exist():
    root = Path(__file__).parent.parent
    missing = [path for path in REQUIRED_FILES if not (root / path).exists()]
    assert not missing, missing
"""), encoding="utf-8")
