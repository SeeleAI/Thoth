"""Tests for host-real selftest helpers."""

from __future__ import annotations

import json
import signal
from pathlib import Path

from thoth.selftest import (
    Recorder,
    _cleanup_legacy_heavy_tmp,
    _codex_prompt_for_public_command,
    _ensure_codex_global_hooks,
    _ensure_codex_skill_installed,
    _ensure_features_flag,
    _ensure_seed_frontend_lock,
    _host_real_contract_payloads,
    _host_real_decision_payload,
    _legacy_heavy_process_targets,
    _verify_host_run_completion,
    _terminate_processes,
)
from thoth.selftest_seed import seed_host_real_app


def test_seed_host_real_app_writes_expected_surface(tmp_path):
    seed_host_real_app(tmp_path)
    assert (tmp_path / "backend" / "app.py").exists()
    assert (tmp_path / "frontend" / "src" / "main.js").exists()
    assert (tmp_path / "frontend" / "e2e" / "board.spec.ts").exists()
    assert (tmp_path / "frontend" / "e2e" / "feature-create.spec.ts").exists()
    assert (tmp_path / "frontend" / "e2e" / "column-persist.spec.ts").exists()
    assert (tmp_path / "scripts" / "api_smoke.py").exists()
    assert (tmp_path / "scripts" / "validate_host_real.py").exists()
    frontend = (tmp_path / "frontend" / "src" / "main.js").read_text(encoding="utf-8")
    validator = (tmp_path / "scripts" / "validate_host_real.py").read_text(encoding="utf-8")
    assert "#assignee-input" not in frontend
    assert "#due-date-input" not in frontend
    assert "PLAYWRIGHT_BROWSERS_PATH" in validator
    assert "NPM_CONFIG_CACHE" in validator


def test_ensure_features_flag_inserts_inside_features_block():
    content = "[memories]\nenabled = true\n\n[features]\nother_flag = false\n"
    updated = _ensure_features_flag(content, key="codex_hooks", value="true")
    assert "[features]" in updated
    assert "other_flag = false" in updated
    assert "codex_hooks = true" in updated
    assert updated.index("other_flag = false") < updated.index("codex_hooks = true")


def test_ensure_features_flag_handles_section_header_comments():
    content = "[features]\nfast_mode = true\n\n[memories] # comment\nextract_model = \"gpt-5.4\"\n"
    updated = _ensure_features_flag(content, key="codex_hooks", value="true")
    assert "codex_hooks = true" in updated
    assert updated.index("codex_hooks = true") < updated.index("[memories] # comment")


def test_ensure_seed_frontend_lock_materializes_lockfile(tmp_path, monkeypatch):
    seed_host_real_app(tmp_path)

    def fake_run_command(argv, *, cwd, env=None, timeout=120):
        assert argv[:3] == ["npm", "install", "--package-lock-only"]
        lock = Path(cwd) / "package-lock.json"
        lock.write_text(json.dumps({"name": "seed-lock", "lockfileVersion": 3}) + "\n", encoding="utf-8")

        class Result:
            def __init__(self) -> None:
                self.returncode = 0
                self.stdout = "ok"
                self.stderr = ""
                self.argv = list(argv)
                self.cwd = str(cwd)
                self.duration_seconds = 0.01

        return Result()

    monkeypatch.setattr("thoth.selftest._run_command", fake_run_command)
    artifacts = _ensure_seed_frontend_lock(tmp_path)
    assert artifacts == []
    lock = tmp_path / "frontend" / "package-lock.json"
    assert lock.exists()


def test_ensure_codex_skill_installed_links_global_entry(tmp_path, monkeypatch):
    repo_root = tmp_path / "repo"
    source = repo_root / ".agents" / "skills" / "thoth"
    source.mkdir(parents=True)
    (source / "SKILL.md").write_text("# test\n", encoding="utf-8")
    home = tmp_path / "home"
    home.mkdir(parents=True)

    monkeypatch.setattr("thoth.selftest.ROOT", repo_root)
    monkeypatch.setenv("HOME", str(home))

    recorder = Recorder(tmp_path / "artifacts")
    payload = _ensure_codex_skill_installed(recorder)

    target = home / ".codex" / "skills" / "thoth"
    assert target.is_symlink()
    assert target.resolve() == source.resolve()
    assert payload["effective"] is True


def test_ensure_codex_global_hooks_writes_bridge_config(tmp_path, monkeypatch):
    home = tmp_path / "home"
    home.mkdir(parents=True)
    monkeypatch.setenv("HOME", str(home))

    recorder = Recorder(tmp_path / "artifacts")
    payload = _ensure_codex_global_hooks(recorder)

    hooks_path = home / ".codex" / "hooks.json"
    assert hooks_path.exists()
    hooks = json.loads(hooks_path.read_text(encoding="utf-8"))
    start_hook = hooks["hooks"]["SessionStart"][0]["hooks"][0]
    stop_hook = hooks["hooks"]["Stop"][0]["hooks"][0]
    assert "thoth-codex-hook.sh\" start" in start_hook["command"]
    assert "thoth-codex-hook.sh\" stop" in stop_hook["command"]
    assert payload["effective"] is True


