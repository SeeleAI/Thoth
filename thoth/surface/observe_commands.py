"""Observe/read public commands."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from thoth.observe.dashboard import manage_dashboard
from thoth.observe.report import generate_default_report, render_report_summary
from thoth.observe.status import render_status
from thoth.plan.doctor import build_doctor_payload, render_doctor_text
from thoth.run.status import build_status_payload
from thoth.surface.envelope import output_refs, print_envelope


def handle_status(args, parser, *, project_root: Path) -> int:
    payload = build_status_payload(project_root)
    if args.json:
        print_envelope(command="status", status="ok", summary=f"Loaded status for {payload['project_root']}", body={"status": payload}, refs=output_refs(project_root / ".thoth" / "project" / "project.json"), checks=[{"name": "active_run_count", "ok": True, "detail": str(payload.get("active_run_count", 0))}])
    else:
        print(render_status(project_root, full=False))
    return 0


def handle_doctor(args, parser, *, project_root: Path) -> int:
    payload = build_doctor_payload(project_root)
    if args.json:
        print_envelope(command="doctor", status="ok" if payload.get("overall_ok") else "failed", summary="Doctor checks completed", body={"doctor": payload}, refs=output_refs(project_root / ".thoth" / "project" / "compiler-state.json"), checks=payload.get("checks") if isinstance(payload.get("checks"), list) else [])
    else:
        print(render_doctor_text(payload), end="")
    return 0 if payload.get("overall_ok") else 1


def handle_dashboard(args, parser, *, project_root: Path) -> int:
    result = manage_dashboard(project_root, getattr(args, "action", "start"))
    print_envelope(command="dashboard", status=result["status"], summary=result["summary"], body=result, refs=output_refs(project_root / ".thoth" / "derived" / "dashboard.pid"), checks=[{"name": f"dashboard_{result['action']}", "ok": result["status"] == "ok"}])
    return 0


def handle_report(args, parser, *, project_root: Path) -> int:
    end = datetime.now(timezone.utc).date()
    start = end - timedelta(days=7)
    output_path = generate_default_report(project_root, start.isoformat(), end.isoformat(), fmt=getattr(args, "format", "md"))
    print_envelope(command="report", status="ok", summary=render_report_summary(output_path), body={"output_path": str(output_path)}, refs=output_refs(output_path))
    return 0
