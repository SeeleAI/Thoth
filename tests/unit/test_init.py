"""Tests for init script file generation (init.py)."""

import json
import sys
from pathlib import Path

import pytest
import yaml

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

from init import (
    parse_config,
    generate_research_config,
    generate_agent_os_docs,
    generate_milestones,
    generate_research_tasks,
    generate_dashboard,
    generate_scripts,
    generate_host_projections,
    generate_codex_project_layer,
    generate_pre_commit_config,
    generate_thoth_runtime,
    REQUIRED_AGENT_OS_FILES,
    DEFAULT_PHASES,
)


@pytest.fixture
def base_config():
    """Minimal config dict for testing."""
    return {
        "name": "UnitTestProject",
        "description": "Test project for init.py",
        "language": "en",
        "directions": ["frontend", "backend"],
        "phases": DEFAULT_PHASES,
        "port": 8501,
        "theme": "warm-bear",
    }


@pytest.fixture
def project_dir(tmp_path):
    """Create the minimum directory structure required by init."""
    (tmp_path / ".agent-os" / "research-tasks").mkdir(parents=True)
    (tmp_path / "tools" / "dashboard" / "backend").mkdir(parents=True)
    (tmp_path / "tools" / "dashboard" / "frontend").mkdir(parents=True)
    (tmp_path / "scripts").mkdir()
    (tmp_path / "reports").mkdir()
    return tmp_path


def test_parse_config_from_json():
    """parse_config should correctly parse a JSON config string."""
    config_json = json.dumps({
        "name": "ParseTest",
        "directions": "alpha,beta,gamma",
        "language": "zh",
    })
    config = parse_config(config_json)
    assert config["name"] == "ParseTest"
    assert config["directions"] == ["alpha", "beta", "gamma"]
    assert config["language"] == "zh"
    # Defaults
    assert config["port"] == 8501
    assert config["theme"] == "warm-bear"


def test_parse_config_defaults():
    """parse_config should apply defaults for missing fields."""
    config = parse_config('{}')
    assert "name" in config
    assert config["phases"] == DEFAULT_PHASES
    assert config["port"] == 8501


def test_generates_config(base_config, project_dir):
    """Config file should be created with correct structure."""
    generate_research_config(base_config, project_dir)

    config_path = project_dir / ".research-config.yaml"
    assert config_path.exists(), "Expected .research-config.yaml to be created"

    with open(config_path, "r", encoding="utf-8") as fh:
        content = fh.read()

    # Parse as YAML to verify structure
    config = yaml.safe_load(content)
    assert config is not None, "Expected YAML to parse successfully"
    assert "project" in config, "Expected 'project' key in config"
    assert config["project"]["name"] == "UnitTestProject"
    assert "research" in config, "Expected 'research' key in config"
    assert "directions" in config["research"], "Expected 'directions' in research"
    assert len(config["research"]["directions"]) == 2, (
        f"Expected 2 directions, got {len(config['research']['directions'])}"
    )
    assert "phases" in config["research"], "Expected 'phases' in research"
    assert "dashboard" in config, "Expected 'dashboard' key in config"
    assert config["dashboard"]["port"] == 8501


def test_generates_agent_os_docs(base_config, project_dir):
    """All 9 required .agent-os documents should be created."""
    generate_agent_os_docs(base_config, project_dir)

    agent_os = project_dir / ".agent-os"
    for fname in REQUIRED_AGENT_OS_FILES:
        fpath = agent_os / fname
        assert fpath.exists(), f"Expected {fname} to be created"
        content = fpath.read_text(encoding="utf-8")
        assert len(content) > 0, f"Expected {fname} to have content"
        # Each file should start with a markdown heading
        assert content.startswith("#"), (
            f"Expected {fname} to start with '#', got: {content[:50]}"
        )


def test_generates_milestones(base_config, project_dir):
    """milestones.yaml should be created with correct structure."""
    generate_milestones(base_config, project_dir)

    ms_path = project_dir / ".agent-os" / "milestones.yaml"
    assert ms_path.exists(), "Expected milestones.yaml to be created"

    with open(ms_path, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)
    assert data is not None
    assert "milestones" in data, "Expected 'milestones' key"
    assert data["milestones"] == [], "Expected empty milestones list for new project"


