"""Shared pytest fixtures for Thoth plugin tests."""
import json
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
