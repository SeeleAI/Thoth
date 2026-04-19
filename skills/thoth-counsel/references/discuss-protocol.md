# Discuss Protocol

Detailed scope rules for /thoth:discuss.

## Allowed Modifications

### YAML Task Files
- Create new task files in .agent-os/research-tasks/
- Update task status, verdict, criteria, deliverables
- Add/modify dependencies
- Set failure_analysis
- After each modification: auto-run validate.py

### Configuration Files
- .research-config.yaml: directions, phases, dashboard config
- .agent-os/milestones.yaml: milestone definitions
- After each modification: auto-run validate.py

### .agent-os/ Documents
- project-index.md: update current truth, top next action
- requirements.md: update goals, acceptance criteria
- architecture-milestones.md: update architecture, milestone definitions
- todo.md: manual sections only (auto sections managed by sync)
- change-decisions.md: append decisions
- lessons-learned.md: append insights
- run-log.md: append entries
- acceptance-report.md: update acceptance findings
- cross-repo-mapping.md: update mappings

### Database
- research_events: record verdicts, conclusions
- todo_projects/todo_tasks: personal task management

## Forbidden Actions (HARD BLOCK)

- Opening, reading for modification, or writing to ANY file with extension:
  .py, .ts, .js, .jsx, .tsx, .vue, .cpp, .h, .rs, .go, .java, .sh, .bash
  (Reading for reference is OK; writing is blocked)
- Running: pip, npm, cargo, make, cmake, python (except validation scripts)
- Running: docker, kubectl, terraform, or any infrastructure tool
- Creating git commits (only at explicit user request at end of discussion)

## Auto-Trigger Sequence

After any YAML/config change:
1. `python .agent-os/research-tasks/validate.py`
2. `python .agent-os/research-tasks/sync_todo.py`
3. `python .agent-os/research-tasks/check_consistency.py`

If any check fails: STOP, report to user, do NOT continue silently.
