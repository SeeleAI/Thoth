"""Shared pytest fixtures for Thoth plugin tests."""
import os
import tempfile
import shutil
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures" / "golden"
THOTH_ROOT = Path(__file__).parent.parent


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
    """Create a temporary project directory with minimal Thoth structure."""
    project = tmp_path / "test-project"
    project.mkdir()

    agent_os = project / ".agent-os"
    agent_os.mkdir()
    (agent_os / "research-tasks").mkdir()

    (project / "tools" / "dashboard" / "backend").mkdir(parents=True)
    (project / "tools" / "dashboard" / "frontend" / "dist").mkdir(parents=True)
    (project / "scripts").mkdir()
    (project / "reports").mkdir()

    return project


@pytest.fixture
def tmp_project_with_config(tmp_project, golden_config_valid):
    """Temporary project with a valid .research-config.yaml."""
    import yaml

    with open(golden_config_valid) as f:
        config = yaml.safe_load(f)

    config_path = tmp_project / ".research-config.yaml"
    with open(config_path, "w") as f:
        yaml.dump(config, f)

    return tmp_project
