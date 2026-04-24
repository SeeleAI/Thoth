"""
app.py — FastAPI main application for Thoth Research Dashboard.

Run:
    cd tools/dashboard/backend
    python app.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import time
import logging
import traceback
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, JSONResponse
from starlette.requests import Request

from data_loader import (
    load_all_tasks, load_modules, load_task, get_paper_mapping,
    invalidate_cache, get_cache_info, DIRECTIONS, load_compiler_state,
    load_decisions, load_contracts, load_project_config,
)
from runtime_loader import (
    get_active_run_for_task,
    get_run_detail,
    get_run_events,
    get_task_runs,
    runtime_overview,
)
from progress_calculator import (
    calculate_task_progress, calculate_module_progress,
    calculate_direction_progress, calculate_global_progress,
    find_blocked_tasks, estimate_completion, get_task_status, status_counts,
)
from trigger_runner import run_validate, run_sync, run_verify, run_health_check
from database import init_db, get_conn

APP_DIR = Path(__file__).resolve().parent
DASHBOARD_DIR = APP_DIR.parent
PROJECT_ROOT = DASHBOARD_DIR / ".." / ".."
THOTH_RUNS_DIR = Path(
    os.environ.get("THOTH_RUNS_DIR", str(PROJECT_ROOT / ".thoth" / "runs"))
).resolve()


def _load_milestones() -> list:
    ms_path = (PROJECT_ROOT / ".agent-os" / "milestones.yaml").resolve()
    if ms_path.exists():
        import yaml as _yaml

        with open(ms_path, encoding="utf-8") as f:
            data = _yaml.safe_load(f) or {}
            return data.get("milestones", [])
    return []

_RESEARCH_CONFIG = load_project_config(PROJECT_ROOT)
_DIRECTIONS_CONFIG = _RESEARCH_CONFIG.get("research", {}).get("directions") or []
_PROJECT_NAME = _RESEARCH_CONFIG.get("project", {}).get("name", "Thoth Project")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("dashboard")
logger.info("Thoth project root: %s", PROJECT_ROOT)

app = FastAPI(title=f"{_PROJECT_NAME} Dashboard", version="1.0.0")
init_db()

SPA_ENTRY_ROUTES = (
    "/overview",
    "/tasks",
    "/milestones",
    "/dag",
    "/timeline",
    "/todo",
    "/activity",
)


def _error_response(status_code: int, error: str, detail: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": error, "detail": detail})


def _frontend_index_response() -> HTMLResponse:
    vue_index = DASHBOARD_DIR / "frontend" / "dist" / "index.html"
    if vue_index.exists():
        return HTMLResponse(content=vue_index.read_text(encoding="utf-8"), status_code=200)
    return HTMLResponse(content=f"<h1>{_PROJECT_NAME} Dashboard</h1><p>Run: npm run build in tools/dashboard/frontend/</p>")


DIRECTION_LABELS = {
    d["id"]: d.get("label_en", d["id"].title()) for d in _DIRECTIONS_CONFIG
} or {d: d.title() for d in DIRECTIONS}


def _build_tree() -> list[dict]:
    modules = load_modules(PROJECT_ROOT)
    all_tasks = load_all_tasks(PROJECT_ROOT)
    tasks_by_module: dict[str, list[dict]] = {}
    for t in all_tasks:
        tasks_by_module.setdefault(t.get("module", ""), []).append(t)
    modules_by_dir: dict[str, list[dict]] = {}
    for m in modules:
        modules_by_dir.setdefault(m.get("direction", "unknown"), []).append(m)

    tree = []
    for direction in DIRECTIONS:
        dir_modules = modules_by_dir.get(direction, [])
        module_nodes = []
        for mod in dir_modules:
            mid = mod.get("id", "")
            mod_tasks = tasks_by_module.get(mid, [])
            task_nodes = []
            for task in mod_tasks:
                task_nodes.append({
                    "id": task.get("id", "") or task.get("task_id", ""),
                    "title": task.get("title", ""),
                    "type": task.get("type", "hypothesis"),
                    "status": get_task_status(task),
                    "progress": calculate_task_progress(task),
                    "hypothesis": task.get("hypothesis") or task.get("goal_statement", ""),
                    "phases": _summarize_phases(task),
                })
            module_nodes.append({
                "id": mid,
                "name": mod.get("name", mid),
                "scientific_question": mod.get("scientific_question", ""),
                "task_count": len(mod_tasks),
                "progress": calculate_module_progress(mod_tasks),
                "tasks": task_nodes,
                "upstream": mod.get("related_modules", {}).get("upstream", []),
                "downstream": mod.get("related_modules", {}).get("downstream", []),
            })
        dir_progress = calculate_direction_progress(
            [{"tasks": tasks_by_module.get(m.get("id", ""), [])} for m in dir_modules]
        )
        tree.append({
            "direction": direction,
            "label": DIRECTION_LABELS.get(direction, direction.title()),
            "module_count": len(dir_modules),
            "progress": dir_progress,
            "modules": module_nodes,
        })
    return tree


def _summarize_phases(task: dict) -> dict:
    if "phases" not in task:
        return {}
    phases = task.get("phases", {})
    summary = {}
    for pname in ("survey", "method_design", "experiment", "conclusion"):
        p = phases.get(pname, {})
        if p:
            summary[pname] = {"status": p.get("status", "pending")}
            criteria = p.get("criteria")
            if criteria:
                summary[pname]["criteria"] = criteria
        else:
            summary[pname] = {"status": "pending"}
    return summary


def _attach_runtime(task: dict) -> dict:
    payload = dict(task)
    task_id = str(task.get("id", "") or task.get("task_id", ""))
    payload["active_run"] = get_active_run_for_task(PROJECT_ROOT, task_id)
    payload["run_count"] = len(get_task_runs(PROJECT_ROOT, task_id))
    return payload


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return _frontend_index_response()


for _spa_route in SPA_ENTRY_ROUTES:
    app.add_api_route(_spa_route, index, methods=["GET"], response_class=HTMLResponse)


@app.get("/api/config")
async def api_config():
    try:
        return load_project_config(PROJECT_ROOT)
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/tree")
async def api_tree():
    try:
        return _build_tree()
    except Exception as exc:
        logger.error("Error in /api/tree: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/tasks")
async def api_tasks(
    status: Optional[str] = Query(None),
    module: Optional[str] = Query(None),
    direction: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=10000),
    offset: int = Query(0, ge=0),
):
    try:
        tasks = load_all_tasks(PROJECT_ROOT)
        blocked_ids = {t.get("id") or t.get("task_id") for t in find_blocked_tasks(tasks)}
        result = []
        for t in tasks:
            t_status = get_task_status(t)
            task_id = t.get("id") or t.get("task_id")
            if task_id in blocked_ids and t_status not in {"invalid", "failed"}:
                t_status = "blocked"
            if status and t_status != status:
                continue
            if module and t.get("module") != module:
                continue
            if direction and t.get("direction") != direction:
                continue
            result.append({
                **_attach_runtime({k: v for k, v in t.items() if not k.startswith("_")}),
                "computed_status": t_status,
                "computed_progress": calculate_task_progress(t),
            })
        total = len(result)
        return {"total": total, "offset": offset, "limit": limit, "tasks": result[offset:offset + limit]}
    except Exception as exc:
        logger.error("Error in /api/tasks: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/tasks/{task_id}")
async def api_task_detail(task_id: str):
    try:
        tasks = load_all_tasks(PROJECT_ROOT)
        for t in tasks:
            if t.get("id") == task_id or t.get("task_id") == task_id:
                return {
                    **_attach_runtime({k: v for k, v in t.items() if not k.startswith("_")}),
                    "computed_status": get_task_status(t),
                    "computed_progress": calculate_task_progress(t),
                }
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    except HTTPException:
        raise
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/dag")
async def api_dag():
    try:
        modules = load_modules(PROJECT_ROOT)
        tasks = load_all_tasks(PROJECT_ROOT)
        tasks_by_module: dict[str, list[dict]] = {}
        for t in tasks:
            tasks_by_module.setdefault(t.get("module", ""), []).append(t)
        nodes = []
        edges = []
        for mod in modules:
            mid = mod.get("id", "")
            mod_tasks = tasks_by_module.get(mid, [])
            nodes.append({
                "id": mid, "label": mod.get("name", mid), "type": "module",
                "direction": mod.get("direction", ""),
                "progress": calculate_module_progress(mod_tasks),
                "task_count": len(mod_tasks),
            })
            for ds in mod.get("related_modules", {}).get("downstream", []):
                edges.append({"source": mid, "target": ds, "type": "hard", "level": "module"})
        for task in tasks:
            tid = task.get("id", "") or task.get("task_id", "")
            nodes.append({
                "id": tid, "label": task.get("title", tid), "type": "task",
                "direction": task.get("direction", ""), "module": task.get("module", ""),
                "status": get_task_status(task), "progress": calculate_task_progress(task),
            })
            for dep in task.get("depends_on", []):
                edges.append({
                    "source": dep.get("task_id", ""), "target": tid,
                    "type": dep.get("type", "soft"), "level": "task",
                    "reason": dep.get("reason", ""),
                })
            if task.get("ready_state") in {"blocked", "invalid"} and task.get("blocking_reason"):
                edges.append({
                    "source": f"reason:{tid}",
                    "target": tid,
                    "type": "hard",
                    "level": "task",
                    "reason": str(task.get("blocking_reason")),
                })
        return {"nodes": nodes, "edges": edges}
    except Exception as exc:
        logger.error("Error in /api/dag: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/timeline")
async def api_timeline():
    try:
        tasks = load_all_tasks(PROJECT_ROOT)
        items = []
        for task in tasks:
            phases = task.get("phases", {})
            starts, ends = [], []
            for pname in ("survey", "method_design", "experiment", "conclusion"):
                p = phases.get(pname, {})
                if p.get("started_at"):
                    starts.append(str(p["started_at"]))
                if p.get("completed_at"):
                    ends.append(str(p["completed_at"]))
            created = task.get("created_at")
            items.append({
                "id": task.get("id", "") or task.get("task_id", ""), "title": task.get("title", ""),
                "module": task.get("module", ""), "direction": task.get("direction", ""),
                "status": get_task_status(task), "progress": calculate_task_progress(task),
                "start_date": min(starts) if starts else (str(created) if created else str(task.get("generated_at")) if task.get("generated_at") else None),
                "end_date": max(ends) if ends else None,
                "estimated_hours": task.get("estimated_total_hours", 0),
                "spent_hours": task.get("time_spent_hours", 0),
            })
        return items
    except Exception as exc:
        logger.error("Error in /api/timeline: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/progress")
async def api_progress():
    try:
        tasks = load_all_tasks(PROJECT_ROOT)
        modules = load_modules(PROJECT_ROOT)
        compiler_state = load_compiler_state(PROJECT_ROOT)
        counts = status_counts(tasks)
        overall_pct = calculate_global_progress(tasks)
        est = estimate_completion(tasks)
        tasks_by_dir: dict[str, list] = {}
        for t in tasks:
            tasks_by_dir.setdefault(t.get("direction", ""), []).append(t)
        by_direction = {}
        for direction in DIRECTIONS:
            dir_tasks = tasks_by_dir.get(direction, [])
            by_direction[direction] = calculate_global_progress(dir_tasks) if dir_tasks else 0.0

        blocked = find_blocked_tasks(tasks)
        blocked_list = []
        for bt in blocked:
            deps = [d.get("task_id", "") for d in bt.get("depends_on", []) if d.get("type") == "hard"]
            if bt.get("blocking_reason"):
                deps = [str(bt.get("blocking_reason"))]
            blocked_list.append({"id": bt.get("id", "") or bt.get("task_id", ""), "title": bt.get("title", ""), "blocked_by": deps})

        return {
            "overall_progress": overall_pct, "by_direction": by_direction,
            "status_counts": counts, "blocked_tasks": blocked_list,
            "module_count": len(modules), "estimation": est,
            "runtime": runtime_overview(PROJECT_ROOT),
            "compiler": compiler_state,
        }
    except Exception as exc:
        logger.error("Error in /api/progress: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/milestones")
async def api_milestones():
    try:
        milestone_map = _load_milestones()
        tasks = load_all_tasks(PROJECT_ROOT)
        tasks_by_id = {t.get("id", ""): t for t in tasks}
        result = []
        for ms in milestone_map:
            ms_task_ids = ms.get("tasks", [])
            ms_tasks = [tasks_by_id[tid] for tid in ms_task_ids if tid in tasks_by_id]
            progress = sum(calculate_task_progress(t) for t in ms_tasks) / len(ms_tasks) if ms_tasks else 0.0
            result.append({
                "id": ms["id"], "name": ms["name"],
                "description": ms.get("description", ""),
                "progress": round(progress, 1), "task_count": len(ms_task_ids),
            })
        return result
    except Exception as exc:
        logger.error("Error in /api/milestones: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/activity")
async def api_activity(limit: int = Query(20, ge=1, le=100)):
    try:
        with get_conn() as conn:
            events = conn.execute(
                "SELECT id, task_id, task_title, module, direction, verdict, conclusion_text, created_at "
                "FROM research_events ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
        return [dict(r) for r in events]
    except Exception as exc:
        logger.error("Error in /api/activity: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/status")
async def api_system_status():
    try:
        tasks = load_all_tasks(PROJECT_ROOT)
        modules = load_modules(PROJECT_ROOT)
        runtime = runtime_overview(PROJECT_ROOT)
        return {
            "last_updated": runtime.get("last_runtime_update") or time.time(),
            "task_count": len(tasks), "module_count": len(modules),
            "cache_info": get_cache_info(),
            "runtime": runtime,
            "compiler": load_compiler_state(PROJECT_ROOT),
        }
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/tasks/{task_id}/active-run")
async def api_task_active_run(task_id: str):
    try:
        return get_active_run_for_task(PROJECT_ROOT, task_id)
    except Exception as exc:
        logger.error("Error in /api/tasks/%s/active-run: %s", task_id, traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/tasks/{task_id}/runs")
async def api_task_runs(task_id: str):
    try:
        return {"task_id": task_id, "runs": get_task_runs(PROJECT_ROOT, task_id)}
    except Exception as exc:
        logger.error("Error in /api/tasks/%s/runs: %s", task_id, traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/runs/{run_id}")
async def api_run_detail(run_id: str):
    try:
        detail = get_run_detail(PROJECT_ROOT, run_id)
        if detail is None:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        return detail
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error in /api/runs/%s: %s", run_id, traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/runs/{run_id}/events")
async def api_run_events(run_id: str, after_seq: Optional[int] = Query(None), limit: int = Query(100, ge=1, le=1000)):
    try:
        payload = get_run_events(PROJECT_ROOT, run_id, after_seq=after_seq, limit=limit)
        if payload is None:
            raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
        return payload
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Error in /api/runs/%s/events: %s", run_id, traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.post("/api/trigger/validate")
async def trigger_validate():
    try:
        return await run_validate()
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.post("/api/trigger/sync")
async def trigger_sync():
    try:
        return await run_sync()
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.post("/api/trigger/verify/{task_id}")
async def trigger_verify(task_id: str):
    try:
        return await run_verify(task_id)
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.post("/api/trigger/health-check")
async def trigger_health_check():
    try:
        return await run_health_check()
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.post("/api/research-events")
async def api_add_research_event(body: dict):
    required = {"task_id", "task_title", "module", "direction", "verdict"}
    missing = required - set(body.keys())
    if missing:
        return _error_response(400, "MissingFields", f"Missing: {missing}")
    try:
        with get_conn() as conn:
            conn.execute(
                "INSERT INTO research_events (task_id, task_title, module, direction, verdict, conclusion_text) VALUES (?,?,?,?,?,?)",
                (body["task_id"], body["task_title"], body["module"], body["direction"], body["verdict"], body.get("conclusion_text")),
            )
        return {"status": "ok"}
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/todo")
async def api_todo_get():
    try:
        with get_conn() as conn:
            projects = conn.execute("SELECT id, name, created_at FROM todo_projects ORDER BY id").fetchall()
            tasks = conn.execute(
                "SELECT id, project_id, description, due_label, due_date, completed, completed_at, created_at "
                "FROM todo_tasks ORDER BY project_id, id"
            ).fetchall()
        tasks_by_project: dict[int, list] = {}
        for t in tasks:
            tasks_by_project.setdefault(t["project_id"], []).append(dict(t))
        return [
            {"id": p["id"], "name": p["name"], "created_at": p["created_at"],
             "tasks": tasks_by_project.get(p["id"], [])}
            for p in projects
        ]
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.post("/api/todo/projects")
async def api_todo_add_project(body: dict):
    name = (body.get("name") or "").strip()
    if not name:
        return _error_response(400, "MissingName", "Project name is required")
    try:
        with get_conn() as conn:
            cur = conn.execute("INSERT INTO todo_projects (name) VALUES (?)", (name,))
            return {"id": cur.lastrowid, "name": name}
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.post("/api/todo/tasks")
async def api_todo_add_task(body: dict):
    description = (body.get("description") or "").strip()
    project_id = body.get("project_id")
    if not description or not project_id:
        return _error_response(400, "MissingFields", "description and project_id required")
    try:
        with get_conn() as conn:
            cur = conn.execute(
                "INSERT INTO todo_tasks (project_id, description, due_label, due_date) VALUES (?,?,?,?)",
                (project_id, description, body.get("due_label"), body.get("due_date")),
            )
            return {"id": cur.lastrowid, "project_id": project_id, "description": description}
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.patch("/api/todo/tasks/{task_id}")
async def api_todo_update(task_id: int, body: dict):
    from datetime import datetime, timezone
    try:
        with get_conn() as conn:
            row = conn.execute("SELECT * FROM todo_tasks WHERE id=?", (task_id,)).fetchone()
            if not row:
                raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
            if "completed" in body:
                completed = bool(body["completed"])
                now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") if completed else None
                conn.execute("UPDATE todo_tasks SET completed=?, completed_at=? WHERE id=?", (1 if completed else 0, now, task_id))
            if "description" in body:
                conn.execute("UPDATE todo_tasks SET description=? WHERE id=?", (body["description"], task_id))
            if "due_label" in body or "due_date" in body:
                conn.execute("UPDATE todo_tasks SET due_label=?, due_date=? WHERE id=?",
                             (body.get("due_label"), body.get("due_date"), task_id))
        return {"id": task_id, "updated": True}
    except HTTPException:
        raise
    except Exception as exc:
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/decisions")
async def api_decisions():
    try:
        return {"decisions": load_decisions(PROJECT_ROOT)}
    except Exception as exc:
        logger.error("Error in /api/decisions: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/contracts")
async def api_contracts():
    try:
        return {"contracts": load_contracts(PROJECT_ROOT)}
    except Exception as exc:
        logger.error("Error in /api/contracts: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


@app.get("/api/compiler-state")
async def api_compiler_state():
    try:
        return load_compiler_state(PROJECT_ROOT)
    except Exception as exc:
        logger.error("Error in /api/compiler-state: %s", traceback.format_exc())
        return _error_response(500, "InternalError", str(exc))


frontend_dist = DASHBOARD_DIR / "frontend" / "dist"
if frontend_dist.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dist), html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("DASHBOARD_PORT", "8501"))
    host = os.environ.get("DASHBOARD_HOST", "0.0.0.0")
    logger.info("Starting dashboard on %s:%d", host, port)
    uvicorn.run(app, host=host, port=port, log_level="info")
