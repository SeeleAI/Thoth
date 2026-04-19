#!/usr/bin/env python3
"""Thoth project initializer.

Generates all project infrastructure files from a JSON config produced
by the /thoth:init interactive questionnaire.

Usage:
    python init.py --config '{"name":"MyProject","directions":"engine,video",...}'
"""

import argparse
import json
import shutil
import sys
import textwrap
from pathlib import Path
from typing import Any, Dict, List

CONFIG_FILE = ".research-config.yaml"
PLUGIN_ROOT = Path(__file__).resolve().parent.parent
TEMPLATES_DIR = PLUGIN_ROOT / "templates"


# ---------------------------------------------------------------------------
# Default values
# ---------------------------------------------------------------------------

DEFAULT_PHASES = [
    {"id": "survey",        "label_zh": "文献综述",  "label_en": "Survey",        "weight": 20},
    {"id": "method_design", "label_zh": "方案设计",  "label_en": "Method Design", "weight": 20},
    {"id": "experiment",    "label_zh": "实验",      "label_en": "Experiment",    "weight": 40},
    {"id": "conclusion",    "label_zh": "结论",      "label_en": "Conclusion",    "weight": 20},
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


# ---------------------------------------------------------------------------
# Config parsing
# ---------------------------------------------------------------------------

def parse_config(config_json: str) -> Dict[str, Any]:
    """Parse and validate the JSON config from the init questionnaire."""
    try:
        config = json.loads(config_json)
    except json.JSONDecodeError as exc:
        print(f"Error: Invalid JSON config: {exc}", file=sys.stderr)
        sys.exit(1)

    # Apply defaults
    project_dir = Path.cwd()
    config.setdefault("name", project_dir.name)
    config.setdefault("description", "")
    config.setdefault("language", "zh")
    config.setdefault("directions", "")
    config.setdefault("phases", None)
    config.setdefault("port", 8501)
    config.setdefault("theme", "warm-bear")

    # Parse directions from comma-separated string or list
    directions = config["directions"]
    if isinstance(directions, str):
        directions = [d.strip() for d in directions.split(",") if d.strip()]
    config["directions"] = directions

    # Parse phases
    if config["phases"] is None:
        config["phases"] = DEFAULT_PHASES
    elif isinstance(config["phases"], str):
        phase_ids = [p.strip() for p in config["phases"].split(",") if p.strip()]
        config["phases"] = [
            {"id": pid, "label_zh": pid, "label_en": pid, "weight": int(100 / max(len(phase_ids), 1))}
            for pid in phase_ids
        ]

    return config


# ---------------------------------------------------------------------------
# File generators
# ---------------------------------------------------------------------------

def generate_research_config(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate .research-config.yaml."""
    lines: List[str] = []
    lines.append('project:')
    lines.append(f'  name: "{config["name"]}"')
    lines.append(f'  description: "{config.get("description", "")}"')
    lines.append(f'  language: "{config["language"]}"')
    lines.append('  version: "0.1.0"')
    lines.append('')
    lines.append('research:')
    lines.append('  directions:')
    for i, d in enumerate(config["directions"]):
        color = DIRECTION_COLORS[i % len(DIRECTION_COLORS)]
        label_en = d.replace('_', ' ').title()
        lines.append(f'    - id: "{d}"')
        lines.append(f'      label_zh: "{d}"')
        lines.append(f'      label_en: "{label_en}"')
        lines.append(f'      color: "{color}"')
    lines.append('')
    lines.append('  phases:')
    for p in config["phases"]:
        lines.append(f'    - id: "{p["id"]}"')
        lines.append(f'      label_zh: "{p.get("label_zh", p["id"])}"')
        lines.append(f'      label_en: "{p.get("label_en", p["id"])}"')
        lines.append(f'      weight: {p.get("weight", 25)}')
    lines.append('')
    lines.append('  deliverable_types:')
    for t in DEFAULT_DELIVERABLE_TYPES:
        lines.append(f'    - "{t}"')
    lines.append('')
    lines.append('dashboard:')
    lines.append(f'  port: {config["port"]}')
    lines.append(f'  theme: "{config["theme"]}"')
    lines.append('')
    lines.append('toolchain:')
    lines.append('  python: "python"')
    lines.append('  pre_commit: true')
    lines.append('  git_hooks: true')
    lines.append('')

    content = '\n'.join(lines)
    (project_dir / CONFIG_FILE).write_text(content, encoding="utf-8")


def generate_milestones(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate .agent-os/milestones.yaml (empty template)."""
    content = textwrap.dedent(f"""\
# Milestones for {config['name']}
# Add milestones as the project progresses.
milestones: []
""")
    (project_dir / ".agent-os" / "milestones.yaml").write_text(content, encoding="utf-8")


def generate_agent_os_docs(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate the 9 required .agent-os/ markdown files."""
    name = config["name"]
    lang = config.get("language", "zh")

    templates = {
        "project-index.md": textwrap.dedent(f"""\
# Project Index

## 1. Current Truth
- Project: {name}
- Status: Initialized
- Active workflows: (none yet)

## 2. Top Next Action
- Set up first research direction and create initial tasks.

## 3. Blockers
- (none)

## 4. Recovery Pointers
- Read CLAUDE.md first, then this file.
"""),
        "requirements.md": textwrap.dedent(f"""\
# Requirements

## 1. User Goals
- (Define project goals here)

## 2. Acceptance Criteria
- (Define acceptance criteria here)

## 3. Non-Goals
- (Define what is explicitly out of scope)

## 4. Hard Constraints
- (Define hard constraints here)
"""),
        "architecture-milestones.md": textwrap.dedent(f"""\
# Architecture & Milestones

## 1. Current Architecture
- (Describe current system architecture)

## 2. Workflows
- (Describe active workflows)

## 3. Milestones
- See `.agent-os/milestones.yaml` for milestone definitions.
"""),
        "todo.md": textwrap.dedent(f"""\
# TODO

## 1. Backlog

(Add items here)

## 2. Ready

## 3. Doing

## 4. Blocked

## 5. Done

## 6. Verified

## 7. Abandoned

<!-- RESEARCH-TASKS-AUTO-START -->

## Research Tasks (auto-generated)

_No research task YAML files found._

<!-- RESEARCH-TASKS-AUTO-END -->
"""),
        "cross-repo-mapping.md": textwrap.dedent(f"""\
# Cross-Repo Mapping

## 1. Mapping Table

| Main ID | Local ID | Repo | Status |
|---------|----------|------|--------|
| (none)  |          |      |        |
"""),
        "acceptance-report.md": textwrap.dedent(f"""\
# Acceptance Report

## 1. Final Conclusions
- (No conclusions yet)

## 2. Evidence
- (No evidence yet)
"""),
        "lessons-learned.md": textwrap.dedent(f"""\
# Lessons Learned

## 1. Failed Explorations
- (None yet)

## 2. Pitfalls
- (None yet)

## 3. Retry Conditions
- (None yet)
"""),
        "run-log.md": textwrap.dedent(f"""\
# Run Log

## 1. Entries

- {{date}} [project initialization]
  - Worked on: Project setup
  - State changes: Project initialized with Thoth
  - Evidence produced: .research-config.yaml, .agent-os/, CLAUDE.md
  - Next likely action: Define first research tasks
""").replace("{date}", _now_str()),
        "change-decisions.md": textwrap.dedent(f"""\
# Change Decisions

## 1. Decisions Log

| ID | Date | Decision | Rationale | Impact |
|----|------|----------|-----------|--------|
| CD-001 | {_now_str()[:10]} | Project initialized | Starting from scratch | All files created |
"""),
    }

    agent_os = project_dir / ".agent-os"
    for fname, content in templates.items():
        (agent_os / fname).write_text(content, encoding="utf-8")


def generate_research_tasks(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate .agent-os/research-tasks/ with schema.json and scripts from plugin templates."""
    tasks_dir = project_dir / ".agent-os" / "research-tasks"
    tasks_dir.mkdir(parents=True, exist_ok=True)

    # Copy schema.json from plugin templates
    src_schema = TEMPLATES_DIR / "agent-os" / "research-tasks" / "schema.json"
    if src_schema.exists():
        shutil.copy2(src_schema, tasks_dir / "schema.json")

    # Generate validate.py, sync_todo.py, check_consistency.py, verify_completion.py,
    # verify_on_complete.py from plugin templates if they exist, otherwise copy from
    # the known reference implementation
    template_scripts = [
        "validate.py", "sync_todo.py", "check_consistency.py",
        "verify_completion.py", "verify_on_complete.py",
    ]
    src_dir = TEMPLATES_DIR / "agent-os" / "research-tasks"
    for script_name in template_scripts:
        src = src_dir / script_name
        if src.exists():
            shutil.copy2(src, tasks_dir / script_name)

    # Generate paper-module-mapping.yaml
    mapping_content = textwrap.dedent("""\
# Paper-Module Mapping
papers: []
""")
    (tasks_dir / "paper-module-mapping.yaml").write_text(mapping_content, encoding="utf-8")

    # Create direction subdirectories
    for d in config.get("directions", []):
        (tasks_dir / d).mkdir(exist_ok=True)


def generate_dashboard(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate tools/dashboard/ structure (copy from plugin templates)."""
    dest = project_dir / "tools" / "dashboard"
    src = TEMPLATES_DIR / "dashboard"

    if src.exists():
        # Copy entire dashboard template
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(src, dest, dirs_exist_ok=True)
    else:
        # Create minimal structure
        (dest / "backend").mkdir(parents=True, exist_ok=True)
        (dest / "frontend" / "src").mkdir(parents=True, exist_ok=True)


def generate_pre_commit_config(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate .pre-commit-config.yaml."""
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

      - id: research-tasks-consistency
        name: Check module/dependency consistency
        entry: python .agent-os/research-tasks/check_consistency.py
        language: python
        files: '\\.agent-os/research-tasks/.*\\.ya?ml$'
        additional_dependencies: ['pyyaml']
        pass_filenames: false

      - id: sync-todo-freshness
        name: Check todo.md sync freshness
        entry: python .agent-os/research-tasks/sync_todo.py --check-only
        language: python
        files: '\\.agent-os/research-tasks/.*\\.ya?ml$'
        additional_dependencies: ['pyyaml']
        pass_filenames: false

      - id: required-agent-os-files
        name: Check required .agent-os files exist
        entry: bash scripts/check-required-files.sh
        language: system
        always_run: true
        pass_filenames: false

      - id: verify-on-complete
        name: Auto-verify tasks with completed phases
        entry: python .agent-os/research-tasks/verify_on_complete.py
        language: python
        files: '\\.agent-os/research-tasks/.*\\.ya?ml$'
        additional_dependencies: ['pyyaml']
        pass_filenames: true
""")
    (project_dir / ".pre-commit-config.yaml").write_text(content, encoding="utf-8")


def generate_scripts(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate scripts/ directory (install-hooks.sh, session-end-check.sh, etc.)."""
    scripts_dir = project_dir / "scripts"
    scripts_dir.mkdir(exist_ok=True)
    name = config["name"]

    # install-hooks.sh
    install_hooks = textwrap.dedent(f"""\
#!/usr/bin/env bash
set -e

echo "=== Installing {name} Git Hooks ==="

# Check pre-commit is available
if ! command -v pre-commit &> /dev/null; then
    echo "Installing pre-commit..."
    pip install pre-commit
fi

# Install hooks
pre-commit install

echo ""
echo "Running hooks on all files for initial validation..."
pre-commit run --all-files || true

echo ""
echo "=== Git hooks installed successfully ==="
echo "Hooks will run automatically on every 'git commit'."
echo "To run manually: pre-commit run --all-files"
""")
    install_path = scripts_dir / "install-hooks.sh"
    install_path.write_text(install_hooks, encoding="utf-8")
    install_path.chmod(0o755)

    # check-required-files.sh
    check_required = textwrap.dedent("""\
#!/usr/bin/env bash
# Check that all required .agent-os files exist.
# Used as a pre-commit hook.
set -e

REQUIRED_FILES=(
    project-index.md
    requirements.md
    architecture-milestones.md
    todo.md
    cross-repo-mapping.md
    acceptance-report.md
    lessons-learned.md
    run-log.md
    change-decisions.md
)

exit_code=0
for f in "${REQUIRED_FILES[@]}"; do
    if [ ! -f ".agent-os/$f" ]; then
        echo "MISSING: .agent-os/$f"
        exit_code=1
    fi
done

if [ $exit_code -eq 0 ]; then
    echo "All required .agent-os files present."
fi

exit $exit_code
""")
    check_path = scripts_dir / "check-required-files.sh"
    check_path.write_text(check_required, encoding="utf-8")
    check_path.chmod(0o755)

    # session-end-check.sh
    session_end = textwrap.dedent(f"""\
#!/usr/bin/env bash
# Session end self-check for {name}.
# Runs all validation checks before ending a session.
set -e

echo "=== Session End Check ==="

# 1. Schema validation
echo "Checking schema..."
python .agent-os/research-tasks/validate.py || exit 1

# 2. Consistency check
echo "Checking consistency..."
python .agent-os/research-tasks/check_consistency.py || exit 1

# 3. Todo sync
echo "Checking todo sync..."
python .agent-os/research-tasks/sync_todo.py --check-only || {{
    echo "Warning: todo.md is stale. Running sync..."
    python .agent-os/research-tasks/sync_todo.py
}}

# 4. Required files
echo "Checking required files..."
bash scripts/check-required-files.sh || exit 1

echo ""
echo "=== All session end checks passed ==="
""")
    session_path = scripts_dir / "session-end-check.sh"
    session_path.write_text(session_end, encoding="utf-8")
    session_path.chmod(0o755)

    # validate-all.sh
    validate_all = textwrap.dedent("""\
#!/usr/bin/env bash
# Run all validation checks.
set -e

echo "=== Full Validation ==="

python .agent-os/research-tasks/validate.py
python .agent-os/research-tasks/check_consistency.py
python .agent-os/research-tasks/sync_todo.py --check-only
bash scripts/check-required-files.sh

echo ""
echo "=== All checks passed ==="
""")
    validate_path = scripts_dir / "validate-all.sh"
    validate_path.write_text(validate_all, encoding="utf-8")
    validate_path.chmod(0o755)


def generate_claude_md(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate CLAUDE.md with project-specific instructions."""
    name = config["name"]
    lang = config.get("language", "zh")

    if lang == "zh":
        content = textwrap.dedent(f"""\
# AGENTS.md

本文件是 `{name}` 的项目操作合同。

## 1. 使命

- 保留用户定义的最终目标、要求与验收边界，不允许代理私自改写其含义。
- 仅靠文件恢复上下文，而不是依赖聊天记录。
- 保持真实状态、证据、失败探索和单一最高优先级下一步动作可见。

## 2. 恢复顺序

1. 先读本文件。
2. 再读 [`.agent-os/project-index.md`](.agent-os/project-index.md)。
3. 再读 [`.agent-os/requirements.md`](.agent-os/requirements.md)、
   [`.agent-os/architecture-milestones.md`](.agent-os/architecture-milestones.md)、
   [`.agent-os/todo.md`](.agent-os/todo.md)。
4. 如果当前 top next action 涉及跨仓映射，继续读
   [`.agent-os/cross-repo-mapping.md`](.agent-os/cross-repo-mapping.md)。
5. 最近会话历史最后再看 [`.agent-os/run-log.md`](.agent-os/run-log.md)。

## 3. 文档角色

`.agent-os/` 必须至少包含：

- `project-index.md`: 当前真相、活跃工作流、唯一 top next action、阻塞与恢复指针
- `requirements.md`: 用户目标、要求、验收标准、非目标、硬约束
- `change-decisions.md`: 后续用户拍板造成的解释变化
- `architecture-milestones.md`: 当前架构、工作流、里程碑与里程碑验收
- `todo.md`: backlog / ready / doing / blocked / done / verified / abandoned
- `acceptance-report.md`: 最终或中间验收结论与证据
- `lessons-learned.md`: 失败探索、陷阱、放弃原因与重试条件
- `run-log.md`: 轻量时间序列运行记录
- `cross-repo-mapping.md`: 跨仓编号映射表

## 4. 真相与证据规则

1. 无证据不得声称完成、通过、收敛或满足目标。
2. `done` 不是 `verified`；关闭项前必须同步更新证据和文档状态。
3. 失败探索必须进 `lessons-learned.md`，不能静默丢弃。

## 5. 升级到人工的条件

仅在以下情况升级给用户：

- 仍有必须由用户拍板的目标、边界或资源决策
- 硬外部阻塞导致无法推进
- 多条探索路径连续失败，项目已明显停滞

## 6. 更新纪律

1. 不允许长期漂移；"先改代码后补文档"最多只允许在同一连续工作会话内暂存。
2. 每次会话结束前至少更新 `run-log.md`，并让 `project-index.md` 保持可恢复。

## 7. 语言与风格

1. 项目状态文档主语言为中文。
2. 代码注释、脚本 `print` 输出和命令行消息保持英文。

## 8. 研究任务自检纪律

1. 所有研究任务状态存储在 `.agent-os/research-tasks/` 的结构化 YAML 文件中，
   每个任务一个文件，必须通过 `schema.json` 的 JSON Schema 验证。
2. 每个任务必须有硬数字完成标准（定义在每个阶段的 `criteria.threshold`）。
3. **标记任务阶段为 completed 前**，必须先运行验证脚本：
   ```
   python .agent-os/research-tasks/verify_completion.py <task_id>
   ```
   只有脚本输出 `PASS` 才可写入 `completed` 状态。**禁止绕过验证。**
4. 每个阶段的产物必须使用 **structured deliverables**（数组格式）。
5. 标记任务最终 `verdict` 时，`evidence_paths` 必须指向真实存在的产物文件。
6. 失败的假设必须在 YAML 中填写 `failure_analysis`，不可静默丢弃。
   同时同步到 `.agent-os/lessons-learned.md`。
7. 任何任务状态变更必须同时更新 YAML 文件、`.agent-os/run-log.md`、
   运行 `python .agent-os/research-tasks/sync_todo.py`。
8. 每次会话结束前，必须运行会话结束检查：
   ```
   bash scripts/session-end-check.sh
   ```
9. **量化要求**：标记任何阶段为 completed 时，`criteria.current` 必须填入
   真实实验测量值，不允许填写估算或占位数字。
""")
    else:
        content = textwrap.dedent(f"""\
# AGENTS.md

This file is the operational contract for `{name}`.

## 1. Mission

- Preserve user-defined goals, requirements, and acceptance boundaries. Agents must not
  unilaterally reinterpret their meaning.
- Enable context recovery from files alone, without depending on chat history.
- Keep truth-state, evidence, failed explorations, and the single top next action visible.

## 2. Recovery Order

1. Read this file first.
2. Read [`.agent-os/project-index.md`](.agent-os/project-index.md).
3. Read [`.agent-os/requirements.md`](.agent-os/requirements.md),
   [`.agent-os/architecture-milestones.md`](.agent-os/architecture-milestones.md),
   [`.agent-os/todo.md`](.agent-os/todo.md).
4. If the current top next action involves cross-repo mapping, read
   [`.agent-os/cross-repo-mapping.md`](.agent-os/cross-repo-mapping.md).
5. Review recent session history last via [`.agent-os/run-log.md`](.agent-os/run-log.md).

## 3. Document Roles

`.agent-os/` must contain at minimum:

- `project-index.md`: Current truth, active workflows, single top next action, blockers
- `requirements.md`: User goals, acceptance criteria, non-goals, hard constraints
- `change-decisions.md`: Interpretation changes from user decisions
- `architecture-milestones.md`: Architecture, workflows, milestone definitions
- `todo.md`: backlog / ready / doing / blocked / done / verified / abandoned
- `acceptance-report.md`: Final or intermediate acceptance conclusions and evidence
- `lessons-learned.md`: Failed explorations, pitfalls, abandonment reasons
- `run-log.md`: Lightweight time-series run log
- `cross-repo-mapping.md`: Cross-repo ID mapping table

## 4. Truth & Evidence Rules

1. No claiming completion, pass, convergence, or goal satisfaction without evidence.
2. `done` is not `verified`; update evidence and doc state before closing items.
3. Failed explorations go into `lessons-learned.md`. Never silently discard them.

## 5. Escalation Conditions

Escalate to user only when:

- Goal, boundary, or resource decisions require user sign-off
- Hard external blockers prevent progress
- Multiple exploration paths have consecutively failed and the project is clearly stalled

## 6. Update Discipline

1. No long-term drift. "Code first, docs later" is allowed only within the same session.
2. Update `run-log.md` before ending every session. Keep `project-index.md` recoverable.

## 7. Research Task Discipline

1. All research task state lives in structured YAML files under `.agent-os/research-tasks/`.
2. Every task must have hard numeric completion criteria in each phase's `criteria.threshold`.
3. Before marking a phase as `completed`, run:
   ```
   python .agent-os/research-tasks/verify_completion.py <task_id>
   ```
   Only proceed if the script outputs `PASS`. Never bypass verification.
4. Use structured deliverables (array format) for every phase.
5. When setting a task verdict, `evidence_paths` must point to real files on disk.
6. Failed hypotheses must have `failure_analysis` filled in the YAML.
   Also sync to `.agent-os/lessons-learned.md`.
7. Every task state change must also update the YAML, `.agent-os/run-log.md`,
   and run `python .agent-os/research-tasks/sync_todo.py`.
8. Before ending each session, run:
   ```
   bash scripts/session-end-check.sh
   ```
9. When marking any phase as completed, `criteria.current` must contain actual
   measured values, not estimates or placeholders.
""")

    (project_dir / "CLAUDE.md").write_text(content, encoding="utf-8")


def generate_tests(config: Dict[str, Any], project_dir: Path) -> None:
    """Generate tests/ directory with basic project-level tests."""
    tests_dir = project_dir / "tests"
    tests_dir.mkdir(exist_ok=True)
    name = config["name"]

    conftest = textwrap.dedent(f"""\
\"\"\"Shared pytest fixtures for {name} tests.\"\"\"
import os
from pathlib import Path

import pytest


PROJECT_ROOT = Path(__file__).parent.parent


@pytest.fixture
def project_root():
    \"\"\"Path to project root.\"\"\"
    return PROJECT_ROOT


@pytest.fixture
def agent_os_dir(project_root):
    \"\"\"Path to .agent-os directory.\"\"\"
    return project_root / ".agent-os"


@pytest.fixture
def research_tasks_dir(agent_os_dir):
    \"\"\"Path to research-tasks directory.\"\"\"
    return agent_os_dir / "research-tasks"
""")
    (tests_dir / "conftest.py").write_text(conftest, encoding="utf-8")

    test_structure = textwrap.dedent(f"""\
\"\"\"Test project structure integrity for {name}.\"\"\"
from pathlib import Path


REQUIRED_FILES = [
    "CLAUDE.md",
    ".research-config.yaml",
    ".agent-os/project-index.md",
    ".agent-os/requirements.md",
    ".agent-os/architecture-milestones.md",
    ".agent-os/todo.md",
    ".agent-os/cross-repo-mapping.md",
    ".agent-os/acceptance-report.md",
    ".agent-os/lessons-learned.md",
    ".agent-os/run-log.md",
    ".agent-os/change-decisions.md",
    ".agent-os/milestones.yaml",
    ".agent-os/research-tasks/schema.json",
]


def test_required_files_exist(project_root):
    \"\"\"All required project files must exist.\"\"\"
    missing = []
    for f in REQUIRED_FILES:
        if not (project_root / f).exists():
            missing.append(f)
    assert not missing, f"Missing files: {{missing}}"


def test_research_config_valid(project_root):
    \"\"\"research-config.yaml must parse and contain required keys.\"\"\"
    import yaml
    config_path = project_root / ".research-config.yaml"
    assert config_path.exists()
    with open(config_path) as fh:
        config = yaml.safe_load(fh)
    assert config is not None
    assert "project" in config
    assert "name" in config["project"]
    assert "research" in config
    assert "directions" in config["research"]
    assert "dashboard" in config


def test_schema_json_valid(research_tasks_dir):
    \"\"\"schema.json must be valid JSON.\"\"\"
    import json
    schema_path = research_tasks_dir / "schema.json"
    if not schema_path.exists():
        return  # skip if no schema
    with open(schema_path) as fh:
        schema = json.load(fh)
    assert "definitions" in schema
""")
    (tests_dir / "test_structure.py").write_text(test_structure, encoding="utf-8")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_str() -> str:
    """Return current UTC datetime string."""
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(description="Thoth project initializer")
    parser.add_argument("--config", required=True,
                        help="Project config as JSON string")
    args = parser.parse_args()

    project_dir = Path.cwd()

    # Preconditions
    if (project_dir / CONFIG_FILE).exists():
        print("Project already initialized. Use /thoth:doctor to check health.")
        return 1

    config = parse_config(args.config)

    # Create directory structure
    (project_dir / ".agent-os" / "research-tasks").mkdir(parents=True, exist_ok=True)
    (project_dir / "tools" / "dashboard" / "backend").mkdir(parents=True, exist_ok=True)
    (project_dir / "tools" / "dashboard" / "frontend").mkdir(parents=True, exist_ok=True)
    (project_dir / "scripts").mkdir(exist_ok=True)
    (project_dir / "reports").mkdir(exist_ok=True)
    (project_dir / "tests").mkdir(exist_ok=True)

    # Generate all files
    print(f"Initializing Thoth project: {config['name']}")
    print()

    print("  Generating .research-config.yaml...")
    generate_research_config(config, project_dir)

    print("  Generating .agent-os/milestones.yaml...")
    generate_milestones(config, project_dir)

    print("  Generating .agent-os/ documents (9 files)...")
    generate_agent_os_docs(config, project_dir)

    print("  Generating .agent-os/research-tasks/ (schema + scripts)...")
    generate_research_tasks(config, project_dir)

    print("  Generating tools/dashboard/...")
    generate_dashboard(config, project_dir)

    print("  Generating .pre-commit-config.yaml...")
    generate_pre_commit_config(config, project_dir)

    print("  Generating scripts/...")
    generate_scripts(config, project_dir)

    print("  Generating CLAUDE.md...")
    generate_claude_md(config, project_dir)

    print("  Generating tests/...")
    generate_tests(config, project_dir)

    # Create direction subdirectories
    for d in config.get("directions", []):
        ddir = project_dir / ".agent-os" / "research-tasks" / d
        ddir.mkdir(exist_ok=True)

    # Summary
    print()
    num_directions = len(config.get("directions", []))
    port = config.get("port", 8501)
    print(f"  Thoth initialized: {config['name']}")
    print(f"  - {num_directions} research direction(s) configured")
    print(f"  - Dashboard port: {port}")
    print(f"  - Language: {config.get('language', 'zh')}")
    print(f"  - Run /thoth:dashboard to start the dashboard")
    print(f"  - Run /thoth:status for current state")

    return 0


if __name__ == "__main__":
    sys.exit(main())
