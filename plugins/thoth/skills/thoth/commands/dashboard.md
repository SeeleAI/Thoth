# $thoth dashboard

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Report endpoint, failure point, and one notable runtime delta only.

## Hard Stops

- Do not narrate the whole UI.
- Do not restate healthy panels.

## Reply Contract

- reply_budget_utf8: `56`
- result_style: brief operator receipt
- validator_policy: dashboard is read-only over .thoth ledgers

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth dashboard`, but in the workspace shell you must execute it literally as `thoth dashboard`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Report endpoint, failure point, and one notable runtime delta only. Hard stop: Do not narrate the whole UI. Hard stop: Do not restate healthy panels. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
