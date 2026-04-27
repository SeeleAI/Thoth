"""Semantic validators for strict project authority records."""

from __future__ import annotations

from typing import Any

from .store import _normalize_string_list
from thoth.run.phases import normalize_runtime_contract

DECISION_STATUSES = {"open", "frozen"}
CONTRACT_STATUSES = {"draft", "frozen"}
TASK_READY_STATES = {"ready", "blocked", "invalid", "imported_resolved"}
VERDICT_VALUE_MAP = {
    "confirmed": {"usable": True, "meets_goal": True, "failure_class": None},
    "rejected": {"usable": False, "meets_goal": False, "failure_class": "legacy_rejected"},
    "partial": {"usable": True, "meets_goal": False, "failure_class": "legacy_partial"},
    "needs_more_data": {"usable": None, "meets_goal": False, "failure_class": "legacy_needs_more_data"},
}

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
            runtime_contract = contract.get("runtime_contract")
            if runtime_contract not in (None, {}) and not isinstance(runtime_contract, dict):
                errors.append("runtime_contract must be an object when provided")
            else:
                loop = normalize_runtime_contract(runtime_contract).get("loop", {})
                if not isinstance(loop.get("max_iterations"), int) or int(loop["max_iterations"]) <= 0:
                    errors.append("runtime_contract.loop.max_iterations must be a positive integer")
                if not isinstance(loop.get("max_runtime_seconds"), int) or int(loop["max_runtime_seconds"]) <= 0:
                    errors.append("runtime_contract.loop.max_runtime_seconds must be a positive integer")
            validate_output_schema = contract.get("validate_output_schema")
            if not isinstance(validate_output_schema, dict) or not validate_output_schema:
                errors.append("frozen contract requires validate_output_schema")
            elif validate_output_schema.get("type") != "object":
                errors.append("validate_output_schema.type must be object")
            elif not _normalize_string_list(validate_output_schema.get("required")):
                errors.append("validate_output_schema.required must list required fields")
        failure_classes = _normalize_string_list(contract.get("failure_classes"))
        if not failure_classes:
            errors.append("frozen contract requires failure_classes")
        blocking_gaps = _normalize_string_list(contract.get("blocking_gaps"))
        if blocking_gaps:
            errors.append("frozen contract must not contain blocking_gaps")
    return errors
