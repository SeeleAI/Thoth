"""Tests for strict init workflow helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from thoth.project_init import (
    DEFAULT_PHASES,
    REQUIRED_AGENT_OS_FILES,
    audit_repository_state,
    build_init_preview,
    generate_agent_os_docs,
    generate_codex_hook_projection,
    generate_dashboard,
    generate_host_projections,
    generate_milestones,
    generate_pre_commit_config,
    generate_scripts,
    generate_tests,
    generate_thoth_runtime,
    initialize_project,
    parse_config,
)


@pytest.fixture
def base_config():
    return {
        "name": "UnitTestProject",
        "description": "Test project for init.py",
        "language": "en",
        "directions": ["frontend", "backend"],
        "phases": DEFAULT_PHASES,
        "port": 8501,
        "theme": "warm-bear",
    }


def test_parse_config_from_json():
    config_json = json.dumps({"name": "ParseTest", "directions": "alpha,beta,gamma", "language": "zh"})
    config = parse_config(config_json)
    assert config["name"] == "ParseTest"
    assert config["directions"] == ["alpha", "beta", "gamma"]
    assert config["language"] == "zh"
    assert config["port"] == 8501


def test_generate_agent_os_docs(base_config, tmp_path):
    generate_agent_os_docs(base_config, tmp_path)
    for fname in REQUIRED_AGENT_OS_FILES:
        path = tmp_path / ".agent-os" / fname
        assert path.exists()
        assert path.read_text(encoding="utf-8").startswith("#")


def test_generate_host_projections(base_config, tmp_path):
    generate_host_projections(base_config, tmp_path)
    assert (tmp_path / "AGENTS.md").exists()
    assert (tmp_path / "CLAUDE.md").exists()
    assert (tmp_path / "AGENTS.md").read_text(encoding="utf-8") == (tmp_path / "CLAUDE.md").read_text(encoding="utf-8")


def test_generate_codex_hook_projection(tmp_path):
    generate_codex_hook_projection(tmp_path)
    hook_path = tmp_path / ".thoth" / "derived" / "codex-hooks.json"
    assert hook_path.exists()
    payload = json.loads(hook_path.read_text(encoding="utf-8"))
    start_hook = payload["hooks"]["SessionStart"][0]["hooks"][0]
    stop_hook = payload["hooks"]["Stop"][0]["hooks"][0]
    assert "thoth-codex-hook.sh\" start" in start_hook["command"]
    assert "thoth-codex-hook.sh\" stop" in stop_hook["command"]


def test_generate_thoth_runtime(base_config, tmp_path):
    generate_thoth_runtime(base_config, tmp_path)
    manifest = json.loads((tmp_path / ".thoth" / "project" / "project.json").read_text(encoding="utf-8"))
    assert manifest["project"]["name"] == "UnitTestProject"
    assert manifest["dashboard"]["port"] == 8501
    assert (tmp_path / ".thoth" / "project" / "verdicts" / ".gitkeep").exists()
    assert (tmp_path / ".thoth" / "project" / "compiler-state.json").exists()


def test_generate_pre_commit_config(base_config, tmp_path):
    generate_pre_commit_config(base_config, tmp_path)
    content = (tmp_path / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    assert "thoth-doctor" in content
    assert "thoth-sync" in content


def test_generate_scripts(base_config, tmp_path):
    generate_scripts(base_config, tmp_path)
    session_end = (tmp_path / "scripts" / "session-end-check.sh").read_text(encoding="utf-8")
    hook = (tmp_path / "scripts" / "thoth-codex-hook.sh").read_text(encoding="utf-8")
    assert "command -v python3" in session_end
    assert "THOTH_SOURCE_ROOT" in session_end
    assert '"$PYTHON_BIN" -m thoth.cli sync' in session_end
    assert '"$PYTHON_BIN" -m thoth.cli doctor' in session_end
    assert 'git -C "$SCRIPT_DIR" rev-parse --show-toplevel' in hook
    assert '"$PYTHON_BIN" -m thoth.cli hook' in hook


def test_generate_dashboard_template_is_portable(base_config, tmp_path):
    generate_dashboard(base_config, tmp_path)
    start_script = (tmp_path / "tools" / "dashboard" / "start.sh").read_text(encoding="utf-8")
    package_json = json.loads((tmp_path / "tools" / "dashboard" / "frontend" / "package.json").read_text(encoding="utf-8"))
    trigger_runner = (tmp_path / "tools" / "dashboard" / "backend" / "trigger_runner.py").read_text(encoding="utf-8")
    assert 'git -C "$SCRIPT_DIR" rev-parse --show-toplevel' in start_script
    assert 'PYTHON_BIN="$PROJECT_ROOT/.venv/bin/python"' in start_script
    assert 'command -v python3' in start_script
    assert '"$PYTHON_BIN" -m uvicorn' in start_script
    assert package_json["devDependencies"]["vite"].startswith("^6.")
    assert "sys.executable" in trigger_runner


def test_generate_tests(base_config, tmp_path):
    generate_tests(base_config, tmp_path)
    content = (tmp_path / "tests" / "test_structure.py").read_text(encoding="utf-8")
    assert ".thoth/project/project.json" in content
    assert ".research-config.yaml" not in content


def test_audit_repository_state_detects_legacy_and_docs(tmp_path):
    (tmp_path / ".research-config.yaml").write_text("project:\n  name: Legacy\n", encoding="utf-8")
    (tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1").mkdir(parents=True)
    (tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1" / "legacy.yaml").write_text("id: legacy\n", encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "docs" / "notes.md").write_text("# Notes\n", encoding="utf-8")
    audit = audit_repository_state(tmp_path)
    assert audit["existing"]["research_config"] is True
    assert audit["legacy_research_task_files"] == [".agent-os/research-tasks/frontend/f1/legacy.yaml"]
    assert "docs/notes.md" in audit["docs_files"]


def test_build_init_preview_marks_legacy_for_removal(tmp_path):
    (tmp_path / ".research-config.yaml").write_text("project:\n  name: Legacy\n", encoding="utf-8")
    (tmp_path / ".agent-os" / "research-tasks").mkdir(parents=True)
    audit = audit_repository_state(tmp_path)
    preview = build_init_preview(tmp_path, audit)
    assert ".research-config.yaml" in preview["remove"]
    assert ".agent-os/research-tasks" in preview["remove"]
    assert ".thoth/project/verdicts/.gitkeep" in preview["create"]


def test_build_init_preview_ignores_host_owned_codex_root(tmp_path):
    (tmp_path / ".codex").write_text("", encoding="utf-8")
    audit = audit_repository_state(tmp_path)
    preview = build_init_preview(tmp_path, audit)
    assert ".codex" not in preview["update"]
    assert ".thoth/derived/codex-hooks.json" in preview["create"]


def test_initialize_project_strict_cut_imports_legacy_and_removes_old_surface(base_config, tmp_path):
    legacy_task_dir = tmp_path / ".agent-os" / "research-tasks" / "frontend" / "f1"
    legacy_task_dir.mkdir(parents=True)
    (tmp_path / ".research-config.yaml").write_text(
        yaml.safe_dump(
            {
                "project": {"name": "Legacy Project", "language": "en"},
                "dashboard": {"port": 8520},
                "research": {"directions": [{"id": "frontend", "label_en": "Frontend"}]},
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )
    (legacy_task_dir / "legacy.yaml").write_text(
        yaml.safe_dump(
            {
                "id": "legacy-task",
                "title": "Legacy Task",
                "module": "f1",
                "direction": "frontend",
                "hypothesis": "Legacy result can be imported.",
                "phases": {
                    "experiment": {
                        "status": "completed",
                        "criteria": {
                            "metric": "score",
                            "threshold": 0.7,
                            "current": 0.9,
                            "direction": "higher_is_better",
                            "unit": "score",
                        },
                        "deliverables": [{"path": "reports/legacy.md", "type": "report", "description": "legacy"}],
                    }
                },
                "results": {
                    "verdict": "confirmed",
                    "evidence_paths": ["reports/legacy.md"],
                    "metrics": {"score": 0.9},
                    "conclusion_text": "Imported from legacy.",
                    "failure_analysis": None,
                },
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    result = initialize_project(base_config, tmp_path)

    assert not (tmp_path / ".research-config.yaml").exists()
    assert not (tmp_path / ".agent-os" / "research-tasks").exists()
    task = json.loads((tmp_path / ".thoth" / "project" / "tasks" / "legacy-task.json").read_text(encoding="utf-8"))
    verdict = json.loads((tmp_path / ".thoth" / "project" / "verdicts" / "legacy-task.json").read_text(encoding="utf-8"))
    assert task["ready_state"] == "imported_resolved"
    assert task["runnable"] is False
    assert verdict["source"] == "legacy_import"
    import_index = json.loads(
        (tmp_path / ".thoth" / "migrations" / result["migration_id"] / "legacy-import" / "index.json").read_text(encoding="utf-8")
    )
    assert import_index["imported_task_count"] == 1
    preview = json.loads((tmp_path / ".thoth" / "migrations" / result["migration_id"] / "preview.json").read_text(encoding="utf-8"))
    assert ".research-config.yaml" in preview["remove"]
    assert ".agent-os/research-tasks" in preview["remove"]


def test_initialize_project_preserves_host_owned_codex_root(base_config, tmp_path):
    (tmp_path / ".codex").write_text("", encoding="utf-8")

    result = initialize_project(base_config, tmp_path)

    assert (tmp_path / ".codex").is_file()
    assert (tmp_path / ".thoth" / "derived" / "codex-hooks.json").exists()
    backup = tmp_path / ".thoth" / "migrations" / result["migration_id"] / "backup" / ".codex"
    displaced = tmp_path / ".thoth" / "migrations" / result["migration_id"] / "displaced" / ".codex"
    assert not backup.exists()
    assert not displaced.exists()
    preview = json.loads((tmp_path / ".thoth" / "migrations" / result["migration_id"] / "preview.json").read_text(encoding="utf-8"))
    assert ".codex" not in preview["update"]
    assert result["displaced_conflicts"] == []
