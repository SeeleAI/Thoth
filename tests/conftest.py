"""Shared pytest fixtures and tier helpers for Thoth plugin tests."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

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


def pytest_addoption(parser: pytest.Parser) -> None:
    group = parser.getgroup("thoth")
    group.addoption(
        "--thoth-tier",
        action="store",
        choices=tuple(TEST_TIER_ORDER.keys()),
        help=(
            "Run a bounded Thoth test tier: light (<=20s target), "
            "medium (<=2m target, includes light), or heavy (full suite)."
        ),
    )


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "integration: process-real integration coverage")
    config.addinivalue_line("markers", "light: fast in-process developer smoke tier")
    config.addinivalue_line("markers", "medium: repo-real but bounded developer tier")
    config.addinivalue_line("markers", "heavy: full suite including the slowest process-real coverage")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    selected_tier = config.getoption("--thoth-tier")
    kept: list[pytest.Item] = []
    deselected: list[pytest.Item] = []
    for item in items:
        item_tier = _closest_tier_marker(item) or resolve_test_tier(item.nodeid)
        if _closest_tier_marker(item) is None:
            item.add_marker(getattr(pytest.mark, item_tier))
        if selected_tier and not tier_includes(selected_tier, item_tier):
            deselected.append(item)
        else:
            kept.append(item)
    if selected_tier and deselected:
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
