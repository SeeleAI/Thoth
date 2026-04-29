"""Tests for strict init workflow helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from thoth.init.audit import audit_repository_state
from thoth.init.apply import build_init_preview
from thoth.init.render import (
    DEFAULT_PHASES,
    REQUIRED_AGENT_OS_FILES,
    generate_agent_os_docs,
    generate_codex_hook_projection,
    generate_dashboard,
    generate_host_projections,
    generate_milestones,
    generate_pre_commit_config,
    generate_scripts,
    generate_tests,
    generate_thoth_runtime,
    parse_config,
)
from thoth.init.service import initialize_project, sync_project_layer


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
    assert "thoth hook --host codex --event start" in start_hook["command"]
    assert "thoth hook --host codex --event stop" in stop_hook["command"]
    assert "thoth-codex-hook.sh" in start_hook["command"]
    assert "thoth-codex-hook.sh" in stop_hook["command"]


def test_generate_thoth_runtime(base_config, tmp_path):
    generate_thoth_runtime(base_config, tmp_path)
    manifest = json.loads((tmp_path / ".thoth" / "objects" / "project" / "project.json").read_text(encoding="utf-8"))
    assert manifest["payload"]["project"]["name"] == "UnitTestProject"
    assert manifest["payload"]["dashboard"]["port"] == 8501
    assert (tmp_path / ".thoth" / "docs" / "object-graph-summary.json").exists()


def test_generate_pre_commit_config(base_config, tmp_path):
    generate_pre_commit_config(base_config, tmp_path)
    content = (tmp_path / ".pre-commit-config.yaml").read_text(encoding="utf-8")
    assert "thoth-doctor" in content
    assert "thoth-sync" in content
    assert "bash scripts/thoth-cli.sh doctor --json" in content
    assert "bash scripts/thoth-cli.sh sync" in content


def test_generate_dashboard_writes_locale_selection(base_config, tmp_path):
    generate_dashboard(base_config, tmp_path)
    locale_file = tmp_path / "tools" / "dashboard" / "frontend" / "src" / "generated" / "locale.ts"
    assert locale_file.exists()
    assert "defaultLocale = 'en'" in locale_file.read_text(encoding="utf-8")


def test_generate_scripts(base_config, tmp_path):
    generate_scripts(base_config, tmp_path)
    thoth_cli = (tmp_path / "scripts" / "thoth-cli.sh").read_text(encoding="utf-8")
    session_end = (tmp_path / "scripts" / "session-end-check.sh").read_text(encoding="utf-8")
    assert "command -v thoth" in thoth_cli
    assert "THOTH_SOURCE_ROOT" in thoth_cli
    assert "Install drift" in thoth_cli
    assert "bash scripts/thoth-cli.sh sync" in session_end
    assert "bash scripts/thoth-cli.sh doctor" in session_end


def test_generate_tests(base_config, tmp_path):
    generate_tests(base_config, tmp_path)
    content = (tmp_path / "tests" / "test_structure.py").read_text(encoding="utf-8")
    assert ".thoth/objects/project/project.json" in content
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
    assert ".thoth/objects/project/project.json" in preview["create"]


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
    task = json.loads((tmp_path / ".thoth" / "objects" / "work_item" / "legacy-task.json").read_text(encoding="utf-8"))
    verdict = json.loads((tmp_path / ".thoth" / "docs" / "work-results" / "legacy-task.result.json").read_text(encoding="utf-8"))
    assert task["payload"]["source_contract_id"] == "CTR-import-legacy-task"
    assert task["payload"]["runnable"] is True
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


def test_sync_project_layer_refreshes_dashboard_locale(tmp_path):
    config = {
        "name": "LocaleSyncProject",
        "language": "zh",
        "directions": [],
        "phases": DEFAULT_PHASES,
        "port": 8501,
        "theme": "warm-bear",
    }
    initialize_project(config, tmp_path)
    manifest_path = tmp_path / ".thoth" / "objects" / "project" / "project.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["payload"]["project"]["language"] = "en"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    sync_project_layer(tmp_path)

    locale_file = tmp_path / "tools" / "dashboard" / "frontend" / "src" / "generated" / "locale.ts"
    assert "defaultLocale = 'en'" in locale_file.read_text(encoding="utf-8")
