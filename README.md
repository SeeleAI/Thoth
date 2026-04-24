# Thoth

**Turn Claude Code and OpenAI Codex into two host surfaces over one auditable Thoth runtime with persistent state, mechanical verification, and dashboard visibility.**

Persistent truth + validation scripts + autonomous execution loops = agent work you can actually inspect, recover, and trust.

[![Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-blue?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex](https://img.shields.io/badge/OpenAI_Codex-Plugin-green?logo=openai&logoColor=white)](https://developers.openai.com/codex)
[![Version](https://img.shields.io/badge/version-0.1.4-blue.svg)](https://github.com/SeeleAI/Thoth)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[![Project OS](https://img.shields.io/badge/Agent_Project_OS-Audit_%2B_Execution-black)](https://github.com/SeeleAI/Thoth)
[![Dashboard](https://img.shields.io/badge/Human_Visibility-Dashboard-8A6A3A)](https://github.com/SeeleAI/Thoth)
[![Runtime](https://img.shields.io/badge/Runtime-Claude_%2B_Codex-5B8DEF)](https://github.com/SeeleAI/Thoth)

<br>

![Thoth teaser figure](assets/thoth-teaser-figure.png)

*Thoth bridges a human-facing audit dashboard with an AI execution engine through shared persistent project state.*

Thoth is an **Agent Project OS** for research and engineering workflows. It
does not stop at prompting conventions: it installs a persistent project layer
with state documents, validation scripts, generated structure, and a dashboard
humans can use to see what is actually true.

At the center of Thoth are two connected systems:

- **Audit System**: truth, evidence, decisions, recoverability
- **Execution System**: tasks, loops, verification, delegation

Thoth now treats **`.thoth` as the only runtime authority** and exposes two
official host surfaces:

- **Claude**: `/thoth:*`
- **Codex**: `$thoth <command>`

Both surfaces project from the same host-neutral command specification and
write through the same runtime ledger shape.

## Why Thoth

Most agent workflows disappear into chat history:

- plans drift
- decisions are lost
- evidence is hard to recover
- execution and review happen in different places
- humans cannot easily see current project truth

Thoth solves that by materializing agent work into a real operating layer:

- persistent project state in files
- mechanical validation and consistency checks
- explicit execution and governance modes
- dashboard-visible progress and health
- recoverable project memory outside the chat window

## Quick Start

### 1. Install in Claude Code

Add the Thoth marketplace and install the plugin:

```bash
claude plugin marketplace add SeeleAI/Thoth --scope user
claude plugin install thoth@thoth --scope user
```

Use `project` or `local` scope instead of `user` if you want a narrower install.

Claude `/thoth:*` commands execute the repo-local Thoth CLI through the plugin
bridge before Claude summarizes the result. On the first run, Claude may ask
you to approve `scripts/thoth-claude-command.sh`; you can either approve it
once, add a project-local allow rule in `.claude/settings.local.json`, or set a
global allow rule in `~/.claude/settings.json` if you want Thoth to work
without approval prompts across all projects.

### 2. Install in Codex

Codex uses the marketplace source as the install and enable step:

```bash
codex plugin marketplace add SeeleAI/Thoth
```

Update an existing Codex install:

```bash
codex plugin marketplace upgrade thoth
```

### 3. Install from a local checkout

```bash
git clone https://github.com/SeeleAI/Thoth.git
cd Thoth
claude plugin add "$(pwd)"
codex plugin marketplace add "$(pwd)"
```

### 4. Initialize a target project

Open the repository you want to manage with Thoth and run:

```text
/thoth:init
$thoth init
```

This audits the current repository first, then adopts or scaffolds the project
operating layer with a recorded migration bundle. It can start from a blank
repository or an already-drifted repo that already contains docs, `.agent-os/`,
or partial Thoth state. The managed layer includes:

- `.agent-os/` state and governance documents
- `.thoth/` runtime authority tree
- strict `Decision -> Contract -> generated Task` planning authority
- repo-level verdict ledger under `.thoth/project/verdicts/`
- strict sync / doctor validation scripts
- `tools/dashboard/` backend and frontend
- project-local helper scripts and tests

Use `/thoth:init` inside Claude Code and `$thoth init` inside Codex. Both routes
write the same `.thoth` authority tree.

### 5. Start operating the project

Typical first actions:

```text
/thoth:status
/thoth:run --task-id <task_id>
/thoth:loop --task-id <task_id>
/thoth:dashboard

$thoth status
$thoth run --task-id <task_id>
$thoth loop --task-id <task_id>
$thoth dashboard
```

## Core Capabilities

| Capability | Commands | What it does |
| --- | --- | --- |
| Bootstrap | `/thoth:init` | Audits the current repository and adopts/scaffolds the managed Thoth project layer |
| Single-task execution | `/thoth:run` | Executes one focused task with validation, sync, and commit discipline |
| Autonomous iteration | `/thoth:loop` | Runs task-mode or metric-mode loops with verification and rollback logic |
| Governance | `/thoth:discuss`, `/thoth:review` | Separates planning and review from code execution while preserving conclusions |
| Visibility | `/thoth:status`, `/thoth:dashboard`, `/thoth:report` | Surfaces current truth through structured output, dashboard views, and reports |
| Integrity checks | `/thoth:doctor`, `/thoth:sync` | Audits project persistence, reference health, and synchronization |
| Plugin evolution | `/thoth:extend` | Safely evolves the plugin itself under test gates |

### Codex Native And Delegation

Claude still supports Codex delegation on the main public commands:

- `/thoth:run --executor codex ...`
- `/thoth:loop --executor codex ...`
- `/thoth:review --executor codex ...`

Codex also has its own official single-entry public surface:

```text
$thoth init
$thoth run
$thoth loop
$thoth review
$thoth status
```

The Codex plugin is packaged through `.codex-plugin/plugin.json` and exposes one
public skill bundle rooted at `.agents/skills/thoth/`.

Both surfaces share the same runtime rules:

- `.thoth` is the only authority
- execution planning is strict: `Decision -> Contract -> compiler-generated Task`
- `run` and `loop` execute only by `--task-id`; free-form execution is intentionally rejected
- `run` and `loop` are durable by default
- attach / resume / watch / stop operate on the same run ledger
- dashboard reads `.thoth/runs/*`, not host session state

## How It Works

Thoth operates in two layers.

### 1. Plugin Layer

The Thoth repository provides:

- public command definitions in `commands/`
- internal contracts in `contracts/`
- internal agents in `agents/`
- automation hooks in `hooks/`
- management scripts in `scripts/`
- deployable project templates in `templates/`

This layer defines how the operating system behaves.

### 2. Project Layer

When you run `/thoth:init` in a target repository, Thoth generates a persistent
project layer with:

- state docs: `.agent-os/`
- runtime authority: `.thoth/`
- planning authority: `.thoth/project/decisions`, `.thoth/project/contracts`, `.thoth/project/tasks`
- repo-level verdict authority: `.thoth/project/verdicts`
- strict sync / doctor validation tooling
- dashboard backend and frontend
- project-local scripts and tests

That is the core idea: **Thoth does not only tell the agent what to do; it
installs the project substrate that makes the work inspectable and recoverable.**

## Command Model

Thoth is designed around distinct operating modes rather than one overloaded
assistant surface.

### Execution

- `/thoth:run` for one focused change
- `/thoth:loop` for iterative execution with decision logic
- `--executor codex` for delegated Codex work under Thoth control

### Governance

- `/thoth:discuss` for docs, config, and task-state changes without touching code
- `/thoth:review` for first-principles critique outside the active implementation path

### Visibility and Health

- `/thoth:status` prints a structured project snapshot
- `/thoth:dashboard` starts the human-facing dashboard
- `/thoth:doctor` audits project health and consistency
- `/thoth:sync` aligns generated views and references
- `/thoth:report` builds progress reports from recorded state

## Design Principles

- **Audit-first**: no silent completion claims without evidence
- **Execution with verification**: loops must validate, not just act
- **Recoverable state**: important truth must live in files, not only in chat
- **Dashboard visibility**: humans need an operating view, not raw agent traces
- **Script-backed behavior**: the system relies on contracts and scripts, not pure improvisation
- **Tested infrastructure**: golden-data-driven tests protect the operating layer

## Self-Test Gates

Thoth now ships a heavy self-test orchestration entrypoint that exercises the
real CLI, real temporary repositories, real dashboard processes, fault
injection, and optional host-native Codex / Claude matrices.

Run the daily process-real gate:

```bash
python scripts/selftest.py --tier hard
```

Run the heavy gate with dashboard browser validation and host-real matrices:

```bash
python scripts/selftest.py --tier heavy --hosts auto
```

The runner writes a machine-readable summary plus artifacts for command
transcripts, ledger snapshots, dashboard payloads, and browser traces.

## Runtime Today, Direction Tomorrow

### Today

Thoth is currently:

- generated from a host-neutral public command spec
- published as both a Claude plugin surface and an official Codex plugin surface
- backed by a durable `.thoth/runs/*` ledger plus machine-local supervisor registry
- observable in the dashboard through shared runtime summaries

## Local Development

Run the test suite from the repository root:

```bash
pytest -q
```

Branch policy:

- Do day-to-day development on `dev`
- Treat `main` as the stable integration and release branch
- Do not directly modify `main` for normal feature or code development
- Promote changes from `dev` into `main` deliberately, with `cherry-pick` as the default path
- Do not commit normal development work straight onto `main`; land it on `dev` first and promote reviewed code later

Current repository contents include:

- plugin metadata in `.codex-plugin/`
- plugin metadata in `.claude-plugin/`
- Codex skill metadata in `.agents/skills/`
- public commands in `commands/`
- internal contracts in `contracts/`
- internal agents in `agents/`
- scripts in `scripts/`
- dashboard and project templates in `templates/`
- unit and integration tests in `tests/`

## Contributing

Thoth is now a standalone open-source project. Contributions that improve the
operating model, validation logic, dashboard experience, runtime abstractions,
or documentation are welcome.

When changing behavior, update tests and contracts together so the system stays
trustworthy as it evolves.

## License

MIT. See [LICENSE](LICENSE).

## References

- [karpathy/autoresearch](https://github.com/karpathy/autoresearch)
- [uditgoenka/autoresearch](https://github.com/uditgoenka/autoresearch)
