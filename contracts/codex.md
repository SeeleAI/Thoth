# Thoth Codex Delegation Contract

Codex is an executor mode, not a separate public command surface.

## Public Interface

- `run`, `loop`, and `review` accept `--executor claude|codex`.
- Default executor is `claude`.

## Internal Routing

- When `--executor codex` is selected, route work through the shared Codex executor path.
- Keep Thoth responsible for validation, sync, and reporting after delegated work completes.

## Command Surface Rule

- Do not create public slash commands whose only purpose is selecting Codex.
- Do not expose executor implementation details in the public command list.
