# Thoth

Dashboard-centered research & engineering project management plugin for Claude Code.

Named after the Egyptian god of writing, wisdom, and magic — Thoth records all truth (audit system) and drives the world forward (execution system).

## Installation

```bash
claude plugin add /path/to/thoth
```

## Commands

| Command | Description |
|---------|-------------|
| `/thoth:init` | Initialize a new project with full Thoth infrastructure |
| `/thoth:run` | Execute a single task (foreground) |
| `/thoth:loop` | Autonomous long-running execution loop |
| `/thoth:discuss` | Discussion mode — update docs/config, no code |
| `/thoth:status` | Print current project state |
| `/thoth:review` | First-principles review |
| `/thoth:doctor` | Audit persistence integrity |
| `/thoth:extend` | Safely extend plugin capabilities |
| `/thoth:sync` | Synchronize all persistence data |
| `/thoth:report` | Generate progress report |
| `/thoth:dashboard` | Start/manage the dashboard |

Codex variants: `/thoth:run:codex`, `/thoth:loop:codex`, `/thoth:review:codex`

## Design Principles

- **Dashboard-centric**: Humans interact through a polished dashboard
- **Script-driven**: Commands rely on scripts, not AI judgment
- **Minimalist**: No unnecessary features, no over-design
- **Test-comprehensive**: Golden data driven, fully autonomous tests
