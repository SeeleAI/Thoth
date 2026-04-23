# Legacy Codex Rescue Note

Earlier Thoth iterations exposed dedicated public Codex command variants and a
matching rescue agent.

That shape was retired in favor of:

- a smaller public `/thoth:*` command surface
- `--executor codex` as an execution mode on `run`, `loop`, and `review`
- an internal `codex-worker` agent for delegation

This note exists only to document the migration.
