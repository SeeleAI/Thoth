# Thoth Testing Contract

These rules govern plugin and generated-project verification.

## Plugin Tests

- Plugin behavior changes should update tests together.
- New command semantics should be covered by focused unit or integration tests.

## Project Tests

- `doctor` should continue treating generated project tests as a health signal.
- Validation, consistency, sync freshness, and dashboard basics should remain script-backed.
