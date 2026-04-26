"""Self-test CLI orchestration for Thoth."""

from __future__ import annotations

import argparse
import json
import shutil
import tempfile
from pathlib import Path

from . import processes as _processes
from .capabilities import *
from .fixtures import *
from .hard_suite import *
from .host_claude import *
from .host_codex import *
from .host_common import *
from .model import *
from .processes import *
from .recorder import *


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
        project_dir = base_dir / "repo-hard"
        project_dir.mkdir(parents=True, exist_ok=True)
        _processes._SELFTEST_STREAM_OUTPUT = True
        with _SelftestBudget(HARD_SUITE_MAX_RUNTIME_SECONDS, label=f"{tier} repo-hard suite"):
            hard_details = _repo_hard_suite(project_dir, recorder)
        recorder.write_json("repo-hard/details.json", hard_details)
        recorder.add("repo-hard.snapshot", "passed", "Captured runtime and project snapshots.", _snapshot_runtime(recorder, project_dir, "repo-hard"))

        if tier == "heavy":
            with _SelftestBudget(HEAVY_PREFLIGHT_MAX_RUNTIME_SECONDS, label="heavy host preflight"):
                _preflight_host_real(capabilities, recorder)
            requested_hosts = ["claude", "codex"] if hosts in {"auto", "both"} else ([] if hosts == "none" else [hosts])
            if only_host is not None:
                requested_hosts = [only_host]
            if not requested_hosts:
                raise RuntimeError("heavy host-real selftest requires at least one explicit host")

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
                    with _SelftestBudget(HEAVY_HOST_MAX_RUNTIME_SECONDS, label=f"heavy host {host_name}"):
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
