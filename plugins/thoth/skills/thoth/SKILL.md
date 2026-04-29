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
- `$thoth run`: Start one validator-centered strict run bound to `work_id@revision`, or use `--sleep` to hand the same controller to an external worker.
- `$thoth loop`: Start one bounded controller service whose parent creates validator-centered child runs.
- `$thoth review`: Prepare a structured live review packet through the shared Thoth surface.
- `$thoth orchestration`: Create a controller object that schedules ready work items by object-graph dependencies.
- `$thoth auto`: Create a linear controller queue for multiple ready work items.
- `$thoth status`: Show repo status and active durable runs from the shared ledger.
- `$thoth doctor`: Audit project health, generated surfaces, and runtime shape.
- `$thoth dashboard`: Start or describe the task-first dashboard backed by .thoth ledgers.
- `$thoth sync`: Synchronize generated surfaces and project projections from their canonical sources.
- `$thoth report`: Build a structured report from the current authority state.
- `$thoth discuss`: Discuss or record planning decisions without entering implementation execution.
- `$thoth extend`: Evolve Thoth itself under the generated test gates.

## Dispatcher

- `.thoth` is the only runtime authority.
- Parse the requested `$thoth <command>`, then open only the matching micro prompt under `./commands/<command>.md`.
- Execute the literal shell command immediately; do not replace it with explanation.
- If the plugin-installed `thoth` wrapper is missing in a fresh environment, treat that as host install drift.
- Do not create alternative public Codex variants such as `run:codex` or `loop:codex`.

## Route Table

- `init` -> `mechanical_fast` / `none` / `result_envelope`
- `run` -> `live_intelligent` / `high` / `phase_controller`
- `loop` -> `live_intelligent` / `high` / `phase_controller`
- `review` -> `live_intelligent` / `high` / `review_packet`
- `orchestration` -> `mechanical_fast` / `none` / `result_envelope`
- `auto` -> `mechanical_fast` / `none` / `result_envelope`
- `status` -> `mechanical_fast` / `none` / `result_envelope`
- `doctor` -> `mechanical_fast` / `none` / `result_envelope`
- `dashboard` -> `mechanical_fast` / `none` / `result_envelope`
- `sync` -> `mechanical_fast` / `none` / `result_envelope`
- `report` -> `mechanical_fast` / `none` / `result_envelope`
- `discuss` -> `live_intelligent` / `high` / `command_packet`
- `extend` -> `live_intelligent` / `high` / `command_packet`

## Shared Rules

- `init`, `status`, `doctor`, `dashboard`, `sync`, and `report` are mechanical fast-path commands and should return only short receipts.
- `discuss`, `extend`, `run`, `loop`, and open-ended `review` are high-intelligence paths.
- `review` exact-match/probe flows are protocol-fast: if the packet exposes an exact result, do not improvise.
- `run` and `loop` are validator-centered: default lifecycle is `execute -> validate`, and `reflect` appears only after validator failure.
- Host hooks and subagents may improve throughput but are never correctness requirements.
