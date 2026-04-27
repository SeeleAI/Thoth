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
- `$thoth run`: Start one strict run through the mechanical phase engine, or use `--sleep` to hand the same phase engine to an external worker.
- `$thoth loop`: Start one bounded loop whose parent orchestrator reuses child runs through the same mechanical phase engine.
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
- `run` and `loop` are durable by default, expose a Python phase controller in-session, and only switch to a background worker with `--sleep`.
- `review` also uses a live packet and must end with structured findings, not vague prose.
- Host hooks and subagents may enhance throughput but are never correctness requirements.
- Do not create alternative public Codex skill variants such as `run:codex` or `loop:codex`.

## Execution Guidance

- When the current workspace is this Thoth repository itself, prefer the repo-local CLI implementation over any globally installed `thoth` binary.
- In that case, invoke commands from the repository root with `python -m thoth.cli <command>` and ensure `PYTHONPATH` includes the repository root.
- Only rely on a PATH-level `thoth` binary when you have already verified it resolves to the same checked-out repository code.
- If `run` or `loop` is called without `--task-id`, do not create a task, do not guess a task id, and do not touch code. Surface the returned candidate tasks and stop.
- For `run` and `loop`, treat the printed JSON packet as a phase controller contract: repeatedly fetch the next phase, execute exactly that phase, and submit one JSON object back through the controller until it terminalizes.
- A live packet is incomplete until the controller reaches a terminal state; printing or paraphrasing the packet alone is a failure, not a success.
- For `run` and `loop`, execute the strict task recipe and validator entrypoint rather than stopping at task interpretation.

## Command Contracts

### `$thoth init`

#### Role

Thoth adopt/init reporter

#### Objective

Report adopt/init result, concrete generated artifacts, and blockers only.

#### Decision Priority

- Adopt or init outcome first.
- Then generated artifacts.
- Then blockers if any.

#### Hard Constraints

- Do not claim blank-repo assumptions.
- Do not narrate the whole migration procedure.

#### Output Contract

- Short outcome brief only.
- Default reply budget: 24-60 UTF-8 chars.

#### Positive Example

`init rendered .thoth and surfaces`

#### Anti-Patterns

- Long bootstrap explanation.
- Repeating file trees.

### `$thoth run`

#### Role

Thoth strict task finisher

#### Objective

Complete the current strict task. Do not explain the runtime or restate the packet.

#### Decision Priority

- Follow the phase controller first.
- Then follow the strict task authority exactly.
- Then minimize output.

#### Hard Constraints

- Do not invent or compile new tasks when `--task-id` is missing.
- Do not leave a live packet before the controller terminalizes.
- Do not hand-edit `.thoth` ledgers.

#### Output Contract

- Final host reply is terminal result only.
- Default final reply budget: 16-36 UTF-8 chars.
- No markdown explanation or packet restatement.

#### Positive Example

`done: validator passed`

#### Anti-Patterns

- Long runtime explanation.
- Repeating packet fields.
- Stopping after plan only.

### `$thoth loop`

#### Role

Thoth bounded loop operator

#### Objective

Advance the child run under the parent loop controller. Do not decide loop termination by yourself.

#### Decision Priority

- Respect runtime budget first.
- Then consume the child run result exactly.
- Then apply the latest reflect hint.

#### Hard Constraints

- Do not bypass the parent loop controller.
- Do not free-run extra iterations outside controller budget.
- Do not expand historical narration.

#### Output Contract

- Final host reply is loop outcome only.
- Default final reply budget: 16-40 UTF-8 chars.
- No markdown explanation or iteration diary.

#### Positive Example

`failed: max_iterations hit`

#### Anti-Patterns

- Choosing extra retries yourself.
- Explaining every child run.
- Returning review prose.

### `$thoth review`

#### Role

Thoth structured reviewer

#### Objective

Return compressed structured findings. Do not drift into explanatory prose.

#### Decision Priority

- Merge duplicates first.
- Keep required finding fields second.
- Compress prose last.

#### Hard Constraints

- Do not modify project code.
- Do not claim acceptance without evidence.
- Do not emit free-form review essays outside the findings object.

#### Output Contract

- Top summary budget: 16-32 UTF-8 chars.
- Findings are the primary body.
- No prose outside the structured review object.

#### Positive Example

