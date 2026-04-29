"""Controller services for loop, orchestration, and auto queues."""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

from thoth.objects import Store, flatten_work_item, utc_now
from thoth.plan.store import load_work_for_execution


def _ready_work_ref(project_root: Path, work_id: str) -> dict[str, Any]:
    work = load_work_for_execution(project_root, work_id, require_ready=True)
    return {
        "work_id": work["work_id"],
        "revision": work["revision"],
        "title": work.get("title"),
    }


def _dependency_work_ids(store: Store, work_id: str, requested: set[str]) -> set[str]:
    deps: set[str] = set()
    for dep in store.dependencies("work_item", work_id):
        dep_id = dep.get("object_id")
        if isinstance(dep_id, str) and dep_id in requested:
            deps.add(dep_id)
    return deps


def _dag_batches(project_root: Path, work_ids: list[str]) -> list[list[str]]:
    store = Store(project_root)
    requested = set(work_ids)
    remaining = set(work_ids)
    completed: set[str] = set()
    batches: list[list[str]] = []
    while remaining:
        batch = sorted(
            work_id
            for work_id in remaining
            if _dependency_work_ids(store, work_id, requested).issubset(completed)
        )
        if not batch:
            raise ValueError("orchestration dependency cycle or missing dependency batch")
        batches.append(batch)
        completed.update(batch)
        remaining.difference_update(batch)
    return batches


def create_orchestration_controller(
    project_root: Path,
    *,
    work_ids: list[str],
    host: str,
    executor: str,
) -> dict[str, Any]:
    if not work_ids:
        raise ValueError("orchestration requires at least one --work-id")
    refs = [_ready_work_ref(project_root, work_id) for work_id in work_ids]
    controller_id = f"controller-orchestration-{uuid.uuid4().hex[:12]}"
    batches = _dag_batches(project_root, [ref["work_id"] for ref in refs])
    return Store(project_root).create(
        kind="controller",
        object_id=controller_id,
        status="queued",
        title="Orchestration controller",
        summary=f"Queued orchestration for {len(refs)} work items",
        source="orchestration",
        payload={
            "controller_type": "orchestration",
            "host": host,
            "executor": executor,
            "work_refs": refs,
            "batches": batches,
            "cursor": {"batch_index": 0, "active_run_ids": [], "completed_work_ids": []},
            "created_at": utc_now(),
        },
    )


def create_auto_controller(
    project_root: Path,
    *,
    work_ids: list[str],
    mode: str,
    host: str,
    executor: str,
) -> dict[str, Any]:
    if mode not in {"run", "loop"}:
        raise ValueError("auto mode must be run or loop")
    if not work_ids:
        raise ValueError("auto requires at least one --work-id")
    refs = [_ready_work_ref(project_root, work_id) for work_id in work_ids]
    controller_id = f"controller-auto-{uuid.uuid4().hex[:12]}"
    return Store(project_root).create(
        kind="controller",
        object_id=controller_id,
        status="queued",
        title="Auto queue controller",
        summary=f"Queued {len(refs)} work items for {mode}",
        source="auto",
        payload={
            "controller_type": "auto",
            "mode": mode,
            "host": host,
            "executor": executor,
            "queue": refs,
            "cursor": {"index": 0, "active_run_id": None, "completed_work_ids": []},
            "created_at": utc_now(),
        },
    )
