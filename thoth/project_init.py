"""Project initialization and canonical projection rendering for Thoth."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import textwrap
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

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

OPTIONAL_AGENT_OS_FILES = [
    "milestones.yaml",
]

GENERATED_RESEARCH_TASK_FILES = [
    "validate.py",
    "sync_todo.py",
    "check_consistency.py",
    "verify_completion.py",
    "verify_on_complete.py",
    "schema.json",
    "paper-module-mapping.yaml",
]

GENERATED_SCRIPT_FILES = [
    "install-hooks.sh",
    "check-required-files.sh",
    "session-end-check.sh",
    "validate-all.sh",
    "thoth-codex-hook.sh",
]

GENERATED_TEST_FILES = [
    "tests/conftest.py",
    "tests/test_structure.py",
]

DISCOVERY_CODE_SUFFIXES = {
    ".py",
    ".js",
    ".ts",
    ".tsx",
    ".vue",
    ".sh",
    ".rs",
    ".go",
    ".java",
    ".c",
    ".cc",
    ".cpp",
    ".h",
    ".hpp",
}


def _now_str() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _read_readme_summary(project_dir: Path) -> tuple[str, str]:
    for candidate in ("README.md", "readme.md"):
        path = project_dir / candidate
        if not path.exists():
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        title = ""
        summary = ""
        for raw in lines:
            line = raw.strip()
            if not title and line.startswith("#"):
                title = line.lstrip("#").strip()
                continue
            if not summary and line and not line.startswith("#"):
                summary = line
                break
        return title, summary
    return "", ""


def _detect_language(project_dir: Path, existing_config: dict[str, Any]) -> str:
    language = existing_config.get("project", {}).get("language")
    if isinstance(language, str) and language.strip():
        return language.strip()

    sample_paths = [
        project_dir / "AGENTS.md",
        project_dir / "CLAUDE.md",
        project_dir / "README.md",
        project_dir / ".agent-os" / "project-index.md",
    ]
    for path in sample_paths:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if re.search(r"[\u4e00-\u9fff]", text):
            return "zh"
    return "en"


def _discover_directions(project_dir: Path, existing_config: dict[str, Any]) -> list[Any]:
    configured = existing_config.get("research", {}).get("directions")
    if isinstance(configured, list) and configured:
        return configured

    task_root = project_dir / ".agent-os" / "research-tasks"
    discovered: list[str] = []
    if task_root.is_dir():
        for entry in sorted(task_root.iterdir()):
            if not entry.is_dir():
                continue
            if entry.name.startswith(".") or entry.name.startswith("_"):
                continue
            discovered.append(entry.name)
    return discovered


def _managed_path_list() -> list[str]:
    base = [
        CONFIG_FILE,
        ".pre-commit-config.yaml",
        "AGENTS.md",
        "CLAUDE.md",
        ".codex/config.json",
        ".codex/setup.sh",
        ".codex/hooks.json",
        ".thoth/project/project.json",
        ".thoth/project/instructions.md",
        ".thoth/project/source-map.json",
        ".thoth/runs/.gitkeep",
        ".thoth/migrations/.gitkeep",
        ".thoth/derived/.gitkeep",
    ]
    base.extend(f"scripts/{name}" for name in GENERATED_SCRIPT_FILES)
    base.extend(f".agent-os/{name}" for name in REQUIRED_AGENT_OS_FILES)
    base.extend(f".agent-os/{name}" for name in OPTIONAL_AGENT_OS_FILES)
    base.extend(f".agent-os/research-tasks/{name}" for name in GENERATED_RESEARCH_TASK_FILES)
    base.extend(GENERATED_TEST_FILES)
    return base


def _detect_init_mode(audit: dict[str, Any]) -> str:
    existing = audit.get("existing", {})
    if existing.get("thoth_authority"):
        return "resume"
    if existing.get("research_config"):
        return "adopt"
    if existing.get("agent_os") or existing.get("legacy_agentos_alias"):
        return "adopt"
    if existing.get("docs") or existing.get("dashboard") or existing.get("codex_project_layer"):
        return "adopt"
    if audit.get("top_level_entries"):
        return "adopt"
    return "init"


def _git_status_summary(project_dir: Path) -> dict[str, Any]:
    git_dir = project_dir / ".git"
    if not git_dir.exists():
        return {"present": False}

    branch = ""
    porcelain_lines: list[str] = []
    try:
        branch = subprocess.run(
            ["git", "branch", "--show-current"],
            cwd=str(project_dir),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        ).stdout.strip()
        porcelain = subprocess.run(
            ["git", "status", "--short", "--branch"],
            cwd=str(project_dir),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        ).stdout
        porcelain_lines = [line.rstrip() for line in porcelain.splitlines()]
    except Exception:
        return {"present": True, "branch": "", "dirty": None, "entries": []}

    dirty_entries = [line for line in porcelain_lines if not line.startswith("##")]
    return {
        "present": True,
        "branch": branch,
        "dirty": bool(dirty_entries),
        "entries": dirty_entries,
    }


def audit_repository_state(project_dir: Path) -> dict[str, Any]:
    project_dir = project_dir.resolve()
    existing_config = _read_yaml(project_dir / CONFIG_FILE)
    readme_title, readme_summary = _read_readme_summary(project_dir)

    docs_files: list[str] = []
    docs_dir = project_dir / "docs"
    if docs_dir.is_dir():
        docs_files = sorted(str(path.relative_to(project_dir)) for path in docs_dir.rglob("*") if path.is_file())

    agent_os_files: list[str] = []
    agent_os_dir = project_dir / ".agent-os"
    if agent_os_dir.is_dir():
        agent_os_files = sorted(str(path.relative_to(project_dir)) for path in agent_os_dir.rglob("*") if path.is_file())

    legacy_agentos_files: list[str] = []
    legacy_agentos_dir = project_dir / ".agentos"
    if legacy_agentos_dir.is_dir():
        legacy_agentos_files = sorted(
            str(path.relative_to(project_dir)) for path in legacy_agentos_dir.rglob("*") if path.is_file()
        )

    root_markdown_files = sorted(
        entry.name
        for entry in project_dir.iterdir()
        if entry.is_file() and entry.suffix.lower() == ".md" and entry.name not in {"AGENTS.md", "CLAUDE.md"}
    )

    code_roots: set[str] = set()
    for path in project_dir.rglob("*"):
        if not path.is_file():
            continue
        if ".git" in path.parts or ".thoth" in path.parts:
            continue
        if path.suffix in DISCOVERY_CODE_SUFFIXES:
            rel = path.relative_to(project_dir)
            root = rel.parts[0] if len(rel.parts) > 1 else "."
            code_roots.add(root)

    managed_paths = _managed_path_list()
    managed_existing = sorted(rel for rel in managed_paths if (project_dir / rel).exists())

    top_level_entries = sorted(
        entry.name for entry in project_dir.iterdir() if entry.name not in {".git", "__pycache__"}
    )

    return {
        "schema_version": 1,
        "audited_at": _utc_iso(),
        "project_root": str(project_dir),
        "git": _git_status_summary(project_dir),
        "existing": {
            "research_config": (project_dir / CONFIG_FILE).exists(),
            "thoth_authority": (project_dir / ".thoth").exists(),
            "agent_os": agent_os_dir.exists(),
            "legacy_agentos_alias": legacy_agentos_dir.exists(),
            "docs": docs_dir.exists(),
            "codex_project_layer": (project_dir / ".codex").exists(),
            "dashboard": (project_dir / "tools" / "dashboard").exists(),
        },
        "top_level_entries": top_level_entries,
        "root_markdown_files": root_markdown_files,
        "docs_files": docs_files,
        "agent_os_files": agent_os_files,
        "legacy_agentos_files": legacy_agentos_files,
        "managed_existing": managed_existing,
        "code_roots": sorted(code_roots),
        "readme": {
            "title": readme_title,
            "summary": readme_summary,
        },
        "inferred": {
            "language": _detect_language(project_dir, existing_config),
            "directions": _discover_directions(project_dir, existing_config),
        },
    }


def _normalize_config(requested: dict[str, Any], project_dir: Path, audit: dict[str, Any]) -> dict[str, Any]:
    existing_config = _read_yaml(project_dir / CONFIG_FILE)
    project_config = existing_config.get("project", {})
    dashboard_config = existing_config.get("dashboard", {})
    research_config = existing_config.get("research", {})

    config = dict(requested)
    config.setdefault("name", project_config.get("name") or audit.get("readme", {}).get("title") or project_dir.name)
    config.setdefault("description", project_config.get("description") or audit.get("readme", {}).get("summary") or "")
    config.setdefault("language", project_config.get("language") or audit.get("inferred", {}).get("language") or "zh")
    config.setdefault("directions", research_config.get("directions") or audit.get("inferred", {}).get("directions") or [])
    config.setdefault("phases", research_config.get("phases") or DEFAULT_PHASES)
    config.setdefault("port", dashboard_config.get("port", 8501))
    config.setdefault("theme", dashboard_config.get("theme", "warm-bear"))

    directions = config["directions"]
    if isinstance(directions, str):
        directions = [d.strip() for d in directions.split(",") if d.strip()]
    config["directions"] = directions
    return config


def build_init_preview(project_dir: Path, audit: dict[str, Any]) -> dict[str, Any]:
    project_dir = project_dir.resolve()
    preview = {
        "schema_version": 1,
        "generated_at": _utc_iso(),
        "mode": _detect_init_mode(audit),
        "create": [],
        "update": [],
        "preserve": [],
    }

    managed_update_targets = {
        CONFIG_FILE,
        ".pre-commit-config.yaml",
        "AGENTS.md",
        "CLAUDE.md",
        ".codex/config.json",
        ".codex/setup.sh",
        ".codex/hooks.json",
        "tools/dashboard",
    }
    managed_update_targets.update(f"scripts/{name}" for name in GENERATED_SCRIPT_FILES)
    managed_update_targets.update(f".agent-os/research-tasks/{name}" for name in GENERATED_RESEARCH_TASK_FILES)
    managed_update_targets.update(GENERATED_TEST_FILES)

    managed_create_if_missing = {
        ".thoth/project/project.json",
        ".thoth/project/instructions.md",
        ".thoth/project/source-map.json",
        ".thoth/runs/.gitkeep",
        ".thoth/migrations/.gitkeep",
        ".thoth/derived/.gitkeep",
    }
    managed_create_if_missing.update(f".agent-os/{name}" for name in REQUIRED_AGENT_OS_FILES)
    managed_create_if_missing.update(f".agent-os/{name}" for name in OPTIONAL_AGENT_OS_FILES)

    for rel in sorted(managed_update_targets | managed_create_if_missing):
        path = project_dir / rel
        if rel in managed_update_targets:
            (preview["update"] if path.exists() else preview["create"]).append(rel)
            continue
        if path.exists():
            preview["preserve"].append(rel)
        else:
            preview["create"].append(rel)

    preserve_paths = set(preview["preserve"])
    preserve_paths.update(audit.get("docs_files", []))
    preserve_paths.update(audit.get("agent_os_files", []))
    preserve_paths.update(audit.get("legacy_agentos_files", []))
    preserve_paths.update(audit.get("root_markdown_files", []))
    preview["preserve"] = sorted(preserve_paths)
    return preview


def _backup_existing_path(project_dir: Path, migration_dir: Path, relpath: str) -> None:
    source = project_dir / relpath
    if not source.exists():
        return
    target = migration_dir / "backup" / relpath
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_dir():
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target, dirs_exist_ok=True)
    else:
        shutil.copy2(source, target)


def _write_source_map(project_dir: Path, audit: dict[str, Any], preview: dict[str, Any]) -> None:
    payload = {
        "schema_version": 1,
        "generated_at": _utc_iso(),
        "mode": preview.get("mode", _detect_init_mode(audit)),
        "authority": {
            "project_manifest": ".thoth/project/project.json",
            "instructions": ".thoth/project/instructions.md",
        },
        "projections": {
            "claude": "CLAUDE.md",
            "codex": "AGENTS.md",
            "codex_project_layer": ".codex/",
        },
        "managed_paths": sorted(set(preview["create"] + preview["update"] + preview["preserve"])),
        "preserved_docs": audit.get("docs_files", []),
        "preserved_root_markdown": audit.get("root_markdown_files", []),
        "preserved_agent_os_files": audit.get("agent_os_files", []),
        "legacy_agentos_files": audit.get("legacy_agentos_files", []),
        "code_roots": audit.get("code_roots", []),
    }
    path = project_dir / ".thoth" / "project" / "source-map.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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
    path = project_dir / ".agent-os" / "milestones.yaml"
    if path.exists():
        return
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
        path = agent_os / filename
        if path.exists():
            continue
        path.write_text(content, encoding="utf-8")


def generate_research_tasks(config: dict[str, Any], project_dir: Path) -> None:
    tasks_dir = project_dir / ".agent-os" / "research-tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)
    for script_name in ("validate.py", "sync_todo.py", "check_consistency.py", "verify_completion.py", "verify_on_complete.py", "schema.json"):
        src = TEMPLATES_DIR / "agent-os" / "research-tasks" / script_name
        if src.exists():
            shutil.copy2(src, tasks_dir / script_name)
    mapping_path = tasks_dir / "paper-module-mapping.yaml"
    if not mapping_path.exists():
        mapping_path.write_text("# Paper-Module Mapping\npapers: []\n", encoding="utf-8")
    for direction in config.get("directions", []):
        d_id = direction["id"] if isinstance(direction, dict) else direction
        (tasks_dir / d_id).mkdir(exist_ok=True)


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


def generate_codex_project_layer(config: dict[str, Any], project_dir: Path) -> None:
    codex_dir = project_dir / ".codex"
    codex_dir.mkdir(parents=True, exist_ok=True)
    (codex_dir / "config.json").write_text(json.dumps({
        "schema_version": 1,
        "project_layer": "enabled",
        "thoth_authority": ".thoth",
        "official_surface": "$thoth",
    }, indent=2) + "\n", encoding="utf-8")
    setup_path = codex_dir / "setup.sh"
    setup_path.write_text("#!/usr/bin/env bash\nset -e\npython --version\n", encoding="utf-8")
    setup_path.chmod(0o755)
    (codex_dir / "hooks.json").write_text(json.dumps({
        "hooks": {
            "SessionStart": [
                {
                    "matcher": "startup|resume",
                    "hooks": [
                        {
                            "type": "command",
                            "command": "bash \"$(git rev-parse --show-toplevel)/scripts/thoth-codex-hook.sh\" start",
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
                            "command": "bash \"$(git rev-parse --show-toplevel)/scripts/thoth-codex-hook.sh\" stop",
                            "statusMessage": "Recording Thoth runtime summary",
                        }
                    ],
                }
            ],
        }
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


def initialize_project(config: dict[str, Any], project_dir: Path) -> dict[str, Any]:
    project_dir = project_dir.resolve()
    audit = audit_repository_state(project_dir)
    normalized = _normalize_config(config or {}, project_dir, audit)
    preview = build_init_preview(project_dir, audit)
    migration_id = f"mig-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    preview["migration_id"] = migration_id

    migrations_root = project_dir / ".thoth" / "migrations"
    migrations_root.mkdir(parents=True, exist_ok=True)
    migration_dir = migrations_root / migration_id
    migration_dir.mkdir(parents=True, exist_ok=True)

    (migration_dir / "audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (migration_dir / "preview.json").write_text(
        json.dumps(preview, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    backups: list[dict[str, Any]] = []
    for relpath in preview["update"]:
        source = project_dir / relpath
        if not source.exists():
            continue
        _backup_existing_path(project_dir, migration_dir, relpath)
        backups.append(
            {
                "relative_path": relpath,
                "backup_path": str((Path("backup") / relpath).as_posix()),
            }
        )

    (project_dir / ".agent-os" / "research-tasks").mkdir(parents=True, exist_ok=True)
    (project_dir / "reports").mkdir(exist_ok=True)
    generate_research_config(normalized, project_dir)
    generate_milestones(normalized, project_dir)
    generate_agent_os_docs(normalized, project_dir)
    generate_research_tasks(normalized, project_dir)
    generate_thoth_runtime(normalized, project_dir)
    generate_dashboard(normalized, project_dir)
    generate_pre_commit_config(normalized, project_dir)
    generate_scripts(normalized, project_dir)
    generate_host_projections(normalized, project_dir)
    generate_codex_project_layer(normalized, project_dir)
    generate_tests(normalized, project_dir)
    _write_source_map(project_dir, audit, preview)

    rollback_payload = {
        "schema_version": 1,
        "migration_id": migration_id,
        "created_at": preview["generated_at"],
        "mode": preview["mode"],
        "created_paths": preview["create"],
        "backup_targets": backups,
    }
    (migration_dir / "rollback.json").write_text(
        json.dumps(rollback_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    apply_payload = {
        "schema_version": 1,
        "migration_id": migration_id,
        "applied_at": _utc_iso(),
        "mode": preview["mode"],
        "status": "applied",
        "created_count": len(preview["create"]),
        "updated_count": len(preview["update"]),
        "preserved_count": len(preview["preserve"]),
    }
    (migration_dir / "apply.json").write_text(
        json.dumps(apply_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "migration_id": migration_id,
        "mode": preview["mode"],
        "config": normalized,
        "audit": audit,
        "preview": preview,
        "apply": apply_payload,
    }


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
    audit = audit_repository_state(project_dir)
    preview = build_init_preview(project_dir, audit)
    _write_source_map(project_dir, audit, preview)
