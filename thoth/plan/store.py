"""Read/write store for Decision, Contract, Task, and TaskResult authority."""

from __future__ import annotations

import json
import hashlib
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

from .paths import (
    SCHEMA_VERSION,
    TASK_RESULT_SUFFIX,
    authority_root,
    compiler_state_path,
    contracts_dir,
    decisions_dir,
    legacy_audit_path,
    project_manifest_path,
    task_result_path,
    tasks_dir,
)

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


def _iter_task_result_files(project_root: Path) -> list[Path]:
    task_dir = tasks_dir(project_root)
    if not task_dir.is_dir():
        return []
    return sorted(
        candidate
        for candidate in task_dir.glob(f"*{TASK_RESULT_SUFFIX}")
        if candidate.is_file()
    )


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


def load_compiler_state(project_root: Path) -> dict[str, Any]:
    ensure_task_authority_tree(project_root)
    return _read_json(compiler_state_path(project_root))


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


def _remove_stale_task_results(project_root: Path, active_task_ids: set[str]) -> None:
    for path in _iter_task_result_files(project_root):
        payload = _read_json(path)
        task_id = payload.get("task_id")
        if not isinstance(task_id, str) or task_id not in active_task_ids:
            path.unlink()


def load_task_for_execution(project_root: Path, task_id: str, *, require_ready: bool = True) -> dict[str, Any]:
    from .compiler import compile_task_authority

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


def _tokenize_task_query(value: str) -> list[str]:
    return [token for token in re.findall(r"[a-zA-Z0-9]+", value.lower()) if token]


def _task_search_text(task: dict[str, Any]) -> str:
    parts: list[str] = []
    for field in (
        "task_id",
        "title",
        "goal_statement",
        "module",
        "direction",
        "contract_id",
        "candidate_method_id",
        "blocking_reason",
    ):
        value = task.get(field)
        if isinstance(value, str) and value.strip():
            parts.append(value.strip())
    for field in ("decision_ids", "failure_classes", "baseline_ids"):
        values = task.get(field)
        if isinstance(values, list):
            parts.extend(str(item).strip() for item in values if isinstance(item, str) and item.strip())
    return " ".join(parts)


def suggest_tasks_for_query(project_root: Path, query: str, *, limit: int = 3) -> list[dict[str, Any]]:
    from .compiler import compile_task_authority

    compile_task_authority(project_root)
    tasks = load_compiled_tasks(project_root)
    normalized_query = " ".join(query.strip().lower().split())
    query_tokens = _tokenize_task_query(normalized_query)
    scored: list[tuple[float, dict[str, Any]]] = []
    for task in tasks:
        ready_state = str(task.get("ready_state") or "")
        runnable = task.get("runnable") is True
        text = _task_search_text(task)
        haystack = text.lower()
        text_tokens = set(_tokenize_task_query(text))
        score = 0.0
        if ready_state == "ready":
            score += 3.0
        elif runnable:
            score += 1.5
        if normalized_query:
            if normalized_query in haystack:
                score += 8.0
            for token in query_tokens:
                if token in text_tokens:
                    score += 3.0
                elif token in haystack:
                    score += 1.0
        scored.append((score, task))
    scored.sort(
        key=lambda item: (
            item[0],
            1 if str(item[1].get("ready_state") or "") == "ready" else 0,
            1 if item[1].get("runnable") is True else 0,
            str(item[1].get("title") or ""),
            str(item[1].get("task_id") or ""),
        ),
        reverse=True,
    )
    picks = [task for _score, task in scored[: max(0, limit)]]
    return [
        {
            "task_id": str(task.get("task_id") or ""),
            "title": str(task.get("title") or task.get("task_id") or ""),
            "ready_state": str(task.get("ready_state") or ""),
            "module": str(task.get("module") or ""),
            "direction": str(task.get("direction") or ""),
            "goal_statement": str(task.get("goal_statement") or ""),
        }
        for task in picks
        if str(task.get("task_id") or "").strip()
    ]


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
