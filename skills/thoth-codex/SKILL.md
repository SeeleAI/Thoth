---
name: thoth-codex
description: >
  Codex delegation runtime. Defines how to invoke codex:codex-rescue for
  run:codex, loop:codex, and review:codex variants. Handles parameter
  forwarding and result processing.
version: 0.1.0
---

# thoth-codex — Codex Delegation Contract

## 1. Invocation Pattern

All :codex variants invoke the existing codex plugin's rescue mechanism:

```
Agent(subagent_type: "codex:codex-rescue", prompt: "<task description>")
```

**Do NOT reimplement codex integration.** Use the installed codex plugin directly.

## 2. Parameter Forwarding

From user arguments, forward to codex:
- `--model <model>` → forwarded as-is (e.g., `--model gpt-5.4`)
- `--effort <level>` → forwarded as-is (e.g., `--effort high`)
- `--resume` / `--fresh` → forwarded for thread management

Strip from forwarded prompt:
- `--background` / `--wait` (execution mode flags)
- Any thoth-specific flags (--mode, --iterations)

## 3. Mode-Specific Behavior

### /thoth:run:codex
- Entire task delegated to Codex
- After Codex completes: run validation + commit + sync

### /thoth:loop:codex
- Claude controls the main loop (all phases)
- Only Phase 3 (Modify) is delegated to Codex each iteration
- Claude does: Review → Ideate → [Codex: Modify] → Commit → Verify → Decide → Log

### /thoth:review:codex
- Entire review delegated to Codex
- Return Codex output verbatim
- No post-processing except recording conclusions

## 4. Result Handling

After Codex completes:
1. Display Codex output to user (verbatim)
2. Run Thoth validation (validate.py, verify_completion.py if applicable)
3. If validation passes: proceed with commit + sync
4. If validation fails: report failure, suggest /thoth:run to fix
