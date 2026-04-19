"""Shared fixtures for project-level tests."""
import sys
from pathlib import Path

import pytest

PROJECT_ROOT = Path(__file__).parent.parent
RESEARCH_TASKS_DIR = PROJECT_ROOT / ".agent-os" / "research-tasks"

sys.path.insert(0, str(RESEARCH_TASKS_DIR))


@pytest.fixture
def project_root():
    return PROJECT_ROOT


@pytest.fixture
def research_tasks_dir():
    return RESEARCH_TASKS_DIR
