"""Canonical init planner."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .service import build_init_preview as _build_init_preview


@dataclass(frozen=True)
class InitPlan:
    mode: str
    create: list[str]
    update: list[str]
    preserve: list[str]
    remove: list[str]
    generated_at: str
    schema_version: int


def build_init_plan(project_dir: Path, audit: dict[str, Any]) -> InitPlan:
    preview = _build_init_preview(project_dir, audit)
    return InitPlan(
        mode=str(preview.get("mode") or "init"),
        create=list(preview.get("create") or []),
        update=list(preview.get("update") or []),
        preserve=list(preview.get("preserve") or []),
        remove=list(preview.get("remove") or []),
        generated_at=str(preview.get("generated_at") or ""),
        schema_version=int(preview.get("schema_version") or 1),
    )


__all__ = ["InitPlan", "build_init_plan"]

