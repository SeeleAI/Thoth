"""Tests for the atomic selftest registry and runner contract."""

from __future__ import annotations

import json
from pathlib import Path

from thoth.observe.selftest.atomic_cases import _host_case_window
from thoth.observe.selftest.processes import _SelftestBudget
from thoth.observe.selftest.registry import CASE_REGISTRY, SelftestCaseSpec, resolve_case_specs
from thoth.observe.selftest.runner import _cap_selftest_timeout, main, run_selftest


def test_case_registry_contains_expected_atomic_cases():
    case_ids = {spec.case_id for spec in CASE_REGISTRY}
    assert "plan.discuss.compile" in case_ids
    assert "runtime.run.live" in case_ids
    assert "surface.codex.run.live_prepare" in case_ids
    assert "surface.claude.sync" in case_ids


def test_resolve_case_specs_rejects_duplicates_and_unknown_cases():
    try:
        resolve_case_specs(["runtime.run.live", "runtime.run.live"])
    except ValueError as exc:
        assert "Duplicate selftest case requested" in str(exc)
    else:  # pragma: no cover - defensive
        raise AssertionError("duplicate case id should fail")

    try:
        resolve_case_specs(["missing.case"])
    except ValueError as exc:
        assert "Unknown selftest case" in str(exc)
    else:  # pragma: no cover - defensive
        raise AssertionError("unknown case id should fail")


def test_main_requires_explicit_case(capsys):
    exit_code = main([])
    captured = capsys.readouterr()
    assert exit_code == 2
    assert "requires at least one explicit `--case`" in captured.out
    assert "runtime.run.live" in captured.out


def test_nested_selftest_budget_is_clipped_by_invocation_budget():
    with _SelftestBudget(1.5, label="invocation"):
        with _SelftestBudget(20.0, label="case runtime.run.live"):
            capped = _cap_selftest_timeout(20.0)
    assert 0.1 <= capped <= 1.5


def test_host_case_windows_start_from_minimal_prerequisite_step():
    assert _host_case_window("surface.codex.init") == ("codex", "init", "init")
    assert _host_case_window("surface.codex.status") == ("codex", "status", "status")
    assert _host_case_window("surface.codex.discuss.compile") == (
        "codex",
        "discuss-decision",
        "discuss-contract-2",
    )
    assert _host_case_window("surface.codex.run.watch") == (
        "codex",
        "run-sleep",
        "run-watch",
    )
    assert _host_case_window("surface.claude.dashboard.stop") == (
        "claude",
        "dashboard-start",
        "dashboard-stop",
    )


def test_run_selftest_writes_case_keyed_report(monkeypatch, tmp_path):
    def runner_one(work_root: Path, recorder, _capabilities):
        work_root.mkdir(parents=True, exist_ok=True)
        artifact = recorder.write_text("one.txt", "ok\n")
        recorder.add("case.one.check", "passed", "first case passed", [artifact])

    def runner_two(work_root: Path, recorder, _capabilities):
        work_root.mkdir(parents=True, exist_ok=True)
        artifact = recorder.write_text("two.txt", "ok\n")
        recorder.add("case.two.check", "passed", "second case passed", [artifact])

    specs = [
        SelftestCaseSpec("case.one", "repo_local", 20.0, False, "none", "dummy", runner_one, ("dummy",)),
        SelftestCaseSpec("case.two", "repo_local", 20.0, False, "none", "dummy", runner_two, ("dummy",)),
    ]
    monkeypatch.setattr("thoth.observe.selftest.runner.resolve_case_specs", lambda _cases: specs)
    monkeypatch.setattr("thoth.observe.selftest.runner.detect_capabilities", lambda: {"python": "fake"})

    report_path = tmp_path / "summary.json"
    artifact_dir = tmp_path / "artifacts"
    exit_code = run_selftest(
        cases=["case.one", "case.two"],
        artifact_dir=artifact_dir,
        json_report=report_path,
        keep_workdir=False,
    )

    payload = json.loads(report_path.read_text(encoding="utf-8"))
    assert exit_code == 0
    assert payload["selected_cases"] == ["case.one", "case.two"]
    assert set(payload["results"]) == {"case.one", "case.two"}
    assert payload["results"]["case.one"]["status"] == "passed"
    assert payload["results"]["case.one"]["checks"][0]["name"] == "case.one.check"
    assert (artifact_dir / "case.one" / "one.txt").exists()
    assert (artifact_dir / "case.two" / "two.txt").exists()
