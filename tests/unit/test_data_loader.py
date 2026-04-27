"""Tests for strict dashboard data loader."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "templates" / "dashboard" / "backend"))

from data_loader import (
    _read_directions_from_config,
    _safe_load_yaml,
    invalidate_cache,
    load_all_tasks,
    load_modules,
    load_project_config,
)


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def test_safe_load_yaml_handles_valid_and_invalid(tmp_path):
    good = tmp_path / "good.yaml"
    good.write_text("id: ok\n", encoding="utf-8")
    bad = tmp_path / "bad.yaml"
    bad.write_text("{{not yaml", encoding="utf-8")
    assert _safe_load_yaml(good)["id"] == "ok"
    assert _safe_load_yaml(bad) is None


def test_directions_from_manifest(tmp_path):
    _write_json(
        tmp_path / ".thoth" / "project" / "project.json",
        {
            "project": {
                "name": "Loader Demo",
                "directions": [
                    {"id": "frontend", "label_en": "Frontend"},
                    {"id": "backend", "label_en": "Backend"},
                ],
            }
        },
    )
    directions = _read_directions_from_config(tmp_path)
    assert directions == ("frontend", "backend")


def test_load_all_tasks_attaches_task_results(tmp_path):
    invalidate_cache()
    _write_json(
        tmp_path / ".thoth" / "project" / "project.json",
        {"project": {"name": "Loader Demo", "directions": [{"id": "frontend"}]}},
    )
    _write_json(
        tmp_path / ".thoth" / "project" / "tasks" / "task-1.json",
        {
            "task_id": "task-1",
            "title": "Strict task",
            "direction": "frontend",
            "module": "f1",
            "goal_statement": "Verify loader",
            "ready_state": "imported_resolved",
        },
    )
    _write_json(
        tmp_path / ".thoth" / "project" / "tasks" / "task-1.result.json",
        {
            "task_id": "task-1",
            "source": "legacy_import",
            "usable": True,
            "meets_goal": True,
            "evidence_paths": ["reports/demo.md"],
            "metrics": {},
            "updated_at": "2026-04-24T00:00:00Z",
        },
    )
    tasks = load_all_tasks(tmp_path)
    assert tasks[0]["id"] == "task-1"
    assert tasks[0]["task_result"]["source"] == "legacy_import"


def test_load_modules_from_tasks(tmp_path):
    invalidate_cache()
    _write_json(
        tmp_path / ".thoth" / "project" / "tasks" / "task-1.json",
        {
            "task_id": "task-1",
            "title": "Strict task",
            "direction": "frontend",
            "module": "f1",
            "goal_statement": "Verify loader",
            "ready_state": "ready",
        },
    )
    modules = load_modules(tmp_path)
    assert modules[0]["id"] == "f1"
    assert modules[0]["direction"] == "frontend"


def test_load_project_config_uses_manifest(tmp_path):
    invalidate_cache()
    _write_json(
        tmp_path / ".thoth" / "project" / "project.json",
        {
            "project": {
                "name": "Loader Demo",
                "description": "strict",
                "language": "zh",
                "directions": [{"id": "frontend", "label_en": "Frontend"}],
                "phases": [{"id": "survey", "weight": 20}],
            },
            "dashboard": {"port": 8600, "theme": "warm-bear"},
        },
    )
    config = load_project_config(tmp_path)
    assert config["project"]["name"] == "Loader Demo"
    assert config["research"]["directions"][0]["id"] == "frontend"
    assert config["dashboard"]["port"] == 8600
