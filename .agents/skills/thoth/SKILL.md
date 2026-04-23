---
name: thoth
description: Official Codex public surface for the Thoth authority runtime. Use this skill when the user wants to operate Thoth through the single `$thoth <command>` public entry.
---

# Thoth

Official Codex public surface for Thoth. This skill is generated from the same host-neutral command specification that renders the Claude `/thoth:*` commands.

## Public Entry

Use the single public entrypoint:

- `$thoth <command>`

Supported commands:
- `$thoth init`: Initialize canonical .thoth authority and render both Claude/Codex project layers.
- `$thoth run`: Create one durable run under the shared runtime and attach in the foreground by default.
- `$thoth loop`: Create one durable autonomous loop under the shared runtime and attach in the foreground by default.
- `$thoth review`: Review code or plans through the shared Thoth surface.
- `$thoth status`: Show repo status and active durable runs from the shared ledger.
- `$thoth doctor`: Audit project health, generated surfaces, and runtime shape.
- `$thoth dashboard`: Start or describe the task-first dashboard backed by .thoth ledgers.
- `$thoth sync`: Synchronize generated surfaces and project projections from their canonical sources.
- `$thoth report`: Build a structured report from the current authority state.
- `$thoth discuss`: Discuss or record planning decisions without entering implementation execution.
- `$thoth extend`: Evolve Thoth itself under the generated test gates.

## Runtime Rules

- `.thoth` is the only runtime authority.
- `run` and `loop` are durable by default and support attach/watch/stop semantics.
- Host hooks and subagents may enhance throughput but are never correctness requirements.
- Do not create alternative public Codex skill variants such as `run:codex` or `loop:codex`.

## Execution Guidance

- When the current workspace is this Thoth repository itself, prefer the repo-local CLI implementation over any globally installed `thoth` binary.
- In that case, invoke commands from the repository root with `python -m thoth.cli <command>` and ensure `PYTHONPATH` includes the repository root.
- Only rely on a PATH-level `thoth` binary when you have already verified it resolves to the same checked-out repository code.
