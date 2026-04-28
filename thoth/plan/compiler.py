"""Decision -> Contract -> Task compiler for strict Thoth authority."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .legacy_import import _normalize_legacy_task_result
from .paths import SCHEMA_VERSION, compiler_state_path, legacy_audit_path, task_result_path, tasks_dir
from .store import (
    _normalize_string_list,
    _iter_task_files,
    _read_json,
    _read_yaml,
    _remove_stale_task_results,
    _stable_hash,
    _write_json,
    ensure_task_authority_tree,
    load_contracts,
    load_decisions,
    load_task_result_map,
    utc_now,
)
from .validators import _is_imported_terminal, _validate_contract, _validate_decision
from thoth.run.phases import normalize_runtime_contract, normalize_validate_output_schema

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
            "runtime_contract": normalize_runtime_contract(contract.get("runtime_contract")),
            "validate_output_schema": normalize_validate_output_schema(contract.get("validate_output_schema")),
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
                    "runtime_contract": normalize_runtime_contract(contract.get("runtime_contract")),
                    "validate_output_schema": normalize_validate_output_schema(contract.get("validate_output_schema")),
                    "review_expectation": contract.get("review_expectation"),
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
        if isinstance(contract.get("review_expectation"), dict):
            payload["review_expectation"] = contract.get("review_expectation")
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
            problems.append(f"task {task_id}: legacy_import task_result attached to non-imported_resolved task")
        if not _normalize_string_list(item.get("evidence_paths")) and item.get("source") not in {"none", "acceptance_pending"}:
            problems.append(f"task {task_id}: task_result missing evidence_paths")

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
