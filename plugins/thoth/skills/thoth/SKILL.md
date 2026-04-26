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
- `$thoth init`: Initialize canonical .thoth authority and render both host projections without taking ownership of repo-root `.codex`.
- `$thoth run`: Prepare one strict run packet for live in-session execution, or use `--sleep` to hand it to an external worker.
- `$thoth loop`: Prepare one strict loop packet for live in-session iteration, or use `--sleep` to hand it to an external worker.
- `$thoth review`: Prepare a structured live review packet through the shared Thoth surface.
- `$thoth status`: Show repo status and active durable runs from the shared ledger.
- `$thoth doctor`: Audit project health, generated surfaces, and runtime shape.
- `$thoth dashboard`: Start or describe the task-first dashboard backed by .thoth ledgers.
- `$thoth sync`: Synchronize generated surfaces and project projections from their canonical sources.
- `$thoth report`: Build a structured report from the current authority state.
- `$thoth discuss`: Discuss or record planning decisions without entering implementation execution.
- `$thoth extend`: Evolve Thoth itself under the generated test gates.

## Runtime Rules

- `.thoth` is the only runtime authority.
- `run` and `loop` are durable by default, prepare live packets in-session, and only switch to a background worker with `--sleep`.
- `review` also uses a live packet and must end with structured findings, not vague prose.
- Host hooks and subagents may enhance throughput but are never correctness requirements.
- Do not create alternative public Codex skill variants such as `run:codex` or `loop:codex`.

## Execution Guidance

- When the current workspace is this Thoth repository itself, prefer the repo-local CLI implementation over any globally installed `thoth` binary.
- In that case, invoke commands from the repository root with `python -m thoth.cli <command>` and ensure `PYTHONPATH` includes the repository root.
- Only rely on a PATH-level `thoth` binary when you have already verified it resolves to the same checked-out repository code.
- For `run`, `loop`, and `review`, treat the printed JSON packet as an execution contract: keep progress/heartbeat/events synced with the internal protocol commands until you call `complete` or `fail`.
- A live packet is incomplete until it reaches a terminal protocol write; printing or paraphrasing the packet alone is a failure, not a success.
- For `run` and `loop`, execute the strict task recipe and validator entrypoint rather than stopping at task interpretation.
