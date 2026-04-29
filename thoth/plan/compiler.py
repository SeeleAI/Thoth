"""Object graph summarizer for strict Thoth authority.

The legacy planning compiler has been removed from the authority path.
`compile_task_authority` now validates and summarizes the canonical
`.thoth/objects` graph, then writes a read-only docs view.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from thoth.objects import summarize_object_graph, utc_now

from .paths import SCHEMA_VERSION, compiler_state_path, legacy_audit_path
from .store import _read_yaml, _write_json, ensure_work_authority_tree


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


def compile_task_authority(project_root: Path) -> dict[str, Any]:
    ensure_work_authority_tree(project_root)
    legacy_audit = audit_legacy_tasks(project_root)
    graph = summarize_object_graph(project_root)
    problems = list(graph.get("problems", []))
    for item in legacy_audit.get("legacy_tasks", []):
        problems.append(f"legacy task {item.get('task_id')}: {item.get('reason')}")
    graph["summary"]["legacy_task_count"] = legacy_audit["summary"]["total"]
    graph["problems"] = problems
    _write_json(compiler_state_path(project_root), graph)
    return graph