def test_host_real_payloads_define_frozen_decision_and_three_contracts():
    decision = _host_real_decision_payload()
    contracts = _host_real_contract_payloads()

    assert decision["decision_id"] == "DEC-host-real-selftest"
    assert decision["status"] == "frozen"
    assert [item["task_id"] for item in contracts] == [
        "task-feature-create-card",
        "task-bugfix-column-persist",
        "task-loop-close-review",
    ]
    assert "validate_host_real.py --spec e2e/feature-create.spec.ts" in contracts[0]["eval_entrypoint"]["command"]
    assert "validate_host_real.py --spec e2e/column-persist.spec.ts" in contracts[1]["eval_entrypoint"]["command"]
    assert "validate_host_real.py --api-script scripts/api_smoke.py --spec e2e/board.spec.ts" in contracts[2]["eval_entrypoint"]["command"]


def test_codex_prompt_uses_literal_shell_command_for_public_surface():
    prompt = _codex_prompt_for_public_command("$thoth doctor --quick", "DONE_TOKEN")
    assert "`$thoth doctor --quick`" in prompt
    assert "`thoth doctor --quick`" in prompt
    assert "rather than treating `$thoth` as a shell variable" in prompt


def test_codex_run_prompt_requires_live_packet_terminalization():
    prompt = _codex_prompt_for_public_command("$thoth run --host codex --task-id task-1", "DONE_TOKEN")
    assert "dispatch_mode=live_native" in prompt
    assert "terminalize the run with `complete` or `fail`" in prompt
    assert "Reply with exactly DONE_TOKEN only after the live packet has reached terminal state" in prompt


def test_cleanup_legacy_heavy_tmp_only_keeps_preserved_fixed_dirs(tmp_path):
    preserve = tmp_path / "thoth-selftest-claude"
    preserve.mkdir()
    stale_heavy = tmp_path / "thoth-heavy-stale"
    stale_heavy.mkdir()
    stale_runtime = tmp_path / "thoth-selftest-old"
    stale_runtime.mkdir()

    _cleanup_legacy_heavy_tmp(preserve=[preserve], tmp_root=tmp_path)

    assert preserve.exists()
    assert not stale_heavy.exists()
    assert not stale_runtime.exists()


def test_legacy_heavy_process_targets_matches_fixed_roots_and_old_heavy_runner(tmp_path):
    proc_root = tmp_path / "proc"
    proc_root.mkdir()
    fixed_claude = tmp_path / "thoth-selftest-claude"
    fixed_codex = tmp_path / "thoth-selftest-codex"
    fixed_runtime = tmp_path / "thoth-selftest-runtime"
    fixed_claude.mkdir()
    fixed_codex.mkdir()
    fixed_runtime.mkdir()

    runner = proc_root / "101"
    runner.mkdir()
    (runner / "cmdline").write_bytes(b"python\x00-m\x00thoth.selftest\x00--tier\x00heavy\x00--hosts\x00claude\x00")
    (runner / "cwd").symlink_to(tmp_path)

    claude_session = proc_root / "102"
    claude_session.mkdir()
    (claude_session / "cmdline").write_bytes(b"claude\x00-p\x00/thoth:run\x00")
    (claude_session / "cwd").symlink_to(fixed_claude)

    codex_skill = proc_root / "103"
    codex_skill.mkdir()
    (codex_skill / "cmdline").write_bytes(f"node\x00{fixed_codex / 'frontend' / 'node_modules' / '.bin' / 'vite'}\x00preview\x00".encode())
    (codex_skill / "cwd").symlink_to(tmp_path)

    unrelated = proc_root / "104"
    unrelated.mkdir()
    (unrelated / "cmdline").write_bytes(b"python\x00app.py\x00")
    (unrelated / "cwd").symlink_to(tmp_path)

    targets = _legacy_heavy_process_targets(
        proc_root=proc_root,
        current_pid=999,
        fixed_roots=[fixed_claude, fixed_codex, fixed_runtime],
    )

    assert targets == [101, 102, 103]


def test_terminate_processes_escalates_from_term_to_kill(tmp_path, monkeypatch):
    proc_root = tmp_path / "proc"
    proc_root.mkdir()
    for pid in ("201", "202"):
        (proc_root / pid).mkdir()

    signals: list[tuple[int, signal.Signals]] = []

    def fake_kill(pid: int, signum: signal.Signals) -> None:
        signals.append((pid, signum))
        target = proc_root / str(pid)
        if pid == 201 and signum == signal.SIGTERM:
            target.rmdir()
        if pid == 202 and signum == signal.SIGKILL:
            target.rmdir()

    monkeypatch.setattr("thoth.selftest.os.kill", fake_kill)

    remaining = _terminate_processes([201, 202], proc_root=proc_root, term_timeout=0.05, kill_timeout=0.05)

    assert remaining == []
    assert (201, signal.SIGTERM) in signals
    assert (202, signal.SIGTERM) in signals
    assert (202, signal.SIGKILL) in signals


