# $thoth loop

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `phase_controller`

## Objective

Advance the current bounded loop through foreground or sleeping RuntimeDriver monitoring.

## Hard Stops

- Do not decide extra iterations outside the recorded loop budget.
- Do not skip validator output when judging success.
- Do not expand into iteration diaries or runtime narration.

## Reply Contract

- reply_budget_utf8: `40`
- result_style: terminal receipt only
- validator_policy: parent loop budget controls retries; each child runs plan -> execute -> validate -> reflect

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth loop`, but in the workspace shell you must execute it literally as `thoth loop`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=phase_controller. Objective: Advance the current bounded loop through foreground or sleeping RuntimeDriver monitoring. Hard stop: Do not decide extra iterations outside the recorded loop budget. Hard stop: Do not skip validator output when judging success. Hard stop: Do not expand into iteration diaries or runtime narration. If the command streams runtime events, report progress and risks from those events only. Stay in the same session until the RuntimeDriver reaches terminal state unless --sleep was requested. Runtime lifecycle is plan -> execute -> validate -> reflect. Do not hand-edit `.thoth`; let the Thoth runtime driver advance phases. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
