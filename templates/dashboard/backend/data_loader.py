"""
data_loader.py — YAML parsing for Thoth Research Dashboard.

Scans .agent-os/research-tasks/ for _module.yaml and h*.yaml files,
returning structured data for the API layer.
"""

import os
import time
import logging
from pathlib import Path
from typing import Any, Optional

import yaml


def _read_directions_from_config(base_dir: Path) -> tuple[str, ...]:
    """Read direction IDs from project .research-config.yaml, fallback to alphabetical scan."""
    config_path = base_dir / ".research-config.yaml"
    if config_path.exists():
        try:
            with open(config_path, encoding="utf-8") as f:
                cfg = yaml.safe_load(f) or {}
            dirs = cfg.get("research", {}).get("directions", [])
            if dirs:
                return tuple(d["id"] for d in dirs)
        except Exception:
            pass
    research_dir = base_dir / ".agent-os" / "research-tasks"
    if research_dir.is_dir():
        found = sorted(
            d.name for d in research_dir.iterdir()
            if d.is_dir() and not d.name.startswith(".")
        )
        if found:
            return tuple(found)
    return ()


logger = logging.getLogger(__name__)

_cache: dict[str, Any] = {}
_cache_ts: dict[str, float] = {}
CACHE_TTL: float = float(os.environ.get("DASHBOARD_CACHE_TTL", "2"))
_file_mtime_cache: dict[str, tuple[float, Optional[dict]]] = {}


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


class YAMLLoadError:
    def __init__(self, path: str, error_type: str, message: str):
        self.path = path
        self.error_type = error_type
        self.message = message

    def to_dict(self) -> dict:
        return {"path": self.path, "error_type": self.error_type, "message": self.message}


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
        with open(file_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        if isinstance(data, dict):
            if current_mtime is not None:
                _file_mtime_cache[path_str] = (current_mtime, data)
            return data
        logger.warning("YAML file %s did not parse as a dict (got %s)", file_path, type(data).__name__)
        return None
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


DIRECTIONS = _read_directions_from_config(Path(__file__).resolve().parents[3])


def load_task(file_path: str | Path) -> Optional[dict]:
    return _safe_load_yaml(file_path)


def load_modules(base_dir: str | Path) -> list[dict]:
    cached = _cached("modules")
    if cached is not None:
        return cached

    base = Path(base_dir)
    modules: list[dict] = []
    if not base.is_dir():
        return _set_cache("modules", modules)

    for direction in DIRECTIONS:
        dir_path = base / direction
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


def load_all_tasks(base_dir: str | Path) -> list[dict]:
    cached = _cached("tasks")
    if cached is not None:
        return cached

    base = Path(base_dir)
    tasks: list[dict] = []
    if not base.is_dir():
        return _set_cache("tasks", tasks)

    for direction in DIRECTIONS:
        dir_path = base / direction
        if not dir_path.is_dir():
            continue
        for module_dir in sorted(dir_path.iterdir()):
            if not module_dir.is_dir():
                continue
            for yaml_file in sorted(module_dir.glob("*.yaml")):
                if yaml_file.name == "_module.yaml":
                    continue
                data = _safe_load_yaml(yaml_file)
                if data is None:
                    continue
                if "id" not in data:
                    logger.warning("Task YAML missing 'id' field, skipping: %s", yaml_file)
                    continue
                data.setdefault("direction", direction)
                data.setdefault("module", module_dir.name)
                data["_path"] = str(yaml_file)
                tasks.append(data)

    return _set_cache("tasks", tasks)


def get_paper_mapping(base_dir: str | Path) -> Optional[dict]:
    cached = _cached("paper_mapping")
    if cached is not None:
        return cached

    mapping_file = Path(base_dir) / "paper-module-mapping.yaml"
    if mapping_file.exists():
        data = _safe_load_yaml(mapping_file)
        return _set_cache("paper_mapping", data)
    return _set_cache("paper_mapping", {})


def load_everything(base_dir: str | Path) -> dict:
    try:
        tmp_modules = load_modules(base_dir)
        tmp_tasks = load_all_tasks(base_dir)
        tmp_mapping = get_paper_mapping(base_dir)
    except Exception as exc:
        logger.error("load_everything failed, cache unchanged: %s", exc)
        raise

    return {
        "modules": tmp_modules,
        "tasks": tmp_tasks,
        "paper_mapping": tmp_mapping,
    }
