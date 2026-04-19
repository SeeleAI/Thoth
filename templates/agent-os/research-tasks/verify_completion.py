#!/usr/bin/env python3
"""Verify that a completed research task actually meets its own criteria.

Usage:
    python verify_completion.py <task_id>

The script locates the corresponding YAML file in the research-tasks directory
tree, then checks:
  1. Every phase marked "completed" has criteria.current >= criteria.threshold.
     If criteria.current is null while threshold is set, that is a FAIL.
  2. Every phase marked "completed" has all deliverables present on disk.
     Supports both old string format and new array-of-objects format.
  3. If conclusion phase is "completed" but results.verdict is null, that is a FAIL.
  4. If results.verdict is set, all entries in evidence_paths must exist on disk.

Exit code 0 = verified, 1 = one or more checks failed.
"""

import os
import sys
from pathlib import Path
from typing import Dict, List, Optional

try:
    import yaml
except ImportError:
    sys.exit("ERROR: pyyaml is required.  Install with:  pip install pyyaml")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]  # two levels up from research-tasks/

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def find_task_file(task_id: str) -> Optional[Path]:
    """Walk the research-tasks tree and return the first YAML whose 'id' field
    matches *task_id*."""
    for dirpath, _dirnames, filenames in os.walk(SCRIPT_DIR):
        for fn in sorted(filenames):
            if not fn.endswith((".yaml", ".yml")):
                continue
            if fn == "_module.yaml":
                continue
            fp = Path(dirpath) / fn
            try:
                with open(fp, "r", encoding="utf-8") as fh:
                    data = yaml.safe_load(fh)
                if isinstance(data, dict) and data.get("id") == task_id:
                    return fp
            except Exception:
                continue
    return None


def _check_deliverables(phase_name: str, phase: Dict, project_root: Path) -> List[str]:
    """Check all deliverables exist.

    Handles two formats:
      - New format: deliverables is a list of dicts with 'path' and 'type' keys
      - Old format: deliverable is a single string path
    """
    issues: List[str] = []
    deliverables = phase.get("deliverables", [])

    # Also handle old format for backward compatibility
    if not deliverables and "deliverable" in phase:
        old = phase["deliverable"]
        if old:
            deliverables = [{"path": old, "type": "unknown"}]

    for d in deliverables:
        path = d.get("path", "") if isinstance(d, dict) else str(d)
        if path:
            full_path = project_root / path
            if not full_path.exists():
                issues.append(
                    f"Phase '{phase_name}': deliverable not found: {path}"
                )
    return issues


def verify_phase(phase_name: str, phase: Dict) -> List[str]:
    """Return a list of failure messages for a single phase."""
    failures: List[str] = []

    status = phase.get("status")
    if status != "completed":
        return failures  # nothing to check for non-completed phases

    # --- criteria check (with null safety) ---
    criteria = phase.get("criteria", {})
    if criteria:
        threshold = criteria.get("threshold")
        current = criteria.get("current")
        metric = criteria.get("metric", "?")
        unit = criteria.get("unit", "")

        if current is None and threshold is not None:
            failures.append(
                f"Phase '{phase_name}': completed but criteria.current is null "
                f"(threshold={threshold}{unit}).\n"
                f"  -> You must provide a real measured value before marking this phase complete.\n"
                f"  -> Run your experiment, measure '{metric}', then update criteria.current."
            )
        elif current is not None and threshold is not None:
            if current < threshold:
                failures.append(
                    f"Phase '{phase_name}': criteria not met for '{metric}' "
                    f"(current={current}{unit} < threshold={threshold}{unit})"
                )

    # --- deliverable path check (supports both old and new format) ---
    failures.extend(_check_deliverables(phase_name, phase, PROJECT_ROOT))

    return failures


def verify_results(task: Dict) -> List[str]:
    """Check verdict/evidence consistency.

    - If conclusion phase is completed but verdict is null -> FAIL
    - If verdict is set, every evidence_path must exist on disk
    """
    failures: List[str] = []
    results = task.get("results", {}) or {}
    verdict = results.get("verdict")

    # Conclusion completed but no verdict -- check all phase names for a
    # "conclusion" phase (handles both the default 4-phase convention and
    # custom phase names).
    phases = task.get("phases", {})
    conclusion_status = phases.get("conclusion", {}).get("status")
    if conclusion_status == "completed" and verdict is None:
        failures.append(
            "Conclusion phase is completed but results.verdict is null"
        )

    # If verdict is set, check evidence
    if verdict is not None:
        evidence_paths = results.get("evidence_paths", [])
        if not evidence_paths:
            failures.append(
                f"Results verdict is '{verdict}' but evidence_paths is empty."
            )
        for ep in evidence_paths:
            if not (PROJECT_ROOT / ep).exists():
                failures.append(f"Evidence path does not exist: {ep}")

    return failures


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <task_id>", file=sys.stderr)
        return 1

    task_id = sys.argv[1]
    task_file = find_task_file(task_id)

    if task_file is None:
        print(f"FAIL: No YAML file found with id '{task_id}'.")
        return 1

    rel = task_file.relative_to(SCRIPT_DIR) if task_file.is_relative_to(SCRIPT_DIR) else task_file
    print(f"Task file: {rel}")

    with open(task_file, "r", encoding="utf-8") as fh:
        data = yaml.safe_load(fh)

    all_failures: List[str] = []

    # --- Phase-level checks ---
    # Iterate over all phases found in the YAML rather than only the default 4.
    # The default convention is (survey, method_design, experiment, conclusion)
    # but custom phase names are also supported.
    phases = data.get("phases", {})
    for phase_name, phase in phases.items():
        if phase is None:
            continue
        all_failures.extend(verify_phase(phase_name, phase))

        # Sub-experiments inside the experiment phase
        if phase_name == "experiment":
            for sub in phase.get("sub_experiments", []):
                sub_name = sub.get("name", "unnamed")
                all_failures.extend(verify_phase(f"experiment/{sub_name}", sub))

    # --- Results-level checks (verdict + evidence) ---
    all_failures.extend(verify_results(data))

    # --- Report ---
    if all_failures:
        print(f"\nFAIL  ({len(all_failures)} issue(s)):")
        for f in all_failures:
            print(f"  - {f}")
        return 1
    else:
        print("\nPASS: All completion checks verified.")
        return 0


if __name__ == "__main__":
    sys.exit(main())