def test_verify_host_review_accepts_findings_from_review_events(tmp_path):
    project_dir = tmp_path / "project"
    run_id = "review-123"
    run_dir = project_dir / ".thoth" / "runs" / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "run.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "kind": "review",
                "task_id": None,
                "host": "claude",
                "executor": "codex",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "state.json").write_text(
        json.dumps(
            {
                "run_id": run_id,
                "task_id": None,
                "status": "completed",
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "acceptance.json").write_text(
        json.dumps({"status": "passed", "summary": "ok", "result": {}}) + "\n",
        encoding="utf-8",
    )
    (run_dir / "packet.json").write_text("{}\n", encoding="utf-8")
    (run_dir / "events.jsonl").write_text(
        json.dumps({"seq": 1, "kind": "log", "message": json.dumps({"findings": [{"severity": "high", "title": "x"}]})})
        + "\n",
        encoding="utf-8",
    )

    recorder = Recorder(tmp_path / "artifacts")
    artifacts = _verify_host_run_completion(
        project_dir,
        recorder,
        check_name="host.claude.review_run",
        run_id=run_id,
        expected_kind="review",
        expected_host="claude",
        expected_executor="codex",
        require_findings=True,
        timeout=0.1,
    )

    assert artifacts
    assert recorder.checks[-1].status == "passed"


def test_verify_host_review_accepts_findings_from_artifact_file(tmp_path):
    project_dir = tmp_path / "project"
    run_id = "review-456"
    run_dir = project_dir / ".thoth" / "runs" / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "run.json").write_text(
        json.dumps({"run_id": run_id, "kind": "review", "host": "claude", "executor": "codex"}) + "\n",
        encoding="utf-8",
    )
    (run_dir / "state.json").write_text(json.dumps({"run_id": run_id, "status": "completed"}) + "\n", encoding="utf-8")
    (run_dir / "acceptance.json").write_text(json.dumps({"status": "passed", "result": {}}) + "\n", encoding="utf-8")
    (run_dir / "packet.json").write_text("{}\n", encoding="utf-8")
    (run_dir / "events.jsonl").write_text("{}\n", encoding="utf-8")
    (run_dir / "artifacts.json").write_text(
        json.dumps(
            {
                "artifacts": [
                    {
                        "path": f".thoth/runs/{run_id}/review-findings.json",
                        "label": "review-findings",
                    }
                ]
            }
        )
        + "\n",
        encoding="utf-8",
    )
    (run_dir / "review-findings.json").write_text(
        json.dumps({"findings": [{"severity": "medium", "title": "artifact finding"}]}) + "\n",
        encoding="utf-8",
    )

    recorder = Recorder(tmp_path / "artifacts")
    _verify_host_run_completion(
        project_dir,
        recorder,
        check_name="host.claude.review_run",
        run_id=run_id,
        expected_kind="review",
        expected_host="claude",
        expected_executor="codex",
        require_findings=True,
        timeout=0.1,
    )

    assert recorder.checks[-1].status == "passed"


def test_verify_host_run_rejects_fallback_or_degraded_language(tmp_path):
    project_dir = tmp_path / "project"
    run_id = "run-789"
    run_dir = project_dir / ".thoth" / "runs" / run_id
    run_dir.mkdir(parents=True)
    (run_dir / "run.json").write_text(
        json.dumps({"run_id": run_id, "kind": "run", "task_id": "task-1", "host": "codex", "dispatch_mode": "live_native"}) + "\n",
        encoding="utf-8",
    )
    (run_dir / "state.json").write_text(
        json.dumps({"run_id": run_id, "task_id": "task-1", "status": "completed"}) + "\n",
        encoding="utf-8",
    )
    (run_dir / "acceptance.json").write_text(
        json.dumps({"status": "passed", "summary": "official validator hung in playwright install chromium in this environment"}) + "\n",
        encoding="utf-8",
    )
    (run_dir / "packet.json").write_text("{}\n", encoding="utf-8")
    (run_dir / "events.jsonl").write_text("{}\n", encoding="utf-8")

    recorder = Recorder(tmp_path / "artifacts")

    try:
        _verify_host_run_completion(
            project_dir,
            recorder,
            check_name="host.codex.feature_run",
            run_id=run_id,
            expected_kind="run",
            expected_task_id="task-1",
            expected_host="codex",
            expected_dispatch_mode="live_native",
            timeout=0.1,
        )
    except RuntimeError as exc:
        assert "host.codex.feature_run failed" in str(exc)
    else:  # pragma: no cover - defensive
        raise AssertionError("fallback language should fail heavy verification")

    assert recorder.checks[-1].status == "failed"
