"""Tests for schema validation (validate.py)."""

import json
import sys
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

try:
    from jsonschema import Draft7Validator, ValidationError
except ImportError:
    pytest.skip("jsonschema not installed", allow_module_level=True)


SCHEMA_PATH = Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks" / "schema.json"


@pytest.fixture
def schema():
    """Load the JSON schema."""
    with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
        return json.load(fh)


@pytest.fixture
def task_schema(schema):
    """Build a sub-schema for validating task YAML."""
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$ref": "#/definitions/task",
        "definitions": schema.get("definitions", {}),
    }


@pytest.fixture
def module_schema(schema):
    """Build a sub-schema for validating module YAML."""
    return {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$ref": "#/definitions/module",
        "definitions": schema.get("definitions", {}),
    }


def test_valid_task_passes_schema(golden_task_valid, task_schema):
    """A well-formed task YAML should pass schema validation."""
    with open(golden_task_valid, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    validator = Draft7Validator(task_schema)
    errors = list(validator.iter_errors(data))
    assert errors == [], f"Expected valid task to pass, got {len(errors)} error(s): {[e.message for e in errors]}"


def test_completed_task_passes_schema(golden_task_completed, task_schema):
    """A completed task YAML should pass schema validation."""
    with open(golden_task_completed, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    validator = Draft7Validator(task_schema)
    errors = list(validator.iter_errors(data))
    assert errors == [], f"Expected completed task to pass, got {len(errors)} error(s): {[e.message for e in errors]}"


def test_invalid_task_fails_schema(golden_task_invalid, schema):
    """A task YAML with schema violations should fail validation.

    The invalid_schema.yaml has multiple issues:
    - missing 'id' field
    - 'type' field is an integer instead of string
    - phases is a list instead of object
    """
    with open(golden_task_invalid, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    # Validate against both task and module definitions to confirm it fails both
    task_sub = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$ref": "#/definitions/task",
        "definitions": schema.get("definitions", {}),
    }
    module_sub = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$ref": "#/definitions/module",
        "definitions": schema.get("definitions", {}),
    }

    task_errors = list(Draft7Validator(task_sub).iter_errors(data))
    module_errors = list(Draft7Validator(module_sub).iter_errors(data))
    assert len(task_errors) > 0, "Expected invalid task to fail task schema, but it passed"
    assert len(module_errors) > 0, "Expected invalid task to fail module schema, but it passed"


def test_valid_module_passes_schema(golden_module_valid, module_schema):
    """A well-formed module YAML should pass schema validation."""
    with open(golden_module_valid, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    validator = Draft7Validator(module_schema)
    errors = list(validator.iter_errors(data))
    assert errors == [], f"Expected valid module to pass, got {len(errors)} error(s): {[e.message for e in errors]}"


def test_valid_config_has_required_fields(golden_config_valid):
    """The golden valid config should have all required structural fields."""
    with open(golden_config_valid, "r", encoding="utf-8") as fh:
        config = yaml.safe_load(fh)

    assert "project" in config, "Config missing 'project' key"
    assert "name" in config["project"], "Config missing 'project.name'"
    assert "research" in config, "Config missing 'research' key"
    assert "directions" in config["research"], "Config missing 'research.directions'"
    assert "phases" in config["research"], "Config missing 'research.phases'"
    assert len(config["research"]["directions"]) > 0, "Config must have at least one direction"
    assert len(config["research"]["phases"]) > 0, "Config must have at least one phase"

    # Check direction structure
    d = config["research"]["directions"][0]
    assert "id" in d, "Direction missing 'id'"
    assert "label_en" in d, "Direction missing 'label_en'"

    # Check phase structure
    p = config["research"]["phases"][0]
    assert "id" in p, "Phase missing 'id'"
    assert "weight" in p, "Phase missing 'weight'"


def test_blocked_task_passes_schema(golden_task_blocked, task_schema):
    """A task with hard dependencies should still pass schema validation."""
    with open(golden_task_blocked, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    validator = Draft7Validator(task_schema)
    errors = list(validator.iter_errors(data))
    assert errors == [], f"Expected blocked task to pass, got {len(errors)} error(s): {[e.message for e in errors]}"


def test_schema_itself_is_valid(schema):
    """The schema.json should be a valid Draft-07 schema."""
    # This should not raise
    Draft7Validator.check_schema(schema)
