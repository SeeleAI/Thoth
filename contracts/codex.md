# Thoth Codex Delegation Contract

Codex is an executor mode, not a separate public command surface.

## Public Interface

- `run`, `loop`, and `review` accept `--executor claude|codex`.
- Default executor is `claude`.

## Internal Routing

- When `--executor codex` is selected, delegate to the internal `codex-worker` agent.
- Keep Thoth responsible for validation, sync, and reporting after delegated work completes.

## Command Surface Rule

- Do not create public slash commands whose only purpose is selecting Codex.
- Do not expose internal worker names in the public command list.
