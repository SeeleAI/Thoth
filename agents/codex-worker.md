---
name: codex-worker
description: >
  Internal worker for Codex-backed execution or review inside Thoth. Intended to
  be called by public Thoth commands when `--executor codex` is selected.
---

# codex-worker

This worker bridges Thoth to the installed Codex plugin.

## Rules

1. Use the installed Codex companion from the Codex plugin root when available.
2. Forward model and effort flags if they were provided by the caller.
3. Return delegation output faithfully so the calling command can validate and report it.
4. Do not create new public command names or user-facing slash entry points.
