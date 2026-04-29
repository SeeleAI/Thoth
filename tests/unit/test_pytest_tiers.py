"""Tests for targeted pytest selection and broad-run guard helpers."""

from __future__ import annotations

from pathlib import Path

import pytest

from tests.conftest import (
    THOTH_ROOT,
    allow_broad_tests,
    classify_explicit_pytest_targets,
    item_matches_target_selectors,
    resolve_test_tier,
    tier_includes,
    validate_pytest_invocation,
)
from thoth.test_targets import (
    build_pytest_command,
    build_selftest_command,
    recommended_selftest_cases_for_paths,
    recommended_targets_for_paths,
    selectors_for_targets,
)


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


def test_allow_broad_tests_respects_cli_flag_and_env():
    assert allow_broad_tests(cli_flag=True, env={}) is True
    assert allow_broad_tests(cli_flag=False, env={"THOTH_ALLOW_BROAD_TESTS": "1"}) is True
    assert allow_broad_tests(cli_flag=False, env={"THOTH_ALLOW_BROAD_TESTS": "true"}) is True
    assert allow_broad_tests(cli_flag=False, env={}) is False


def test_classify_explicit_pytest_targets_distinguishes_files_and_directories():
    classification = classify_explicit_pytest_targets(
        ["tests/unit/test_status.py", "tests/unit", "tests/unit/test_cli_surface.py::test_cli_status_json"],
        repo_root=THOTH_ROOT,
    )
    assert classification["explicit"] == [
        "tests/unit/test_status.py",
        "tests/unit/test_cli_surface.py::test_cli_status_json",
    ]
    assert classification["directories"] == ["tests/unit"]


def test_validate_pytest_invocation_rejects_bare_pytest_by_default():
    failure = validate_pytest_invocation(
        [],
        repo_root=THOTH_ROOT,
        selected_targets=[],
        selected_tier=None,
        broad_allowed=False,
    )
    assert failure is not None
    assert "Bare pytest runs are disabled" in failure


def test_validate_pytest_invocation_rejects_directory_only_runs_by_default():
    failure = validate_pytest_invocation(
        ["tests/unit"],
        repo_root=THOTH_ROOT,
        selected_targets=[],
        selected_tier=None,
        broad_allowed=False,
    )
    assert failure is not None
    assert "Directory-wide pytest runs are disabled" in failure


def test_validate_pytest_invocation_rejects_tier_runs_without_override():
    failure = validate_pytest_invocation(
        [],
        repo_root=THOTH_ROOT,
        selected_targets=[],
        selected_tier="heavy",
        broad_allowed=False,
    )
    assert failure is not None
    assert "Broad tier runs are disabled" in failure


def test_validate_pytest_invocation_allows_explicit_file_or_target_or_override():
    explicit = validate_pytest_invocation(
        ["tests/unit/test_status.py"],
        repo_root=THOTH_ROOT,
        selected_targets=[],
        selected_tier=None,
        broad_allowed=False,
    )
    target = validate_pytest_invocation(
        [],
        repo_root=THOTH_ROOT,
        selected_targets=["selftest-core"],
        selected_tier=None,
        broad_allowed=False,
    )
    override = validate_pytest_invocation(
        [],
        repo_root=THOTH_ROOT,
        selected_targets=[],
        selected_tier=None,
        broad_allowed=True,
    )
    assert explicit is None
    assert target is None
    assert override is None


def test_selectors_for_targets_and_item_matching_work_together():
    selectors = selectors_for_targets(["surface-cli"])
    assert "tests/unit/test_cli_surface.py" in selectors
    assert item_matches_target_selectors(
        "tests/unit/test_cli_surface.py::test_cli_status_json",
        selectors,
    )
    assert not item_matches_target_selectors(
        "tests/unit/test_status.py::test_status_summary",
        selectors,
    )


def test_selectors_for_targets_rejects_unknown_target():
    with pytest.raises(ValueError, match="Unknown Thoth test target"):
        selectors_for_targets(["missing-target"])


def test_changed_path_recommendations_return_targets_and_selftest_cases():
    paths = [
        "thoth/observe/selftest/runner.py",
        "thoth/run/worker.py",
    ]
    targets = recommended_targets_for_paths(paths)
    cases = recommended_selftest_cases_for_paths(paths)
    assert "selftest-core" in targets
    assert "runtime-core" in targets
    assert "runtime.run.live" in cases
    assert "runtime.loop.lease_conflict" in cases


def test_build_targeted_commands_render_expected_cli_strings():
    pytest_command = build_pytest_command(["selftest-core", "runtime-core"])
    selftest_command = build_selftest_command(["runtime.run.live", "surface.codex.init"])
    assert pytest_command == "python -m pytest -q --thoth-target selftest-core --thoth-target runtime-core"
    assert selftest_command == "python -m thoth.selftest --case runtime.run.live --case surface.codex.init"
