"""Shared pytest fixtures and targeted-selection helpers for Thoth tests."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Sequence

import pytest

from thoth.test_targets import known_target_ids, selectors_for_targets

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "golden"
THOTH_ROOT = Path(__file__).parent.parent
TEST_TIER_ORDER = {"light": 0, "medium": 1, "heavy": 2}
TEST_TIER_PATH_OVERRIDES = {
    "tests/unit/test_init.py": "medium",
    "tests/unit/test_init_permission_guidance.py": "medium",
    "tests/integration/test_dashboard_api.py": "medium",
    "tests/unit/test_claude_bridge.py": "heavy",
    "tests/unit/test_cli_surface.py": "heavy",
    "tests/integration/test_init_workflow.py": "heavy",
    "tests/integration/test_runtime_lifecycle_e2e.py": "heavy",
}


def resolve_test_tier(nodeid: str) -> str:
    """Return the canonical execution tier for a collected test node."""
    path = nodeid.split("::", 1)[0].replace("\\", "/")
    if path in TEST_TIER_PATH_OVERRIDES:
        return TEST_TIER_PATH_OVERRIDES[path]
    if path.startswith("tests/integration/"):
        return "heavy"
    return "light"


def tier_includes(selected_tier: str, item_tier: str) -> bool:
    """Whether a selected tier should include a specific item tier."""
    return TEST_TIER_ORDER[item_tier] <= TEST_TIER_ORDER[selected_tier]


def _closest_tier_marker(item: pytest.Item) -> str | None:
    for tier in TEST_TIER_ORDER:
        if item.get_closest_marker(tier):
            return tier
    return None


def allow_broad_tests(*, cli_flag: bool, env: dict[str, str] | None = None) -> bool:
    variables = env or os.environ
    value = str(variables.get("THOTH_ALLOW_BROAD_TESTS", "")).strip().lower()
    return bool(cli_flag) or value in {"1", "true", "yes", "on"}


def classify_explicit_pytest_targets(invocation_args: Sequence[str], *, repo_root: Path) -> dict[str, list[str]]:
    explicit: list[str] = []
    directories: list[str] = []
    unknown: list[str] = []
    for raw_arg in invocation_args:
        arg = str(raw_arg).strip()
        if not arg or arg.startswith("-"):
            continue
        path_part = arg.split("::", 1)[0]
        candidate = Path(path_part)
        if not candidate.is_absolute():
            candidate = repo_root / candidate
        if "::" in arg or candidate.is_file() or path_part.endswith(".py"):
            explicit.append(arg)
            continue
        if candidate.is_dir():
            directories.append(arg)
            continue
        unknown.append(arg)
    return {
        "explicit": explicit,
        "directories": directories,
        "unknown": unknown,
    }


def validate_pytest_invocation(
    invocation_args: Sequence[str],
    *,
    repo_root: Path,
    selected_targets: Sequence[str],
    selected_tier: str | None,
    broad_allowed: bool,
) -> str | None:
    if broad_allowed:
        return None
    if selected_targets:
        return None
    if selected_tier:
        return (
            "Broad tier runs are disabled by default. Use explicit file/nodeid targets, "
            "`--thoth-target <target_id>`, or opt in with `--thoth-allow-broad` / "
            "`THOTH_ALLOW_BROAD_TESTS=1`."
        )
    classification = classify_explicit_pytest_targets(invocation_args, repo_root=repo_root)
    if classification["explicit"]:
        return None
    if classification["directories"]:
        return (
            "Directory-wide pytest runs are disabled by default. Use an explicit file/nodeid, "
            "`--thoth-target <target_id>`, or opt in with `--thoth-allow-broad` / "
            "`THOTH_ALLOW_BROAD_TESTS=1`."
        )
    if classification["unknown"]:
        return (
            "Pytest invocation must name explicit test files/nodeids or `--thoth-target <target_id>` "
            "unless broad runs are explicitly allowed."
        )
    return (
        "Bare pytest runs are disabled by default. Use an explicit file/nodeid, "
        "`--thoth-target <target_id>`, or opt in with `--thoth-allow-broad` / "
        "`THOTH_ALLOW_BROAD_TESTS=1`."
    )


def item_matches_target_selectors(nodeid: str, selectors: Sequence[str]) -> bool:
    normalized = nodeid.replace("\\", "/")
    path = normalized.split("::", 1)[0]
    for selector in selectors:
        normalized_selector = selector.replace("\\", "/")
        if "::" in normalized_selector:
            if normalized == normalized_selector or normalized.startswith(f"{normalized_selector}::"):
                return True
            continue
        if path == normalized_selector or normalized.startswith(f"{normalized_selector}::"):
            return True
    return False


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("thoth")
    group.addoption(
        "--thoth-target",
        action="append",
        default=[],
        metavar="TARGET_ID",
        help=(
            "Run one named Thoth test target. "
            f"Known targets: {', '.join(known_target_ids())}."
        ),
    )
    group.addoption(
        "--thoth-allow-broad",
        action="store_true",
        help="Explicitly allow directory-wide or bare pytest runs for release/CI situations.",
    )
    group.addoption(
        "--thoth-tier",
        action="store",
        choices=tuple(TEST_TIER_ORDER.keys()),
        help=(
            "Run a bounded Thoth tier only when broad runs are explicitly allowed. "
            "This flag is reserved for CI/release-style sweeps, not normal development."
        ),
    )


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "integration: process-real integration coverage")
    config.addinivalue_line("markers", "light: fast in-process developer smoke tier")
    config.addinivalue_line("markers", "medium: repo-real but bounded developer tier")
    config.addinivalue_line("markers", "heavy: full suite including the slowest process-real coverage")
    selected_targets = list(config.getoption("--thoth-target") or [])
    try:
        selectors_for_targets(selected_targets)
    except ValueError as exc:
        raise pytest.UsageError(str(exc)) from exc
    broad_allowed = allow_broad_tests(
        cli_flag=bool(config.getoption("--thoth-allow-broad")),
    )
    failure = validate_pytest_invocation(
        config.invocation_params.args,
        repo_root=THOTH_ROOT,
        selected_targets=selected_targets,
        selected_tier=config.getoption("--thoth-tier"),
        broad_allowed=broad_allowed,
    )
    if failure:
        raise pytest.UsageError(failure)


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    selected_targets = list(config.getoption("--thoth-target") or [])
    selected_selectors = selectors_for_targets(selected_targets) if selected_targets else ()
    selected_tier = config.getoption("--thoth-tier")
    kept: list[pytest.Item] = []
    deselected: list[pytest.Item] = []
    for item in items:
        item_tier = _closest_tier_marker(item) or resolve_test_tier(item.nodeid)
        if _closest_tier_marker(item) is None:
            item.add_marker(getattr(pytest.mark, item_tier))
        target_ok = True
        if selected_selectors:
            target_ok = item_matches_target_selectors(item.nodeid, selected_selectors)
        tier_ok = True
        if selected_tier:
            tier_ok = tier_includes(selected_tier, item_tier)
        if target_ok and tier_ok:
            kept.append(item)
        else:
            deselected.append(item)
    if (selected_tier or selected_selectors) and deselected:
        config.hook.pytest_deselected(items=deselected)
        items[:] = kept


@pytest.fixture
def golden_dir():
    """Path to golden test fixtures."""
    return FIXTURES_DIR


@pytest.fixture
def golden_config_valid():
    """Load valid project config."""
    return FIXTURES_DIR / "config" / "valid_config.yaml"


@pytest.fixture
def golden_config_minimal():
    """Load minimal project config."""
    return FIXTURES_DIR / "config" / "minimal_config.yaml"


@pytest.fixture
def golden_config_invalid():
    """Load invalid project config."""
    return FIXTURES_DIR / "config" / "invalid_config.yaml"


@pytest.fixture
def golden_task_valid():
    """Load valid task YAML."""
    return FIXTURES_DIR / "tasks" / "valid_task.yaml"


@pytest.fixture
def golden_task_completed():
    """Load completed task YAML."""
    return FIXTURES_DIR / "tasks" / "completed_task.yaml"


@pytest.fixture
def golden_task_blocked():
    """Load blocked task YAML."""
    return FIXTURES_DIR / "tasks" / "blocked_task.yaml"


@pytest.fixture
def golden_task_null_criteria():
    """Load task with null criteria.current."""
    return FIXTURES_DIR / "tasks" / "null_criteria.yaml"


@pytest.fixture
def golden_task_invalid():
    """Load invalid task YAML (schema violation)."""
    return FIXTURES_DIR / "tasks" / "invalid_schema.yaml"


@pytest.fixture
def golden_module_valid():
    """Load valid module YAML."""
    return FIXTURES_DIR / "modules" / "valid_module.yaml"


@pytest.fixture
def golden_module_cycle():
    """Load module with circular dependencies."""
    return FIXTURES_DIR / "modules" / "cycle_deps.yaml"


@pytest.fixture
def golden_milestones_valid():
    """Load valid milestones YAML."""
    return FIXTURES_DIR / "milestones" / "valid.yaml"


@pytest.fixture
def golden_milestones_broken():
    """Load milestones with broken task references."""
    return FIXTURES_DIR / "milestones" / "broken_refs.yaml"


@pytest.fixture
def tmp_project(tmp_path):
    """Create a temporary project directory with minimal strict Thoth structure."""
    project = tmp_path / "test-project"
    project.mkdir()

    agent_os = project / ".agent-os"
    agent_os.mkdir()
    (project / ".thoth" / "project").mkdir(parents=True)
    (project / ".thoth" / "runs").mkdir(parents=True)
    (project / ".thoth" / "migrations").mkdir(parents=True)
    (project / ".thoth" / "derived").mkdir(parents=True)

    (project / "tools" / "dashboard" / "backend").mkdir(parents=True)
    (project / "tools" / "dashboard" / "frontend" / "dist").mkdir(parents=True)
    (project / "scripts").mkdir()
    (project / "reports").mkdir()

    return project


@pytest.fixture
def tmp_project_with_config(tmp_project, golden_config_valid):
    """Temporary project seeded through canonical `.thoth` manifest files."""
    import yaml

    with open(golden_config_valid) as f:
        config = yaml.safe_load(f)

    manifest = {
        "schema_version": 2,
        "project": config.get("project", {}),
        "dashboard": config.get("dashboard", {}),
        "runtime": {"authority": ".thoth"},
    }
    (tmp_project / ".thoth" / "project" / "project.json").write_text(json.dumps(manifest), encoding="utf-8")

    return tmp_project
