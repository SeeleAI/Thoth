"""Path helpers for strict Thoth project authority."""

from __future__ import annotations

from pathlib import Path

SCHEMA_VERSION = 1
TASK_RESULT_SUFFIX = ".result.json"

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


def compiler_state_path(project_root: Path) -> Path:
    return authority_root(project_root) / "compiler-state.json"


def legacy_audit_path(project_root: Path) -> Path:
    return authority_root(project_root) / "legacy-audit.json"
