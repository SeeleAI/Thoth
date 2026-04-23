# Changelog

## [0.1.4] - 2026-04-23

### Fixed
- Restored explicit `thoth:*` public command names so installed plugin commands render as `/thoth:*` instead of bare command names

## [0.1.2] - 2026-04-23

### Changed
- Collapsed Codex delegation into `--executor codex` on the main public commands
- Moved internal behavioral contracts out of the public plugin `skills/` surface into `contracts/`
- Added internal `thoth-main` and `codex-worker` agents plus plugin `settings.json`

### Fixed
- Removed internal Thoth helper modules and dedicated Codex variants from the public slash-command surface

## [0.1.1] - 2026-04-22

### Changed
- Migrated plugin commands to standard root-level `commands/` layout
- Added teaser figure asset and linked it from the README
- Rewrote README for public open-source plugin positioning

### Added
- Added `.claude-plugin/marketplace.json` for Claude Code marketplace distribution
- Added repository homepage and author metadata to the plugin manifest

### Fixed
- Updated `hooks/hooks.json` to match Claude Code plugin validation format

## [0.1.0] - 2026-04-19

### Added
- Initial plugin skeleton
- 7 skills: core, audit, exec, memory, counsel, codex, testing
- 11 commands + 3 codex variants
- Session lifecycle hooks (SessionStart, SessionEnd)
- Codex rescue subagent
