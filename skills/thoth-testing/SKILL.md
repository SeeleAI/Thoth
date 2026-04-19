---
name: thoth-testing
description: >
  Testing discipline and golden data methodology. Defines how to construct
  test fixtures, write autonomous tests, and maintain coverage. Loaded for
  /thoth:doctor and /thoth:extend.
version: 0.1.0
---

# thoth-testing — Testing Discipline Contract

## 1. Golden Data Methodology

Every test uses pre-constructed fixtures from `tests/fixtures/golden/`:
- **Valid cases**: Known-good inputs with expected outputs
- **Invalid cases**: Known-bad inputs that should trigger specific errors
- **Edge cases**: Boundary conditions (null values, empty arrays, cycles)

### Rules
- Tests MUST be deterministic — same input always produces same output
- Tests MUST be autonomous — no user interaction, no prompts
- Tests MUST have clear error messages — readable without debugging
- Tests MUST compare against golden expected outputs

## 2. Plugin Tests

Location: `tests/` in the thoth plugin directory
Framework: pytest

Coverage requirements:
- Every script in `scripts/` has a `test_*.py`
- Every script in `templates/agent-os/research-tasks/` has a `test_*.py`
- Every dashboard endpoint has test coverage in `test_dashboard_api.py`
- Integration tests for init workflow and loop protocol

## 3. Project Tests

Location: `tests/` in the target project (deployed by init)
Run by: `/thoth:doctor`

Tests the LOCAL instance of:
- validate.py (schema validation)
- verify_completion.py (completion checks)
- check_consistency.py (graph consistency)
- sync_todo.py (sync freshness)
- Dashboard API endpoints

## 4. Test-Gated Operations

### /thoth:extend
Before accepting any plugin modification:
1. Run `pytest tests/ -v` in plugin directory
2. If ANY test fails → revert ALL changes
3. New functionality MUST include corresponding tests

### /thoth:doctor
Runs project-level tests as part of health check:
1. `pytest tests/ -v` in target project (if tests/ exists)
2. Report pass/fail as part of doctor output

## 5. Reference

- `references/golden-data-protocol.md` — How to construct fixtures
