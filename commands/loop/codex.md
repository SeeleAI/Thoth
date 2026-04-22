---
name: thoth:loop:codex
description: Autonomous loop where Phase 3 (Modify) is delegated to Codex
argument-hint: "--mode=task|metric [--iterations=N] [--model <model>] [--effort <level>] ..."
---

# /thoth:loop:codex

Same as /thoth:loop but Phase 3 (Modify) is delegated to Codex each iteration.

## Loop Structure

Claude controls ALL phases. Only Phase 3 is delegated:

```
Phase 0-2: Claude (preconditions, review, ideate)
Phase 3:   Codex (modify — via codex:codex-rescue)
Phase 4-8: Claude (commit, verify, guard, decide, log, continue)
```

## Phase 3 Delegation

Each iteration, Claude:
1. Formulates a specific, concrete task description based on Phase 2 ideation
2. Invokes Codex:
   ```
   Agent(subagent_type: "codex:codex-rescue", prompt: "<specific task>")
   ```
3. Waits for Codex completion
4. Proceeds to Phase 4 (commit what Codex produced)

## Parameter Forwarding

`--model` and `--effort` from loop arguments are forwarded to every
Codex invocation within the loop.
