"""Self-test CLI orchestration for Thoth."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any

from . import processes as _processes
from .capabilities import (
    _ensure_codex_global_hooks,
    _ensure_codex_skill_installed,
    _ensure_features_flag,
    _preflight_host_real,
    detect_capabilities,
)
from .fixtures import (
    _expected_host_review_result,
    _host_real_contract_payloads,
    _host_real_decision_payload,
    _host_real_source_fingerprint,
    _host_real_source_unchanged,
    _seed_host_real_repo,
    _snapshot_runtime,
)
from .hard_suite import _repo_hard_suite, _verify_host_run_completion
from .host_claude import _host_claude
from .host_codex import _host_codex
from .host_common import (
    _codex_completed_command_items,
    _codex_prompt_for_public_command,
    _effective_host_command_timeout,
    _looks_like_transient_host_outage,
    _normalize_codex_public_command_result,
)
from .model import (
    FIXED_CLAUDE_DIR,
    FIXED_CODEX_DIR,
    FIXED_RUNTIME_DIR,
    HARD_SUITE_MAX_RUNTIME_SECONDS,
    HEAVY_SUITE_MAX_RUNTIME_SECONDS,
    ROOT,
)
from .processes import (
    _SelftestBudget,
    _cap_selftest_timeout,
    _cleanup_legacy_heavy_processes,
    _cleanup_legacy_heavy_tmp,
    _legacy_heavy_process_targets,
    _run_command,
    _terminate_processes,
)
from .recorder import Recorder, _write_json


def _should_run_host(mode: str, *, host: str, capabilities: dict[str, Any]) -> bool:
    if mode == "none":
        return False
    if mode in {host, "both"}:
        return True
    if mode != "auto":
        return False
    if host == "claude":
        return bool(capabilities.get("claude_cli_present") and capabilities.get("claude_authenticated"))
    if host == "codex":
        return bool(capabilities.get("codex_cli_present") and capabilities.get("codex_authenticated"))
    return False


def run_selftest(
    *,
    tier: str,
    hosts: str,
    artifact_dir: Path | None,
    json_report: Path | None,
    keep_workdir: bool,
    only_host: str | None = None,
    from_step: str | None = None,
    to_step: str | None = None,
) -> int:
    capabilities = detect_capabilities()
    base_dir = Path(tempfile.mkdtemp(prefix="thoth-selftest-"))
    if tier == "heavy":
        _cleanup_legacy_heavy_processes()
        _cleanup_legacy_heavy_tmp(preserve=[FIXED_CLAUDE_DIR, FIXED_CODEX_DIR, FIXED_RUNTIME_DIR])
        shutil.rmtree(FIXED_RUNTIME_DIR, ignore_errors=True)
        FIXED_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        base_dir = FIXED_RUNTIME_DIR
    run_artifact_dir = artifact_dir or (base_dir / "artifacts")
    if run_artifact_dir.exists():
        shutil.rmtree(run_artifact_dir, ignore_errors=True)
    if json_report is not None:
        json_report.unlink(missing_ok=True)
    recorder = Recorder(run_artifact_dir)
    exit_code = 0

    try:
        _processes._SELFTEST_STREAM_OUTPUT = True
        if tier == "hard":
            project_dir = base_dir / "repo-hard"
            project_dir.mkdir(parents=True, exist_ok=True)
            with _SelftestBudget(HARD_SUITE_MAX_RUNTIME_SECONDS, label="hard repo-hard suite"):
                hard_details = _repo_hard_suite(project_dir, recorder)
            recorder.write_json("repo-hard/details.json", hard_details)
            recorder.add("repo-hard.snapshot", "passed", "Captured runtime and project snapshots.", _snapshot_runtime(recorder, project_dir, "repo-hard"))
        elif tier == "heavy":
            requested_hosts = ["claude", "codex"] if hosts in {"auto", "both"} else ([] if hosts == "none" else [hosts])
            if only_host is not None:
                requested_hosts = [only_host]
            if not requested_hosts:
                raise RuntimeError("heavy host-real selftest requires at least one explicit host")
            with _SelftestBudget(HEAVY_SUITE_MAX_RUNTIME_SECONDS, label="heavy host-real command gate"):
                _preflight_host_real(capabilities, recorder, requested_hosts=set(requested_hosts))

            for host_name, host_project in (("claude", FIXED_CLAUDE_DIR), ("codex", FIXED_CODEX_DIR)):
                if host_name not in requested_hosts:
                    continue
                _seed_host_real_repo(host_project, recorder)
                recorder.add(
                    f"host.{host_name}.seed_repo",
                    "passed",
                    f"Rebuilt disposable host-real repo for {host_name} at {host_project}.",
                    _snapshot_runtime(recorder, host_project, f"host-{host_name}-seed"),
                )
                try:
                    if host_name == "claude":
                        _host_claude(ROOT, host_project, recorder, from_step=from_step, to_step=to_step)
                    else:
                        _host_codex(ROOT, host_project, recorder, from_step=from_step, to_step=to_step)
                except Exception as exc:  # pragma: no cover - environment-specific
                    recorder.add(f"host.{host_name}", "failed", f"{host_name} host matrix failed: {exc}", _snapshot_runtime(recorder, host_project, f"host-{host_name}"))
                recorder.add(
                    f"host.{host_name}.snapshot",
                    "passed",
                    f"Captured post-host snapshot for {host_name}.",
                    _snapshot_runtime(recorder, host_project, f"host-{host_name}-final"),
                )

        summary = recorder.summary_payload(tier=tier, capabilities=capabilities, work_root=str(base_dir))
        summary_path = json_report or (run_artifact_dir / "summary.json")
        _write_json(summary_path, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        if summary["overall_status"] == "failed":
            exit_code = 1
    except Exception as exc:
        recorder.add("selftest.runner", "failed", f"Self-test aborted: {exc}")
        summary = recorder.summary_payload(tier=tier, capabilities=capabilities, work_root=str(base_dir))
        summary["overall_status"] = "failed"
        summary_path = json_report or (run_artifact_dir / "summary.json")
        _write_json(summary_path, summary)
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        exit_code = 1
    finally:
        _processes._SELFTEST_DEADLINE = None
        _processes._SELFTEST_DEADLINE_LABEL = None
        _processes._SELFTEST_DEADLINE_SECONDS = None
        _processes._SELFTEST_STREAM_OUTPUT = False
        if keep_workdir:
            print(f"Kept self-test workdir at {base_dir}")
        else:
            shutil.rmtree(base_dir, ignore_errors=True)
    return exit_code


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Thoth heavy self-tests.")
    parser.add_argument("--tier", choices=("hard", "heavy"), default="heavy")
    parser.add_argument("--hosts", choices=("auto", "none", "codex", "claude", "both"), default="auto")
    parser.add_argument("--only-host", choices=("codex", "claude"))
    parser.add_argument("--from-step")
    parser.add_argument("--to-step")
    parser.add_argument("--json-report", type=Path)
    parser.add_argument("--artifact-dir", type=Path)
    parser.add_argument("--keep-workdir", action="store_true")
    args = parser.parse_args(argv)
    return run_selftest(
        tier=args.tier,
        hosts=args.hosts,
        artifact_dir=args.artifact_dir,
        json_report=args.json_report,
        keep_workdir=args.keep_workdir,
        only_host=args.only_host,
        from_step=args.from_step,
        to_step=args.to_step,
    )


if __name__ == "__main__":
    raise SystemExit(main())
