"""
runtime_loader.py -- Canonical run-ledger reader for the Thoth dashboard.

The dashboard must not infer long-running execution state from chat history or
task YAML files. Runtime truth lives under `.thoth/runs/<run_id>/`.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

ACTIVE_RUN_STATUSES = {"queued", "running", "paused", "waiting_input", "stopping"}


def _parse_timestamp(value: Any) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None


def _format_timestamp(value: Optional[datetime]) -> Optional[str]:
    if value is None:
        return None
    return value.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    records: list[dict[str, Any]] = []
    for line_no, raw_line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            payload.setdefault("_line_no", line_no)
            records.append(payload)
    return records


def _event_seq(event: dict[str, Any]) -> int:
    seq = event.get("seq")
    if isinstance(seq, int):
        return seq
    return int(event.get("_line_no", 0))


def _normalize_event(event: dict[str, Any]) -> dict[str, Any]:
    payload = dict(event)
    payload["seq"] = _event_seq(payload)
    payload["ts"] = payload.get("ts") or payload.get("timestamp")
    payload["kind"] = payload.get("kind") or payload.get("type") or "event"
    payload["level"] = payload.get("level") or "info"
    payload["message"] = payload.get("message") or payload.get("summary") or ""
    payload.pop("_line_no", None)
    return payload


def _latest_ts(*values: Any) -> Optional[str]:
    parsed = [_parse_timestamp(v) for v in values]
    parsed = [value for value in parsed if value is not None]
    if not parsed:
        return None
    return _format_timestamp(max(parsed))


def _runs_dir(project_root: Path) -> Path:
    return Path(os.environ.get("THOTH_RUNS_DIR", str(project_root / ".thoth" / "runs"))).resolve()


def list_runs(project_root: Path) -> list[dict[str, Any]]:
    runs_dir = _runs_dir(project_root)
    if not runs_dir.is_dir():
        return []

    stale_minutes = int(os.environ.get("THOTH_HEARTBEAT_STALE_MINUTES", "20"))
    now = datetime.now(timezone.utc)
    runs: list[dict[str, Any]] = []

    for run_dir in sorted(runs_dir.iterdir()):
        if not run_dir.is_dir():
            continue

        run_data = _read_json(run_dir / "run.json")
        state_data = _read_json(run_dir / "state.json")
        heartbeat_data = _read_json(run_dir / "heartbeat.json")
        artifacts_data = _read_json(run_dir / "artifacts.json")
        events = [_normalize_event(event) for event in _read_jsonl(run_dir / "events.jsonl")]
        events.sort(key=lambda item: item["seq"])

        run_id = str(run_data.get("run_id") or run_data.get("id") or state_data.get("run_id") or run_dir.name)
        task_id = run_data.get("task_id") or state_data.get("task_id")
        status = str(state_data.get("status") or run_data.get("status") or heartbeat_data.get("status") or "unknown")
        progress_pct = state_data.get("progress_pct")
        if not isinstance(progress_pct, (int, float)):
            progress_pct = state_data.get("progress")
        if not isinstance(progress_pct, (int, float)):
            progress_pct = 0.0
        progress_pct = round(max(0.0, min(100.0, float(progress_pct))), 1)

        last_event = events[-1] if events else None
        last_heartbeat_at = heartbeat_data.get("last_heartbeat_at") or heartbeat_data.get("heartbeat_at")
        last_updated_at = _latest_ts(
            state_data.get("updated_at"),
            last_heartbeat_at,
            heartbeat_data.get("updated_at"),
            last_event.get("ts") if last_event else None,
            run_data.get("updated_at"),
            run_data.get("created_at"),
        )
        hb_dt = _parse_timestamp(last_heartbeat_at)
        is_stale = False
        if hb_dt is not None and status in ACTIVE_RUN_STATUSES:
            is_stale = (now - hb_dt).total_seconds() > stale_minutes * 60
        is_active = status in ACTIVE_RUN_STATUSES and not is_stale

        runs.append({
            "run_id": run_id,
            "task_id": task_id,
            "title": run_data.get("title") or run_id,
            "status": status,
            "phase": state_data.get("phase") or run_data.get("phase"),
            "progress_pct": progress_pct,
            "executor": run_data.get("executor"),
            "created_at": run_data.get("created_at"),
            "started_at": run_data.get("started_at") or run_data.get("created_at"),
            "last_updated_at": last_updated_at,
            "last_heartbeat_at": last_heartbeat_at,
            "last_event_seq": state_data.get("last_event_seq") if isinstance(state_data.get("last_event_seq"), int) else (last_event["seq"] if last_event else 0),
            "is_active": is_active,
            "is_stale": is_stale,
            "latest_message": last_event.get("message") if last_event else "",
            "artifact_count": len(artifacts_data.get("artifacts", [])) if isinstance(artifacts_data.get("artifacts"), list) else 0,
            "events_path": str((run_dir / "events.jsonl").relative_to(project_root)) if (run_dir / "events.jsonl").exists() else None,
        })

    runs.sort(
        key=lambda item: (
            _parse_timestamp(item.get("last_updated_at")) or datetime.min.replace(tzinfo=timezone.utc),
            item["run_id"],
        ),
        reverse=True,
    )
    return runs


def get_task_runs(project_root: Path, task_id: str) -> list[dict[str, Any]]:
    return [run for run in list_runs(project_root) if run.get("task_id") == task_id]


def get_active_run_for_task(project_root: Path, task_id: str) -> Optional[dict[str, Any]]:
    task_runs = get_task_runs(project_root, task_id)
    for run in task_runs:
        if run.get("is_active"):
            return run
    return task_runs[0] if task_runs else None


def get_run_detail(project_root: Path, run_id: str) -> Optional[dict[str, Any]]:
    summary = next((run for run in list_runs(project_root) if run["run_id"] == run_id), None)
    if summary is None:
        return None
    run_dir = _runs_dir(project_root) / run_id
    return {
        **summary,
        "run": _read_json(run_dir / "run.json"),
        "state": _read_json(run_dir / "state.json"),
        "heartbeat": _read_json(run_dir / "heartbeat.json"),
        "artifacts": _read_json(run_dir / "artifacts.json"),
        "acceptance": _read_json(run_dir / "acceptance.json"),
    }


def get_run_events(project_root: Path, run_id: str, *, after_seq: Optional[int] = None, limit: int = 100) -> Optional[dict[str, Any]]:
    run_dir = _runs_dir(project_root) / run_id
    if not run_dir.is_dir():
        return None
    events = [_normalize_event(event) for event in _read_jsonl(run_dir / "events.jsonl")]
    events.sort(key=lambda item: item["seq"])
    if after_seq is not None:
        filtered = [event for event in events if event["seq"] > after_seq]
        payload = filtered[:limit]
        has_more = len(filtered) > len(payload)
    else:
        payload = events[-limit:]
        has_more = len(events) > len(payload)
    return {
        "run_id": run_id,
        "events": payload,
        "next_after_seq": payload[-1]["seq"] if payload else after_seq,
        "has_more": has_more,
    }


def runtime_overview(project_root: Path) -> dict[str, Any]:
    runs = list_runs(project_root)
    active_runs = [run for run in runs if run.get("is_active")]
    stale_runs = [run for run in runs if run.get("is_stale")]
    return {
        "active_run_count": len(active_runs),
        "stale_run_count": len(stale_runs),
        "active_runs": active_runs[:10],
        "last_runtime_update": runs[0].get("last_updated_at") if runs else None,
        "progress_source": "task_yaml_plus_run_ledger",
    }
