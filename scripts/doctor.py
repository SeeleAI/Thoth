#!/usr/bin/env python3
"""Wrapper for the canonical Thoth doctor command."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from thoth.plan.doctor import build_doctor_payload, render_doctor_text


def main() -> int:
    parser = argparse.ArgumentParser(description="Thoth doctor")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    payload = build_doctor_payload(Path.cwd())
    if args.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print(render_doctor_text(payload), end="")
    return 0 if payload.get("overall_ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
