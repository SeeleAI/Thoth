"""Doctor payloads and review task inference for strict project authority."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .compiler import compile_task_authority
from .paths import SCHEMA_VERSION, authority_root, compiler_state_path, work_items_dir
from .store import load_work_items, load_compiler_state, utc_now

def build_doctor_payload(project_root: Path) -> dict[str, Any]:
    compiler = compile_task_authority(project_root)
    summary = compiler.get("summary", {})
    decision_counts = summary.get("decision_counts", {})
    work_counts = summary.get("work_item_counts", {})
    legacy_task_count = int(summary.get("legacy_task_count", 0))
    active_work_count = int(summary.get("active_work_count", 0))

    checks = [
        {
            "id": "authority-tree",
            "ok": authority_root(project_root).exists(),
            "detail": str(authority_root(project_root)),
        },
        {
            "id": "no-proposed-decisions",
            "ok": int(decision_counts.get("proposed", 0)) == 0,
            "detail": f"proposed_decisions={int(decision_counts.get('proposed', 0))}",
        },
        {
            "id": "no-blocked-work-items",
            "ok": int(work_counts.get("blocked", 0)) == 0,
            "detail": f"blocked={int(work_counts.get('blocked', 0))} ready={int(work_counts.get('ready', 0))} active={active_work_count}",
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
            "id": "work-item-authority-present",
            "ok": work_items_dir(project_root).exists(),
            "detail": f"path={work_items_dir(project_root)}",
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
            "work_item_counts": work_counts,
            "legacy_task_count": legacy_task_count,
            "active_work_count": active_work_count,
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
    decision_counts = summary.get("decision_counts", {})
    work_counts = summary.get("work_item_counts", {})
    lines.append(
        "  decisions proposed={proposed} accepted={accepted} superseded={superseded}".format(
            proposed=int(decision_counts.get("proposed", 0)),
            accepted=int(decision_counts.get("accepted", 0)),
            superseded=int(decision_counts.get("superseded", 0)),
        )
    )
    lines.append(
        "  work ready={ready} blocked={blocked} active={active} validated={validated} total={total}".format(
            ready=int(work_counts.get("ready", 0)),
            blocked=int(work_counts.get("blocked", 0)),
            active=int(work_counts.get("active", 0)),
            validated=int(work_counts.get("validated", 0)),
            total=int(work_counts.get("total", 0)),
        )
    )
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


def infer_review_work_id(project_root: Path, target: str) -> str | None:
    normalized = target.strip()
    if not normalized:
        return None
    for task in load_work_items(project_root):
        binding = task.get("review_binding")
        if not isinstance(binding, dict):
            continue
        candidate = binding.get("target")
        if isinstance(candidate, str) and candidate.strip() == normalized:
            work_id = task.get("work_id")
            if isinstance(work_id, str) and work_id:
                return work_id
    return None
