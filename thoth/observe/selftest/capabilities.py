from __future__ import annotations

import argparse
import json
import os
import re
import selectors
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable
from urllib.error import URLError
from urllib.request import urlopen

import yaml

from thoth.init.render import render_codex_hooks_payload
from thoth.plan.compiler import compile_task_authority
from thoth.run.ledger import complete_run, heartbeat_run
from thoth.selftest_seed import seed_host_real_app

from .model import *
from .recorder import *
from .processes import *

def detect_capabilities() -> dict[str, Any]:
    def tool_path(name: str) -> str | None:
        return shutil.which(name)

    thoth_cli_path = tool_path("thoth")
    capabilities: dict[str, Any] = {
        "python": PYTHON,
        "codex_cli_present": bool(tool_path("codex")),
        "claude_cli_present": bool(tool_path("claude")),
        "thoth_cli_present": bool(thoth_cli_path),
        "thoth_cli_path": thoth_cli_path,
    }

    if capabilities["codex_cli_present"]:
        result = _run_command(["codex", "login", "status"], cwd=ROOT, timeout=20)
        status_text = result.stdout.strip() or result.stderr.strip()
        capabilities["codex_authenticated"] = "logged in" in status_text.lower()
        capabilities["codex_login_status"] = status_text
        features = _run_command(["codex", "features", "list"], cwd=ROOT, timeout=20)
        hooks_line = next((line for line in features.stdout.splitlines() if line.startswith("codex_hooks")), "codex_hooks false")
        capabilities["codex_hooks_enabled"] = hooks_line.split()[-1].lower() == "true"
        capabilities["codex_features_snapshot"] = features.stdout.strip()
    else:
        capabilities["codex_authenticated"] = False
        capabilities["codex_hooks_enabled"] = False

    if capabilities["claude_cli_present"]:
        result = _run_command(["claude", "auth", "status"], cwd=ROOT, timeout=20)
        status_text = result.stdout.strip() or result.stderr.strip()
        capabilities["claude_authenticated"] = "\"loggedIn\": true" in status_text
        capabilities["claude_auth_status"] = status_text
    else:
        capabilities["claude_authenticated"] = False

    return capabilities


def _codex_config_path() -> Path:
    return Path.home() / ".codex" / "config.toml"


def _codex_hooks_path() -> Path:
    return Path.home() / ".codex" / "hooks.json"


def _codex_skills_root() -> Path:
    return Path.home() / ".codex" / "skills"


def _path_snapshot(path: Path) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists() or path.is_symlink(),
        "is_symlink": path.is_symlink(),
        "is_dir": path.is_dir(),
        "is_file": path.is_file(),
    }
    try:
        payload["resolved"] = str(path.resolve())
    except OSError:
        payload["resolved"] = None
    return payload


def _ensure_features_flag(content: str, *, key: str, value: str) -> str:
    lines = content.splitlines()
    if not lines:
        return f"[features]\n{key} = {value}\n"
    result: list[str] = []
    in_features = False
    inserted = False
    replaced = False
    for line in lines:
        stripped = line.strip()
        section_match = re.match(r"^\s*\[([^\]]+)\]", line)
        if section_match:
            if in_features and not inserted:
                result.append(f"{key} = {value}")
                inserted = True
            in_features = section_match.group(1).strip() == "features"
            result.append(line)
            continue
        if in_features and stripped.startswith(f"{key} "):
            result.append(f"{key} = {value}")
            inserted = True
            replaced = True
            continue
        result.append(line)
    if in_features and not inserted:
        result.append(f"{key} = {value}")
        inserted = True
    if not inserted and not replaced:
        if result and result[-1].strip():
            result.append("")
        result.extend(["[features]", f"{key} = {value}"])
    return "\n".join(result).rstrip() + "\n"


def _ensure_codex_hooks_enabled(recorder: Recorder) -> dict[str, Any]:
    config_path = _codex_config_path()
    before = config_path.read_text(encoding="utf-8") if config_path.exists() else ""
    before_artifact = recorder.write_text("codex-hooks/config.before.toml", before or "__MISSING__\n")
    updated = _ensure_features_flag(before, key="codex_hooks", value="true")
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(updated, encoding="utf-8")
    after = config_path.read_text(encoding="utf-8")
    after_artifact = recorder.write_text("codex-hooks/config.after.toml", after)
    features = _run_command(["codex", "features", "list"], cwd=ROOT, timeout=20)
    features_artifact = _save_command(recorder, "codex-features-list", features)
    hooks_line = next((line for line in features.stdout.splitlines() if line.startswith("codex_hooks")), "codex_hooks false")
    enabled = hooks_line.split()[-1].lower() == "true"
    payload = {
        "path": str(config_path),
        "before_artifact": before_artifact,
        "after_artifact": after_artifact,
        "effective_enabled": enabled,
        "effective_line": hooks_line,
    }
    recorder.add(
        "preflight.codex_hooks_config",
        "passed" if enabled else "failed",
        "Codex global config was checked and codex_hooks was forced on under [features].",
        [before_artifact, after_artifact, *features_artifact],
    )
    if not enabled:
        raise RuntimeError("codex hooks feature flag is still disabled after config.toml update")
    return payload


