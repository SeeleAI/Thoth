"""Doctor payloads and review task inference for strict project authority."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .compiler import compile_task_authority
from .paths import SCHEMA_VERSION, authority_root, compiler_state_path, tasks_dir
from .store import load_compiled_tasks, load_compiler_state, utc_now

def build_doctor_payload(project_root: Path) -> dict[str, Any]:
    compiler = compile_task_authority(project_root)
    summary = compiler.get("summary", {})
    decision_counts = summary.get("decision_counts", {})
    task_counts = summary.get("task_counts", {})
    legacy_task_count = int(summary.get("legacy_task_count", 0))
    task_result_count = int(summary.get("task_result_count", 0))

    checks = [
        {
            "id": "authority-tree",
            "ok": authority_root(project_root).exists(),
            "detail": str(authority_root(project_root)),
        },
        {
            "id": "decision-queue-empty",
            "ok": int(summary.get("decision_queue_count", 0)) == 0,
            "detail": f"open_or_invalid_decisions={int(summary.get('decision_queue_count', 0))}",
        },
        {
            "id": "no-blocked-or-invalid-tasks",
            "ok": int(task_counts.get("blocked", 0)) == 0 and int(task_counts.get("invalid", 0)) == 0,
            "detail": f"blocked={int(task_counts.get('blocked', 0))} invalid={int(task_counts.get('invalid', 0))} imported_resolved={int(task_counts.get('imported_resolved', 0))}",
        },
        {
            "id": "no-legacy-yaml-authority",
            "ok": legacy_task_count == 0,
            "detail": f"legacy_task_count={legacy_task_count}",
        },
        {
            "id": "compiler-state-written",
            "ok": compiler_state_path(project_root).exists(),
            "detail": str(compiler_state_path(project_root)),
        },
        {
            "id": "task-result-ledger-present",
            "ok": tasks_dir(project_root).exists(),
            "detail": f"task_result_count={task_result_count} path={tasks_dir(project_root)}",
        },
    ]
    overall_ok = all(check["ok"] for check in checks)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now(),
        "project_root": str(project_root.resolve()),
        "overall_ok": overall_ok,
        "checks": checks,
        "compiler": compiler,
        "summary": {
            "decision_counts": decision_counts,
            "task_counts": task_counts,
            "legacy_task_count": legacy_task_count,
            "task_result_count": task_result_count,
        },
    }


def render_doctor_text(payload: dict[str, Any]) -> str:
    lines = ["Thoth Doctor", ""]
    lines.append(f"Project: {payload.get('project_root')}")
    lines.append(f"Overall: {'PASS' if payload.get('overall_ok') else 'FAIL'}")
    lines.append("")
    lines.append("Checks:")
    for check in payload.get("checks", []):
        marker = "PASS" if check.get("ok") else "FAIL"
        lines.append(f"- {marker} {check.get('id')}: {check.get('detail')}")
    compiler = payload.get("compiler", {})
    summary = compiler.get("summary", {})
    lines.append("")
    lines.append("Compiler Summary:")
    lines.append(
        "  decisions open={open_count} frozen={frozen_count}".format(
            open_count=int(summary.get("decision_counts", {}).get("open", 0)),
            frozen_count=int(summary.get("decision_counts", {}).get("frozen", 0)),
        )
    )
    lines.append(
        "  tasks ready={ready} blocked={blocked} invalid={invalid} imported_resolved={imported} total={total}".format(
            ready=int(summary.get("task_counts", {}).get("ready", 0)),
            blocked=int(summary.get("task_counts", {}).get("blocked", 0)),
            invalid=int(summary.get("task_counts", {}).get("invalid", 0)),
            imported=int(summary.get("task_counts", {}).get("imported_resolved", 0)),
            total=int(summary.get("task_counts", {}).get("total", 0)),
        )
    )
    lines.append(f"  task_result_count={int(summary.get('task_result_count', 0))}")
    lines.append(f"  legacy_task_count={int(summary.get('legacy_task_count', 0))}")
    problems = compiler.get("problems", [])
    if problems:
        lines.append("")
        lines.append("Problems:")
        for item in problems[:20]:
            lines.append(f"- {item}")
    return "\n".join(lines) + "\n"


def compiler_summary(project_root: Path) -> dict[str, Any]:
    compiler = load_compiler_state(project_root)
    return compiler.get("summary", {}) if isinstance(compiler, dict) else {}


def infer_review_task_id(project_root: Path, target: str) -> str | None:
    normalized = target.strip()
    if not normalized:
        return None
    for task in load_compiled_tasks(project_root):
        binding = task.get("review_binding")
        if not isinstance(binding, dict):
            continue
        candidate = binding.get("target")
        if isinstance(candidate, str) and candidate.strip() == normalized:
            task_id = task.get("task_id")
            if isinstance(task_id, str) and task_id:
                return task_id
    return None
