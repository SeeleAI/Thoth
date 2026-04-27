"""Planning public commands."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from thoth.plan.compiler import compile_task_authority
from thoth.plan.store import create_discussion_placeholder, upsert_contract, upsert_decision
from thoth.surface.envelope import output_refs, print_envelope


def append_project_note(project_root: Path, note_type: str, content: str) -> Path:
    path = project_root / ".thoth" / "project" / "conversations.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"ts": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"), "type": note_type, "host": "codex", "content": content}
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")
    return path


def handle_discuss(args, parser, *, project_root: Path) -> int:
    content = (getattr(args, "goal", None) or " ".join(getattr(args, "rest", []) or [])).strip()
    note_path = append_project_note(project_root, "discuss", content)
    if getattr(args, "decision_json", None):
        decision = upsert_decision(project_root, json.loads(args.decision_json))
        body: dict[str, Any] = {"decision": decision, "note_path": str(note_path)}
    elif getattr(args, "contract_json", None):
        contract = upsert_contract(project_root, json.loads(args.contract_json))
        body = {"contract": contract, "note_path": str(note_path)}
    else:
        decision = create_discussion_placeholder(project_root, content, host="codex")
        body = {"decision": decision, "note_path": str(note_path)}
    compiler = compile_task_authority(project_root)
    summary = compiler.get("summary", {})
    print_envelope(command="discuss", status="ok", summary="Compiler summary: ready={ready} blocked={blocked} invalid={invalid} open_decisions={open_count} legacy={legacy}".format(ready=int(summary.get("task_counts", {}).get("ready", 0)), blocked=int(summary.get("task_counts", {}).get("blocked", 0)), invalid=int(summary.get("task_counts", {}).get("invalid", 0)), open_count=int(summary.get("decision_counts", {}).get("open", 0)), legacy=int(summary.get("legacy_task_count", 0))), body={**body, "compiler": compiler}, refs=output_refs(note_path, project_root / ".thoth" / "project" / "compiler-state.json"), checks=[{"name": "compiler_ready", "ok": True, "detail": str(summary.get("task_counts", {}).get("ready", 0))}])
    return 0
