# $thoth doctor

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Report only failing, drifting, or missing checks.

## Hard Stops

- Do not pad with passing checks.
- Do not claim repo health without checks.

## Reply Contract

- reply_budget_utf8: `64`
- result_style: brief defect receipt
- validator_policy: authority and generated surfaces decide health

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth doctor`, but in the workspace shell you must execute it literally as `thoth doctor`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Report only failing, drifting, or missing checks. Hard stop: Do not pad with passing checks. Hard stop: Do not claim repo health without checks. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
