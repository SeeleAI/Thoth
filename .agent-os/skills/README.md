# Repository-Local Skills

This directory is the canonical repository-owned source for local development skills used to
maintain Thoth. Skills stored here support repository work such as reviewing new Paseo commits,
transplanting compatible functionality into Thoth, updating evidence and documentation, running
acceptance gates, and preparing authorized releases.

## Layout

Each skill uses its own directory:

```text
.agent-os/skills/<skill-name>/
  SKILL.md
  agents/       # Optional provider-facing discovery metadata
  references/   # Optional focused reference material
  scripts/      # Optional deterministic helpers
  assets/       # Optional reusable assets
```

## Authority

1. `AGENTS.md` and the canonical `.agent-os` project documents remain higher authority than any
   skill in this directory.
2. Skills must follow the current package ownership, single production path, test discipline, and
   release authorization boundaries.
3. Skills should reference current project-state documents instead of duplicating fast-changing
   branch, TODO, blocker, metric, or Release state.
4. All tracked skill documentation, filenames, code comments, and script output must be English.

## Discovery Boundary

This directory is the repository source location. It is not automatically discovered by every
Provider or coding-agent client. Provider-specific discovery paths, such as `.codex/skills`, must
be wired to this source explicitly when a skill is made executable. Do not copy these skills into
user-global homes or modify Provider installations without explicit authorization.

Thoth product runtime skills remain under `packages/drivers/src/runtime-skills/`; they are separate
from the repository-maintenance skills stored here.

Do not add a second README, installation guide, changelog, or quick-reference file inside an
individual skill. Keep the required workflow in `SKILL.md` and load focused `references/` only when
the workflow calls for them.
