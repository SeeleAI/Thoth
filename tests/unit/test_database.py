"""Tests for SQLite database operations (database.py)."""

import sqlite3
import sys
from pathlib import Path

import pytest

# Add source paths
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "templates" / "dashboard" / "backend"))
sys.path.insert(0, str(Path(__file__).parent.parent.parent / "scripts"))

import database as db_module


@pytest.fixture
def test_db(tmp_path, monkeypatch):
    """Set up a temporary database for testing."""
    db_path = tmp_path / "test_thoth.db"
    monkeypatch.setattr(db_module, "DB_PATH", db_path)
    return db_path


def _get_test_conn(db_path):
    """Create a connection to the test database."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def test_init_db_creates_tables(test_db):
    """After init_db(), all expected tables should exist."""
    db_module.init_db()

    conn = _get_test_conn(test_db)
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    )
    tables = {row["name"] for row in cursor.fetchall()}
    conn.close()

    assert "research_events" in tables, f"Expected research_events table, got: {tables}"
    assert "todo_projects" in tables, f"Expected todo_projects table, got: {tables}"
    assert "todo_tasks" in tables, f"Expected todo_tasks table, got: {tables}"


def test_insert_research_event(test_db):
    """Inserting and querying a research event should work."""
    db_module.init_db()

    conn = _get_test_conn(test_db)
    conn.execute(
        """INSERT INTO research_events (task_id, task_title, module, direction, verdict, conclusion_text)
           VALUES (?, ?, ?, ?, ?, ?)""",
        ("f1-h2", "OAuth Integration", "f1", "frontend", "confirmed",
         "72% friction reduction achieved"),
    )
    conn.commit()

    cursor = conn.execute("SELECT * FROM research_events WHERE task_id = ?", ("f1-h2",))
    row = cursor.fetchone()
    conn.close()

    assert row is not None, "Expected to find the inserted research event"
    assert row["task_id"] == "f1-h2"
    assert row["verdict"] == "confirmed"
    assert row["module"] == "f1"
    assert row["direction"] == "frontend"
    assert row["conclusion_text"] == "72% friction reduction achieved"


def test_todo_crud(test_db):
    """Test create, read, update, and query for todo projects and tasks."""
    db_module.init_db()

    conn = _get_test_conn(test_db)

    # Create project
    cursor = conn.execute(
        "INSERT INTO todo_projects (name) VALUES (?)", ("Test Project",)
    )
    project_id = cursor.lastrowid
    conn.commit()
    assert project_id is not None, "Expected project_id after insert"

    # Add task
    cursor = conn.execute(
        """INSERT INTO todo_tasks (project_id, description, due_label)
           VALUES (?, ?, ?)""",
        (project_id, "Write unit tests", "this week"),
    )
    task_id = cursor.lastrowid
    conn.commit()

    # Query task
    cursor = conn.execute(
        "SELECT * FROM todo_tasks WHERE project_id = ?", (project_id,)
    )
    tasks = cursor.fetchall()
    assert len(tasks) == 1, f"Expected 1 task, got {len(tasks)}"
    assert tasks[0]["description"] == "Write unit tests"
    assert tasks[0]["completed"] == 0

    # Complete task
    conn.execute(
        """UPDATE todo_tasks SET completed = 1,
           completed_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
           WHERE id = ?""",
        (task_id,),
    )
    conn.commit()

    cursor = conn.execute("SELECT * FROM todo_tasks WHERE id = ?", (task_id,))
    updated = cursor.fetchone()
    assert updated["completed"] == 1, "Expected task to be marked completed"
    assert updated["completed_at"] is not None, "Expected completed_at timestamp"

    conn.close()


def test_indexes_exist(test_db):
    """Verify that expected indexes are created after init_db()."""
    db_module.init_db()

    conn = _get_test_conn(test_db)
    cursor = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='index' ORDER BY name"
    )
    indexes = {row["name"] for row in cursor.fetchall()}
    conn.close()

    expected_indexes = [
        "idx_research_events_created",
        "idx_research_events_task",
        "idx_todo_tasks_project",
        "idx_todo_tasks_completed",
    ]
    for idx in expected_indexes:
        assert idx in indexes, f"Expected index '{idx}' to exist, found: {indexes}"


def test_init_db_idempotent(test_db):
    """Calling init_db() multiple times should not fail or corrupt data."""
    db_module.init_db()

    conn = _get_test_conn(test_db)
    conn.execute(
        """INSERT INTO research_events (task_id, task_title, module, direction, verdict)
           VALUES (?, ?, ?, ?, ?)""",
        ("t1", "Test", "m1", "d1", "confirmed"),
    )
    conn.commit()
    conn.close()

    # Call init_db() again
    db_module.init_db()

    conn = _get_test_conn(test_db)
    cursor = conn.execute("SELECT COUNT(*) as cnt FROM research_events")
    count = cursor.fetchone()["cnt"]
    conn.close()

    assert count == 1, f"Expected 1 event after re-init, got {count}"


def test_foreign_key_constraint(test_db):
    """Inserting a todo_task with invalid project_id should fail with foreign keys on."""
    db_module.init_db()

    conn = _get_test_conn(test_db)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute(
            """INSERT INTO todo_tasks (project_id, description)
               VALUES (?, ?)""",
            (99999, "orphan task"),
        )
    conn.close()
