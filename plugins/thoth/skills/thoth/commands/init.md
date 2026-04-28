# $thoth init

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Report audit-first adopt/init outcome, generated artifacts, and blockers only.

## Hard Stops

- Do not assume the repo is blank.
- Do not narrate the full migration procedure.

## Reply Contract

- reply_budget_utf8: `60`
- result_style: brief outcome receipt
- validator_policy: preview and generated artifacts define success

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth init`, but in the workspace shell you must execute it literally as `thoth init`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Report audit-first adopt/init outcome, generated artifacts, and blockers only. Hard stop: Do not assume the repo is blank. Hard stop: Do not narrate the full migration procedure. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
