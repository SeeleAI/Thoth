[English](./README.md) | [简体中文](./README.zh-CN.md)

<div align="center">
  <h1>🐦 Thoth — Dashboard-First Runtime for Autoresearch</h1>
  <img src="assets/thoth.png" width="80%" alt="Thoth logo" />
  <p><strong>Dashboard-first orchestration runtime for autoresearch.</strong></p>
  <p>Turn drifting agent work into durable runs, locked contracts, and reviewable verdicts.</p>
  <p>
    <img alt="Runtime Dashboard First" src="https://img.shields.io/badge/runtime-dashboard--first-4B5563?style=for-the-badge&labelColor=3F3F46&color=0F766E" />
    <img alt="Mode Autoresearch" src="https://img.shields.io/badge/mode-autoresearch-4B5563?style=for-the-badge&labelColor=3F3F46&color=B45309" />
    <img alt="Engine Orchestration" src="https://img.shields.io/badge/engine-orchestration-4B5563?style=for-the-badge&labelColor=3F3F46&color=2563EB" />
    <img alt="Trust Contract Locked" src="https://img.shields.io/badge/trust-contract--locked-4B5563?style=for-the-badge&labelColor=3F3F46&color=6D28D9" />
  </p>
  <p>
    <img alt="Claude Code Plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-4B5563?style=flat-square&labelColor=3F3F46&color=0284C7" />
    <img alt="Codex Plugin" src="https://img.shields.io/badge/Codex-plugin-4B5563?style=flat-square&labelColor=3F3F46&color=65A30D" />
    <img alt="Strict Tasks --task-id" src="https://img.shields.io/badge/tasks-strict%20--task--id-4B5563?style=flat-square&labelColor=3F3F46&color=7C3AED" />
    <img alt="Version 0.1.4" src="https://img.shields.io/badge/version-0.1.4-4B5563?style=flat-square&labelColor=3F3F46&color=0369A1" />
    <img alt="License MIT" src="https://img.shields.io/badge/license-MIT-4B5563?style=flat-square&labelColor=3F3F46&color=84CC16" />
  </p>
  <img src="assets/thoth-teaser-figure.png" width="100%" alt="Thoth concept banner" />
</div>

## Why Thoth

Thoth is a dashboard-first orchestration runtime for autoresearch. It assumes chat alone is not an operating system: truth must survive the session, progress must stay visible, and completion must be mechanically testable.

## Failure Modes Table

| Problem | Why it matters |
| --- | --- |
| Work is not persistent | A useful run can disappear with the session, leaving no durable state to resume or audit. |
| Parallel work is invisible | Multiple threads or delegated runs drift apart, and humans cannot see what is actually active. |
| Agents can claim completion too early | A fluent summary can hide that nothing mechanical passed. |
| Docs and state rot over time | Decisions, contracts, and runtime facts drift until nobody knows which layer is authoritative. |

## Thoth Response Table

| Mechanism | What it does | Counters |
| --- | --- | --- |
| Hooks + watchdog + runtime | Keep execution attached to durable ledgers and observable lifecycle events. | Work is not persistent |
| Dashboard-first visibility | Show live, stale, attachable, and host-specific runtime truth in one read surface. | Parallel work is invisible |
| Mechanical yes/no acceptance | Force validators, ledgers, and result payloads to decide whether work really passed. | Agents can claim completion too early |
| Decision system + execution system + locked contracts | Freeze what is allowed, compile it into tasks, and keep authority layers from drifting. | Docs and state rot over time |

## System At A Glance

Humans should not spend their attention tracking every grain of sand in the funnel. Thoth lets AI own the middle of the hourglass, while the dashboard shows the gold that survives: decisions, tasks, runs, results, and the current verdict.

## Architecture Flow Table

| Stage | Purpose | Input | Output |
| --- | --- | --- | --- |
| Intent | Capture the user request and operating boundary. | Human goals, constraints, repo context | Direction for planning |
| Decision | Lock key choices before execution drifts. | Intent, open questions, policy constraints | Recorded decisions |
| Contract | Freeze what is allowed and what counts as done. | Decisions, requirements, acceptance rules | Locked contracts |
| Task | Compile executable work items from the contract. | Contracts, project state, compiler rules | Strict task specs |
| Run | Execute one task through a durable runtime packet. | Task spec, host surface, executor | `.thoth/runs/<run_id>` ledger |
| Result | Produce a mechanical verdict instead of narration alone. | Validator outputs, artifacts, runtime checks | Structured result and acceptance evidence |
| Dashboard | Let humans read the final state without replaying the chat. | Ledgers, read models, derived summaries | Inspectable project truth |

## Quick Start

1. Install Thoth on the host surfaces you use.

