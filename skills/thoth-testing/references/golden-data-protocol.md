# Golden Data Testing Protocol

How to construct and use golden test fixtures for Thoth.

## Fixture Structure

```
tests/fixtures/golden/
├── config/           # Project configuration variants
├── tasks/            # Research task YAML variants
├── modules/          # Module definition variants
├── milestones/       # Milestone definition variants
└── expected/         # Expected outputs for comparison
```

## Construction Rules

### Valid Cases
- Must pass all validation scripts without errors
- Represent realistic project state
- Include all required fields

### Invalid Cases
- Each invalid fixture targets ONE specific failure mode
- Name includes the failure type: `invalid_missing_id.yaml`, `invalid_cycle.yaml`
- Document the expected error message

### Edge Cases
- null values where allowed (criteria.current)
- Empty arrays (no tasks, no deliverables)
- Maximum reasonable size (20+ tasks)
- Unicode content (Chinese labels, special characters)

## Test Patterns

### Schema Validation Tests
```python
def test_valid_task_passes(golden_task_valid):
    errors = validate(golden_task_valid)
    assert errors == []

def test_invalid_task_fails(golden_task_invalid):
    errors = validate(golden_task_invalid)
    assert len(errors) > 0
    assert "required" in errors[0].message
```

### Comparison Tests
```python
def test_status_output(golden_project, expected_status):
    output = run_status(golden_project)
    assert output == expected_status
```

### API Tests
```python
def test_progress_endpoint(golden_project, expected_progress):
    response = client.get("/api/progress")
    assert response.json() == expected_progress
```

## Autonomy Rules

- Tests MUST NOT require user input (no prompts, no confirmations)
- Tests MUST NOT depend on network access
- Tests MUST NOT depend on specific system state (time, env vars)
- Tests MUST clean up after themselves (use tmp directories)
- Tests MUST produce clear error messages (assert messages explain what went wrong)
