# Change Decisions

This file records user decisions that change how New Thoth should be interpreted.

## Decisions

1. `NTH-CD-001` `[2026-06-27]`: The old Thoth plugin form is the final archived plugin line. It is no longer maintained. Archive release: `thoth-plugin-final-archive`. Archive branch: `archive/main-20260627`.
2. `NTH-CD-002` `[2026-06-28]`: New Thoth starts fresh. Old plugin code should be removed from the active working tree after enough design information is extracted.
3. `NTH-CD-003` `[2026-06-28]`: The New Thoth design authority is the core principles document plus three canonical design documents: high-level design, MVP user journey and engineering architecture.
4. `NTH-CD-004` `[2026-06-28]`: The hardest product problems are clarify quality and aggressive loop design, not ordinary software development.
5. `NTH-CD-005` `[2026-06-28]`: New Thoth should behave like a real private secretary for a high-authority user. It should remember context and ask only a few golden questions when human judgment is truly needed.
6. `NTH-CD-006` `[2026-06-28]`: A task loop must aggressively solve the previous unresolved problem. It must not mechanically repeat runs or only add incremental tests.
7. `NTH-CD-007` `[2026-06-28]`: The active repo reset uses `GPL-3.0-only`, `npm workspaces`, package namespace `@thoth/*`, version `0.0.0`, and package skeletons marked `private: true`.
8. `NTH-CD-008` `[2026-06-28]`: TUI must use OpenTUI. Node/Bun runtime choice is intentionally deferred to the first TUI spike.
9. `NTH-CD-009` `[2026-06-28]`: Old prompt assets are preserved as docs-only structured contract seeds, not as executable Python code.
10. `NTH-CD-010` `[2026-06-28]`: `CLAUDE.md` should be a symlink to `AGENTS.md` in this reset.
