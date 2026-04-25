"""Integration test: strict init workflow end-to-end."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

THOTH_ROOT = Path(__file__).parent.parent.parent
INIT_SCRIPT = THOTH_ROOT / "scripts" / "init.py"


def _run_init(project_dir: Path, config: dict) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(INIT_SCRIPT), "--config", json.dumps(config)],
        cwd=str(project_dir),
        capture_output=True,
        text=True,
        timeout=60,
        env={**os.environ, "THOTH_PLUGIN_ROOT": str(THOTH_ROOT)},
    )


@pytest.fixture
def init_project(tmp_path):
    project_dir = tmp_path / "test-project"
    project_dir.mkdir()
    subprocess.run(["git", "init"], cwd=str(project_dir), capture_output=True, check=False)
    subprocess.run(["git", "config", "user.email", "test@test.com"], cwd=str(project_dir), capture_output=True, check=False)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=str(project_dir), capture_output=True, check=False)
    config = {
        "name": "TestProject",
        "description": "A test project",
        "language": "en",
        "directions": [
            {"id": "frontend", "label_zh": "前端", "label_en": "Frontend", "color": "#CC8B3A"},
            {"id": "backend", "label_zh": "后端", "label_en": "Backend", "color": "#8BA870"},
        ],
        "phases": [
            {"id": "survey", "label_zh": "调研", "label_en": "Survey", "weight": 20},
            {"id": "method_design", "label_zh": "设计", "label_en": "Design", "weight": 20},
            {"id": "experiment", "label_zh": "实验", "label_en": "Experiment", "weight": 40},
            {"id": "conclusion", "label_zh": "结论", "label_en": "Conclusion", "weight": 20},
        ],
        "port": 8501,
        "theme": "warm-bear",
    }
    result = _run_init(project_dir, config)
    return project_dir, result


@pytest.mark.integration
class TestInitWorkflow:
    def test_init_exits_zero(self, init_project):
        _, result = init_project
        assert result.returncode == 0, f"init failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"

    def test_creates_strict_project_surface(self, init_project):
        project_dir, _ = init_project
        for rel in [
            "AGENTS.md",
            "CLAUDE.md",
            ".thoth/project/project.json",
            ".thoth/project/instructions.md",
            ".thoth/project/source-map.json",
            ".thoth/project/compiler-state.json",
            ".thoth/project/verdicts/.gitkeep",
            ".thoth/derived/codex-hooks.json",
            "tools/dashboard/backend/app.py",
        ]:
            assert (project_dir / rel).exists(), f"Missing: {rel}"

    def test_project_manifest_is_canonical(self, init_project):
        project_dir, _ = init_project
        manifest = json.loads((project_dir / ".thoth" / "project" / "project.json").read_text(encoding="utf-8"))
        assert manifest["project"]["name"] == "TestProject"
        assert len(manifest["project"]["directions"]) == 2
        assert manifest["dashboard"]["port"] == 8501
        assert not (project_dir / ".research-config.yaml").exists()

    def test_agent_os_docs_exist(self, init_project):
        project_dir, _ = init_project
        required = [
            "project-index.md",
            "requirements.md",
            "architecture-milestones.md",
            "todo.md",
            "change-decisions.md",
            "acceptance-report.md",
            "lessons-learned.md",
            "run-log.md",
        ]
        for fname in required:
            assert (project_dir / ".agent-os" / fname).exists()

    def test_validation_scripts_are_strict_only(self, init_project):
        project_dir, _ = init_project
        session_end = (project_dir / "scripts" / "session-end-check.sh").read_text(encoding="utf-8")
        assert "command -v python3" in session_end
        assert "THOTH_SOURCE_ROOT" in session_end
        assert '"$PYTHON_BIN" -m thoth.cli sync' in session_end
        assert '"$PYTHON_BIN" -m thoth.cli doctor' in session_end
        assert "research-tasks" not in session_end

    def test_generated_hooks_and_dashboard_are_portable(self, init_project):
        project_dir, _ = init_project
        setup = (project_dir / ".codex" / "setup.sh").read_text(encoding="utf-8")
        hooks = json.loads((project_dir / ".codex" / "hooks.json").read_text(encoding="utf-8"))
        codex_hook = (project_dir / "scripts" / "thoth-codex-hook.sh").read_text(encoding="utf-8")
        dashboard_start = (project_dir / "tools" / "dashboard" / "start.sh").read_text(encoding="utf-8")
        frontend_package = json.loads((project_dir / "tools" / "dashboard" / "frontend" / "package.json").read_text(encoding="utf-8"))
        assert "command -v python3" in setup
        assert "git rev-parse --show-toplevel 2>/dev/null || pwd" in hooks["hooks"]["SessionStart"][0]["hooks"][0]["command"]
        assert 'git -C "$SCRIPT_DIR" rev-parse --show-toplevel' in codex_hook
        assert '"$PYTHON_BIN" -m thoth.cli hook' in codex_hook
        assert 'git -C "$SCRIPT_DIR" rev-parse --show-toplevel' in dashboard_start
        assert 'command -v python3' in dashboard_start
        assert frontend_package["devDependencies"]["vite"].startswith("^6.")

    def test_creates_migration_bundle(self, init_project):
        project_dir, _ = init_project
        migration_dirs = sorted((project_dir / ".thoth" / "migrations").glob("mig-*"))
        assert migration_dirs
        latest = migration_dirs[-1]
        for rel in ("audit.json", "preview.json", "rollback.json", "apply.json"):
            assert (latest / rel).exists()

    def test_reinit_imports_legacy_and_cuts_old_surface(self, init_project):
        project_dir, _ = init_project
        (project_dir / ".research-config.yaml").write_text(
            yaml.safe_dump(
                {
                    "project": {"name": "Legacy Project"},
                    "dashboard": {"port": 8520},
                    "research": {"directions": [{"id": "frontend"}]},
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )
        legacy_task_dir = project_dir / ".agent-os" / "research-tasks" / "frontend" / "f1"
        legacy_task_dir.mkdir(parents=True)
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
        result = _run_init(project_dir, {"name": "ReInitProject", "directions": []})
        assert result.returncode == 0, f"re-init failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"
        assert not (project_dir / ".research-config.yaml").exists()
        assert not (project_dir / ".agent-os" / "research-tasks").exists()
        assert (project_dir / ".thoth" / "project" / "tasks" / "legacy-task.json").exists()
        assert (project_dir / ".thoth" / "project" / "verdicts" / "legacy-task.json").exists()
