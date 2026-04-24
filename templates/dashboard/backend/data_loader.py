"""
data_loader.py — strict-task dashboard loader for Thoth.

The dashboard now treats `.thoth/project/tasks/*.json` as the execution
authority. Legacy `.agent-os/research-tasks/*.yaml` remains readable only as a
fallback or audit surface.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Optional

import yaml


logger = logging.getLogger(__name__)

_cache: dict[str, Any] = {}
_cache_ts: dict[str, float] = {}
CACHE_TTL: float = float(os.environ.get("DASHBOARD_CACHE_TTL", "2"))
_file_mtime_cache: dict[str, tuple[float, Optional[dict[str, Any]]]] = {}


def _cached(key: str) -> Optional[Any]:
    if key in _cache and (time.time() - _cache_ts.get(key, 0)) < CACHE_TTL:
        return _cache[key]
    return None


def _set_cache(key: str, value: Any) -> Any:
    _cache[key] = value
    _cache_ts[key] = time.time()
    return value


def invalidate_cache() -> None:
    _cache.clear()
    _cache_ts.clear()
    _file_mtime_cache.clear()


def get_cache_info() -> dict:
    return {
        "ttl_seconds": CACHE_TTL,
        "cached_keys": list(_cache.keys()),
        "cached_timestamps": {k: v for k, v in _cache_ts.items()},
        "file_mtime_entries": len(_file_mtime_cache),
    }


def _read_json(path: Path) -> Optional[dict[str, Any]]:
    path_str = str(path)
    try:
        current_mtime = os.path.getmtime(path_str)
    except OSError:
        current_mtime = None

    if current_mtime is not None and path_str in _file_mtime_cache:
        cached_mtime, cached_data = _file_mtime_cache[path_str]
        if cached_mtime == current_mtime:
            return cached_data

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    if current_mtime is not None:
        _file_mtime_cache[path_str] = (current_mtime, data)
    return data


def _safe_load_yaml(file_path: str | Path) -> Optional[dict]:
    path_str = str(file_path)
    try:
        current_mtime = os.path.getmtime(path_str)
    except OSError:
        current_mtime = None

    if current_mtime is not None and path_str in _file_mtime_cache:
        cached_mtime, cached_data = _file_mtime_cache[path_str]
        if cached_mtime == current_mtime:
            return cached_data

    try:
        data = yaml.safe_load(Path(file_path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("File not found: %s", file_path)
        return None
    except PermissionError:
        logger.error("Permission denied reading: %s", file_path)
        return None
    except yaml.YAMLError as exc:
        logger.error("YAML parse error in %s: %s", file_path, exc)
        return None
    except Exception as exc:
        logger.warning("Unexpected error loading %s: %s", file_path, exc)
        return None

    if not isinstance(data, dict):
        return None
    if current_mtime is not None:
        _file_mtime_cache[path_str] = (current_mtime, data)
    return data


def _infer_project_root(base_dir: str | Path) -> Path:
    base = Path(base_dir).resolve()
    if (base / ".thoth" / "project").exists() or (base / ".agent-os").exists():
        return base
    if base.name == "research-tasks" and base.parent.name == ".agent-os":
        return base.parent.parent
    return base


def _read_directions_from_config(base_dir: Path) -> tuple[str, ...]:
    project_root = _infer_project_root(base_dir)
    config_path = project_root / ".research-config.yaml"
    if config_path.exists():
        try:
            cfg = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
            dirs = cfg.get("research", {}).get("directions", [])
            result = []
            for item in dirs:
                if isinstance(item, dict) and isinstance(item.get("id"), str):
                    result.append(item["id"])
            if result:
                return tuple(result)
        except Exception:
            pass
    compiled_tasks = project_root / ".thoth" / "project" / "tasks"
    if compiled_tasks.is_dir():
        found = sorted(
            {
                payload.get("direction")
                for path in compiled_tasks.glob("*.json")
                for payload in [_read_json(path) or {}]
                if isinstance(payload.get("direction"), str) and payload.get("direction")
            }
        )
        if found:
            return tuple(found)
    research_dir = project_root / ".agent-os" / "research-tasks"
    if research_dir.is_dir():
        found = sorted(d.name for d in research_dir.iterdir() if d.is_dir() and not d.name.startswith("."))
        if found:
            return tuple(found)
    return ()


DIRECTIONS = _read_directions_from_config(Path(__file__).resolve().parents[3])


def _load_compiled_tasks(project_root: Path) -> list[dict[str, Any]]:
    task_dir = project_root / ".thoth" / "project" / "tasks"
    rows: list[dict[str, Any]] = []
    if not task_dir.is_dir():
        return rows
    for path in sorted(task_dir.glob("*.json")):
        payload = _read_json(path)
        if not payload:
            continue
        payload.setdefault("id", payload.get("task_id"))
        payload.setdefault("_path", str(path))
        rows.append(payload)
    return rows


def _load_legacy_tasks(project_root: Path) -> list[dict[str, Any]]:
    research_dir = project_root / ".agent-os" / "research-tasks"
    rows: list[dict[str, Any]] = []
    if not research_dir.is_dir():
        return rows
    for direction_dir in sorted(research_dir.iterdir()):
        if not direction_dir.is_dir():
            continue
        for module_dir in sorted(direction_dir.iterdir()):
            if not module_dir.is_dir():
                continue
            for yaml_file in sorted(module_dir.glob("*.yaml")):
                if yaml_file.name == "_module.yaml":
                    continue
                payload = _safe_load_yaml(yaml_file)
                if payload is None or "id" not in payload:
                    continue
                payload.setdefault("direction", direction_dir.name)
                payload.setdefault("module", module_dir.name)
                payload.setdefault("_path", str(yaml_file))
                rows.append(payload)
    return rows


def load_task(file_path: str | Path) -> Optional[dict]:
    path = Path(file_path)
    if path.suffix == ".json":
        return _read_json(path)
    return _safe_load_yaml(path)


def load_all_tasks(base_dir: str | Path) -> list[dict]:
    cached = _cached("tasks")
    if cached is not None:
        return cached
    project_root = _infer_project_root(base_dir)
    compiled = _load_compiled_tasks(project_root)
    if compiled:
        return _set_cache("tasks", compiled)
    return _set_cache("tasks", _load_legacy_tasks(project_root))


def load_modules(base_dir: str | Path) -> list[dict]:
    cached = _cached("modules")
    if cached is not None:
        return cached

    project_root = _infer_project_root(base_dir)
    tasks = _load_compiled_tasks(project_root)
    if tasks:
        modules: dict[tuple[str, str], dict[str, Any]] = {}
        for task in tasks:
            direction = str(task.get("direction") or "general")
            module = str(task.get("module") or "strict")
            key = (direction, module)
            item = modules.setdefault(
                key,
                {
                    "id": module,
                    "name": module,
                    "direction": direction,
                    "scientific_question": task.get("goal_statement", ""),
                    "related_modules": {"upstream": [], "downstream": []},
                },
            )
            if not item.get("scientific_question") and isinstance(task.get("goal_statement"), str):
                item["scientific_question"] = task.get("goal_statement")
        return _set_cache("modules", list(modules.values()))

    research_dir = project_root / ".agent-os" / "research-tasks"
    modules: list[dict] = []
    if research_dir.is_dir():
        for direction in DIRECTIONS:
            dir_path = research_dir / direction
            if not dir_path.is_dir():
                continue
            for module_dir in sorted(dir_path.iterdir()):
                if not module_dir.is_dir():
                    continue
                mod_file = module_dir / "_module.yaml"
                if mod_file.exists():
                    data = _safe_load_yaml(mod_file)
                    if data:
                        data.setdefault("direction", direction)
                        data["_path"] = str(mod_file)
                        modules.append(data)
    return _set_cache("modules", modules)


def get_paper_mapping(base_dir: str | Path) -> Optional[dict]:
    cached = _cached("paper_mapping")
    if cached is not None:
        return cached
    project_root = _infer_project_root(base_dir)
    mapping_file = project_root / ".agent-os" / "research-tasks" / "paper-module-mapping.yaml"
    if mapping_file.exists():
        return _set_cache("paper_mapping", _safe_load_yaml(mapping_file))
    return _set_cache("paper_mapping", {})


def load_compiler_state(base_dir: str | Path) -> dict[str, Any]:
    cached = _cached("compiler_state")
    if cached is not None:
        return cached
    project_root = _infer_project_root(base_dir)
    return _set_cache("compiler_state", _read_json(project_root / ".thoth" / "project" / "compiler-state.json") or {})


def load_decisions(base_dir: str | Path) -> list[dict[str, Any]]:
    cached = _cached("decisions")
    if cached is not None:
        return cached
    project_root = _infer_project_root(base_dir)
    rows: list[dict[str, Any]] = []
    decision_dir = project_root / ".thoth" / "project" / "decisions"
    if decision_dir.is_dir():
        for path in sorted(decision_dir.glob("*.json")):
            payload = _read_json(path)
            if payload:
                payload["_path"] = str(path)
                rows.append(payload)
    return _set_cache("decisions", rows)


def load_contracts(base_dir: str | Path) -> list[dict[str, Any]]:
    cached = _cached("contracts")
    if cached is not None:
        return cached
    project_root = _infer_project_root(base_dir)
    rows: list[dict[str, Any]] = []
    contract_dir = project_root / ".thoth" / "project" / "contracts"
    if contract_dir.is_dir():
        for path in sorted(contract_dir.glob("*.json")):
            payload = _read_json(path)
            if payload:
                payload["_path"] = str(path)
                rows.append(payload)
    return _set_cache("contracts", rows)


def load_everything(base_dir: str | Path) -> dict:
    project_root = _infer_project_root(base_dir)
    return {
        "modules": load_modules(project_root),
        "tasks": load_all_tasks(project_root),
        "paper_mapping": get_paper_mapping(project_root),
        "compiler_state": load_compiler_state(project_root),
        "decisions": load_decisions(project_root),
        "contracts": load_contracts(project_root),
    }
