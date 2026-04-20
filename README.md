# Thoth

**An Agent Project OS for auditable, recoverable AI work.**  
**一个面向 AI Agent 的项目操作系统，让执行可追溯、可恢复、可验证。**

Thoth turns agent-driven research and engineering into a real operating system:
not just prompts, but a persistent project layer with audit trails, validation
scripts, generated state documents, and a dashboard humans can trust.

Named after the god of writing and wisdom, Thoth is built around two connected
systems:

- **Audit System**: truth, evidence, decisions, recoverability
- **Execution System**: tasks, loops, verification, delegation

Today, Thoth runs as a **Claude Code plugin** with **Codex delegation support**.
Its longer-term direction is a more **host-agnostic, Codex-native runtime**.

> Hero visual coming soon.  
> The art direction is intentionally centered on the "dual systems" model:
> one side for audit and visibility, one side for execution and automation.

## Why Thoth / 为什么需要 Thoth

Most agent workflows disappear into chat history:

- plans drift
- decisions are not recorded
- evidence is hard to recover
- execution and review live in different places
- humans cannot easily see what is true right now

Thoth solves that by materializing project state into files, scripts, and
interfaces that survive the conversation.

Thoth 不是一个“给 Agent 多几条 prompt”的工具。  
它会把项目状态真正落到仓库里，让人和 Agent 看到的是同一套系统事实。

## Quick Start / 快速开始

### 1. Clone and install the plugin

```bash
git clone https://github.com/Royalvice/thoth.git
cd thoth
claude plugin add "$(pwd)"
```

### 2. Initialize a target project

Open the project you want to manage with Thoth, then run:

```text
/thoth:init
```

This scaffolds the project operating layer, including:

- `.research-config.yaml`
- `.agent-os/` state and governance documents
- research-task validation scripts
- `tools/dashboard/` backend and frontend
- project-local helper scripts and tests

### 3. Start using the system

Typical first actions:

```text
/thoth:status
/thoth:run <task>
/thoth:loop --mode=task
/thoth:dashboard
```

## What Thoth Is / Thoth 是什么

Thoth is an **Agent Project OS** for research and engineering teams who want:

- persistent project truth instead of chat-only context
- execution loops with mechanical verification
- decision records and evidence trails
- dashboard visibility for humans
- a clean bridge between planning, doing, reviewing, and reporting

It is especially suited to workflows where agents are already doing meaningful
work, but the project still needs governance, memory, and acceptance discipline.

## Core Capabilities / 核心能力

| Capability | Commands | What it does |
| --- | --- | --- |
| Bootstrap | `/thoth:init` | Create the project operating layer in a fresh repo |
| Single-task execution | `/thoth:run` | Execute one focused task with validation, sync, and commit discipline |
| Autonomous iteration | `/thoth:loop` | Run task-mode or metric-mode loops with verification and rollback logic |
| Discussion and governance | `/thoth:discuss`, `/thoth:review` | Separate planning/review from code execution, and preserve conclusions |
| Visibility | `/thoth:status`, `/thoth:dashboard`, `/thoth:report` | Surface current truth through structured output, dashboard views, and progress reports |
| Integrity checks | `/thoth:doctor`, `/thoth:sync` | Audit project persistence, required files, reference health, and synchronization |
| Plugin evolution | `/thoth:extend` | Safely evolve the plugin itself under test gates |

### Codex Delegation / Codex 委派

Thoth already exposes Codex-enabled variants:

- `/thoth:run:codex`
- `/thoth:loop:codex`
- `/thoth:review:codex`

Current meaning:

- Thoth remains the project operating layer
- Claude Code is the current host runtime
- Codex can already be delegated specific execution or review work

This is **real support today**, but it is **not yet** the final runtime model.

## How It Works / 工作方式

Thoth operates in two layers.

### 1. Plugin Layer

The Thoth repository provides:

- command contracts under `.claude/commands/`
- behavioral skills under `skills/`
- automation hooks under `hooks/`
- management scripts under `scripts/`
- deployable project templates under `templates/`

This layer defines how the operating system behaves.

### 2. Project Layer

When you run `/thoth:init` in a target repo, Thoth generates a persistent
project layer with:

- config: `.research-config.yaml`
- state docs: `.agent-os/`
- task validation and consistency tooling
- dashboard backend/frontend
- project-local scripts and tests

This is the critical idea: **Thoth does not only tell the agent what to do; it
installs the project substrate that makes the work inspectable and recoverable.**

## Command Model / 命令模型

Thoth is designed around distinct modes rather than one overloaded assistant.

### Execution

- `/thoth:run`: do one thing well
- `/thoth:loop`: iterate with verification and decision logic
- `*:codex`: delegate selected work to Codex while preserving Thoth control

### Governance

- `/thoth:discuss`: change docs, config, and task state without touching code
- `/thoth:review`: step outside the current solution and critique it from first principles

### Visibility and Health

- `/thoth:status`: print a structured snapshot of the current project state
- `/thoth:dashboard`: start the dashboard for human-facing visibility
- `/thoth:doctor`: audit whether the project state is healthy and internally consistent
- `/thoth:sync`: align generated views and references
- `/thoth:report`: build a progress report from the recorded project state

## Design Principles / 设计原则

- **Audit-first**: no silent completion claims without evidence
- **Execution with verification**: loops must validate, not just act
- **Recoverable state**: important truth must live in files, not only in chat
- **Dashboard visibility**: humans need an operating view, not raw agent traces
- **Script-backed behavior**: the system relies on scripts and contracts, not pure improvisation
- **Tested infrastructure**: golden-data-driven tests protect the operating layer

## Current Runtime and Future Direction / 当前运行时与未来方向

### Today

Thoth is currently:

- hosted through **Claude Code**
- installed as a local plugin
- backed by generated project files and scripts
- capable of **delegating work to Codex** through `:codex` command variants

### Next

The intended direction is to make Thoth less dependent on Claude Code as the
only host. That means:

- deeper Codex integration
- cleaner host/runtime abstraction
- eventually running the operating model in a more host-agnostic way

README 中的 Codex 表述代表的是：
现在已经有委派能力；未来会继续往脱离单一宿主、走向更原生的运行时架构推进。

## Local Development / 本地开发

Run the test suite from the repository root:

```bash
pytest -q
```

Current repository contents include:

- plugin metadata in `.claude-plugin/`
- command definitions in `.claude/commands/`
- skills in `skills/`
- scripts in `scripts/`
- dashboard and project templates in `templates/`
- unit and integration tests in `tests/`

## Contributing / 贡献

Thoth is now a standalone open-source project. Contributions that improve the
operating model, validation logic, dashboard experience, runtime abstractions,
or documentation are welcome.

When changing behavior, prefer updating tests and contracts together so the
system remains trustworthy as it evolves.

## License / 许可证

MIT. See [LICENSE](LICENSE).
