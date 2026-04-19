"""Tests for consistency checking (check_consistency.py)."""

import sys
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from check_consistency import (
    check_bidirectional,
    check_cycles,
    check_dependency_refs,
    check_module_refs,
)


def test_valid_module_passes(golden_module_valid):
    """A valid module with consistent bidirectional links should produce no issues."""
    with open(golden_module_valid, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    # Build a modules dict with this single module
    modules = {data["id"]: data}

    # Since there is only one module (f1), and it lists "b1" as downstream
    # but b1 is not loaded, the bidirectional check won't flag anything
    # because the check only verifies existing modules.
    issues = check_bidirectional(modules)
    assert issues == [], f"Expected no issues for single valid module, got: {issues}"


def test_cycle_detection(golden_module_cycle):
    """Modules with circular dependencies should be detected."""
    # The cycle_deps.yaml contains two YAML documents separated by ---
    with open(golden_module_cycle, "r", encoding="utf-8") as fh:
        docs = list(yaml.safe_load_all(fh))

    # Filter out None documents (from leading comments before first ---)
    docs = [d for d in docs if d is not None]
    assert len(docs) == 2, f"Expected 2 module documents, got {len(docs)}"

    # Build tasks that represent the cycle: task_a depends on task_b, task_b depends on task_a
    tasks = {
        "task_a": {
            "id": "task_a",
            "module": docs[0]["id"],
            "depends_on": [{"task_id": "task_b", "type": "hard", "reason": "test"}],
        },
        "task_b": {
            "id": "task_b",
            "module": docs[1]["id"],
            "depends_on": [{"task_id": "task_a", "type": "hard", "reason": "test"}],
        },
    }
    cycles = check_cycles(tasks)
    assert len(cycles) > 0, "Expected cycle detection to find at least one cycle"

    # Verify the cycle contains both nodes
    cycle_nodes = set()
    for cycle in cycles:
        cycle_nodes.update(cycle)
    assert "task_a" in cycle_nodes, "Expected task_a in cycle"
    assert "task_b" in cycle_nodes, "Expected task_b in cycle"


def test_bidirectional_consistency_detects_mismatch():
    """If module A lists B as downstream but B doesn't list A as upstream, flag it."""
    modules = {
        "mod_a": {
            "id": "mod_a",
            "related_modules": {
                "upstream": [],
                "downstream": ["mod_b"],
            },
        },
        "mod_b": {
            "id": "mod_b",
            "related_modules": {
                "upstream": [],  # Should contain mod_a, but doesn't
                "downstream": [],
            },
        },
    }
    issues = check_bidirectional(modules)
    assert len(issues) > 0, "Expected bidirectional mismatch to be detected"
    assert any("mod_a" in issue and "mod_b" in issue for issue in issues), (
        f"Expected issue to mention both mod_a and mod_b, got: {issues}"
    )


def test_missing_dependency_reference():
    """A task depending on a non-existent task should be reported."""
    tasks = {
        "real_task": {
            "id": "real_task",
            "depends_on": [
                {"task_id": "phantom_task", "type": "hard", "reason": "test"},
            ],
        },
    }
    issues = check_dependency_refs(tasks)
    assert len(issues) > 0, "Expected missing dependency reference to be reported"
    assert any("phantom_task" in i for i in issues), (
        f"Expected issue to mention phantom_task, got: {issues}"
    )


def test_missing_module_reference():
    """A task referencing a non-existent module should be reported."""
    tasks = {
        "some_task": {
            "id": "some_task",
            "module": "nonexistent_module",
        },
    }
    modules = {
        "real_module": {
            "id": "real_module",
            "related_modules": {"upstream": [], "downstream": []},
        },
    }
    issues = check_module_refs(tasks, modules)
    assert len(issues) > 0, "Expected missing module reference to be reported"
    assert any("nonexistent_module" in i for i in issues), (
        f"Expected issue to mention nonexistent_module, got: {issues}"
    )


def test_no_cycles_in_linear_chain():
    """A linear dependency chain (A -> B -> C) should have no cycles."""
    tasks = {
        "task_a": {
            "id": "task_a",
            "depends_on": [],
        },
        "task_b": {
            "id": "task_b",
            "depends_on": [{"task_id": "task_a", "type": "hard", "reason": "test"}],
        },
        "task_c": {
            "id": "task_c",
            "depends_on": [{"task_id": "task_b", "type": "hard", "reason": "test"}],
        },
    }
    cycles = check_cycles(tasks)
    assert cycles == [], f"Expected no cycles in linear chain, got: {cycles}"


def test_self_referencing_dependency_detected():
    """A task depending on itself should be detected as a cycle."""
    tasks = {
        "self_ref": {
            "id": "self_ref",
            "depends_on": [{"task_id": "self_ref", "type": "hard", "reason": "self"}],
        },
    }
    cycles = check_cycles(tasks)
    assert len(cycles) > 0, "Expected self-referencing dependency to be detected as cycle"
