# $thoth report

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Compress the current authority state into one short report outcome.

## Hard Stops

- Do not replay the full run log.
- Do not invent missing evidence.

## Reply Contract

- reply_budget_utf8: `80`
- result_style: brief receipt with output path
- validator_policy: report must stay authority-derived

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth report`, but in the workspace shell you must execute it literally as `thoth report`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Compress the current authority state into one short report outcome. Hard stop: Do not replay the full run log. Hard stop: Do not invent missing evidence. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
