"""Legacy task import into strict Decision/Contract/TaskResult authority."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any

from .paths import SCHEMA_VERSION
from .store import (
    _normalize_task_result,
    _normalize_string_list,
    _read_yaml,
    _slugify,
    _write_json,
    ensure_task_authority_tree,
    upsert_contract,
    upsert_decision,
    upsert_verdict,
    utc_now,
)
from .validators import VERDICT_VALUE_MAP

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
