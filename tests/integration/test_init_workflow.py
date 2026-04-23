"""Integration test: init workflow end-to-end."""
import json
import subprocess
import sys
import os
from pathlib import Path

import pytest
import yaml

THOTH_ROOT = Path(__file__).parent.parent.parent
INIT_SCRIPT = THOTH_ROOT / "scripts" / "init.py"


@pytest.fixture
def init_project(tmp_path):
    """Run init.py in a temp git repo with a test config."""
    project_dir = tmp_path / "test-project"
    project_dir.mkdir()

    subprocess.run(["git", "init"], cwd=str(project_dir), capture_output=True)
    subprocess.run(
        ["git", "config", "user.email", "test@test.com"],
        cwd=str(project_dir), capture_output=True,
    )
    subprocess.run(
        ["git", "config", "user.name", "Test"],
        cwd=str(project_dir), capture_output=True,
    )

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

    result = subprocess.run(
        [sys.executable, str(INIT_SCRIPT), "--config", json.dumps(config)],
        cwd=str(project_dir),
        capture_output=True, text=True, timeout=60,
        env={**os.environ, "THOTH_PLUGIN_ROOT": str(THOTH_ROOT)},
    )

    return project_dir, result


@pytest.mark.integration
class TestInitWorkflow:

    def test_init_exits_zero(self, init_project):
        project_dir, result = init_project
        assert result.returncode == 0, f"init failed:\nSTDOUT: {result.stdout}\nSTDERR: {result.stderr}"

    def test_creates_research_config(self, init_project):
        project_dir, _ = init_project
        config_path = project_dir / ".research-config.yaml"
        assert config_path.exists(), "Should create .research-config.yaml"
        with open(config_path) as f:
            config = yaml.safe_load(f)
        assert config["project"]["name"] == "TestProject"
        assert len(config["research"]["directions"]) == 2

    def test_creates_agent_os_docs(self, init_project):
        project_dir, _ = init_project
        required = [
            "project-index.md", "requirements.md", "architecture-milestones.md",
            "todo.md", "change-decisions.md", "acceptance-report.md",
            "lessons-learned.md", "run-log.md",
        ]
        for fname in required:
            assert (project_dir / ".agent-os" / fname).exists(), f"Missing: .agent-os/{fname}"

    def test_creates_research_tasks_scripts(self, init_project):
        project_dir, _ = init_project
        scripts = ["validate.py", "verify_completion.py", "check_consistency.py", "sync_todo.py", "schema.json"]
        for fname in scripts:
            path = project_dir / ".agent-os" / "research-tasks" / fname
            assert path.exists(), f"Missing: {fname}"

    def test_creates_direction_dirs(self, init_project):
        project_dir, _ = init_project
        for d in ["frontend", "backend"]:
            assert (project_dir / ".agent-os" / "research-tasks" / d).is_dir(), f"Missing direction dir: {d}"

    def test_creates_milestones(self, init_project):
        project_dir, _ = init_project
        ms_path = project_dir / ".agent-os" / "milestones.yaml"
        assert ms_path.exists(), "Should create milestones.yaml"

    def test_creates_claude_md(self, init_project):
        project_dir, _ = init_project
        claude_md = project_dir / "CLAUDE.md"
        assert claude_md.exists(), "Should create CLAUDE.md"
        content = claude_md.read_text()
        assert "TestProject" in content or "Thoth" in content

    def test_creates_agents_md(self, init_project):
        project_dir, _ = init_project
        agents_md = project_dir / "AGENTS.md"
        assert agents_md.exists(), "Should create AGENTS.md"
        assert agents_md.read_text() == (project_dir / "CLAUDE.md").read_text()

    def test_creates_scripts(self, init_project):
        project_dir, _ = init_project
        scripts = ["install-hooks.sh", "session-end-check.sh", "validate-all.sh", "check-required-files.sh"]
        for fname in scripts:
            assert (project_dir / "scripts" / fname).exists(), f"Missing: scripts/{fname}"

    def test_creates_thoth_runtime_tree(self, init_project):
        project_dir, _ = init_project
        for rel in [
            ".thoth/project/project.json",
            ".thoth/project/instructions.md",
            ".thoth/runs/.gitkeep",
            ".thoth/migrations/.gitkeep",
            ".thoth/derived/.gitkeep",
        ]:
            assert (project_dir / rel).exists(), f"Missing: {rel}"

    def test_creates_codex_project_layer(self, init_project):
        project_dir, _ = init_project
        for rel in [
            ".codex/config.json",
            ".codex/setup.sh",
            ".codex/hooks/hooks.json",
        ]:
            assert (project_dir / rel).exists(), f"Missing: {rel}"

    def test_validation_passes(self, init_project):
        project_dir, _ = init_project
        validate_script = project_dir / ".agent-os" / "research-tasks" / "validate.py"
        if validate_script.exists():
            result = subprocess.run(
                [sys.executable, str(validate_script)],
                cwd=str(project_dir), capture_output=True, text=True, timeout=30,
            )
            assert result.returncode == 0, f"Validation failed: {result.stdout}"
