# $thoth orchestration

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Create a controller object with dependency batches for ready work items.

## Hard Stops

- Do not execute work while creating the controller.
- Do not invent missing work items.

## Reply Contract

- reply_budget_utf8: `56`
- result_style: brief controller receipt
- validator_policy: object graph dependencies define batch order

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth orchestration`, but in the workspace shell you must execute it literally as `thoth orchestration`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Create a controller object with dependency batches for ready work items. Hard stop: Do not execute work while creating the controller. Hard stop: Do not invent missing work items. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
