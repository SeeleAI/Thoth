"""Audit-first init and sync orchestration."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from thoth.plan.compiler import compile_task_authority
from thoth.plan.results import rebuild_work_results_from_runs
from thoth.plan.store import load_project_manifest

from .audit import (
    LEGACY_CONFIG_FILE,
    _detect_language,
    _discover_directions,
    _read_yaml,
    audit_repository_state,
    detect_claude_bridge_permission,
)
from .generators import (
    DEFAULT_PHASES,
    _write_dashboard_locale_selection,
    generate_agent_os_docs,
    generate_codex_hook_projection,
    generate_dashboard,
    generate_host_projections,
    generate_milestones,
    generate_pre_commit_config,
    generate_scripts,
    generate_tests,
    generate_thoth_runtime,
)
from .migration import _backup_existing_path, _displace_existing_path, _managed_directory_conflicts, _remove_existing_path, _write_source_map
from .preview import build_init_preview

def _utc_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _normalize_config(requested: dict[str, Any], project_dir: Path, audit: dict[str, Any]) -> dict[str, Any]:
    legacy_config = _read_yaml(project_dir / LEGACY_CONFIG_FILE)
    manifest = load_project_manifest(project_dir)
    project_config = manifest.get("project", {})
    dashboard_config = manifest.get("dashboard", {})
    research_config = legacy_config.get("research", {})
    legacy_project_config = legacy_config.get("project", {})
    legacy_dashboard_config = legacy_config.get("dashboard", {})

    config = dict(requested)
    config.setdefault("name", project_config.get("name") or legacy_project_config.get("name") or audit.get("readme", {}).get("title") or project_dir.name)
    config.setdefault("description", project_config.get("description") or legacy_project_config.get("description") or audit.get("readme", {}).get("summary") or "")
    config.setdefault("language", project_config.get("language") or legacy_project_config.get("language") or audit.get("inferred", {}).get("language") or "zh")
    config.setdefault("directions", project_config.get("directions") or research_config.get("directions") or audit.get("inferred", {}).get("directions") or [])
    config.setdefault("phases", project_config.get("phases") or research_config.get("phases") or DEFAULT_PHASES)
    config.setdefault("port", dashboard_config.get("port", legacy_dashboard_config.get("port", 8501)))
    config.setdefault("theme", dashboard_config.get("theme", legacy_dashboard_config.get("theme", "warm-bear")))

    directions = config["directions"]
    if isinstance(directions, str):
        directions = [d.strip() for d in directions.split(",") if d.strip()]
    config["directions"] = directions
    return config


def initialize_project(config: dict[str, Any], project_dir: Path) -> dict[str, Any]:
    project_dir = project_dir.resolve()
    audit = audit_repository_state(project_dir)
    normalized = _normalize_config(config or {}, project_dir, audit)
    preview = build_init_preview(project_dir, audit)
    migration_id = f"mig-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    preview["migration_id"] = migration_id

    migrations_root = project_dir / ".thoth" / "migrations"
    migrations_root.mkdir(parents=True, exist_ok=True)
    migration_dir = migrations_root / migration_id
    migration_dir.mkdir(parents=True, exist_ok=True)

    (migration_dir / "audit.json").write_text(
        json.dumps(audit, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (migration_dir / "preview.json").write_text(
        json.dumps(preview, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    backups: list[dict[str, Any]] = []
    for relpath in sorted(set(preview["update"] + preview.get("remove", []))):
        source = project_dir / relpath
        if not source.exists():
            continue
        _backup_existing_path(project_dir, migration_dir, relpath)
        backups.append(
            {
                "relative_path": relpath,
                "backup_path": str((Path("backup") / relpath).as_posix()),
            }
        )

    displaced_conflicts: list[dict[str, Any]] = []
    for relpath in _managed_directory_conflicts(project_dir):
        displaced_path = _displace_existing_path(project_dir, migration_dir, relpath)
        if displaced_path:
            displaced_conflicts.append(
                {
                    "relative_path": relpath,
                    "displaced_path": displaced_path,
                }
            )

    (project_dir / "reports").mkdir(exist_ok=True)
    generate_thoth_runtime(normalized, project_dir)
    generate_dashboard(normalized, project_dir)
    generate_pre_commit_config(normalized, project_dir)
    generate_scripts(normalized, project_dir)
    generate_host_projections(normalized, project_dir)
    generate_codex_hook_projection(project_dir)
    generate_tests(normalized, project_dir)

    for relpath in preview.get("remove", []):
        _remove_existing_path(project_dir, relpath)

    _write_source_map(project_dir, audit, preview)
    compile_task_authority(project_dir)
    rebuild_work_results_from_runs(project_dir)

    rollback_payload = {
        "schema_version": 1,
        "migration_id": migration_id,
        "created_at": preview["generated_at"],
        "mode": preview["mode"],
        "created_paths": preview["create"],
        "removed_paths": preview.get("remove", []),
        "backup_targets": backups,
        "displaced_conflicts": displaced_conflicts,
    }
    (migration_dir / "rollback.json").write_text(
        json.dumps(rollback_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    apply_payload = {
        "schema_version": 1,
        "migration_id": migration_id,
        "applied_at": _utc_iso(),
        "mode": preview["mode"],
        "status": "applied",
        "created_count": len(preview["create"]),
        "updated_count": len(preview["update"]),
        "preserved_count": len(preview["preserve"]),
        "removed_count": len(preview.get("remove", [])),
        "displaced_conflict_count": len(displaced_conflicts),
    }
    (migration_dir / "apply.json").write_text(
        json.dumps(apply_payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return {
        "migration_id": migration_id,
        "mode": preview["mode"],
        "config": normalized,
        "audit": audit,
        "preview": preview,
        "apply": apply_payload,
        "legacy_import": {"status": "disabled", "reason": "legacy task/contract runtime import removed"},
        "claude_permissions": detect_claude_bridge_permission(project_dir),
        "displaced_conflicts": displaced_conflicts,
    }


def sync_project_layer(project_dir: Path) -> None:
    """Regenerate project-local projections from canonical authority/config."""
    manifest = load_project_manifest(project_dir)
    project = manifest.get("project", {}) if isinstance(manifest, dict) else {}
    dashboard = manifest.get("dashboard", {}) if isinstance(manifest, dict) else {}
    if not project:
        return
    normalized = {
        "name": project.get("name", project_dir.name),
        "description": project.get("description", ""),
        "language": project.get("language", "zh"),
        "directions": project.get("directions", []),
        "phases": project.get("phases", DEFAULT_PHASES),
        "port": dashboard.get("port", 8501),
        "theme": dashboard.get("theme", "warm-bear"),
    }
    generate_thoth_runtime(normalized, project_dir)
    _write_dashboard_locale_selection(normalized, project_dir)
    generate_host_projections(normalized, project_dir)
    generate_codex_hook_projection(project_dir)
    audit = audit_repository_state(project_dir)
    preview = build_init_preview(project_dir, audit)
    _write_source_map(project_dir, audit, preview)
    compile_task_authority(project_dir)
