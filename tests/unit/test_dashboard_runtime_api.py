"""Tests for task-first runtime APIs backed by `.thoth/runs`."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml
from fastapi.testclient import TestClient

ROOT = Path(__file__).parent.parent.parent
sys.path.insert(0, str(ROOT / "templates" / "dashboard" / "backend"))

import app as dashboard_app
import data_loader as dashboard_data_loader


def _write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8")


def _setup_project(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("THOTH_RUNS_DIR", str(tmp_path / ".thoth" / "runs"))
    monkeypatch.setenv("THOTH_HEARTBEAT_STALE_MINUTES", "100000")
    monkeypatch.setattr(dashboard_app, "PROJECT_ROOT", tmp_path)
    monkeypatch.setattr(dashboard_app, "RESEARCH_TASKS_DIR", tmp_path / ".agent-os" / "research-tasks")
    monkeypatch.setattr(dashboard_app, "THOTH_RUNS_DIR", tmp_path / ".thoth" / "runs")
    monkeypatch.setattr(dashboard_app, "DIRECTIONS", ("frontend",))
    monkeypatch.setattr(dashboard_data_loader, "DIRECTIONS", ("frontend",))

    (tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".agent-os" / "milestones.yaml").write_text("milestones: []\n", encoding="utf-8")
    (tmp_path / ".research-config.yaml").write_text(
        yaml.safe_dump(
            {
                "project": {"name": "RuntimeDemo"},
                "research": {"directions": [{"id": "frontend", "label_en": "Frontend"}]},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    task = {
        "id": "task-1",
        "title": "Long running task",
        "module": "f1",
        "direction": "frontend",
        "type": "hypothesis",
        "hypothesis": "Test runtime binding",
        "null_hypothesis": "None",
        "phases": {
            "survey": {"status": "completed"},
            "method_design": {"status": "in_progress"},
            "experiment": {"status": "pending"},
            "conclusion": {"status": "pending"},
        },
        "depends_on": [],
        "results": {"verdict": None, "evidence_paths": [], "metrics": {}},
    }
    (tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1" / "task-1.yaml").write_text(
        yaml.safe_dump(task, sort_keys=False),
        encoding="utf-8",
    )

    runs_dir = tmp_path / ".thoth" / "runs"
    _write_json(runs_dir / "run-1" / "run.json", {"run_id": "run-1", "task_id": "task-1", "host": "codex", "executor": "claude", "attachable": True, "created_at": "2026-04-23T01:00:00Z"})
    _write_json(runs_dir / "run-1" / "state.json", {"status": "running", "phase": "experiment", "progress_pct": 61, "last_event_seq": 2, "updated_at": "2026-04-23T01:10:00Z", "supervisor_state": "running"})
    _write_json(runs_dir / "run-1" / "heartbeat.json", {"last_heartbeat_at": "2026-04-23T01:11:00Z"})
    _write_jsonl(runs_dir / "run-1" / "events.jsonl", [
        {"seq": 1, "ts": "2026-04-23T01:01:00Z", "kind": "log", "message": "started"},
        {"seq": 2, "ts": "2026-04-23T01:10:00Z", "kind": "log", "message": "still running"},
    ])


def test_task_endpoint_includes_active_run(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    response = client.get("/api/tasks")
    assert response.status_code == 200
    body = response.json()
    assert body["tasks"][0]["active_run"]["run_id"] == "run-1"
    assert body["tasks"][0]["run_count"] == 1
    assert body["tasks"][0]["active_run"]["host"] == "codex"
    assert body["tasks"][0]["active_run"]["attachable"] is True


def test_runtime_progress_and_event_endpoints(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    progress = client.get("/api/progress")
    assert progress.status_code == 200
    assert progress.json()["runtime"]["active_run_count"] == 1
    assert progress.json()["runtime"]["host_breakdown"] == ["codex"]

    active = client.get("/api/tasks/task-1/active-run")
    assert active.status_code == 200
    assert active.json()["status"] == "running"
    assert active.json()["supervisor_state"] == "running"

    history = client.get("/api/tasks/task-1/runs")
    assert history.status_code == 200
    assert history.json()["runs"][0]["run_id"] == "run-1"

    events = client.get("/api/runs/run-1/events?after_seq=1&limit=10")
    assert events.status_code == 200
    payload = events.json()
    assert payload["events"][0]["seq"] == 2
    assert payload["next_after_seq"] == 2
