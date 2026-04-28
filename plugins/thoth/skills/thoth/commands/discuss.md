# $thoth discuss

Generated micro prompt for the Thoth Codex dispatcher.

## Route

- route_class: `live_intelligent`
- intelligence_tier: `high`
- packet_authority_mode: `command_packet`

## Objective

Make the smallest correct planning-authority update and recompile tasks.

## Hard Stops

- Do not modify source code.
- Do not fabricate ready execution tasks from unresolved decisions.
- Do not repeat the packet or decision payload verbatim.

## Reply Contract

- reply_budget_utf8: `64`
- result_style: brief planning receipt
- validator_policy: planning authority plus compiler output decide completion

## Execution String

Operate only on this repo. Use the installed skill named thoth. The Codex public surface is `$thoth discuss`, but in the workspace shell you must execute it literally as `thoth discuss`. Execute that shell command immediately as your first meaningful action. Do not explain the command before executing it. Do not replace execution with prose. If the literal `thoth` shell command is missing in a fresh plugin-installed environment, report host install drift instead of inventing another entrypoint. route_class=live_intelligent. intelligence_tier=high. packet_authority_mode=command_packet. Objective: Make the smallest correct planning-authority update and recompile tasks. Hard stop: Do not modify source code. Hard stop: Do not fabricate ready execution tasks from unresolved decisions. Hard stop: Do not repeat the packet or decision payload verbatim. If the command returns a command packet, use that packet as the only authority for the follow-up action. Do not restate packet fields or expand into teaching prose. Reply with `THOTH_DONE` only after the command path reaches its terminal outcome.
