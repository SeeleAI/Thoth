# $thoth auto

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Create a linear controller queue over ready work items.

## Hard Stops

- Do not create private queue files.
- Do not execute work while creating the controller.

## Reply Contract

- reply_budget_utf8: `56`
- result_style: brief queue receipt
- validator_policy: controller object cursor defines queue state

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth auto`, but in the workspace shell you must execute it literally as `thoth auto`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Create a linear controller queue over ready work items. Hard stop: Do not create private queue files. Hard stop: Do not execute work while creating the controller. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
