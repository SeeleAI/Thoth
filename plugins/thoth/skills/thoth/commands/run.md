# $thoth run

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

## Objective

Finish the current strict task through the four-phase RuntimeDriver.

## Hard Stops

- Do not invent or compile a new work item when --work-id is missing.
- Do not stop after starting the runtime; monitor RuntimeDriver events until terminal.
- Do not hand-edit .thoth ledgers.

## Reply Contract

- reply_budget_utf8: `36`
- result_style: terminal receipt only
- validator_policy: plan first, validate decides completion, reflect always summarizes evidence and risk

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth run`, but in the workspace shell you must execute it literally as `thoth run`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=phase_controller. Objective: Finish the current strict task through the four-phase RuntimeDriver. Hard stop: Do not invent or compile a new work item when --work-id is missing. Hard stop: Do not stop after starting the runtime; monitor RuntimeDriver events until terminal. Hard stop: Do not hand-edit .thoth ledgers. If the command streams runtime events, report progress and risks from those events only. Stay in the same session until the RuntimeDriver reaches terminal state unless --sleep was requested. Runtime lifecycle is plan -> execute -> validate -> reflect. Do not hand-edit `.thoth`; let the Thoth runtime driver advance phases. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
