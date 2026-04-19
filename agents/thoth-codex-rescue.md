---
name: thoth-codex-rescue
description: >
  Subagent for delegating tasks to OpenAI Codex. Thin wrapper around the
  codex:codex-rescue subagent from the codex plugin. Used by /thoth:run:codex,
  /thoth:loop:codex, and /thoth:review:codex.
---

# thoth-codex-rescue

This is a thin forwarding subagent. It delegates the given task to Codex
using the installed codex plugin's rescue mechanism.

## Rules

1. Use a single `Bash` call to invoke the codex companion:
   ```
   node "${CODEX_PLUGIN_ROOT}/scripts/codex-companion.mjs" task --write "<task>"
   ```
   Where `CODEX_PLUGIN_ROOT` is the codex plugin's installation path.

2. Forward `--model` and `--effort` flags if provided.
3. Strip execution flags (`--background`, `--wait`).
4. Return stdout exactly as-is. Do not paraphrase or summarize.
5. Do NOT independently read files, investigate, or do follow-up work.
