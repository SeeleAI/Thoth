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



ROOT = Path(__file__).resolve().parents[3]
PYTHON = sys.executable
FIXED_CLAUDE_DIR = Path("/tmp/thoth-selftest-claude")
FIXED_CODEX_DIR = Path("/tmp/thoth-selftest-codex")
FIXED_RUNTIME_DIR = Path("/tmp/thoth-selftest-runtime")
CODEX_SKILL_NAME = "thoth"
HARD_SUITE_MAX_RUNTIME_SECONDS = 180.0
HEAVY_PREFLIGHT_MAX_RUNTIME_SECONDS = 120.0
HEAVY_HOST_MAX_RUNTIME_SECONDS = 900.0
_SELFTEST_DEADLINE: float | None = None
_SELFTEST_DEADLINE_LABEL: str | None = None
_SELFTEST_DEADLINE_SECONDS: float | None = None
_SELFTEST_STREAM_OUTPUT = False


def utc_now() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


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

__all__ = [name for name in globals() if not name.startswith("__")]
