# $thoth extend

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `command_packet`

## Objective

Complete the requested repository change while preserving generated-surface parity.

## Hard Stops

- Do not bypass repository test gates.
- Do not leave Claude and Codex projections drifting.
- Do not expand into changelog-style prose.

## Reply Contract

- reply_budget_utf8: `60`
- result_style: brief change receipt
- validator_policy: repo tests and surface parity decide completion

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth extend`, but in the workspace shell you must execute it literally as `thoth extend`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=command_packet. Objective: Complete the requested repository change while preserving generated-surface parity. Hard stop: Do not bypass repository test gates. Hard stop: Do not leave Claude and Codex projections drifting. Hard stop: Do not expand into changelog-style prose. If the command returns a command packet, use that packet as the only authority for the follow-up action. Do not restate packet fields or expand into teaching prose. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