def test_generates_research_tasks(base_config, project_dir):
    """Research tasks directory should be created with schema and scripts."""
    generate_research_tasks(base_config, project_dir)

    tasks_dir = project_dir / ".agent-os" / "research-tasks"
    assert tasks_dir.exists(), "Expected research-tasks directory"

    # Check schema.json copied from templates
    schema_path = tasks_dir / "schema.json"
    template_schema = (
        Path(__file__).parent.parent.parent / "templates" / "agent-os" / "research-tasks" / "schema.json"
    )
    if template_schema.exists():
        assert schema_path.exists(), "Expected schema.json to be copied"
        with open(schema_path, "r", encoding="utf-8") as fh:
            schema = json.load(fh)
        assert "definitions" in schema, "Expected valid schema with definitions"

    # Check direction subdirectories
    assert (tasks_dir / "frontend").is_dir(), "Expected 'frontend' direction directory"
    assert (tasks_dir / "backend").is_dir(), "Expected 'backend' direction directory"

    # Check paper-module-mapping.yaml
    mapping = tasks_dir / "paper-module-mapping.yaml"
    assert mapping.exists(), "Expected paper-module-mapping.yaml"


def test_generates_dashboard(base_config, project_dir):
    """Dashboard files should be created."""
    generate_dashboard(base_config, project_dir)

    dashboard_dir = project_dir / "tools" / "dashboard"
    assert dashboard_dir.exists(), "Expected tools/dashboard directory"

    # Backend should exist
    backend_dir = dashboard_dir / "backend"
    assert backend_dir.exists(), "Expected tools/dashboard/backend directory"


def test_generates_scripts(base_config, project_dir):
    """Scripts directory should contain expected shell scripts."""
    generate_scripts(base_config, project_dir)

    scripts_dir = project_dir / "scripts"
    expected_scripts = [
        "install-hooks.sh",
        "check-required-files.sh",
        "session-end-check.sh",
        "validate-all.sh",
    ]
    for script in expected_scripts:
        spath = scripts_dir / script
        assert spath.exists(), f"Expected {script} to be created"
        content = spath.read_text(encoding="utf-8")
        assert content.startswith("#!/"), (
            f"Expected {script} to have a shebang line, got: {content[:20]}"
        )


def test_generates_host_projections(base_config, project_dir):
    """AGENTS.md and CLAUDE.md should be rendered from the same source."""
    generate_host_projections(base_config, project_dir)
    agents = project_dir / "AGENTS.md"
    claude = project_dir / "CLAUDE.md"
    assert agents.exists()
    assert claude.exists()
    assert agents.read_text(encoding="utf-8") == claude.read_text(encoding="utf-8")


def test_generates_codex_project_layer(base_config, project_dir):
    """Codex project layer files should be created."""
    generate_codex_project_layer(base_config, project_dir)
    assert (project_dir / ".codex" / "config.json").exists()
    assert (project_dir / ".codex" / "setup.sh").exists()
    assert (project_dir / ".codex" / "hooks" / "hooks.json").exists()


def test_generates_thoth_authority_project_files(base_config, project_dir):
    """Project authority should include project.json and instructions.md."""
    generate_thoth_runtime(base_config, project_dir)
    assert (project_dir / ".thoth" / "project" / "project.json").exists()
    assert (project_dir / ".thoth" / "project" / "instructions.md").exists()


def test_generates_pre_commit_config(base_config, project_dir):
    generate_pre_commit_config(base_config, project_dir)
    assert (project_dir / ".pre-commit-config.yaml").exists()


def test_config_directions_have_colors(base_config, project_dir):
    """Each direction in the generated config should have a color assigned."""
    generate_research_config(base_config, project_dir)

    config_path = project_dir / ".research-config.yaml"
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))

    for d in config["research"]["directions"]:
        assert "color" in d, f"Expected direction '{d.get('id')}' to have a color"
        assert d["color"].startswith("#"), (
            f"Expected color to be hex, got: {d['color']}"
        )


def test_config_phases_have_weights(base_config, project_dir):
    """Each phase in the generated config should have a weight."""
    generate_research_config(base_config, project_dir)

    config_path = project_dir / ".research-config.yaml"
    config = yaml.safe_load(config_path.read_text(encoding="utf-8"))

    total_weight = 0
    for p in config["research"]["phases"]:
        assert "weight" in p, f"Expected phase '{p.get('id')}' to have a weight"
        assert isinstance(p["weight"], (int, float)), (
            f"Expected weight to be numeric, got {type(p['weight'])}"
        )
        total_weight += p["weight"]
    assert total_weight == 100, f"Expected total phase weight 100, got {total_weight}"


def test_parse_config_directions_from_list():
    """parse_config should accept directions as a list too."""
    config_json = json.dumps({
        "name": "ListDirs",
        "directions": ["a", "b", "c"],
    })
    config = parse_config(config_json)
    assert config["directions"] == ["a", "b", "c"]
