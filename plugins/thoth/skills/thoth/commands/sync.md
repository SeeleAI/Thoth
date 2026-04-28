# $thoth sync

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `mechanical_fast`
- intelligence_tier: `none`
- packet_authority_mode: `result_envelope`

## Objective

Report whether generated surfaces are in sync and what changed.

## Hard Stops

- Do not narrate unchanged surfaces.
- Do not hand-maintain generated semantics.

## Reply Contract

- reply_budget_utf8: `60`
- result_style: brief sync receipt
- validator_policy: canonical renderers define parity

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth sync`, but in the workspace shell you must execute it literally as `thoth sync`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=mechanical_fast. intelligence_tier=none. packet_authority_mode=result_envelope. Objective: Report whether generated surfaces are in sync and what changed. Hard stop: Do not narrate unchanged surfaces. Hard stop: Do not hand-maintain generated semantics. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
