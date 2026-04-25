"""Tests for repository-level pytest tier selection."""

from tests.conftest import resolve_test_tier, tier_includes


def test_resolve_test_tier_defaults_unit_files_to_light():
    assert resolve_test_tier("tests/unit/test_status.py::test_status_summary") == "light"


def test_resolve_test_tier_promotes_repo_real_init_suite_to_medium():
    assert resolve_test_tier("tests/unit/test_init.py::test_generate_agent_os_docs") == "medium"
    assert resolve_test_tier("tests/integration/test_dashboard_api.py::test_dashboard_api_payloads") == "medium"


def test_resolve_test_tier_keeps_process_real_runtime_and_cli_in_heavy():
    assert resolve_test_tier("tests/unit/test_cli_surface.py::test_cli_status_json") == "heavy"
    assert resolve_test_tier("tests/integration/test_runtime_lifecycle_e2e.py::test_run_and_loop_lifecycle_end_to_end") == "heavy"


def test_tier_includes_is_hierarchical():
    assert tier_includes("light", "light") is True
    assert tier_includes("medium", "light") is True
    assert tier_includes("medium", "medium") is True
    assert tier_includes("medium", "heavy") is False
    assert tier_includes("heavy", "heavy") is True
