# Thoth

**Turn [Claude Code](https://docs.anthropic.com/en/docs/claude-code) into an auditable project operating system with persistent state, mechanical verification, dashboard visibility, and [OpenAI Codex](https://developers.openai.com/codex) delegation.**

Persistent truth + validation scripts + autonomous execution loops = agent work you can actually inspect, recover, and trust.

[![Claude Code](https://img.shields.io/badge/Claude_Code-Plugin-blue?logo=anthropic&logoColor=white)](https://docs.anthropic.com/en/docs/claude-code)
[![Codex](https://img.shields.io/badge/OpenAI_Codex-Delegation-green?logo=openai&logoColor=white)](https://developers.openai.com/codex)
[![Version](https://img.shields.io/badge/version-0.1.1-blue.svg)](https://github.com/Royalvice/Thoth)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[![Project OS](https://img.shields.io/badge/Agent_Project_OS-Audit_%2B_Execution-black)](https://github.com/Royalvice/Thoth)
[![Dashboard](https://img.shields.io/badge/Human_Visibility-Dashboard-8A6A3A)](https://github.com/Royalvice/Thoth)
[![Runtime](https://img.shields.io/badge/Runtime-Claude_today%2C_Codex_next-5B8DEF)](https://github.com/Royalvice/Thoth)

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

Today, Thoth runs as a **Claude Code plugin** and supports **Codex
delegation** as an executor mode on the main public commands. The longer-term
direction is a more host-agnostic, Codex-native runtime.

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

### 1. Install from a marketplace

Add the Thoth marketplace and install the plugin:

```bash
claude plugin marketplace add Royalvice/Thoth --scope user
claude plugin install thoth@thoth --scope user
```

Use `project` or `local` scope instead of `user` if you want a narrower install.

### 2. Install directly from the repository

```bash
git clone https://github.com/Royalvice/Thoth.git
cd Thoth
claude plugin add "$(pwd)"
```

### 3. Initialize a target project

Open the repository you want to manage with Thoth and run:

```text
/thoth:init
```

This scaffolds the project operating layer, including:

- `.research-config.yaml`
- `.agent-os/` state and governance documents
- research-task validation and consistency scripts
- `tools/dashboard/` backend and frontend
- project-local helper scripts and tests

### 4. Start operating the project

Typical first actions:

```text
/thoth:status
/thoth:run <task>
/thoth:loop --mode=task
/thoth:dashboard
```

## Core Capabilities

| Capability | Commands | What it does |
| --- | --- | --- |
| Bootstrap | `/thoth:init` | Creates the project operating layer inside a fresh repository |
| Single-task execution | `/thoth:run` | Executes one focused task with validation, sync, and commit discipline |
| Autonomous iteration | `/thoth:loop` | Runs task-mode or metric-mode loops with verification and rollback logic |
| Governance | `/thoth:discuss`, `/thoth:review` | Separates planning and review from code execution while preserving conclusions |
| Visibility | `/thoth:status`, `/thoth:dashboard`, `/thoth:report` | Surfaces current truth through structured output, dashboard views, and reports |
| Integrity checks | `/thoth:doctor`, `/thoth:sync` | Audits project persistence, reference health, and synchronization |
| Plugin evolution | `/thoth:extend` | Safely evolves the plugin itself under test gates |

### Codex Delegation

Codex is available as an executor mode on the main public commands:

- `/thoth:run --executor codex ...`
- `/thoth:loop --executor codex ...`
- `/thoth:review --executor codex ...`

This is real support today:

- Thoth remains the project operating layer
- Claude Code is the current host runtime
- Codex can already handle delegated execution or review steps

This is **not yet** the final runtime model. It is the bridge toward a more
host-agnostic architecture.

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

- config: `.research-config.yaml`
- state docs: `.agent-os/`
- task validation and consistency tooling
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

## Runtime Today, Direction Tomorrow

### Today

Thoth is currently:

- hosted through **Claude Code**
- installed as a local plugin
- backed by generated project files and scripts
- capable of delegating work to **OpenAI Codex** through executor-mode routing

### Next

The direction is to make Thoth less dependent on Claude Code as the only host:

- deeper Codex integration
- cleaner host/runtime abstraction
- eventual movement toward a more host-agnostic operating model

## Local Development

Run the test suite from the repository root:

```bash
pytest -q
```

Current repository contents include:

- plugin metadata in `.claude-plugin/`
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
