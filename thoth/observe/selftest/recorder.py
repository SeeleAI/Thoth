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

def _write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    return data if isinstance(data, dict) else {}


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    data = yaml.safe_load(path.read_text(encoding="utf-8"))
    return data if isinstance(data, dict) else {}


def _dump_yaml(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def _safe_name(value: str) -> str:
    return "".join(ch if ch.isalnum() or ch in ("-", "_") else "_" for ch in value)


def _extract_json(stdout: str) -> dict[str, Any]:
    start = stdout.find("{")
    if start < 0:
        return {}
    try:
        payload = json.loads(stdout[start:])
    except json.JSONDecodeError:
        return {}
    if not isinstance(payload, dict):
        return {}
    body = payload.get("body")
    if isinstance(body, dict):
        packet = body.get("packet")
        if isinstance(packet, dict):
            return packet
        status_payload = body.get("status")
        if isinstance(status_payload, dict):
            return status_payload
        doctor_payload = body.get("doctor")
        if isinstance(doctor_payload, dict):
            return doctor_payload
        result_payload = body.get("result")
        if isinstance(result_payload, dict):
            return result_payload
    return payload


@dataclass
class CommandResult:
    argv: list[str]
    cwd: str
    returncode: int
    stdout: str
    stderr: str
    duration_seconds: float


@dataclass
class CheckResult:
    name: str
    status: str
    detail: str
    artifacts: list[str] = field(default_factory=list)


class Recorder:
    def __init__(self, artifact_dir: Path) -> None:
        self.artifact_dir = artifact_dir
        self.artifact_dir.mkdir(parents=True, exist_ok=True)
        self.checks: list[CheckResult] = []

    def write_text(self, relpath: str, content: str) -> str:
        path = self.artifact_dir / relpath
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content, encoding="utf-8")
        return str(path)

    def write_json(self, relpath: str, payload: dict[str, Any]) -> str:
        path = self.artifact_dir / relpath
        _write_json(path, payload)
        return str(path)

    def add(self, name: str, status: str, detail: str, artifacts: Iterable[str] | None = None) -> None:
        self.checks.append(CheckResult(name=name, status=status, detail=detail, artifacts=list(artifacts or [])))

    def summary_payload(self, *, tier: str, capabilities: dict[str, Any], work_root: str) -> dict[str, Any]:
        counts = {"passed": 0, "failed": 0, "degraded": 0}
        for item in self.checks:
            counts[item.status] = counts.get(item.status, 0) + 1
        overall = "failed" if counts.get("failed", 0) or counts.get("degraded", 0) else "passed"
        return {
            "schema_version": 1,
            "generated_at": utc_now(),
            "tier": tier,
            "overall_status": overall,
            "counts": counts,
            "capabilities": capabilities,
            "work_root": work_root,
            "checks": [
                {
                    "name": item.name,
                    "status": item.status,
                    "detail": item.detail,
                    "artifacts": item.artifacts,
                }
                for item in self.checks
            ],
        }

__all__ = [name for name in globals() if not name.startswith("__")]
