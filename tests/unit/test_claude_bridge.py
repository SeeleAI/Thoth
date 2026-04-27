"""Tests for the Claude command bridge."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

from thoth.plan.compiler import compile_task_authority
from thoth.run.phases import default_validate_output_schema


ROOT = Path(__file__).parent.parent.parent


def _bridge_entry() -> Path:
    candidates = [
        ROOT / "thoth" / "surface" / "bridges" / "claude.py",
        ROOT / "thoth" / "claude_bridge.py",
    ]
    for path in candidates:
        if path.exists():
            return path
    raise AssertionError(f"No Claude bridge entry found under {ROOT}")


def _run_bridge(tmp_path: Path, command_id: str, *args: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = str(ROOT) if not existing else f"{ROOT}:{existing}"
    env["THOTH_CLAUDE_PLUGIN_ROOT"] = str(ROOT)
    return subprocess.run(
        [sys.executable, str(_bridge_entry()), command_id, *args],
        cwd=str(tmp_path),
        text=True,
        capture_output=True,
        env=env,
    )


def _write_task(project_dir: Path, task_id: str, *, title: str, goal_statement: str) -> None:
    decisions = project_dir / ".thoth" / "project" / "decisions"
    contracts = project_dir / ".thoth" / "project" / "contracts"
    decisions.mkdir(parents=True, exist_ok=True)
    contracts.mkdir(parents=True, exist_ok=True)
    decision_id = f"DEC-{task_id}"
    contract_id = f"CTR-{task_id}"
    (decisions / f"{decision_id}.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "kind": "decision",
                "decision_id": decision_id,
                "scope_id": f"scope-{task_id}",
                "question": "Which strict task should be executed?",
                "candidate_method_ids": ["repo-change"],
                "selected_values": {"candidate_method_id": "repo-change"},
                "status": "frozen",
                "unresolved_gaps": [],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    (contracts / f"{contract_id}.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "kind": "contract",
                "contract_id": contract_id,
                "task_id": task_id,
                "scope_id": f"scope-{task_id}",
                "direction": "frontend",
                "module": "f1",
                "title": title,
                "decision_ids": [decision_id],
                "candidate_method_id": "repo-change",
                "goal_statement": goal_statement,
                "implementation_recipe": ["Make the requested repo change."],
                "eval_entrypoint": {"command": "pytest -q"},
                "primary_metric": {"name": "checks", "direction": "gte", "threshold": 1},
                "failure_classes": ["runtime_drift"],
                "validate_output_schema": default_validate_output_schema(),
                "status": "frozen",
                "blocking_gaps": [],
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    compile_task_authority(project_dir)


def test_bridge_executes_repo_local_init_and_records_event(tmp_path):
    result = _run_bridge(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "init"
    assert payload["bridge_success"] is True
    assert payload["checks"]["project_manifest_exists"] is True
    event_log = tmp_path / ".thoth" / "derived" / "host-bridges" / "claude-command-events.jsonl"
    assert event_log.exists()
    event = json.loads(event_log.read_text(encoding="utf-8").splitlines()[-1])
    assert event["command_id"] == "init"
    assert event["bridge_success"] is True


def test_bridge_records_status_after_init(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True
    status_result = _run_bridge(tmp_path, "status")
    assert status_result.returncode == 0, status_result.stderr
    status_payload = json.loads(status_result.stdout)
    assert status_payload["command_id"] == "status"
    assert status_payload["bridge_success"] is True
    events = [
        json.loads(line)
        for line in (tmp_path / ".thoth" / "derived" / "host-bridges" / "claude-command-events.jsonl").read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    assert [event["command_id"] for event in events][-2:] == ["init", "status"]


def test_bridge_uses_plugin_cli_even_if_project_has_shadow_thoth_package(tmp_path):
    shadow_pkg = tmp_path / "thoth"
    shadow_pkg.mkdir()
    (shadow_pkg / "__init__.py").write_text("", encoding="utf-8")
    (shadow_pkg / "cli.py").write_text(
        "raise SystemExit('shadow-cli-should-not-run')\n",
        encoding="utf-8",
    )

    result = _run_bridge(tmp_path, "init")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["bridge_success"] is True
    assert "shadow-cli-should-not-run" not in payload["stderr"]


def test_bridge_rewrites_review_positional_target_for_prepare(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True

    result = _run_bridge(tmp_path, "review", "--executor", "codex", "backend/app.py")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "review"
    assert payload["bridged_command_id"] == "prepare"
    assert payload["bridge_success"] is True
    assert "--target" in payload["argv"]
    assert "backend/app.py" in payload["argv"]
    assert payload["packet"]["command_id"] == "review"
    assert payload["packet"]["target"] == "backend/app.py"
    assert "protocol_commands" in payload["packet"]


def test_bridge_run_without_task_id_returns_candidate_tasks_and_stops(tmp_path):
    init_result = _run_bridge(tmp_path, "init")
    assert json.loads(init_result.stdout)["bridge_success"] is True
    _write_task(tmp_path, "task-auth-fix", title="Fix Auth Session", goal_statement="Repair session persistence bug in auth flow.")
    _write_task(tmp_path, "task-dashboard", title="Dashboard Polish", goal_statement="Polish dashboard filters and layout.")

    result = _run_bridge(tmp_path, "run", "fix", "auth", "session")
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["command_id"] == "run"
    assert payload["bridge_success"] is False
    assert "task-auth-fix" in payload["stdout"]
    assert "No task was created" in payload["stdout"]