```bash
claude plugin marketplace add SeeleAI/Thoth --scope user
claude plugin install thoth@thoth --scope user
codex plugin marketplace add SeeleAI/Thoth
```

2. Initialize the repository you want Thoth to manage.

```text
/thoth:init
$thoth init
```

3. Start the first strict run from a compiled task.

```text
/thoth:run --task-id task-1
$thoth run --task-id task-1
```

4. Open the read surface.

```text
/thoth:dashboard
$thoth dashboard
```

## Command Matrix

| Command | Host Surface | Purpose | Input | Result |
| --- | --- | --- | --- | --- |
| `init` | `Claude: /thoth:init`<br>`Codex: $thoth init` | Audit the repo and materialize canonical Thoth authority. | Optional project metadata or config payload | `.thoth` authority, generated projections, dashboard scaffolding, scripts, and tests |
| `discuss` | `Claude: /thoth:discuss`<br>`Codex: $thoth discuss` | Record planning decisions without entering code execution. | Topic, decision payload, or contract payload | Updated decision or contract authority plus recompiled task state |
| `run` | `Claude: /thoth:run`<br>`Codex: $thoth run` | Execute one strict task through a durable runtime packet. | `--task-id`, optional host or executor controls, optional attach/watch/stop | Durable run ledger with state, events, artifacts, and terminal result |
| `loop` | `Claude: /thoth:loop`<br>`Codex: $thoth loop` | Iterate on one strict task with durable resume and stop semantics. | `--task-id`, optional resume or sleep controls | Recoverable loop ledger and bounded iteration history |
| `review` | `Claude: /thoth:review`<br>`Codex: $thoth review` | Produce structured findings without modifying source code. | Review target, optional `--task-id`, optional executor controls | Structured review result recorded through the shared protocol |
| `status` | `Claude: /thoth:status`<br>`Codex: $thoth status` | Show project health and active durable runs. | Optional `--json` | Shared status snapshot derived from authority and local registry |
| `dashboard` | `Claude: /thoth:dashboard`<br>`Codex: $thoth dashboard` | Start or manage the local dashboard runtime. | Optional action: `start`, `stop`, or `rebuild` | Local dashboard process and read endpoints backed by `.thoth` ledgers |
| `report` | `Claude: /thoth:report`<br>`Codex: $thoth report` | Build a structured report from current project truth. | Optional output format such as `md` or `json` | Derived progress report from ledgers and project docs |
| `doctor` | `Claude: /thoth:doctor`<br>`Codex: $thoth doctor` | Audit health, generated surfaces, and runtime shape. | Optional `--quick` or host checks | Health report with validation findings |
| `sync` | `Claude: /thoth:sync`<br>`Codex: $thoth sync` | Regenerate projections and align generated surfaces. | No required positional input | Refreshed host projections and synchronized derived files |
| `extend` | `Claude: /thoth:extend`<br>`Codex: $thoth extend` | Evolve Thoth itself under its own test gates. | Change request or touched paths | Verified repository changes that preserve public-surface parity |

## Why Trust It

| Signal | What you can inspect |
| --- | --- |
| Durable runtime truth | `.thoth/runs/*` keeps run, state, events, artifacts, and result payloads. |
| Locked planning authority | `.thoth/project/decisions/`, `contracts/`, and compiler-generated `tasks/` define what execution is allowed to do. |
| Script-backed verification | Validators, doctor checks, and selftests decide pass or fail mechanically. |
| Shared read model | `status`, `report`, and `dashboard` all read from the same authority instead of chat memory. |

## Who It Is For

| Good fit | Why |
| --- | --- |
| Research and experimentation repos | They need durable memory, replayable results, and visible long-running work. |
| Engineering teams using AI for real changes | They need code execution, review, and acceptance to stay auditable. |
| Teams that want Claude Code and Codex parity | They need one host-neutral command model rather than two drifting workflows. |

## Current Limitations

| Current boundary | Implication |
| --- | --- |
| `run` and `loop` are strict `--task-id` surfaces | Free-form execution is intentionally rejected. |
| Host parity is semantic, not identical UX | Claude and Codex still need their own install and local runtime wiring. |
| Dashboard is a local service, not a hosted control plane | Operators need a machine that can run the backend and frontend assets. |
| The hero logo currently ships as a raster PNG | A clean SVG and icon-family refinement is still useful for smaller surfaces and plugin packaging. |

---

## Contributors

Built in public by contributors who want AI work to remain inspectable.

[![Contributors](https://contrib.rocks/image?repo=SeeleAI/Thoth)](https://github.com/SeeleAI/Thoth/graphs/contributors)

Contribution path: [open a pull request](https://github.com/SeeleAI/Thoth/pulls) or [start a discussion](https://github.com/SeeleAI/Thoth/discussions).

## License

MIT. See [LICENSE](LICENSE).
