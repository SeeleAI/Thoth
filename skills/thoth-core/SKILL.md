---
name: thoth-core
description: >
  Core behavioral contract for all Thoth commands. Enforces scope guards,
  plan mode compatibility, and task state machine transitions. Loaded for
  every /thoth:* command invocation.
version: 0.1.0
---

# thoth-core — Core Behavioral Contract

Every Thoth command MUST follow these rules. No exceptions.

## 1. Scope Guard Enforcement

Each command declares a CAN/CANNOT list in its command file. Before taking any
action, verify it falls within the command's declared scope.

**If the user's request is outside this command's scope:**
1. STOP immediately
2. Name the correct command: "This is outside /thoth:{current}'s scope. Use /thoth:{correct} instead."
3. Do NOT attempt the action

## 2. Plan Mode Protocol

When plan mode is active:
1. **Read-only phase**: Explore codebase, read state, understand context
2. **Draft plan**: Write a concrete plan to the plan file
3. **Wait for approval**: Call ExitPlanMode — do NOT ask "is this okay?" via text
4. **Execute exactly**: After approval, execute the plan with ZERO drift

**Zero-drift rule**: The executed actions must match the approved plan exactly.
If you discover something unexpected during execution, STOP and inform the user
rather than silently adapting.

## 3. Task State Machine

Valid state transitions:
```
pending → in_progress → completed
pending → in_progress → skipped (with reason)
pending → skipped (with reason)
```

Invalid transitions (BLOCKED):
```
pending → completed (must go through in_progress)
completed → pending (no reversal)
skipped → in_progress (must create new task)
```

## 4. Error Routing

When a command encounters an error:
1. **Identify** the error type (precondition failure, script error, validation failure)
2. **Report** with specific, actionable message
3. **Never** silently skip or work around the error
4. **Suggest** the correct recovery action

## 5. Argument Parsing

Commands receive arguments via `$ARGUMENTS`. Parse them according to each
command's `argument-hint` specification. Unknown flags should be reported, not
silently ignored.

## 6. Session Awareness

- Check for `.research-config.yaml` before any command (except init)
- If missing: "No Thoth project detected. Run /thoth:init first."
- Read project name and language from config for all outputs