def _ensure_codex_skill_installed(recorder: Recorder) -> dict[str, Any]:
    source = ROOT / "plugins" / "thoth" / "skills" / CODEX_SKILL_NAME
    if not source.exists():
        raise RuntimeError(f"missing generated Codex skill at {source}")
    target = _codex_skills_root() / CODEX_SKILL_NAME
    before_snapshot = _path_snapshot(target)
    before_artifact = recorder.write_json("codex-skill/skill.before.json", before_snapshot)

    same_target = bool(target.exists() or target.is_symlink())
    if same_target:
        try:
            same_target = target.resolve() == source.resolve()
        except OSError:
            same_target = False
    if not same_target:
        if target.is_symlink() or target.is_file():
            target.unlink()
        elif target.is_dir():
            shutil.rmtree(target)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.symlink_to(source, target_is_directory=True)

    after_snapshot = _path_snapshot(target)
    after_artifact = recorder.write_json("codex-skill/skill.after.json", after_snapshot)
    effective = bool(target.exists() or target.is_symlink())
    try:
        effective = effective and target.resolve() == source.resolve()
    except OSError:
        effective = False
    recorder.add(
        "preflight.codex_skill_install",
        "passed" if effective else "failed",
        "Codex global skill entry for Thoth was checked and aligned to the repo-generated public skill surface.",
        [before_artifact, after_artifact],
    )
    if not effective:
        raise RuntimeError("codex skill installation did not resolve to the repo-generated Thoth skill")
    return {
        "source": str(source),
        "target": str(target),
        "before": before_snapshot,
        "after": after_snapshot,
        "effective": effective,
    }


def _ensure_codex_global_hooks(recorder: Recorder) -> dict[str, Any]:
    hooks_path = _codex_hooks_path()
    before = hooks_path.read_text(encoding="utf-8") if hooks_path.exists() else ""
    before_artifact = recorder.write_text("codex-hooks/global.before.json", before or "__MISSING__\n")
    payload = render_codex_hooks_payload()
    hooks_path.parent.mkdir(parents=True, exist_ok=True)
    hooks_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    after = hooks_path.read_text(encoding="utf-8")
    after_artifact = recorder.write_text("codex-hooks/global.after.json", after)
    effective = "thoth-codex-hook.sh" in after
    recorder.add(
        "preflight.codex_global_hooks",
        "passed" if effective else "failed",
        "Codex global hooks.json was aligned to the repo-local Thoth hook bridge commands.",
        [before_artifact, after_artifact],
    )
    if not effective:
        raise RuntimeError("codex global hooks.json does not contain the Thoth hook bridge commands")
    return {
        "path": str(hooks_path),
        "before_artifact": before_artifact,
        "after_artifact": after_artifact,
        "effective": effective,
    }


def _preflight_host_real(
    capabilities: dict[str, Any],
    recorder: Recorder,
    *,
    requested_hosts: set[str],
) -> None:
    required = {
        "codex_cli_present": bool(capabilities.get("codex_cli_present")) if "codex" in requested_hosts else True,
        "codex_authenticated": bool(capabilities.get("codex_authenticated")) if "codex" in requested_hosts else True,
        "claude_cli_present": bool(capabilities.get("claude_cli_present")) if "claude" in requested_hosts else True,
        "claude_authenticated": bool(capabilities.get("claude_authenticated")) if "claude" in requested_hosts else True,
        "thoth_cli_present": bool(capabilities.get("thoth_cli_present")) if "codex" in requested_hosts else True,
    }
    missing = [name for name, ok in required.items() if not ok]
    if missing:
        detail = f"Missing heavy host-real prerequisites: {', '.join(missing)}"
        if "thoth_cli_present" in missing:
            detail += ". Host install drift: expected the plugin-installed `thoth` shell wrapper on PATH."
        recorder.add("preflight.host_tools", "failed", detail)
        raise RuntimeError(detail)
    if "codex" in requested_hosts:
        _ensure_codex_hooks_enabled(recorder)
        _ensure_codex_global_hooks(recorder)
        _ensure_codex_skill_installed(recorder)
    recorder.add(
        "preflight.deterministic_seed",
        "passed",
        "Verified heavy prerequisites for the deterministic Python host workflow.",
    )

__all__ = [name for name in globals() if not name.startswith("__")]
