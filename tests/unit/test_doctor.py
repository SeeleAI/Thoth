"""Tests for doctor.py check functions."""

import os
import sys
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from doctor import (
    REQUIRED_AGENT_OS_FILES,
    check_required_files,
    check_id_integrity,
)


def test_check_required_files_all_present(tmp_path, monkeypatch):
    """When all 9 required files exist, check_required_files should pass."""
    monkeypatch.chdir(tmp_path)

    agent_os = tmp_path / ".agent-os"
    agent_os.mkdir()

    for fname in REQUIRED_AGENT_OS_FILES:
        (agent_os / fname).write_text(f"# {fname}\n", encoding="utf-8")

    passed, detail = check_required_files()
    assert passed, f"Expected PASS when all files present, got: {detail}"
    assert "PASS" in detail, f"Expected 'PASS' in detail, got: {detail}"


def test_check_required_files_missing(tmp_path, monkeypatch):
    """When some files are missing, check_required_files should fail with a list."""
    monkeypatch.chdir(tmp_path)

    agent_os = tmp_path / ".agent-os"
    agent_os.mkdir()

    # Only create half the files
    for fname in REQUIRED_AGENT_OS_FILES[:4]:
        (agent_os / fname).write_text(f"# {fname}\n", encoding="utf-8")

    passed, detail = check_required_files()
    assert not passed, f"Expected FAIL when files are missing, got: {detail}"
    assert "missing" in detail.lower(), f"Expected 'missing' in detail, got: {detail}"

    # Check that at least one missing file is named
    missing_files = REQUIRED_AGENT_OS_FILES[4:]
    for fname in missing_files:
        assert fname in detail, f"Expected '{fname}' to be listed as missing in: {detail}"


def test_check_required_files_no_agent_os(tmp_path, monkeypatch):
    """When .agent-os/ directory doesn't exist, all files should be reported missing."""
    monkeypatch.chdir(tmp_path)

    passed, detail = check_required_files()
    assert not passed, f"Expected FAIL without .agent-os/, got: {detail}"


def test_check_id_integrity_no_duplicates(tmp_path, monkeypatch):
    """When all task IDs are unique, check_id_integrity should pass."""
    monkeypatch.chdir(tmp_path)

    tasks_dir = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1"
    tasks_dir.mkdir(parents=True)

    # Create tasks with unique IDs
    for i in range(3):
        task = {
            "id": f"f1-h{i+1}-test",
            "title": f"Test Task {i+1}",
            "module": "f1",
            "hypothesis": "test hypothesis",
        }
        with open(tasks_dir / f"h{i+1}-test.yaml", "w", encoding="utf-8") as fh:
            yaml.dump(task, fh)

    passed, detail = check_id_integrity()
    assert passed, f"Expected PASS with unique IDs, got: {detail}"
    assert "3 unique" in detail, f"Expected '3 unique' in detail, got: {detail}"


def test_check_id_integrity_duplicates(tmp_path, monkeypatch):
    """When duplicate task IDs exist, check_id_integrity should fail."""
    monkeypatch.chdir(tmp_path)

    tasks_dir = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1"
    tasks_dir.mkdir(parents=True)

    # Create two tasks with the SAME id
    for i in range(2):
        task = {
            "id": "f1-h1-duplicate",  # Same ID!
            "title": f"Duplicate Task {i+1}",
            "module": "f1",
            "hypothesis": "test hypothesis",
        }
        with open(tasks_dir / f"task_{i}.yaml", "w", encoding="utf-8") as fh:
            yaml.dump(task, fh)

    passed, detail = check_id_integrity()
    assert not passed, f"Expected FAIL with duplicate IDs, got: {detail}"
    assert "duplicate" in detail.lower(), f"Expected 'duplicate' in detail, got: {detail}"
    assert "f1-h1-duplicate" in detail, f"Expected duplicate ID name in detail, got: {detail}"


def test_check_id_integrity_no_tasks_dir(tmp_path, monkeypatch):
    """When .agent-os/research-tasks/ doesn't exist, should pass with a note."""
    monkeypatch.chdir(tmp_path)

    passed, detail = check_id_integrity()
    assert passed, f"Expected PASS without tasks dir, got: {detail}"


def test_check_id_integrity_skips_module_files(tmp_path, monkeypatch):
    """_module.yaml files should be skipped during ID integrity check."""
    monkeypatch.chdir(tmp_path)

    tasks_dir = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1"
    tasks_dir.mkdir(parents=True)

    # Create a _module.yaml (should be skipped)
    module = {"id": "f1", "name": "Frontend Module"}
    with open(tasks_dir / "_module.yaml", "w", encoding="utf-8") as fh:
        yaml.dump(module, fh)

    # Create one real task
    task = {"id": "f1-h1-test", "module": "f1", "hypothesis": "test"}
    with open(tasks_dir / "h1-test.yaml", "w", encoding="utf-8") as fh:
        yaml.dump(task, fh)

    passed, detail = check_id_integrity()
    assert passed, f"Expected PASS, got: {detail}"
    # Should only count the task, not the module
    assert "1 unique" in detail, f"Expected '1 unique' in detail, got: {detail}"
