"""Tests for task-first runtime APIs backed by `.thoth/runs`."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient
from thoth.plan.store import upsert_work_item, upsert_decision
from thoth.run.phases import default_validate_output_schema

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
    monkeypatch.setattr(dashboard_app, "DASHBOARD_DIR", tmp_path / "tools" / "dashboard")
    monkeypatch.setattr(dashboard_app, "THOTH_RUNS_DIR", tmp_path / ".thoth" / "runs")
    monkeypatch.setattr(dashboard_app, "DIRECTIONS", ("frontend",))
    monkeypatch.setattr(dashboard_data_loader, "DIRECTIONS", ("frontend",))

    (tmp_path / ".agent-os").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".agent-os" / "milestones.yaml").write_text("milestones: []\n", encoding="utf-8")
    (tmp_path / "tools" / "dashboard" / "frontend" / "dist").mkdir(parents=True, exist_ok=True)
    (tmp_path / "tools" / "dashboard" / "frontend" / "dist" / "index.html").write_text(
        "<!doctype html><html><body><div id='app'>dashboard shell</div></body></html>",
        encoding="utf-8",
    )
    _write_json(
        tmp_path / ".thoth" / "objects" / "project" / "project.json",
        {
            "schema_version": 1,
            "object_id": "project",
            "kind": "project",
            "status": "active",
            "title": "RuntimeDemo",
            "summary": "Runtime dashboard test project",
            "revision": 1,
            "created_at": "2026-04-23T01:00:00Z",
            "updated_at": "2026-04-23T01:00:00Z",
            "source": "test",
            "links": [],
            "payload": {
                "project": {
                    "name": "RuntimeDemo",
                    "directions": [{"id": "frontend", "label_en": "Frontend"}],
                    "phases": [],
                },
                "dashboard": {"port": 8501},
            },
            "history": [],
        },
    )

    upsert_decision(
        tmp_path,
        {
            "schema_version": 1,
            "kind": "decision",
            "decision_id": "DEC-runtime",
            "question": "Which runtime binding should be tested?",
            "candidate_method_ids": ["real-process-lifecycle"],
            "selected_values": {"candidate_method_id": "real-process-lifecycle"},
            "status": "frozen",
            "unresolved_gaps": [],
        },
    )
    upsert_work_item(
        tmp_path,
        {
            "schema_version": 1,
            "kind": "work_item",
            "work_id": "task-1",
            "title": "Long running task",
            "module": "f1",
            "direction": "frontend",
            "status": "ready",
            "work_type": "task",
            "runnable": True,
            "goal": "Test runtime binding",
            "context": "frontend-runtime",
            "constraints": ["dashboard"],
            "execution_plan": ["Run lifecycle integration"],
            "eval_contract": {
                "entrypoint": {"command": "pytest"},
                "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
                "failure_classes": ["runtime_drift"],
                "validate_output_schema": default_validate_output_schema(),
            },
            "runtime_policy": {"loop": {"max_iterations": 10, "max_runtime_seconds": 28800}},
            "decisions": ["DEC-runtime"],
            "missing_questions": [],
        },
    )

    runs_dir = tmp_path / ".thoth" / "runs"
    _write_json(runs_dir / "run-1" / "run.json", {"run_id": "run-1", "work_id": "task-1", "host": "codex", "executor": "claude", "attachable": True, "created_at": "2026-04-23T01:00:00Z"})
    _write_json(runs_dir / "run-1" / "state.json", {"status": "running", "phase": "experiment", "progress_pct": 61, "last_event_seq": 2, "updated_at": "2026-04-23T01:10:00Z", "supervisor_state": "running", "last_heartbeat_at": "2026-04-23T01:11:00Z"})
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


def test_overview_summary_and_gantt_endpoints(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    summary = client.get("/api/overview-summary")
    assert summary.status_code == 200
    summary_payload = summary.json()
    assert summary_payload["headline"]["total_tasks"] == 1
    assert summary_payload["runtime"]["active_run_count"] == 1
    assert summary_payload["recent_conclusions"] == []

    gantt = client.get("/api/gantt")
    assert gantt.status_code == 200
    gantt_payload = gantt.json()
    assert gantt_payload[0]["id"] == "task-1"
    assert gantt_payload[0]["status"] == "ready"
    assert gantt_payload[0]["dependencies"] == []


def test_spa_entry_routes_return_frontend_shell(monkeypatch, tmp_path):
    _setup_project(tmp_path, monkeypatch)
    dashboard_app.invalidate_cache()
    client = TestClient(dashboard_app.app)

    for route in ("/", "/overview", "/tasks", "/timeline", "/system"):
        response = client.get(route)
        assert response.status_code == 200
        assert "dashboard shell" in response.text
