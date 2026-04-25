"""Deterministic Python seed repo for Thoth heavy selftests."""

from __future__ import annotations

from pathlib import Path


SEED_FILES: dict[str, str] = {
    ".gitignore": """\
__pycache__/
.pytest_cache/
""",
    "README.md": """\
# Thoth Deterministic Selftest Repo

This repository is a disposable pure-Python project used by the Thoth heavy
selftest.

Known intentional gaps before the host workflow runs:

- `create_task()` ignores `owner` and `due_date`
- `update_task()` does not persist column changes
- `update_task()` accepts an empty title during updates
""",
    "tracker/__init__.py": """\
\"\"\"Deterministic task tracker used by the Thoth selftest.\"\"\"
""",
    "tracker/store.py": """\
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_PATH = ROOT / "data" / "tasks.json"
VALID_COLUMNS = {"todo", "doing", "done"}


def data_path() -> Path:
    override = os.environ.get("THOTH_SELFTEST_DATA_PATH")
    return Path(override) if override else DEFAULT_DATA_PATH


def load_tasks() -> list[dict]:
    return json.loads(data_path().read_text(encoding="utf-8"))


def save_tasks(tasks: list[dict]) -> None:
    path = data_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(tasks, ensure_ascii=False, indent=2) + "\\n", encoding="utf-8")


def create_task(
    title: str,
    *,
    column: str = "todo",
    owner: str | None = None,
    due_date: str | None = None,
) -> dict:
    normalized = title.strip()
    if not normalized:
        raise ValueError("title required")
    if column not in VALID_COLUMNS:
        raise ValueError("invalid column")
    tasks = load_tasks()
    task = {
        "id": f"task-{uuid.uuid4().hex[:8]}",
        "title": normalized,
        "column": column,
        # Intentional feature gap: owner and due_date are ignored.
        "owner": None,
        "due_date": None,
    }
    tasks.append(task)
    save_tasks(tasks)
    return task


def update_task(
    task_id: str,
    *,
    title: str | None = None,
    column: str | None = None,
    owner: str | None = None,
    due_date: str | None = None,
) -> dict:
    tasks = load_tasks()
    for task in tasks:
        if task["id"] != task_id:
            continue
        # Intentional review target: empty title validation is missing.
        if title is not None:
            task["title"] = title
        if owner is not None:
            task["owner"] = owner
        if due_date is not None:
            task["due_date"] = due_date
        # Intentional bug: column updates are silently ignored.
        if column is not None:
            if column not in VALID_COLUMNS:
                raise ValueError("invalid column")
            task["column"] = task["column"]
        save_tasks(tasks)
        return task
    raise KeyError(f"unknown task: {task_id}")
""",
    "data/tasks.json": """\
[
  {
    "id": "task-1",
    "title": "Inspect runtime packets",
    "column": "todo",
    "owner": "thoth",
    "due_date": "2026-05-01"
  }
]
""",
    "scripts/_validator_support.py": """\
from __future__ import annotations

import json
import os
import shutil
import tempfile
from contextlib import contextmanager
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
BASE_DATA_PATH = ROOT / "data" / "tasks.json"


def read_tasks(path: Path) -> list[dict]:
    return json.loads(path.read_text(encoding="utf-8"))


def task_by_id(tasks: list[dict], task_id: str) -> dict:
    for task in tasks:
        if task["id"] == task_id:
            return task
    raise KeyError(task_id)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(message)


@contextmanager
def isolated_data_file():
    with tempfile.TemporaryDirectory() as tmp_dir:
        temp_path = Path(tmp_dir) / "tasks.json"
        shutil.copy2(BASE_DATA_PATH, temp_path)
        previous = os.environ.get("THOTH_SELFTEST_DATA_PATH")
        os.environ["THOTH_SELFTEST_DATA_PATH"] = str(temp_path)
        try:
            yield temp_path
        finally:
            if previous is None:
                os.environ.pop("THOTH_SELFTEST_DATA_PATH", None)
            else:
                os.environ["THOTH_SELFTEST_DATA_PATH"] = previous
""",
    "scripts/validate_feature.py": """\
from __future__ import annotations

from scripts._validator_support import isolated_data_file, require, task_by_id
from tracker.store import create_task, load_tasks


def main() -> int:
    with isolated_data_file():
        created = create_task(
            "Ship deterministic feature flow",
            owner="ops",
            due_date="2026-05-02",
        )
        reloaded = task_by_id(load_tasks(), created["id"])
        require(created["owner"] == "ops", "create_task() did not return owner")
        require(created["due_date"] == "2026-05-02", "create_task() did not return due_date")
        require(reloaded["owner"] == "ops", "owner was not persisted")
        require(reloaded["due_date"] == "2026-05-02", "due_date was not persisted")
    print("VALIDATION_FEATURE_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
""",
    "scripts/validate_bugfix.py": """\
from __future__ import annotations

from scripts._validator_support import isolated_data_file, require, task_by_id
from tracker.store import create_task, load_tasks, update_task


def main() -> int:
    with isolated_data_file():
        created = create_task("Persist my column")
        update_task(created["id"], column="done")
        reloaded = task_by_id(load_tasks(), created["id"])
        require(reloaded["column"] == "done", "column change did not persist after reload")
    print("VALIDATION_BUGFIX_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
""",
    "scripts/validate_full.py": """\
from __future__ import annotations

from scripts._validator_support import isolated_data_file, require, task_by_id
from tracker.store import create_task, load_tasks, update_task


def main() -> int:
    with isolated_data_file():
        created = create_task(
            "Close review findings",
            owner="qa",
            due_date="2026-05-03",
        )
        update_task(created["id"], column="done")
        reloaded = task_by_id(load_tasks(), created["id"])
        require(reloaded["owner"] == "qa", "feature regression: owner missing")
        require(reloaded["due_date"] == "2026-05-03", "feature regression: due_date missing")
        require(reloaded["column"] == "done", "bugfix regression: column update missing")
        try:
            update_task(created["id"], title="   ")
        except ValueError:
            pass
        else:
            raise SystemExit("review regression: empty title update was accepted")
    print("VALIDATION_FULL_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
""",
}


def seed_host_real_app(project_dir: Path) -> None:
    """Materialize the deterministic Python selftest repo into project_dir."""
    for relative_path, content in SEED_FILES.items():
        target = project_dir / relative_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
