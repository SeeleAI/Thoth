# $thoth run

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

## Objective

Finish the current strict task through the validator-centered controller.

## Hard Stops

- Do not invent or compile a new work item when --work-id is missing.
- Do not stop after reading the packet; terminalize through controller commands only.
- Do not hand-edit .thoth ledgers.

## Reply Contract

- reply_budget_utf8: `36`
- result_style: terminal receipt only
- validator_policy: execute first, validator decides completion, reflect only after validator failure

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth run`, but in the workspace shell you must execute it literally as `thoth run`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=phase_controller. Objective: Finish the current strict task through the validator-centered controller. Hard stop: Do not invent or compile a new work item when --work-id is missing. Hard stop: Do not stop after reading the packet; terminalize through controller commands only. Hard stop: Do not hand-edit .thoth ledgers. If the command returns a live packet, the work is not finished yet. Stay in the same session and obey only the packet plus controller outputs. Default lifecycle is execute -> validate; reflect appears only after validator failure. Do not hand-edit `.thoth`; advance through protocol commands only. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
