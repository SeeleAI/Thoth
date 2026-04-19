"""Tests for YAML data loader (data_loader.py)."""

import sys
import time
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from data_loader import (
    _safe_load_yaml,
    invalidate_cache,
    _read_directions_from_config,
)


def test_load_valid_yaml(golden_task_valid):
    """Loading a valid YAML file should return a dict."""
    invalidate_cache()
    result = _safe_load_yaml(golden_task_valid)
    assert result is not None, "Expected a dict from valid YAML, got None"
    assert isinstance(result, dict), f"Expected dict, got {type(result).__name__}"
    assert "id" in result, "Expected 'id' key in loaded task"
    assert result["id"] == "f1-h1-auth-flow", (
        f"Expected id='f1-h1-auth-flow', got '{result['id']}'"
    )


def test_load_missing_file(tmp_path):
    """Loading a non-existent file should return None."""
    invalidate_cache()
    missing = tmp_path / "nonexistent.yaml"
    result = _safe_load_yaml(missing)
    assert result is None, f"Expected None for missing file, got {result}"


def test_load_invalid_yaml(tmp_path):
    """Loading malformed YAML should return None."""
    invalidate_cache()
    bad_file = tmp_path / "bad.yaml"
    bad_file.write_text("{{{{not: valid: yaml: [}", encoding="utf-8")
    result = _safe_load_yaml(bad_file)
    assert result is None, f"Expected None for malformed YAML, got {result}"


def test_load_non_dict_yaml(tmp_path):
    """Loading a YAML file that parses to a non-dict (e.g., a list) should return None."""
    invalidate_cache()
    list_file = tmp_path / "list.yaml"
    list_file.write_text("- item1\n- item2\n- item3\n", encoding="utf-8")
    result = _safe_load_yaml(list_file)
    assert result is None, f"Expected None for list YAML, got {result}"


def test_cache_invalidation(tmp_path):
    """After invalidate_cache(), the next load should re-read the file."""
    invalidate_cache()

    # Create a YAML file and load it
    yaml_file = tmp_path / "cached.yaml"
    yaml_file.write_text("id: first_version\nname: Original\n", encoding="utf-8")
    result1 = _safe_load_yaml(yaml_file)
    assert result1 is not None, "Expected initial load to succeed"
    assert result1["id"] == "first_version"

    # Modify the file -- need to change mtime
    time.sleep(0.05)
    yaml_file.write_text("id: second_version\nname: Updated\n", encoding="utf-8")

    # Without invalidation, mtime-based cache in _safe_load_yaml should detect the change
    # But let's explicitly invalidate to be sure
    invalidate_cache()
    result2 = _safe_load_yaml(yaml_file)
    assert result2 is not None, "Expected post-invalidation load to succeed"
    assert result2["id"] == "second_version", (
        f"Expected id='second_version' after invalidation, got '{result2['id']}'"
    )


def test_directions_from_config(tmp_path):
    """With a valid config, directions should be read correctly."""
    config_content = {
        "research": {
            "directions": [
                {"id": "frontend", "label_en": "Frontend"},
                {"id": "backend", "label_en": "Backend"},
            ],
        },
    }
    config_path = tmp_path / ".research-config.yaml"
    with open(config_path, "w", encoding="utf-8") as fh:
        yaml.dump(config_content, fh)

    directions = _read_directions_from_config(tmp_path)
    assert directions == ("frontend", "backend"), (
        f"Expected ('frontend', 'backend'), got {directions}"
    )


def test_directions_fallback_to_scan(tmp_path):
    """Without a config file, directions should fall back to scanning subdirectories."""
    # Create the directory structure that _read_directions_from_config scans
    research_dir = tmp_path / ".agent-os" / "research-tasks"
    (research_dir / "alpha").mkdir(parents=True)
    (research_dir / "beta").mkdir(parents=True)

    directions = _read_directions_from_config(tmp_path)
    assert directions == ("alpha", "beta"), (
        f"Expected ('alpha', 'beta') from directory scan, got {directions}"
    )


def test_directions_empty_when_nothing(tmp_path):
    """With no config and no directories, directions should be empty."""
    directions = _read_directions_from_config(tmp_path)
    assert directions == (), f"Expected empty tuple, got {directions}"


def test_load_valid_module(golden_module_valid):
    """Loading a valid module YAML should return expected structure."""
    invalidate_cache()
    result = _safe_load_yaml(golden_module_valid)
    assert result is not None, "Expected dict from valid module YAML"
    assert result["id"] == "f1"
    assert result["name"] == "Authentication Module"
    assert "related_modules" in result
