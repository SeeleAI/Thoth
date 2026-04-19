---
name: thoth:review:codex
description: Delegate first-principles review to Codex
argument-hint: "[--model <model>] [--effort <level>] <what to review>"
---

# /thoth:review:codex

Delegates the review to Codex via codex:codex-rescue.

## Workflow

1. Parse `--model`, `--effort` from arguments
2. Formulate review prompt for Codex (include relevant file paths and context)
3. Invoke: `Agent(subagent_type: "codex:codex-rescue", prompt: "<review request>")`
4. Return Codex output verbatim
5. If significant conclusions: record in .agent-os/ docs
