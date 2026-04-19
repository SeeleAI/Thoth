#!/usr/bin/env python3
"""Check consistency of research task system.

Checks:
1. Module related_modules bidirectional consistency
2. Task depends_on cycle detection (DFS)
3. Task module references exist
4. Dependency references exist
5. Paper mapping completeness

Usage:
    python check_consistency.py              # run all checks
"""

import os
import sys
from pathlib import Path
from collections import defaultdict

try:
    import yaml
except ImportError:
    sys.exit("ERROR: pyyaml is required.  Install with:  pip install pyyaml")

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]


def load_modules():
    """Load all _module.yaml files, keyed by module id."""
    modules = {}
    for dirpath, dirnames, filenames in os.walk(SCRIPT_DIR):
        for fn in filenames:
            if fn != "_module.yaml":
                continue
            fp = Path(dirpath) / fn
            try:
                with open(fp, "r", encoding="utf-8") as f:
                    data = yaml.safe_load(f)
                if data and isinstance(data, dict) and "id" in data:
                    modules[data["id"]] = data
            except Exception:
                continue
    return modules


def load_tasks():
    """Load all task YAML files (skip _module.yaml), keyed by task id."""
    tasks = {}
    for dirpath, dirnames, filenames in os.walk(SCRIPT_DIR):
        for fn in sorted(filenames):
            if not fn.endswith((".yaml", ".yml")):
                continue
            if fn == "_module.yaml":
                continue
            fp = Path(dirpath) / fn
            try:
                with open(fp, "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                if data and isinstance(data, dict) and "id" in data:
                    tasks[data["id"]] = data
            except Exception:
                continue
    return tasks


def check_bidirectional(modules):
    """Check that related_modules upstream/downstream links are symmetric."""
    issues = []
    for mid, mod in modules.items():
        related = mod.get("related_modules", {})
        if not isinstance(related, dict):
            continue

        for down in related.get("downstream", []):
            if down in modules:
                up_list = modules[down].get("related_modules", {}).get("upstream", [])
                if mid not in up_list:
                    issues.append(
                        f"Module {mid} lists {down} as downstream, "
                        f"but {down} doesn't list {mid} as upstream"
                    )

        for up in related.get("upstream", []):
            if up in modules:
                down_list = modules[up].get("related_modules", {}).get("downstream", [])
                if mid not in down_list:
                    issues.append(
                        f"Module {mid} lists {up} as upstream, "
                        f"but {up} doesn't list {mid} as downstream"
                    )
    return issues


def check_cycles(tasks):
    """DFS cycle detection on task dependency graph."""
    graph = {}
    for tid, task in tasks.items():
        deps = []
        for d in task.get("depends_on", []):
            dep_id = d.get("task_id") if isinstance(d, dict) else None
            if dep_id:
                deps.append(dep_id)
        graph[tid] = deps

    WHITE, GRAY, BLACK = 0, 1, 2
    color = {tid: WHITE for tid in graph}
    cycles = []

    def dfs(node, path):
        color[node] = GRAY
        for dep in graph.get(node, []):
            if dep not in color:
                continue
            if color[dep] == GRAY:
                cycle_start = path.index(dep)
                cycle = path[cycle_start:] + [dep]
                cycles.append(cycle)
            elif color[dep] == WHITE:
                dfs(dep, path + [dep])
        color[node] = BLACK

    for tid in graph:
        if color[tid] == WHITE:
            dfs(tid, [tid])
    return cycles


def check_module_refs(tasks, modules):
    """Check that every task's module field references an existing module."""
    issues = []
    for tid, task in tasks.items():
        mod = task.get("module")
        if mod and mod not in modules:
            issues.append(f"Task {tid} references non-existent module: {mod}")
    return issues


def check_dependency_refs(tasks):
    """Check that every dependency task_id references an existing task."""
    issues = []
    for tid, task in tasks.items():
        for dep in task.get("depends_on", []):
            dep_id = dep.get("task_id") if isinstance(dep, dict) else None
            if dep_id and dep_id not in tasks:
                issues.append(f"Task {tid} depends on non-existent task: {dep_id}")
    return issues


def check_paper_mapping():
    """Check that paper-module-mapping.yaml exists and has expected structure."""
    mapping_file = SCRIPT_DIR / "paper-module-mapping.yaml"
    if not mapping_file.exists():
        return ["paper-module-mapping.yaml not found"]
    try:
        with open(mapping_file, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
    except Exception as e:
        return [f"paper-module-mapping.yaml parse error: {e}"]
    if not data or "papers" not in data:
        return ["paper-module-mapping.yaml has no 'papers' key"]
    return []


def _report(name, issues):
    """Print PASS/FAIL for a single check category."""
    if issues:
        print(f"FAIL  {name}:")
        for i in issues:
            print(f"  - {i}")
    else:
        print(f"PASS  {name}")


def main():
    print("=== Research Tasks Consistency Check ===\n")
    all_issues = []

    modules = load_modules()
    tasks = load_tasks()

    print(f"Loaded {len(modules)} modules, {len(tasks)} tasks\n")

    # 1. Bidirectional
    issues = check_bidirectional(modules)
    _report("Module bidirectional consistency", issues)
    all_issues.extend(issues)

    # 2. Cycles
    cycles = check_cycles(tasks)
    cycle_issues = [f"Cycle: {' -> '.join(c)}" for c in cycles]
    _report("Dependency cycle detection", cycle_issues)
    all_issues.extend(cycle_issues)

    # 3. Module refs
    issues = check_module_refs(tasks, modules)
    _report("Task module references", issues)
    all_issues.extend(issues)

    # 4. Dependency refs
    issues = check_dependency_refs(tasks)
    _report("Dependency references", issues)
    all_issues.extend(issues)

    # 5. Paper mapping
    issues = check_paper_mapping()
    _report("Paper mapping", issues)
    all_issues.extend(issues)

    print(f"\n{'='*40}")
    if all_issues:
        print(f"FAILED: {len(all_issues)} issues found")
        return 1
    else:
        print("ALL CHECKS PASSED")
        return 0


if __name__ == "__main__":
    sys.exit(main())
