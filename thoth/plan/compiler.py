"""Strict decision/contract/task authority for Thoth."""

from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml


SCHEMA_VERSION = 1
TASK_RESULT_SUFFIX = ".result.json"
DECISION_STATUSES = {"open", "frozen"}
CONTRACT_STATUSES = {"draft", "frozen"}
TASK_READY_STATES = {"ready", "blocked", "invalid", "imported_resolved"}
VERDICT_VALUE_MAP = {
    "confirmed": {"usable": True, "meets_goal": True, "failure_class": None},
    "rejected": {"usable": False, "meets_goal": False, "failure_class": "legacy_rejected"},
    "partial": {"usable": True, "meets_goal": False, "failure_class": "legacy_partial"},
    "needs_more_data": {"usable": None, "meets_goal": False, "failure_class": "legacy_needs_more_data"},
}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _read_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _iter_json_files(path: Path) -> list[Path]:
    if not path.is_dir():
        return []
    return sorted(candidate for candidate in path.glob("*.json") if candidate.is_file())


def _iter_task_files(path: Path) -> list[Path]:
    if not path.is_dir():
        return []
    return sorted(
        candidate
        for candidate in path.glob("*.json")
        if candidate.is_file() and not candidate.name.endswith(TASK_RESULT_SUFFIX)
    )


def _slugify(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return normalized or "item"


def _stable_hash(payload: dict[str, Any]) -> str:
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:16]


def _normalize_string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for item in value:
        if isinstance(item, str) and item.strip():
            items.append(item.strip())
    return items


def authority_root(project_root: Path) -> Path:
    return project_root / ".thoth" / "project"


def project_manifest_path(project_root: Path) -> Path:
    return authority_root(project_root) / "project.json"


def decisions_dir(project_root: Path) -> Path:
    return authority_root(project_root) / "decisions"


def contracts_dir(project_root: Path) -> Path:
    return authority_root(project_root) / "contracts"


def tasks_dir(project_root: Path) -> Path:
    return authority_root(project_root) / "tasks"


def task_result_path(project_root: Path, task_id: str) -> Path:
    return tasks_dir(project_root) / f"{task_id}{TASK_RESULT_SUFFIX}"

def _iter_task_result_files(project_root: Path) -> list[Path]:
    task_dir = tasks_dir(project_root)
    if not task_dir.is_dir():
        return []
    return sorted(
        candidate
        for candidate in task_dir.glob(f"*{TASK_RESULT_SUFFIX}")
        if candidate.is_file()
    )


def compiler_state_path(project_root: Path) -> Path:
    return authority_root(project_root) / "compiler-state.json"


def legacy_audit_path(project_root: Path) -> Path:
    return authority_root(project_root) / "legacy-audit.json"


def load_project_manifest(project_root: Path) -> dict[str, Any]:
    return _read_json(project_manifest_path(project_root))


def ensure_task_authority_tree(project_root: Path) -> None:
    for path in (decisions_dir(project_root), contracts_dir(project_root), tasks_dir(project_root)):
        path.mkdir(parents=True, exist_ok=True)
    if not compiler_state_path(project_root).exists():
        _write_json(
            compiler_state_path(project_root),
            {
                "schema_version": SCHEMA_VERSION,
                "generated_at": utc_now(),
                "summary": {
                    "decision_counts": {"open": 0, "frozen": 0},
                    "contract_counts": {"draft": 0, "frozen": 0},
                    "task_counts": {"ready": 0, "blocked": 0, "invalid": 0, "imported_resolved": 0, "total": 0},
                    "legacy_task_count": 0,
                    "decision_queue_count": 0,
                },
                "decision_queue": [],
                "blocked_task_ids": [],
                "invalid_task_ids": [],
                "problems": [],
            },
        )
    if not legacy_audit_path(project_root).exists():
        _write_json(
            legacy_audit_path(project_root),
            {
                "schema_version": SCHEMA_VERSION,
                "generated_at": utc_now(),
                "legacy_tasks": [],
                "summary": {"total": 0, "invalid": 0},
            },
        )