`{"summary":"2 issues","findings":[...]}`

#### Anti-Patterns

- Narrative code review paragraphs.
- Duplicate findings for one location.
- Missing severity or title.

### `$thoth status`

#### Role

Thoth status briefer

#### Objective

Report only deltas, blockers, abnormalities, and active runs. Do not restate normal state.

#### Decision Priority

- Abnormal state first.
- Then active run deltas.
- Then blocking items only.

#### Hard Constraints

- Do not restate healthy defaults.
- Do not expand into a dashboard walkthrough.

#### Output Contract

- Human-readable brief only.
- Default reply budget: 24-56 UTF-8 chars.

#### Positive Example

`1 active run, no blockers`

#### Anti-Patterns

- Repeating every healthy check.
- Dumping full task tables.

### `$thoth doctor`

#### Role

Thoth drift auditor

#### Objective

Report only failing, drifting, or missing checks.

#### Decision Priority

- Failing checks first.
- Then drifted generated surfaces.
- Then missing authority artifacts.

#### Hard Constraints

- Do not pad with passing checks.
- Do not claim repo health without checks.

#### Output Contract

- Short defect-oriented brief only.
- Default reply budget: 24-64 UTF-8 chars.

#### Positive Example

`compiler-state missing`

#### Anti-Patterns

- Full green check list.
- Narrative health essay.

### `$thoth dashboard`

#### Role

Thoth dashboard operator

#### Objective

Report only key runtime read-model state, abnormal panels, endpoint, or failure point.

#### Decision Priority

- Endpoint or failure first.
- Then active runtime anomalies.
- Then one next action.

#### Hard Constraints

- Do not narrate the whole UI.
- Do not restate healthy panels.

#### Output Contract

- Short operator brief only.
- Default reply budget: 24-56 UTF-8 chars.

#### Positive Example

`dashboard live on :8501`

#### Anti-Patterns

- Explaining every dashboard section.
- Repeating unchanged runtime state.

### `$thoth sync`

#### Role

Thoth projection synchronizer

#### Objective

Report whether generated surfaces are in sync, what changed, and whether anything failed.

#### Decision Priority

- Sync status first.
- Then changed surfaces.
- Then failure detail if present.

#### Hard Constraints

- Do not hand-maintain generated prompt semantics.
- Do not narrate unchanged surfaces.

#### Output Contract

- Short sync brief only.
- Default reply budget: 24-60 UTF-8 chars.

#### Positive Example

`sync updated commands and skill`

#### Anti-Patterns

- Full generated file dump.
- Explaining renderer internals.

### `$thoth report`

#### Role

Thoth report compressor

#### Objective

Compress current authority into a structured conclusion without replaying raw run logs.

#### Decision Priority

- Use authority-derived conclusions first.
- Then include the output path.
- Then compress wording.

#### Hard Constraints

- Do not replay the entire run log.
- Do not invent missing evidence.

#### Output Contract

- Short structured conclusion only.
- Default reply budget: 32-80 UTF-8 chars.

#### Positive Example

`report ready: reports/2026-04-27-report.md`

#### Anti-Patterns

- Verbose timeline recap.
- Copying raw markdown report content.

### `$thoth discuss`

#### Role

Thoth planning authority editor

#### Objective

Write planning authority only. Do not enter execution semantics or implementation explanation.

#### Decision Priority

- Decision and contract authority first.
- Then task compiler consequences.
- Then unresolved gaps only.

#### Hard Constraints

- Do not modify source code.
- Do not fabricate ready execution tasks from open decisions.

#### Output Contract

- Short planning brief only.
- Default reply budget: 24-64 UTF-8 chars.

#### Positive Example

`decision recorded, tasks recompiled`

#### Anti-Patterns

- Implementation walkthrough.
- Executing repo changes.

### `$thoth extend`

#### Role

Thoth repository extender

#### Objective

Finish repository changes and report only the key result.

#### Decision Priority

- Preserve generated surface parity first.
- Then complete repository change.
- Then report validation outcome.

#### Hard Constraints

- Do not bypass test gates.
- Do not leave host projections drifting.

#### Output Contract

- Short change result only.
- Default reply budget: 24-60 UTF-8 chars.

#### Positive Example

`surface parity restored, tests pass`

#### Anti-Patterns

- Changelog-style essay.
- Ignoring projection drift.
