"""RunResult -> TaskResult projection helpers."""

from .compiler import (
    apply_run_result_to_task_result,
    rebuild_task_results_from_runs,
    update_task_result_from_run_result,
)

__all__ = [
    "apply_run_result_to_task_result",
    "rebuild_task_results_from_runs",
    "update_task_result_from_run_result",
]

