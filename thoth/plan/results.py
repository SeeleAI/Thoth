"""RunResult -> TaskResult projection helpers."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .paths import SCHEMA_VERSION
from .store import (
    _normalize_string_list,
    _normalize_task_result,
    _remove_stale_task_results,
    _read_json,
    ensure_task_authority_tree,
    load_compiled_tasks,
    load_task_result,
    load_task_result_map,
    tasks_dir,
    upsert_task_result,
    utc_now,
)

def _first_failed_check_name(checks: Any) -> str | None:
    if not isinstance(checks, list):
        return None
    for check in checks:
        if not isinstance(check, dict):
            continue
        if check.get("ok") is False:
            for key in ("name", "detail", "summary"):
                value = check.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


def _merge_recent_refs(existing: Any, new_ref: str) -> list[str]:
    rows = [value for value in existing if isinstance(value, str) and value] if isinstance(existing, list) else []
    merged = [new_ref, *[value for value in rows if value != new_ref]]
    return merged[:5]


def apply_run_result_to_task_result(
    current: dict[str, Any],
    *,
    run_payload: dict[str, Any],
    run_result: dict[str, Any],
    artifacts_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    task_id = str(run_payload.get("task_id") or run_result.get("task_id") or "").strip()
    if not task_id:
        return current
    result = _normalize_task_result(task_id, current)
    artifacts = artifacts_payload.get("artifacts", []) if isinstance(artifacts_payload, dict) else []
    evidence_paths = [
        str(row.get("path"))
        for row in artifacts
        if isinstance(row, dict) and isinstance(row.get("path"), str) and row.get("path")
    ]
    finished_at = str(run_result.get("finished_at") or run_result.get("updated_at") or utc_now())
    run_id = str(run_payload.get("run_id") or run_result.get("run_id") or "")
    kind = str(run_result.get("kind") or run_payload.get("kind") or "")
    status = str(run_result.get("status") or "")
    summary = str(run_result.get("summary") or "").strip() or None
    result_payload = run_result.get("result") if isinstance(run_result.get("result"), dict) else {}

    result["updated_at"] = finished_at
    result["last_attempt_at"] = finished_at
    result["evidence_paths"] = evidence_paths
    result["recent_evidence"] = evidence_paths
    if run_id:
        result["recent_run_refs"] = _merge_recent_refs(result.get("recent_run_refs"), run_id)

    if kind == "review":
        findings = result_payload.get("findings") if isinstance(result_payload.get("findings"), list) else []
        result["latest_review"] = {
            "run_id": run_id,
            "target": run_payload.get("target"),
            "summary": summary,
            "finished_at": finished_at,
            "findings_count": len(findings),
        }
        return result

    result["status"] = status or result.get("status") or "idle"
    result["source"] = "run_result"
    result["usable"] = status == "completed"
    result["meets_goal"] = status == "completed"
    result["failure_class"] = None if status == "completed" else _first_failed_check_name(run_result.get("checks")) or str(run_result.get("reason") or "run_failed")
    result["conclusion"] = summary
    result["current_summary"] = summary
    result["metrics"] = result_payload.get("metrics", {}) if isinstance(result_payload.get("metrics"), dict) else {}
    result["latest_run"] = {
        "run_id": run_id,
        "kind": kind,
        "status": status,
        "summary": summary,
        "finished_at": finished_at,
    }
    if status == "completed":
        result["last_closure_at"] = finished_at
    return result


def update_task_result_from_run_result(
    project_root: Path,
    *,
    run_payload: dict[str, Any],
    run_result: dict[str, Any],
    artifacts_payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    task_id = str(run_payload.get("task_id") or run_result.get("task_id") or "").strip()
    if not task_id:
        return {}
    current = load_task_result(project_root, task_id)
    next_payload = apply_run_result_to_task_result(
        current,
        run_payload=run_payload,
        run_result=run_result,
        artifacts_payload=artifacts_payload,
    )
    return upsert_task_result(project_root, task_id, next_payload)


def rebuild_task_results_from_runs(project_root: Path) -> dict[str, Any]:
    ensure_task_authority_tree(project_root)
    active_task_ids = {
        str(task.get("task_id"))
        for task in load_compiled_tasks(project_root)
        if isinstance(task.get("task_id"), str) and task.get("task_id")
    }
    rebuilt: dict[str, dict[str, Any]] = {}
    run_root = project_root / ".thoth" / "runs"
    if run_root.is_dir():
        run_dirs = sorted(
            (run_dir for run_dir in run_root.iterdir() if run_dir.is_dir()),
            key=lambda item: _read_json(item / "result.json").get("finished_at") or _read_json(item / "run.json").get("created_at") or "",
        )
        for run_dir in run_dirs:
            run_payload = _read_json(run_dir / "run.json")
            task_id = run_payload.get("task_id")
            if not isinstance(task_id, str) or task_id not in active_task_ids:
                continue
            run_result = _read_json(run_dir / "result.json")
            if not run_result:
                continue
            current = rebuilt.get(task_id, load_task_result(project_root, task_id))
            rebuilt[task_id] = apply_run_result_to_task_result(
                current,
                run_payload=run_payload,
                run_result=run_result,
                artifacts_payload=_read_json(run_dir / "artifacts.json"),
            )

    _remove_stale_task_results(project_root, active_task_ids)
    for task_id, payload in rebuilt.items():
        upsert_task_result(project_root, task_id, payload)
    return {
        "rebuilt_task_result_count": len(rebuilt),
        "active_task_count": len(active_task_ids),
        "generated_at": utc_now(),
    }
