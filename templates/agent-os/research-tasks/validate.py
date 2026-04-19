#!/usr/bin/env python3
"""Validate research-task YAML files against schema.json.

Usage:
    python validate.py                     # validate all YAML files under research-tasks/
    python validate.py path/to/file.yaml   # validate a single file
"""

import json
import os
import sys
from pathlib import Path
from typing import List, Tuple

try:
    import yaml
except ImportError:
    sys.exit("ERROR: pyyaml is required.  Install with:  pip install pyyaml")

try:
    import jsonschema
    from jsonschema import Draft7Validator, ValidationError
except ImportError:
    sys.exit("ERROR: jsonschema is required.  Install with:  pip install jsonschema")

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = SCRIPT_DIR / "schema.json"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def load_schema() -> dict:
    """Load and return the JSON Schema."""
    with open(SCHEMA_PATH, "r", encoding="utf-8") as fh:
        schema = json.load(fh)
    # Pre-check the schema itself is valid Draft-07
    Draft7Validator.check_schema(schema)
    return schema


def discover_yaml_files(root: Path) -> List[Path]:
    """Recursively find all .yaml / .yml files under *root*, skipping schema.json
    and Python files."""
    results: List[Path] = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in sorted(filenames):
            if fn.endswith((".yaml", ".yml")) and fn != "paper-module-mapping.yaml":
                results.append(Path(dirpath) / fn)
    return results


def classify_file(path: Path) -> str:
    """Return 'module' if this looks like a _module.yaml, else 'task'."""
    return "module" if path.name == "_module.yaml" else "task"


def validate_one(path: Path, schema: dict) -> Tuple[bool, str]:
    """Validate a single YAML file.  Returns (passed, message)."""
    try:
        with open(path, "r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
    except Exception as exc:
        return False, f"YAML parse error: {exc}"

    if data is None:
        return False, "File is empty or contains only comments."

    kind = classify_file(path)

    # Build a sub-schema reference for the specific kind
    ref_name = "module" if kind == "module" else "task"
    sub_schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "$ref": f"#/definitions/{ref_name}",
        "definitions": schema.get("definitions", {}),
    }

    validator = Draft7Validator(sub_schema)
    errors = sorted(validator.iter_errors(data), key=lambda e: list(e.path))

    if not errors:
        return True, "OK"

    lines = []
    for err in errors:
        loc = ".".join(str(p) for p in err.absolute_path) or "(root)"
        lines.append(f"  - {loc}: {err.message}")
    return False, "\n".join(lines)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    schema = load_schema()

    if len(sys.argv) > 1:
        targets = [Path(sys.argv[1]).resolve()]
    else:
        targets = discover_yaml_files(SCRIPT_DIR)

    if not targets:
        print("No YAML files found to validate.")
        return 0

    passed = 0
    failed = 0

    for path in targets:
        ok, msg = validate_one(path, schema)
        rel = path.relative_to(SCRIPT_DIR) if path.is_relative_to(SCRIPT_DIR) else path
        kind = classify_file(path)
        if ok:
            print(f"PASS  [{kind}]  {rel}")
            passed += 1
        else:
            print(f"FAIL  [{kind}]  {rel}")
            print(msg)
            failed += 1

    print(f"\n--- {passed} passed, {failed} failed ---")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
