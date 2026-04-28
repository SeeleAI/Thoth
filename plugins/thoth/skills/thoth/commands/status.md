# $thoth status

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Report only abnormal state, blockers, and active run deltas.

## Hard Stops

- Do not restate healthy defaults.
- Do not expand into a dashboard walkthrough.

## Reply Contract

- reply_budget_utf8: `56`
- result_style: brief receipt
- validator_policy: runtime truth comes from current authority only

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth status`, but in the workspace shell you must execute it literally as `thoth status`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Report only abnormal state, blockers, and active run deltas. Hard stop: Do not restate healthy defaults. Hard stop: Do not expand into a dashboard walkthrough. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
