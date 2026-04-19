# Inter-Skill Contracts

Five binding contracts that govern how Thoth components interact.

## CONTRACT-CONFIG

```
precondition:  .research-config.yaml exists at project root
enforcement:   every command checks on startup; missing → exit with "Run /thoth:init"
reads:         directions, phases, deliverable_types, dashboard config
writes:        NEVER (config is human-maintained via /thoth:discuss)
```

## CONTRACT-TASK

```
precondition:  task YAML must pass validate.py (schema check)
enforcement:   pre-commit hook "research-tasks-schema" blocks invalid commits
               verify_on_complete.py blocks unverified completed status
location:      .agent-os/research-tasks/{direction}/{module}/h*.yaml
naming:        {module_id}-h{N}-{short-title}.yaml
```

## CONTRACT-MILESTONE

```
source:        .agent-os/milestones.yaml (YAML, no code)
enforcement:   check_consistency.py verifies task_id existence
reads:         /api/milestones reads live (no cache)
updates:       only via editing milestones.yaml (through /thoth:discuss)
```

## CONTRACT-API

```
schema:        all API responses follow typed interfaces
versioning:    backend app.py version bumps with API changes
frontend:      TypeScript types from types/index.ts
no-raw-fetch:  all requests through api/client.ts, no raw fetch()
```

## CONTRACT-EVIDENCE

```
rule:          verdict non-null → evidence_paths must point to real files
enforcement:   verify_completion.py checks file existence
rule:          criteria.current cannot be null when marking completed
enforcement:   verify_completion.py outputs actionable error message
```