def load_decisions(project_root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in _iter_json_files(decisions_dir(project_root)):
        payload = _read_json(path)
        if payload:
            payload.setdefault("_path", str(path))
            rows.append(payload)
    return rows


def load_contracts(project_root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in _iter_json_files(contracts_dir(project_root)):
        payload = _read_json(path)
        if payload:
            payload.setdefault("_path", str(path))
            rows.append(payload)
    return rows


def load_compiled_tasks(project_root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in _iter_task_files(tasks_dir(project_root)):
        payload = _read_json(path)
        if payload:
            payload.setdefault("_path", str(path))
            rows.append(payload)
    return rows


def load_task_results(project_root: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for path in _iter_task_result_files(project_root):
        payload = _read_json(path)
        if payload:
            payload.setdefault("_path", str(path))
            rows.append(payload)
    return rows


def load_task_result_map(project_root: Path) -> dict[str, dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for payload in load_task_results(project_root):
        task_id = payload.get("task_id")
        if isinstance(task_id, str) and task_id and task_id not in rows:
            rows[task_id] = payload
    return rows


def load_task_result(project_root: Path, task_id: str) -> dict[str, Any]:
    return _read_json(task_result_path(project_root, task_id))


def load_verdicts(project_root: Path) -> list[dict[str, Any]]:
    return load_task_results(project_root)


def load_verdict_map(project_root: Path) -> dict[str, dict[str, Any]]:
    return load_task_result_map(project_root)


def load_task_verdict(project_root: Path, task_id: str) -> dict[str, Any]:
    return load_task_result(project_root, task_id)


def load_compiler_state(project_root: Path) -> dict[str, Any]:
    ensure_task_authority_tree(project_root)
    return _read_json(compiler_state_path(project_root))


def _validate_decision(decision: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    decision_id = decision.get("decision_id")
    if not isinstance(decision_id, str) or not decision_id.strip():
        errors.append("missing decision_id")
    status = decision.get("status")
    if status not in DECISION_STATUSES:
        errors.append(f"invalid decision status: {status}")
    if status == "frozen":
        candidate_method_ids = _normalize_string_list(decision.get("candidate_method_ids"))
        if not candidate_method_ids:
            errors.append("frozen decision requires non-empty candidate_method_ids")
        unresolved = _normalize_string_list(decision.get("unresolved_gaps"))
        if unresolved:
            errors.append("frozen decision must not contain unresolved_gaps")
    return errors


def _is_imported_terminal(contract: dict[str, Any]) -> bool:
    return (
        contract.get("source_kind") == "legacy_import"
        and contract.get("import_state") == "imported_resolved"
    )


def _validate_contract(contract: dict[str, Any], decisions_by_id: dict[str, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    contract_id = contract.get("contract_id")
    if not isinstance(contract_id, str) or not contract_id.strip():
        errors.append("missing contract_id")
    status = contract.get("status")
    if status not in CONTRACT_STATUSES:
        errors.append(f"invalid contract status: {status}")

    decision_ids = _normalize_string_list(contract.get("decision_ids"))
    if not decision_ids:
        errors.append("contract requires decision_ids")
    for decision_id in decision_ids:
        decision = decisions_by_id.get(decision_id)
        if not decision:
            errors.append(f"unknown decision_id: {decision_id}")
            continue
        if decision.get("status") != "frozen":
            errors.append(f"decision not frozen: {decision_id}")

    if status == "frozen":
        task_id = contract.get("task_id")
        if not isinstance(task_id, str) or not task_id.strip():
            errors.append("frozen contract requires task_id")
        candidate_method_id = contract.get("candidate_method_id")
        if not isinstance(candidate_method_id, str) or not candidate_method_id.strip():
            errors.append("frozen contract requires candidate_method_id")
        title = contract.get("title")
        if not isinstance(title, str) or not title.strip():
            errors.append("frozen contract requires title")
        goal_statement = contract.get("goal_statement")
        if not isinstance(goal_statement, str) or not goal_statement.strip():
            errors.append("frozen contract requires goal_statement")
        implementation_recipe = contract.get("implementation_recipe")
        if not isinstance(implementation_recipe, list) or not implementation_recipe:
            errors.append("frozen contract requires non-empty implementation_recipe")
        if not _is_imported_terminal(contract):
            eval_entrypoint = contract.get("eval_entrypoint")
            if not isinstance(eval_entrypoint, dict):
                errors.append("frozen contract requires eval_entrypoint")
            else:
                command = eval_entrypoint.get("command")
                if not isinstance(command, str) or not command.strip():
                    errors.append("eval_entrypoint.command is required")
            primary_metric = contract.get("primary_metric")
            if not isinstance(primary_metric, dict):
                errors.append("frozen contract requires primary_metric")
            else:
                for key in ("name", "direction", "threshold"):
                    if primary_metric.get(key) in (None, "", []):
                        errors.append(f"primary_metric.{key} is required")
        failure_classes = _normalize_string_list(contract.get("failure_classes"))
        if not failure_classes:
            errors.append("frozen contract requires failure_classes")
        blocking_gaps = _normalize_string_list(contract.get("blocking_gaps"))
        if blocking_gaps:
            errors.append("frozen contract must not contain blocking_gaps")
    return errors


def audit_legacy_tasks(project_root: Path) -> dict[str, Any]:
    root = project_root / ".agent-os" / "research-tasks"
    items: list[dict[str, Any]] = []
    if root.is_dir():
        for path in sorted(root.rglob("*.y*ml")):
            if path.name in {"_module.yaml", "paper-module-mapping.yaml"}:
                continue
            payload = _read_yaml(path)
            task_id = payload.get("id") if isinstance(payload.get("id"), str) else path.stem
            if not isinstance(task_id, str) or not task_id:
                task_id = path.stem
            items.append(
                {
                    "legacy_path": str(path.relative_to(project_root)),
                    "task_id": task_id,
                    "status": "invalid",
                    "reason": "legacy_yaml_execution_authority_removed",
                }
            )
    audit = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now(),
        "legacy_tasks": items,
        "summary": {
            "total": len(items),
            "invalid": len(items),
        },
    }
    _write_json(legacy_audit_path(project_root), audit)
    return audit


def _decision_queue_entry(decision: dict[str, Any], errors: list[str]) -> dict[str, Any]:
    unresolved = _normalize_string_list(decision.get("unresolved_gaps"))
    return {
        "decision_id": decision.get("decision_id"),
        "scope_id": decision.get("scope_id"),
        "status": decision.get("status"),
        "question": decision.get("question"),
        "candidate_method_ids": _normalize_string_list(decision.get("candidate_method_ids")),
        "unresolved_gaps": unresolved,
        "errors": errors,
    }


def _default_task_result(task_id: str) -> dict[str, Any]:
    return {
        "schema_version": SCHEMA_VERSION,
        "kind": "task_result",
        "task_id": task_id,
        "status": "idle",
        "source": "none",
        "usable": None,
        "meets_goal": None,
        "failure_class": None,
        "reasons": [],
        "conclusion": None,
        "current_summary": None,
        "evidence_paths": [],
        "recent_evidence": [],
        "recent_run_refs": [],
        "metrics": {},
        "latest_run": {},
        "latest_review": {},
        "last_attempt_at": None,
        "updated_at": None,
        "last_closure_at": None,
    }


def _normalize_task_result(task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    result = _default_task_result(task_id)
    result.update(payload)
    result["schema_version"] = SCHEMA_VERSION
    result["kind"] = "task_result"
    result["task_id"] = task_id
    result["reasons"] = _normalize_string_list(result.get("reasons"))
    evidence_paths = result.get("evidence_paths")
    if not isinstance(evidence_paths, list):
        result["evidence_paths"] = []
    recent_evidence = result.get("recent_evidence")
    if not isinstance(recent_evidence, list):
        result["recent_evidence"] = []
    recent_run_refs = result.get("recent_run_refs")
    if not isinstance(recent_run_refs, list):
        result["recent_run_refs"] = []
    metrics = result.get("metrics")
    if not isinstance(metrics, dict):
        result["metrics"] = {}
    if not isinstance(result.get("latest_run"), dict):
        result["latest_run"] = {}
    if not isinstance(result.get("latest_review"), dict):
        result["latest_review"] = {}
    if result.get("current_summary") in ("", []):
        result["current_summary"] = None
    return result


def upsert_task_result(project_root: Path, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_task_authority_tree(project_root)
    result = _normalize_task_result(task_id, payload)
    _write_json(task_result_path(project_root, task_id), result)
    return result


def upsert_verdict(project_root: Path, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    return upsert_task_result(project_root, task_id, payload)


def _remove_stale_task_results(project_root: Path, active_task_ids: set[str]) -> None:
    for path in _iter_task_result_files(project_root):
        payload = _read_json(path)
        task_id = payload.get("task_id")
        if not isinstance(task_id, str) or task_id not in active_task_ids:
            path.unlink()


def _normalize_legacy_task_result(task_id: str, legacy: dict[str, Any], *, snapshot_path: str) -> dict[str, Any]:
    raw = legacy.get("verdict")
    mapping = VERDICT_VALUE_MAP.get(str(raw), {"usable": None, "meets_goal": False, "failure_class": "legacy_unknown"})
    reasons: list[str] = []
    if isinstance(legacy.get("failure_analysis"), str) and legacy.get("failure_analysis").strip():
        reasons.append(legacy["failure_analysis"].strip())
    conclusion = legacy.get("conclusion_text")
    now = utc_now()
    return _normalize_task_result(
        task_id,
        {
            "status": "completed" if mapping["meets_goal"] else "failed",
            "source": "legacy_import",
            "legacy_verdict": raw,
            "usable": mapping["usable"],
            "meets_goal": mapping["meets_goal"],
            "failure_class": mapping["failure_class"],
            "reasons": reasons,
            "conclusion": conclusion if isinstance(conclusion, str) and conclusion.strip() else None,
            "current_summary": conclusion if isinstance(conclusion, str) and conclusion.strip() else None,
            "evidence_paths": legacy.get("evidence_paths", []),
            "recent_evidence": legacy.get("evidence_paths", []),
            "metrics": legacy.get("metrics", {}),
            "snapshot_path": snapshot_path,
            "updated_at": now,
            "last_attempt_at": now,
            "last_closure_at": now,
        },
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


def _primary_metric_from_legacy(task: dict[str, Any]) -> dict[str, Any]:
    for phase_name in ("experiment", "conclusion", "method_design", "survey"):
        phase = task.get("phases", {}).get(phase_name, {})
        criteria = phase.get("criteria")
        if isinstance(criteria, dict) and criteria.get("metric") not in (None, ""):
            direction = criteria.get("direction")
            normalized_direction = "gte"
            if direction == "lower_is_better":
                normalized_direction = "lte"
            return {
                "name": criteria.get("metric"),
                "direction": normalized_direction,
                "threshold": criteria.get("threshold"),
                "unit": criteria.get("unit"),
            }
    return {}


def _deliverables_from_legacy(task: dict[str, Any]) -> list[dict[str, Any]]:
    deliverables: list[dict[str, Any]] = []
    phases = task.get("phases", {})
    if not isinstance(phases, dict):
        return deliverables
    for phase_name in ("survey", "method_design", "experiment", "conclusion"):
        phase = phases.get(phase_name, {})
        if not isinstance(phase, dict):
            continue
        rows = phase.get("deliverables")
        if not isinstance(rows, list):
            continue
        for row in rows:
            if isinstance(row, dict):
                deliverables.append(dict(row))
    return deliverables


def _legacy_can_auto_freeze(task: dict[str, Any]) -> tuple[bool, list[str]]:
    missing: list[str] = []
    if not isinstance(task.get("title"), str) or not task.get("title", "").strip():
        missing.append("missing title")
    hypothesis = task.get("hypothesis")
    if not isinstance(hypothesis, str) or not hypothesis.strip():
        missing.append("missing hypothesis")
    primary_metric = _primary_metric_from_legacy(task)
    if not primary_metric.get("name"):
        missing.append("missing primary metric")
    if primary_metric.get("threshold") in (None, "", []):
        missing.append("missing metric threshold")
    if not _deliverables_from_legacy(task):
        missing.append("missing deliverables")
    return not missing, missing


def import_legacy_tasks(project_root: Path, migration_dir: Path) -> dict[str, Any]:
    ensure_task_authority_tree(project_root)
    legacy_root = project_root / ".agent-os" / "research-tasks"
    import_root = migration_dir / "legacy-import"
    tasks_root = import_root / "tasks"
    tasks_root.mkdir(parents=True, exist_ok=True)

    decisions_written = 0
    contracts_written = 0
    task_results_written = 0
    imported_rows: list[dict[str, Any]] = []

    if not legacy_root.is_dir():
        index = {
            "schema_version": SCHEMA_VERSION,
            "generated_at": utc_now(),
            "imported_task_count": 0,
            "decisions_written": 0,
            "contracts_written": 0,
            "task_results_written": 0,
            "tasks": [],
        }
        _write_json(import_root / "index.json", index)
        return index

    for path in sorted(legacy_root.rglob("*.y*ml")):
        if path.name in {"_module.yaml", "paper-module-mapping.yaml"}:
            continue
        payload = _read_yaml(path)
        if not payload:
            continue

        task_id = str(payload.get("id") or path.stem).strip()
        direction = str(payload.get("direction") or path.parent.parent.name or "general").strip() or "general"
        module = str(payload.get("module") or path.parent.name or "imported").strip() or "imported"
        title = str(payload.get("title") or task_id).strip() or task_id
        hypothesis = str(payload.get("hypothesis") or title).strip() or title
        primary_metric = _primary_metric_from_legacy(payload)
        deliverables = _deliverables_from_legacy(payload)
        can_freeze, missing_fields = _legacy_can_auto_freeze(payload)
        results = payload.get("results") if isinstance(payload.get("results"), dict) else {}
        has_formal_legacy_verdict = isinstance(results.get("verdict"), str) and bool(_normalize_string_list(results.get("evidence_paths")))

        task_snapshot_rel = f"legacy-import/tasks/{task_id}.json"
        snapshot_payload = {
            "schema_version": SCHEMA_VERSION,
            "kind": "legacy_import_snapshot",
            "task_id": task_id,
            "legacy_path": str(path.relative_to(project_root)),
            "imported_at": utc_now(),
            "legacy_task": payload,
            "derived": {
                "direction": direction,
                "module": module,
                "title": title,
                "goal_statement": hypothesis,
                "primary_metric": primary_metric,
                "deliverable_count": len(deliverables),
            },
        }
        _write_json(tasks_root / f"{task_id}.json", snapshot_payload)

        decision_id = f"DEC-import-{_slugify(task_id)}"
        contract_id = f"CTR-import-{_slugify(task_id)}"
        candidate_method_id = f"legacy-import::{task_id}"

        decision = {
            "schema_version": SCHEMA_VERSION,
            "kind": "decision",
            "decision_id": decision_id,
            "scope_id": f"legacy-import::{module}",
            "question": f"Imported legacy task contract for {task_id}",
            "candidate_method_ids": [candidate_method_id],
            "selected_values": {"candidate_method_id": candidate_method_id},
            "status": "frozen",
            "unresolved_gaps": [],
            "source": "legacy_import",
            "legacy_path": str(path.relative_to(project_root)),
            "created_at": utc_now(),
            "updated_at": utc_now(),
        }
        upsert_decision(project_root, decision)
        decisions_written += 1

        import_state = "blocked"
        contract_status = "draft"
        blocking_gaps: list[str] = []
        if not can_freeze:
            blocking_gaps.extend(missing_fields)
        elif has_formal_legacy_verdict:
            import_state = "imported_resolved"
            contract_status = "frozen"
        else:
            blocking_gaps.append("missing explicit eval_entrypoint.command from legacy import")

        contract = {
            "schema_version": SCHEMA_VERSION,
            "kind": "contract",
            "contract_id": contract_id,
            "task_id": task_id,
            "scope_id": f"legacy-import::{module}",
            "direction": direction,
            "module": module,
            "title": title,
            "decision_ids": [decision_id],
            "candidate_method_id": candidate_method_id,
            "goal_statement": hypothesis,
            "implementation_recipe": [
                f"Review legacy import snapshot at .thoth/migrations/{migration_dir.name}/{task_snapshot_rel}.",
                "Re-freeze a runnable contract explicitly before executing run/loop.",
            ],
            "baseline_ids": [],
            "eval_entrypoint": {},
            "primary_metric": primary_metric,
            "failure_classes": ["legacy_import_blocked", "legacy_rejected", "legacy_partial", "legacy_needs_more_data"],
            "acceptance_contract": {
                "source": "legacy_import",
                "snapshot_path": f".thoth/migrations/{migration_dir.name}/{task_snapshot_rel}",
                "legacy_verdict": results.get("verdict"),
            },
            "status": contract_status,
            "blocking_gaps": blocking_gaps,
            "source_kind": "legacy_import",
            "import_state": import_state,
            "legacy_snapshot_path": f".thoth/migrations/{migration_dir.name}/{task_snapshot_rel}",
            "legacy_depends_on": payload.get("depends_on", []),
            "legacy_data_requirements": payload.get("data_requirements", {}),
            "legacy_results": results,
            "legacy_deliverables": deliverables,
            "created_at": utc_now(),
            "updated_at": utc_now(),
        }
        upsert_contract(project_root, contract)
        contracts_written += 1

        if import_state == "imported_resolved":
            upsert_verdict(
                project_root,
                task_id,
                _normalize_legacy_task_result(
                    task_id,
                    results,
                    snapshot_path=f".thoth/migrations/{migration_dir.name}/{task_snapshot_rel}",
                ),
            )
            task_results_written += 1

        imported_rows.append(
            {
                "task_id": task_id,
                "legacy_path": str(path.relative_to(project_root)),
                "decision_id": decision_id,
                "contract_id": contract_id,
                "snapshot_path": f".thoth/migrations/{migration_dir.name}/{task_snapshot_rel}",
                "import_state": import_state,
                "status": contract_status,
                "blocking_gaps": blocking_gaps,
                "formal_legacy_verdict": results.get("verdict"),
            }
        )

    index = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now(),
        "imported_task_count": len(imported_rows),
        "decisions_written": decisions_written,
        "contracts_written": contracts_written,
        "task_results_written": task_results_written,
        "tasks": imported_rows,
    }
    _write_json(import_root / "index.json", index)
    return index


def compile_task_authority(project_root: Path) -> dict[str, Any]:
    ensure_task_authority_tree(project_root)
    decisions = load_decisions(project_root)
    decisions_by_id = {
        row.get("decision_id"): row
        for row in decisions
        if isinstance(row.get("decision_id"), str) and row.get("decision_id")
    }
    contracts = load_contracts(project_root)
    legacy_audit = audit_legacy_tasks(project_root)
    task_result_map = load_task_result_map(project_root)

    generated_tasks: dict[str, dict[str, Any]] = {}
    problems: list[str] = []
    decision_queue: list[dict[str, Any]] = []
    blocked_task_ids: list[str] = []
    invalid_task_ids: list[str] = []

    decision_counts = {"open": 0, "frozen": 0}
    contract_counts = {"draft": 0, "frozen": 0}
    task_counts = {"ready": 0, "blocked": 0, "invalid": 0, "imported_resolved": 0, "total": 0}

    for decision in decisions:
        status = decision.get("status")
        if status in decision_counts:
            decision_counts[status] += 1
        errors = _validate_decision(decision)
        unresolved = _normalize_string_list(decision.get("unresolved_gaps"))
        if errors or status != "frozen" or unresolved:
            decision_queue.append(_decision_queue_entry(decision, errors))
        for error in errors:
            problems.append(f"decision {decision.get('decision_id', '?')}: {error}")

    for contract in contracts:
        status = contract.get("status")
        if status in contract_counts:
            contract_counts[status] += 1

        contract_id = str(contract.get("contract_id", "")).strip() or "unknown-contract"
        task_id = str(contract.get("task_id", "")).strip() or f"task-{_slugify(contract_id)}"
        errors = _validate_contract(contract, decisions_by_id)
        ready_state = "ready"
        blocking_reason = ""
        runnable = True

        if _is_imported_terminal(contract) and not errors:
            ready_state = "imported_resolved"
            runnable = False
        elif errors:
            if status == "frozen":
                ready_state = "invalid"
                invalid_task_ids.append(task_id)
                blocking_reason = "; ".join(errors)
            else:
                ready_state = "blocked"
                blocked_task_ids.append(task_id)
                blocking_reason = "; ".join(errors)
            runnable = False
        elif status != "frozen":
            ready_state = "blocked"
            blocked_task_ids.append(task_id)
            blocking_reason = "; ".join(_normalize_string_list(contract.get("blocking_gaps"))) or "contract is still draft"
            runnable = False

        result_path = task_result_path(project_root, task_id)
        payload = {
            "schema_version": SCHEMA_VERSION,
            "kind": "task",
            "task_id": task_id,
            "id": task_id,
            "contract_id": contract_id,
            "scope_id": contract.get("scope_id"),
            "title": contract.get("title") or task_id,
            "direction": contract.get("direction", "general"),
            "module": contract.get("module", "strict"),
            "candidate_method_id": contract.get("candidate_method_id"),
            "decision_ids": _normalize_string_list(contract.get("decision_ids")),
            "ready_state": ready_state,
            "blocking_reason": blocking_reason,
            "runnable": runnable,
            "source_kind": contract.get("source_kind", "compiled"),
            "import_state": contract.get("import_state"),
            "goal_statement": contract.get("goal_statement"),
            "implementation_recipe": contract.get("implementation_recipe", []),
            "baseline_ids": _normalize_string_list(contract.get("baseline_ids")),
            "eval_entrypoint": contract.get("eval_entrypoint", {}),
            "primary_metric": contract.get("primary_metric", {}),
            "failure_classes": _normalize_string_list(contract.get("failure_classes")),
            "acceptance_contract": contract.get("acceptance_contract", {}),
            "review_binding": contract.get("review_binding", {}),
            "legacy_snapshot_path": contract.get("legacy_snapshot_path"),
            "depends_on": contract.get("legacy_depends_on", []),
            "data_requirements": contract.get("legacy_data_requirements", {}),
            "deliverables": contract.get("legacy_deliverables", []),
            "generated_at": utc_now(),
            "inputs_hash": _stable_hash(
                {
                    "decision_ids": _normalize_string_list(contract.get("decision_ids")),
                    "candidate_method_id": contract.get("candidate_method_id"),
                    "goal_statement": contract.get("goal_statement"),
                    "implementation_recipe": contract.get("implementation_recipe", []),
                    "eval_entrypoint": contract.get("eval_entrypoint", {}),
                    "primary_metric": contract.get("primary_metric", {}),
                    "failure_classes": _normalize_string_list(contract.get("failure_classes")),
                    "source_kind": contract.get("source_kind"),
                    "import_state": contract.get("import_state"),
                }
            ),
            "task_result_ref": str(result_path.relative_to(project_root)),
            "legacy_projection": {
                "legacy_yaml_authority_allowed": False,
                "legacy_task_count": legacy_audit["summary"]["total"],
            },
        }
        generated_tasks[task_id] = payload
        task_counts[ready_state] += 1
        task_counts["total"] += 1
        for error in errors:
            problems.append(f"contract {contract_id}: {error}")

    for path in _iter_task_files(tasks_dir(project_root)):
        task_payload = _read_json(path)
        task_id = task_payload.get("task_id")
        if not isinstance(task_id, str) or task_id not in generated_tasks:
            path.unlink()
    for task_id, payload in generated_tasks.items():
        _write_json(tasks_dir(project_root) / f"{task_id}.json", payload)

    active_task_ids = set(generated_tasks)
    _remove_stale_task_results(project_root, active_task_ids)
    task_result_map = {task_id: task_result_map[task_id] for task_id in active_task_ids if task_id in task_result_map}

    for task_id, item in task_result_map.items():
        if generated_tasks.get(task_id, {}).get("ready_state") != "imported_resolved" and item.get("source") == "legacy_import":
            problems.append(f"task {task_id}: legacy_import verdict attached to non-imported_resolved task")
        if not _normalize_string_list(item.get("evidence_paths")) and item.get("source") not in {"none", "acceptance_pending"}:
            problems.append(f"task {task_id}: verdict missing evidence_paths")

    for item in legacy_audit.get("legacy_tasks", []):
        problems.append(f"legacy task {item.get('task_id')}: {item.get('reason')}")

    compiler_state = {
        "schema_version": SCHEMA_VERSION,
        "generated_at": utc_now(),
        "summary": {
            "decision_counts": decision_counts,
            "contract_counts": contract_counts,
            "task_counts": task_counts,
            "legacy_task_count": legacy_audit["summary"]["total"],
            "decision_queue_count": len(decision_queue),
            "task_result_count": len(task_result_map),
        },
        "decision_queue": decision_queue,
        "blocked_task_ids": sorted(set(blocked_task_ids)),
        "invalid_task_ids": sorted(set(invalid_task_ids)),
        "problems": problems,
    }
    _write_json(compiler_state_path(project_root), compiler_state)
    return compiler_state


def load_task_for_execution(project_root: Path, task_id: str, *, require_ready: bool = True) -> dict[str, Any]:
    compile_task_authority(project_root)
    payload = _read_json(tasks_dir(project_root) / f"{task_id}.json")
    if not payload:
        raise FileNotFoundError(f"Strict task {task_id} not found in .thoth/project/tasks")
    ready_state = payload.get("ready_state")
    if require_ready and ready_state != "ready":
        reason = payload.get("blocking_reason") or f"task is {ready_state}"
        raise ValueError(f"Strict task {task_id} is not executable: {reason}")
    if require_ready and payload.get("runnable") is not True:
        raise ValueError(f"Strict task {task_id} is not executable: task is non-runnable")
    return payload


def upsert_decision(project_root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_task_authority_tree(project_root)
    payload = dict(payload)
    payload.setdefault("schema_version", SCHEMA_VERSION)
    payload.setdefault("kind", "decision")
    payload.setdefault("status", "open")
    payload.setdefault("host", "codex")
    payload.setdefault("created_at", utc_now())
    payload["updated_at"] = utc_now()
    decision_id = payload.get("decision_id")
    if not isinstance(decision_id, str) or not decision_id.strip():
        question = payload.get("question") if isinstance(payload.get("question"), str) else "discussion"
        decision_id = f"DEC-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{_slugify(question)[:24]}"
        payload["decision_id"] = decision_id
    _write_json(decisions_dir(project_root) / f"{decision_id}.json", payload)
    return payload


def upsert_contract(project_root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    ensure_task_authority_tree(project_root)
    payload = dict(payload)
    payload.setdefault("schema_version", SCHEMA_VERSION)
    payload.setdefault("kind", "contract")
    payload.setdefault("status", "draft")
    payload.setdefault("created_at", utc_now())
    payload["updated_at"] = utc_now()
    contract_id = payload.get("contract_id")
    if not isinstance(contract_id, str) or not contract_id.strip():
        title = payload.get("title") if isinstance(payload.get("title"), str) else "contract"
        contract_id = f"CTR-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}-{_slugify(title)[:24]}"
        payload["contract_id"] = contract_id
    _write_json(contracts_dir(project_root) / f"{contract_id}.json", payload)
    return payload


def create_discussion_placeholder(project_root: Path, content: str, *, host: str = "codex") -> dict[str, Any]:
    summary = content.strip() or "discussion"
    return upsert_decision(
        project_root,
        {
            "question": summary,
            "scope_id": "general",
            "candidate_method_ids": [],
            "selected_values": {},
            "status": "open",
            "unresolved_gaps": [
                "candidate method universe not frozen",
                "implementation contract not frozen",
                "task cannot be generated until decisions are resolved",
            ],
            "host": host,
            "source": "discuss",
        },
    )


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
